#!/usr/bin/env python3
"""
Music Database Module - Redis based database
Stores music metadata in Redis, files remain on filesystem
With real-time file watching support
"""

import os
import json
import time
import threading
from threading import Lock

# Try to import redis
try:
    import redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
    print("[WARNING] redis not installed, please install: pip install redis")

# Try to import watchdog for file watching
try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
    WATCHDOG_AVAILABLE = True
except ImportError:
    WATCHDOG_AVAILABLE = False
    print("[WARNING] watchdog not installed, please install: pip install watchdog")

# Configuration
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
MUSIC_DIR = os.path.join(DATA_DIR, 'music')
LRC_DIR = os.path.join(DATA_DIR, 'lrc')
COVER_DIR = os.path.join(DATA_DIR, 'Segment')

# Redis configuration
REDIS_HOST = os.environ.get('REDIS_HOST', 'localhost')
REDIS_PORT = int(os.environ.get('REDIS_PORT', 6379))
REDIS_DB = int(os.environ.get('REDIS_DB', 0))
REDIS_PASSWORD = os.environ.get('REDIS_PASSWORD', None)

# Redis key prefixes
KEY_MUSIC = 'music:{}'           # Hash: music metadata
KEY_MUSIC_LIST = 'music:list'    # Sorted set: all music IDs
KEY_LYRICS = 'lyrics:{}'         # String: lyrics content
KEY_COVER = 'cover:{}'           # Hash: cover metadata
KEY_USER = 'user:{}'             # Hash: user data
KEY_FAVORITES = 'favorites:{}'   # Set: user's favorite music IDs
KEY_STATS = 'stats'              # Hash: database statistics

db_lock = Lock()
redis_client = None


def get_redis_connection():
    """Get Redis connection (singleton)"""
    global redis_client
    if redis_client is None:
        if not REDIS_AVAILABLE:
            raise ImportError("Redis is not installed. Please install: pip install redis")
        redis_client = redis.Redis(
            host=REDIS_HOST,
            port=REDIS_PORT,
            db=REDIS_DB,
            password=REDIS_PASSWORD,
            decode_responses=True,
            socket_connect_timeout=5,
            socket_timeout=5,
            retry_on_timeout=True
        )
        # Test connection
        try:
            redis_client.ping()
            print(f"[DB] Connected to Redis at {REDIS_HOST}:{REDIS_PORT}")
        except redis.ConnectionError as e:
            print(f"[ERROR] Cannot connect to Redis: {e}")
            raise
    return redis_client


def reset_database():
    """Reset database - clear all data"""
    r = get_redis_connection()
    with db_lock:
        # Get all keys with our prefixes
        patterns = ['music:*', 'lyrics:*', 'cover:*', 'user:*', 'favorites:*', 'stats', 'music:list']
        for pattern in patterns:
            keys = r.keys(pattern)
            if keys:
                r.delete(*keys)
    print("[DB] Database reset - all data cleared")


def init_database():
    """Initialize database connection"""
    # Ensure directories exist
    os.makedirs(MUSIC_DIR, exist_ok=True)
    os.makedirs(LRC_DIR, exist_ok=True)
    os.makedirs(COVER_DIR, exist_ok=True)
    
    # Test Redis connection
    r = get_redis_connection()
    print("[DB] Database initialized (Redis)")


def get_mime_type(filename):
    """Get MIME type from filename"""
    ext = os.path.splitext(filename)[1].lower()
    mime_types = {
        '.mp3': 'audio/mpeg',
        '.flac': 'audio/flac',
        '.wav': 'audio/wav',
        '.aac': 'audio/aac',
        '.ogg': 'audio/ogg',
        '.m4a': 'audio/mp4',
        '.lrc': 'text/plain',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
    }
    return mime_types.get(ext, 'application/octet-stream')


def get_audio_duration(file_path):
    """Get audio file duration in seconds"""
    try:
        from mutagen.mp3 import MP3
        from mutagen.flac import FLAC
        from mutagen.mp4 import MP4
        
        ext = os.path.splitext(file_path)[1].lower()
        if ext == '.mp3':
            audio = MP3(file_path)
        elif ext == '.flac':
            audio = FLAC(file_path)
        elif ext in ['.m4a', '.mp4']:
            audio = MP4(file_path)
        else:
            return 0
        
        return int(audio.info.length)
    except Exception as e:
        print(f"[DB] Warning: Cannot get duration for {file_path}: {e}")
        return 0


def scan_and_sync_music(music_dir, lrc_dir=None, cover_dir=None):
    """Scan music files and sync to Redis"""
    import re
    
    start_time = time.time()
    r = get_redis_connection()

    if lrc_dir is None:
        lrc_dir = LRC_DIR
    if cover_dir is None:
        cover_dir = COVER_DIR

    # Get existing files from Redis
    existing_ids = r.zrange(KEY_MUSIC_LIST, 0, -1)
    existing_files = {}
    for music_id in existing_ids:
        music_data = r.hgetall(KEY_MUSIC.format(music_id))
        if music_data:
            existing_files[music_data.get('filename')] = music_id

    music_files = []
    for filename in os.listdir(music_dir):
        if filename.lower().endswith(('.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a')):
            music_files.append(filename)

    # Filter only new or modified files
    files_to_process = []
    for filename in music_files:
        file_path = os.path.join(music_dir, filename)
        stat = os.stat(file_path)
        file_mtime = stat.st_mtime

        if filename not in existing_files:
            files_to_process.append((filename, file_path, stat))
        else:
            # Check if file was modified
            music_id = existing_files[filename]
            updated_at = r.hget(KEY_MUSIC.format(music_id), 'updated_at')
            if updated_at:
                try:
                    db_timestamp = float(updated_at)
                    if file_mtime > db_timestamp + 60:
                        files_to_process.append((filename, file_path, stat))
                except:
                    files_to_process.append((filename, file_path, stat))

    print(f"[DB] Found {len(music_files)} music files, {len(files_to_process)} need to be processed")

    with db_lock:
        for filename, file_path, stat in files_to_process:
            title, artist = parse_song_info(filename)
            mime_type = get_mime_type(filename)
            duration = get_audio_duration(file_path)

            # Generate music ID
            if filename in existing_files:
                music_id = existing_files[filename]
            else:
                music_id = r.incr('music:id:counter')

            # Find lyrics
            lrc_filename = None
            lrc_content = None
            song_name_normalized = normalize_name(os.path.splitext(filename)[0])

            potential_lrc = os.path.splitext(filename)[0] + '.lrc'
            if os.path.exists(os.path.join(lrc_dir, potential_lrc)):
                lrc_filename = potential_lrc
                try:
                    with open(os.path.join(lrc_dir, lrc_filename), 'r', encoding='utf-8', errors='ignore') as f:
                        lrc_content = f.read()
                except Exception as e:
                    print(f"[DB] Error reading lyrics {lrc_filename}: {e}")
            else:
                if os.path.exists(lrc_dir):
                    for lrc_file in os.listdir(lrc_dir):
                        if lrc_file.lower().endswith('.lrc'):
                            lrc_normalized = normalize_name(os.path.splitext(lrc_file)[0])
                            if lrc_normalized == song_name_normalized:
                                lrc_filename = lrc_file
                                try:
                                    with open(os.path.join(lrc_dir, lrc_filename), 'r', encoding='utf-8', errors='ignore') as f:
                                        lrc_content = f.read()
                                except Exception as e:
                                    print(f"[DB] Error reading lyrics {lrc_filename}: {e}")
                                break

            # Find cover
            cover_filename = None
            for ext in ['.jpg', '.jpeg', '.png', '.webp']:
                potential_cover = os.path.splitext(filename)[0] + ext
                if os.path.exists(os.path.join(cover_dir, potential_cover)):
                    cover_filename = potential_cover
                    break
                if os.path.exists(cover_dir):
                    for cover_file in os.listdir(cover_dir):
                        if cover_file.lower().endswith(ext):
                            cover_normalized = normalize_name(os.path.splitext(cover_file)[0])
                            if cover_normalized == song_name_normalized:
                                cover_filename = cover_file
                                break
                    if cover_filename:
                        break

            # Store music metadata in Redis (compatible with Redis 3.0)
            music_key = KEY_MUSIC.format(music_id)
            # Use hmset for Redis 3.0 compatibility
            r.hmset(music_key, {
                'id': music_id,
                'filename': filename,
                'title': title,
                'artist': artist,
                'album': '',
                'size': stat.st_size,
                'duration': duration,
                'mime_type': mime_type,
                'file_path': file_path,
                'has_lyrics': '1' if lrc_content else '0',
                'has_cover': '1' if cover_filename else '0',
                'lrc_filename': lrc_filename or '',
                'cover_filename': cover_filename or '',
                'created_at': time.time(),
                'updated_at': time.time()
            })

            # Add to music list (sorted by title)
            r.zadd(KEY_MUSIC_LIST, {music_id: 0})

            # Store lyrics
            if lrc_content:
                r.set(KEY_LYRICS.format(music_id), lrc_content)

            # Store cover metadata (compatible with Redis 3.0)
            if cover_filename:
                cover_path = os.path.join(cover_dir, cover_filename)
                r.hmset(KEY_COVER.format(music_id), {
                    'filename': cover_filename,
                    'mime_type': get_mime_type(cover_filename),
                    'file_path': cover_path
                })

        # Remove deleted files from Redis
        if existing_files:
            deleted_files = set(existing_files.keys()) - set(music_files)
            for filename in deleted_files:
                music_id = existing_files[filename]
                r.delete(KEY_MUSIC.format(music_id))
                r.delete(KEY_LYRICS.format(music_id))
                r.delete(KEY_COVER.format(music_id))
                r.zrem(KEY_MUSIC_LIST, music_id)
            if deleted_files:
                print(f"[DB] Removed {len(deleted_files)} deleted files from database")

    elapsed = time.time() - start_time
    print(f"[DB] Synced {len(files_to_process)} music files to Redis in {elapsed:.2f}s")


def parse_song_info(filename):
    """Parse song info from filename"""
    name_without_ext = os.path.splitext(filename)[0]
    normalized_name = name_without_ext.replace('\u2013', '-').replace('\u2014', '-')

    if '-' in normalized_name:
        parts = normalized_name.split('-', 1)
        title = parts[0].strip()
        artist = parts[1].strip()
        artist = artist.replace('&', ' & ').replace(',', ' & ')
    else:
        title = name_without_ext
        artist = 'Unknown Artist'

    return title, artist


def normalize_name(name):
    """Normalize name for matching"""
    name = os.path.splitext(name)[0]
    name = name.lower()
    for char in [' ', '-', '_', '&', "'", '(', ')', '.', ',']:
        name = name.replace(char, '')
    return name


def get_all_music():
    """Get all music metadata from Redis"""
    r = get_redis_connection()
    music_ids = r.zrange(KEY_MUSIC_LIST, 0, -1)
    
    results = []
    for music_id in music_ids:
        music_data = r.hgetall(KEY_MUSIC.format(music_id))
        if music_data:
            # Convert string values to appropriate types
            music_data['id'] = int(music_data['id'])
            music_data['size'] = int(music_data.get('size', 0))
            music_data['duration'] = int(music_data.get('duration', 0))
            music_data['hasLyrics'] = music_data.get('has_lyrics') == '1'
            music_data['hasCover'] = music_data.get('has_cover') == '1'
            music_data['url'] = f'/api/music/{music_id}/download'
            music_data['lrcUrl'] = f'/api/lyrics/{music_id}' if music_data['hasLyrics'] else None
            music_data['coverUrl'] = f'/api/cover/{music_id}' if music_data['hasCover'] else None
            
            # Remove internal fields
            music_data.pop('has_lyrics', None)
            music_data.pop('has_cover', None)
            music_data.pop('lrc_filename', None)
            music_data.pop('cover_filename', None)
            music_data.pop('file_path', None)
            
            results.append(music_data)
    
    return results


def get_music_by_id(music_id):
    """Get music metadata by ID"""
    r = get_redis_connection()
    music_data = r.hgetall(KEY_MUSIC.format(music_id))
    if music_data:
        music_data['id'] = int(music_data['id'])
        music_data['size'] = int(music_data.get('size', 0))
        music_data['duration'] = int(music_data.get('duration', 0))
    return music_data if music_data else None


def get_music_data(music_id):
    """Get music file path by ID"""
    r = get_redis_connection()
    music_data = r.hgetall(KEY_MUSIC.format(music_id))
    if music_data:
        file_path = music_data.get('file_path')
        if file_path and os.path.exists(file_path):
            return {
                'filename': music_data['filename'],
                'mime_type': music_data['mime_type'],
                'file_path': file_path,
                'cover_path': music_data.get('cover_path'),
                'lrc_path': music_data.get('lrc_path')
            }
    return None


def get_music_by_filename(filename):
    """Get music metadata by filename"""
    r = get_redis_connection()
    # Search all music entries
    music_ids = r.zrange(KEY_MUSIC_LIST, 0, -1)
    for music_id in music_ids:
        music_data = r.hgetall(KEY_MUSIC.format(music_id))
        if music_data and music_data.get('filename') == filename:
            music_data['id'] = int(music_data['id'])
            music_data['size'] = int(music_data.get('size', 0))
            music_data['duration'] = int(music_data.get('duration', 0))
            music_data['has_lyrics'] = music_data.get('has_lyrics') == '1'
            music_data['has_cover'] = music_data.get('has_cover') == '1'
            return music_data
    return None


def get_lyrics_by_music_id(music_id):
    """Get lyrics content by music ID"""
    r = get_redis_connection()
    return r.get(KEY_LYRICS.format(music_id))


def update_lyrics_by_filename(lrc_filename, lrc_content):
    """Update or insert lyrics by filename"""
    r = get_redis_connection()
    
    try:
        # Get the base name without extension to match with music file
        base_name = os.path.splitext(lrc_filename)[0]
        
        # Find the corresponding music file
        music_ids = r.zrange(KEY_MUSIC_LIST, 0, -1)
        for music_id in music_ids:
            music_data = r.hgetall(KEY_MUSIC.format(music_id))
            if music_data:
                music_filename = music_data.get('filename', '')
                music_base = os.path.splitext(music_filename)[0]
                if music_base == base_name or music_filename.startswith(base_name):
                    # Store lyrics
                    r.set(KEY_LYRICS.format(music_id), lrc_content)
                    # Update music metadata
                    r.hset(KEY_MUSIC.format(music_id), 'has_lyrics', '1')
                    r.hset(KEY_MUSIC.format(music_id), 'lrc_filename', lrc_filename)
                    print(f"[DB] Lyrics updated for '{music_filename}' (ID: {music_id})")
                    return True
        
        print(f"[DB] No matching music file found for lyrics: '{lrc_filename}'")
        return False
    except Exception as e:
        print(f"[DB] Error updating lyrics for '{lrc_filename}': {e}")
        return False


def update_cover_by_filename(cover_filename, cover_path):
    """Update or insert cover by filename"""
    r = get_redis_connection()
    
    try:
        # Get the base name without extension to match with music file
        base_name = os.path.splitext(cover_filename)[0]
        
        # Find the corresponding music file
        music_ids = r.zrange(KEY_MUSIC_LIST, 0, -1)
        for music_id in music_ids:
            music_data = r.hgetall(KEY_MUSIC.format(music_id))
            if music_data:
                music_filename = music_data.get('filename', '')
                music_base = os.path.splitext(music_filename)[0]
                if music_base == base_name or music_filename.startswith(base_name):
                    # Store cover metadata
                    r.hmset(KEY_COVER.format(music_id), {
                        'filename': cover_filename,
                        'mime_type': get_mime_type(cover_filename),
                        'file_path': cover_path
                    })
                    # Update music metadata
                    r.hset(KEY_MUSIC.format(music_id), 'has_cover', '1')
                    r.hset(KEY_MUSIC.format(music_id), 'cover_filename', cover_filename)
                    r.hset(KEY_MUSIC.format(music_id), 'cover_path', cover_path)
                    print(f"[DB] Cover updated for '{music_filename}' (ID: {music_id})")
                    return True
        
        print(f"[DB] No matching music file found for cover: '{cover_filename}'")
        return False
    except Exception as e:
        print(f"[DB] Error updating cover for '{cover_filename}': {e}")
        return False


def get_cover_by_music_id(music_id):
    """Get cover file path by music ID"""
    r = get_redis_connection()
    cover_data = r.hgetall(KEY_COVER.format(music_id))
    if cover_data:
        file_path = cover_data.get('file_path')
        if file_path and os.path.exists(file_path):
            return {
                'filename': cover_data['filename'],
                'mime_type': cover_data['mime_type'],
                'file_path': file_path
            }
    return None


def search_music(keyword):
    """Search music by keyword"""
    r = get_redis_connection()
    keyword_lower = keyword.lower()
    
    music_ids = r.zrange(KEY_MUSIC_LIST, 0, -1)
    results = []
    
    for music_id in music_ids:
        music_data = r.hgetall(KEY_MUSIC.format(music_id))
        if music_data:
            title = music_data.get('title', '').lower()
            artist = music_data.get('artist', '').lower()
            
            if keyword_lower in title or keyword_lower in artist:
                music_data['id'] = int(music_data['id'])
                music_data['size'] = int(music_data.get('size', 0))
                music_data['duration'] = int(music_data.get('duration', 0))
                music_data['has_lyrics'] = music_data.get('has_lyrics') == '1'
                music_data['has_cover'] = music_data.get('has_cover') == '1'
                music_data['url'] = f'/api/music/{music_id}/download'
                music_data['lrc_url'] = f'/api/lyrics/{music_id}' if music_data['has_lyrics'] else None
                music_data['cover_url'] = f'/api/cover/{music_id}' if music_data['has_cover'] else None
                results.append(music_data)
    
    return results


def get_music_by_artist(artist):
    """Get music by artist"""
    r = get_redis_connection()
    
    music_ids = r.zrange(KEY_MUSIC_LIST, 0, -1)
    results = []
    
    for music_id in music_ids:
        music_data = r.hgetall(KEY_MUSIC.format(music_id))
        if music_data and music_data.get('artist') == artist:
            music_data['id'] = int(music_data['id'])
            music_data['size'] = int(music_data.get('size', 0))
            music_data['duration'] = int(music_data.get('duration', 0))
            music_data['has_lyrics'] = music_data.get('has_lyrics') == '1'
            music_data['has_cover'] = music_data.get('has_cover') == '1'
            music_data['url'] = f'/api/music/{music_id}/download'
            music_data['lrc_url'] = f'/api/lyrics/{music_id}' if music_data['has_lyrics'] else None
            music_data['cover_url'] = f'/api/cover/{music_id}' if music_data['has_cover'] else None
            results.append(music_data)
    
    return results


def get_all_artists():
    """Get all unique artists"""
    r = get_redis_connection()
    
    music_ids = r.zrange(KEY_MUSIC_LIST, 0, -1)
    artists = set()
    
    for music_id in music_ids:
        music_data = r.hgetall(KEY_MUSIC.format(music_id))
        if music_data:
            artist = music_data.get('artist')
            if artist:
                artists.add(artist)
    
    return sorted(list(artists))


# User and favorites functions (using JSON files for now, can be migrated to Redis)
def load_users():
    """Load users from JSON file"""
    users_file = os.path.join(DATA_DIR, 'user', 'users.json')
    if os.path.exists(users_file):
        try:
            with open(users_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"[ERROR] Failed to load users: {e}")
    return {}


def save_users(users):
    """Save users to JSON file"""
    users_file = os.path.join(DATA_DIR, 'user', 'users.json')
    os.makedirs(os.path.dirname(users_file), exist_ok=True)
    try:
        with open(users_file, 'w', encoding='utf-8') as f:
            json.dump(users, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"[ERROR] Failed to save users: {e}")
        return False


def get_favorites_by_username(username):
    """Get user favorites"""
    r = get_redis_connection()
    music_ids = r.smembers(KEY_FAVORITES.format(username))
    
    results = []
    for music_id in music_ids:
        music_data = r.hgetall(KEY_MUSIC.format(music_id))
        if music_data:
            results.append({
                'id': int(music_data['id']),
                'filename': music_data['filename'],
                'title': music_data['title'],
                'artist': music_data['artist'],
                'coverUrl': f'/api/cover/{music_id}' if music_data.get('has_cover') == '1' else None,
                'url': f'/api/music/{music_id}/download',
                'duration': int(music_data.get('duration', 0)),
                'hasLyrics': music_data.get('has_lyrics') == '1',
                'lrcUrl': f'/api/lyrics/{music_id}' if music_data.get('has_lyrics') == '1' else None
            })
    
    return results


def add_favorite(username, filename, title, artist):
    """Add favorite"""
    r = get_redis_connection()
    
    # Find music by filename
    music_ids = r.zrange(KEY_MUSIC_LIST, 0, -1)
    for music_id in music_ids:
        music_data = r.hgetall(KEY_MUSIC.format(music_id))
        if music_data and music_data.get('filename') == filename:
            r.sadd(KEY_FAVORITES.format(username), music_id)
            return True
    
    return False


def remove_favorite(username, filename):
    """Remove favorite"""
    r = get_redis_connection()
    
    # Find music by filename
    music_ids = r.zrange(KEY_MUSIC_LIST, 0, -1)
    for music_id in music_ids:
        music_data = r.hgetall(KEY_MUSIC.format(music_id))
        if music_data and music_data.get('filename') == filename:
            r.srem(KEY_FAVORITES.format(username), music_id)
            return True
    
    return False


def get_music_stats():
    """Get music statistics"""
    r = get_redis_connection()
    
    total_music = r.zcard(KEY_MUSIC_LIST)
    
    # Count lyrics
    total_lyrics = 0
    music_ids = r.zrange(KEY_MUSIC_LIST, 0, -1)
    for music_id in music_ids:
        if r.exists(KEY_LYRICS.format(music_id)):
            total_lyrics += 1
    
    # Count covers
    total_covers = 0
    for music_id in music_ids:
        if r.exists(KEY_COVER.format(music_id)):
            total_covers += 1
    
    # Count unique artists
    artists = set()
    for music_id in music_ids:
        music_data = r.hgetall(KEY_MUSIC.format(music_id))
        if music_data:
            artist = music_data.get('artist')
            if artist:
                artists.add(artist)
    
    return {
        'total_music': total_music,
        'total_lyrics': total_lyrics,
        'total_covers': total_covers,
        'total_artists': len(artists)
    }


# ==================== File Watcher ====================

class MusicFolderHandler(FileSystemEventHandler):
    """处理音乐文件夹变化事件"""

    def __init__(self, callback):
        self.callback = callback
        self.last_event_time = {}
        self.debounce_seconds = 2  # 防抖时间

    def _should_process(self, filepath):
        """检查是否应该处理这个文件（防抖）"""
        current_time = time.time()
        last_time = self.last_event_time.get(filepath, 0)

        if current_time - last_time < self.debounce_seconds:
            return False

        self.last_event_time[filepath] = current_time
        return True

    def _is_music_file(self, filepath):
        """检查是否是音乐文件"""
        ext = os.path.splitext(filepath)[1].lower()
        return ext in ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a']

    def _is_lyrics_file(self, filepath):
        """检查是否是歌词文件"""
        return filepath.lower().endswith('.lrc')

    def _is_cover_file(self, filepath):
        """检查是否是封面文件"""
        ext = os.path.splitext(filepath)[1].lower()
        return ext in ['.jpg', '.jpeg', '.png', '.webp']

    def on_created(self, event):
        if event.is_directory:
            return
        filepath = event.src_path
        if not self._should_process(filepath):
            return
        if self._is_music_file(filepath) or self._is_lyrics_file(filepath) or self._is_cover_file(filepath):
            print(f"[WATCHER] File created: {os.path.basename(filepath)}")
            self.callback()

    def on_deleted(self, event):
        if event.is_directory:
            return
        filepath = event.src_path
        if self._is_music_file(filepath) or self._is_lyrics_file(filepath) or self._is_cover_file(filepath):
            print(f"[WATCHER] File deleted: {os.path.basename(filepath)}")
            self.callback()

    def on_modified(self, event):
        if event.is_directory:
            return
        filepath = event.src_path
        if not self._should_process(filepath):
            return
        if self._is_music_file(filepath) or self._is_lyrics_file(filepath) or self._is_cover_file(filepath):
            print(f"[WATCHER] File modified: {os.path.basename(filepath)}")
            self.callback()


class MusicFileWatcher:
    """音乐文件监视器"""

    def __init__(self):
        self.observer = None
        self.is_running = False
        self.sync_timer = None
        self.sync_delay = 3  # 延迟3秒后同步

    def _delayed_sync(self):
        """延迟同步数据库"""
        try:
            print("[WATCHER] Starting database sync...")
            scan_and_sync_music(MUSIC_DIR, LRC_DIR, COVER_DIR)
            print("[WATCHER] Database sync completed")
        except Exception as e:
            print(f"[WATCHER] Database sync failed: {e}")
        finally:
            self.sync_timer = None

    def _trigger_sync(self):
        """触发同步（带延迟）"""
        if self.sync_timer:
            self.sync_timer.cancel()
        self.sync_timer = threading.Timer(self.sync_delay, self._delayed_sync)
        self.sync_timer.start()

    def start(self):
        """启动文件监视"""
        if self.is_running:
            print("[WATCHER] Already running")
            return

        if not WATCHDOG_AVAILABLE:
            print("[WATCHER] watchdog not installed, file watching disabled")
            return

        self.observer = Observer()
        handler = MusicFolderHandler(self._trigger_sync)

        # 监视三个文件夹
        for folder, name in [(MUSIC_DIR, 'music'), (LRC_DIR, 'lyrics'), (COVER_DIR, 'cover')]:
            if os.path.exists(folder):
                self.observer.schedule(handler, folder, recursive=False)
                print(f"[WATCHER] Watching {name} folder: {folder}")

        self.observer.start()
        self.is_running = True
        print("[WATCHER] File watcher started")

    def stop(self):
        """停止文件监视"""
        if not self.is_running:
            return

        if self.sync_timer:
            self.sync_timer.cancel()

        if self.observer:
            self.observer.stop()
            self.observer.join()

        self.is_running = False
        print("[WATCHER] File watcher stopped")


# 全局监视器实例
_watcher = MusicFileWatcher()


def start_file_watcher():
    """启动文件监视（供外部调用）"""
    _watcher.start()


def stop_file_watcher():
    """停止文件监视（供外部调用）"""
    _watcher.stop()


# ==================== Main ====================

if __name__ == '__main__':
    init_database()
    print("[DB] Database module ready")
