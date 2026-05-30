#!/usr/bin/env python3
"""
Music Player Server with Upload API
Compatible with Python 3.13+
"""

import os
import sys
import json
import shutil
import re
import time
import ssl
import subprocess
import atexit
import zipfile
import urllib.request
import locale
from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn
import socket
from urllib.parse import parse_qs, urlparse, unquote
import threading

# Import logger module
from logger import (
    load_locale, t,
    log_info, log_success, log_warning, log_error, 
    log_debug, log_server, log_db, log_redis, log_download,
    format_http_log, COLORS
)

# Import music downloader
try:
    from music_downloader import search_songs, download_song
    DOWNLOADER_AVAILABLE = True
except ImportError as e:
    DOWNLOADER_AVAILABLE = False
    log_warning(f"Music downloader not available: {e}")

# Import file watcher from database
try:
    from database import start_file_watcher, stop_file_watcher
    WATCHER_AVAILABLE = True
except ImportError as e:
    WATCHER_AVAILABLE = False
    log_warning(f"File watcher not available: {e}")

# Get system language (compatible with Python 3.15)
def get_system_language():
    """Get system language code"""
    try:
        # Try to get locale from environment
        env_lang = os.environ.get('LANG', '') or os.environ.get('LANGUAGE', '')
        if env_lang:
            return env_lang.split('.')[0].lower()
    except:
        pass
    
    try:
        # Try new API first (Python 3.11+)
        loc = locale.getlocale()[0]
        if loc:
            return loc.lower()
    except:
        pass
    
    try:
        # Fallback for older versions
        loc = locale.getdefaultlocale()[0]
        if loc:
            return loc.lower()
    except:
        pass
    
    return 'en_us'

SYSTEM_LANG = get_system_language()
DEFAULT_LANG = 'zh-cn' if 'zh' in SYSTEM_LANG or 'chinese' in SYSTEM_LANG else 'en-us'

# Load locale
load_locale(DEFAULT_LANG)
log_server(t('server.starting'))
log_server(f"{t('log.labels.SERVER')}: {SYSTEM_LANG}, {DEFAULT_LANG}")

# Try to import mutagen for reading audio duration
try:
    from mutagen.mp3 import MP3
    from mutagen.flac import FLAC
    from mutagen.wavpack import WavPack
    MUTAGEN_AVAILABLE = True
except ImportError:
    MUTAGEN_AVAILABLE = False
    print("[WARNING] mutagen not installed, audio duration will not be available")

# Configuration
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
MUSIC_DIR = os.path.join(DATA_DIR, 'music')
LRC_DIR = os.path.join(DATA_DIR, 'lrc')
COVER_DIR = os.path.join(DATA_DIR, 'Segment')  # Cover storage directory
USER_DIR = os.path.join(DATA_DIR, 'user')  # User data directory
REDIS_DIR = os.path.join(DATA_DIR, 'redis')  # Redis data directory

# Ensure directories exist
os.makedirs(MUSIC_DIR, exist_ok=True)
os.makedirs(LRC_DIR, exist_ok=True)
os.makedirs(COVER_DIR, exist_ok=True)
os.makedirs(USER_DIR, exist_ok=True)
os.makedirs(REDIS_DIR, exist_ok=True)

# User data file
USERS_FILE = os.path.join(USER_DIR, 'users.json')
FAVORITES_FILE = os.path.join(USER_DIR, 'favorites.json')

# Redis process
redis_process = None


def download_redis():
    """Download and extract Redis for Windows"""
    redis_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'redis')
    redis_exe = os.path.join(redis_dir, 'redis-server.exe')
    
    if os.path.exists(redis_exe):
        return redis_exe
    
    print("[REDIS] Downloading Redis for Windows...")
    
    try:
        # Create redis directory
        os.makedirs(redis_dir, exist_ok=True)
        
        # Download Redis (using gh-proxy.com for faster download in China)
        redis_url = "https://gh-proxy.com/https://github.com/microsoftarchive/redis/releases/download/win-3.0.504/Redis-x64-3.0.504.zip"
        zip_path = os.path.join(redis_dir, "redis.zip")
        
        # Download with progress
        def download_progress(block_num, block_size, total_size):
            downloaded = block_num * block_size
            percent = min(100, downloaded * 100 / total_size)
            print(f"\r[REDIS] Downloading: {percent:.1f}%", end='', flush=True)
        
        urllib.request.urlretrieve(redis_url, zip_path, reporthook=download_progress)
        print()  # New line after progress
        
        # Extract
        print("[REDIS] Extracting...")
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(redis_dir)
        
        # Remove zip file
        os.remove(zip_path)
        
        log_redis(f"Downloaded to: {redis_dir}")
        return redis_exe
        
    except Exception as e:
        log_error(f"Failed to download Redis: {e}")
        return None


def find_redis_server():
    """Find redis-server executable"""
    # Check common locations
    possible_paths = [
        # Current directory / downloaded redis
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'redis', 'redis-server.exe'),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'redis-server.exe'),
        # System PATH
        'redis-server.exe',
        'redis-server',
        # Common Windows installation paths
        r'C:\Program Files\Redis\redis-server.exe',
        r'C:\Redis\redis-server.exe',
        r'D:\Redis\redis-server.exe',
        # Chocolatey installation
        r'C:\ProgramData\chocolatey\bin\redis-server.exe',
        # Scoop installation
        os.path.expanduser(r'~\scoop\shims\redis-server.exe'),
    ]
    
    for path in possible_paths:
        if os.path.isfile(path):
            return path
    
    # Try to find in PATH
    try:
        result = subprocess.run(['where', 'redis-server'], capture_output=True, text=True)
        if result.returncode == 0:
            return result.stdout.strip().split('\n')[0]
    except:
        pass
    
    # Try to download Redis
    return download_redis()


def start_embedded_redis():
    """Start embedded Redis server"""
    global redis_process
    
    redis_server = find_redis_server()
    if not redis_server:
        print("[ERROR] Redis server not found!")
        print("[INFO] Please install Redis:")
        print("  1. Download from: https://github.com/microsoftarchive/redis/releases")
        print("  2. Or use Chocolatey: choco install redis-64")
        print("  3. Or use Scoop: scoop install redis")
        print("  4. Or place redis-server.exe in the project directory")
        return False
    
    log_redis(f"Found Redis server: {redis_server}")
    
    # Create Redis configuration
    redis_conf_path = os.path.join(REDIS_DIR, 'redis.conf')
    with open(redis_conf_path, 'w') as f:
        f.write(f"""# Redis configuration
port 6379
bind 127.0.0.1
dir {REDIS_DIR.replace('\\', '/')}
dbfilename redis.rdb
save 900 1
save 300 10
save 60 10000
""")
    
    # Start Redis server
    try:
        redis_process = subprocess.Popen(
            [redis_server, redis_conf_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
        )
        
        # Wait for Redis to start
        time.sleep(2)
        
        # Check if Redis is running
        if redis_process.poll() is None:
            log_redis("Server started successfully on port 6379")
            return True
        else:
            stdout, stderr = redis_process.communicate()
            log_error("Redis failed to start:")
            log_error(f"  stdout: {stdout.decode()}")
            log_error(f"  stderr: {stderr.decode()}")
            return False
            
    except Exception as e:
        log_error(f"Failed to start Redis: {e}")
        return False


def stop_embedded_redis():
    """Stop embedded Redis server"""
    global redis_process
    if redis_process:
        print("[REDIS] Stopping server...")
        redis_process.terminate()
        try:
            redis_process.wait(timeout=5)
        except:
            redis_process.kill()
        redis_process = None
        print("[REDIS] Server stopped")


# Register cleanup function
atexit.register(stop_embedded_redis)

# Start Redis server
print("[SERVER] Starting embedded Redis server...")
if not start_embedded_redis():
    print("[WARNING] Could not start embedded Redis, trying external Redis...")

# Import database after Redis is started
import database

# Initialize database - scan and sync music files
log_server("Initializing database...")
try:
    database.init_database()  # Create tables if not exist
    database.scan_and_sync_music(MUSIC_DIR, LRC_DIR, COVER_DIR)  # Scan and sync music files
except Exception as e:
    log_error(f"Database initialization failed: {e}")
    log_info("Make sure Redis is running on localhost:6379")
    stop_embedded_redis()
    sys.exit(1)


def load_users():
    """Load users from JSON file"""
    if os.path.exists(USERS_FILE):
        try:
            with open(USERS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            log_error(f"Failed to load users: {e}")
    return {}


def save_users(users):
    """Save users to JSON file"""
    try:
        with open(USERS_FILE, 'w', encoding='utf-8') as f:
            json.dump(users, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        log_error(f"Failed to save users: {e}")
        return False


def load_favorites():
    """Load user favorites from JSON file"""
    if os.path.exists(FAVORITES_FILE):
        try:
            with open(FAVORITES_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            log_error(f"Failed to load favorites: {e}")
    return {}


def save_favorites(favorites):
    """Save user favorites to JSON file"""
    try:
        with open(FAVORITES_FILE, 'w', encoding='utf-8') as f:
            json.dump(favorites, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        log_error(f"Failed to save favorites: {e}")
        return False


class FormField:
    """Form field class"""
    def __init__(self, name, value=None, filename=None, data=None):
        self.name = name
        self.value = value
        self.filename = filename
        self.data = data

    def __repr__(self):
        return f"FormField(name='{self.name}', filename='{self.filename}')"


class MusicRequestHandler(SimpleHTTPRequestHandler):
    """Custom request handler"""

    def __init__(self, *args, **kwargs):
        # Set document root to data/server/web for direct access
        web_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'server', 'web')
        super().__init__(*args, directory=web_dir, **kwargs)

    # ANSI color codes
    COLORS = {
        'RESET': '\033[0m',
        'BOLD': '\033[1m',
        'DIM': '\033[2m',
        'RED': '\033[91m',
        'GREEN': '\033[92m',
        'YELLOW': '\033[93m',
        'BLUE': '\033[94m',
        'MAGENTA': '\033[95m',
        'CYAN': '\033[96m',
        'WHITE': '\033[97m',
        'GRAY': '\033[90m',
    }

    def log_message(self, format, *args):
        """Custom log format with IP address and colors"""
        client_ip = self.client_address[0]
        timestamp = self.log_date_time_string()
        
        # Handle different log formats
        if not args:
            # No args, just print the format string
            print(f"{self.COLORS['GRAY']}[{timestamp}]{self.COLORS['RESET']} {self.COLORS['CYAN']}{client_ip}{self.COLORS['RESET']} {format}")
            return
        
        # Check if first arg is a string (normal HTTP request log)
        request = args[0]
        if not isinstance(request, str):
            # Error log format: "code %d, message %s", code, message
            message = format % args
            print(f"{self.COLORS['GRAY']}[{timestamp}]{self.COLORS['RESET']} {self.COLORS['RED']}[ERROR]{self.COLORS['RESET']} {message}")
            return
        
        # Parse request to get method and path
        parts = request.split()
        if len(parts) >= 2:
            method = parts[0]
            path = parts[1]
            protocol = parts[2] if len(parts) > 2 else ''
            
            # Colorize method
            method_colors = {
                'GET': self.COLORS['GREEN'],
                'POST': self.COLORS['BLUE'],
                'PUT': self.COLORS['YELLOW'],
                'DELETE': self.COLORS['RED'],
                'PATCH': self.COLORS['MAGENTA'],
            }
            method_color = method_colors.get(method, self.COLORS['WHITE'])
            
            # Colorize path based on type
            if '/api/' in path:
                path_color = self.COLORS['CYAN']
            elif path.endswith(('.js', '.css', '.html')):
                path_color = self.COLORS['GRAY']
            elif path.endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico')):
                path_color = self.COLORS['MAGENTA']
            elif path.endswith(('.mp3', '.flac', '.wav', '.aac', '.ogg')):
                path_color = self.COLORS['YELLOW']
            else:
                path_color = self.COLORS['WHITE']
            
            # Build colored log
            colored_request = f"{method_color}{method}{self.COLORS['RESET']} {path_color}{path}{self.COLORS['RESET']} {self.COLORS['DIM']}{protocol}{self.COLORS['RESET']}"
            
            print(f"{self.COLORS['GRAY']}[{timestamp}]{self.COLORS['RESET']} {self.COLORS['CYAN']}{client_ip}{self.COLORS['RESET']} {colored_request}")
        else:
            print(f"{self.COLORS['GRAY']}[{timestamp}]{self.COLORS['RESET']} {self.COLORS['CYAN']}{client_ip}{self.COLORS['RESET']} {request}")

    def send_json_response(self, data, status_code=200):
        """Send JSON response"""
        response_body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(response_body))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Connection', 'close')
        self.end_headers()
        self.wfile.write(response_body)
        self.wfile.flush()

    def do_GET(self):
        """Handle GET requests"""
        parsed_path = urlparse(self.path)

        # Redirect HTTP to HTTPS (if this is an HTTP request and HTTPS is available)
        host = self.headers.get('Host', '')
        if hasattr(self.server, 'is_http') and self.server.is_http and host:
            # Build HTTPS URL
            https_url = f"https://{host}{self.path}"
            self.send_response(301)  # Permanent redirect
            self.send_header('Location', https_url)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(f"<html><body>Redirecting to <a href='{https_url}'>{https_url}</a>...</body></html>".encode())
            return

        # Download page
        if parsed_path.path == '/DownMusic':
            self.path = '/download_new.html'
            return SimpleHTTPRequestHandler.do_GET(self)

        # Download detail page (e.g., /DownMusic/GQB/12345)
        if parsed_path.path.startswith('/DownMusic/'):
            music_id = parsed_path.path[len('/DownMusic/'):]
            if music_id and music_id != 'GQB':
                self.path = '/download_detail.html'
                return SimpleHTTPRequestHandler.do_GET(self)
            elif music_id == 'GQB':
                # Handle GQB route with ID parameter
                self.path = '/download_detail.html'
                return SimpleHTTPRequestHandler.do_GET(self)

        # API: Get song info
        if parsed_path.path == '/api/song-info':
            self.handle_song_info()
            return

        # API: Get system language
        if parsed_path.path == '/api/lang':
            self.send_json_response({
                'lang': DEFAULT_LANG,
                'system_lang': SYSTEM_LANG
            })
            return

        # API: Launch downloader
        if parsed_path.path == '/api/launch-downloader':
            self.handle_launch_downloader()
            return

        # API: Search songs (web downloader)
        if parsed_path.path == '/api/search-songs':
            self.handle_search_songs()
            return

        # API: Download song (web downloader)
        if parsed_path.path == '/api/download-song':
            self.handle_download_song()
            return

        # API: Get download link (web downloader)
        if parsed_path.path == '/api/get-download-link':
            self.handle_get_download_link()
            return

        # API: Proxy download (web downloader)
        if parsed_path.path == '/api/proxy-download':
            self.handle_proxy_download()
            return

        # API: Download lyrics (web downloader)
        if parsed_path.path == '/api/download-lyrics':
            self.handle_download_lyrics()
            return

        # API: Client download (MSI/NSIS)
        if parsed_path.path.startswith('/api/download/'):
            version_type = parsed_path.path[len('/api/download/'):]
            self.handle_client_download(version_type)
            return

        # API: Get music list
        if parsed_path.path == '/api/music-list':
            self.handle_music_list()
            return

        # API: Get lyrics (by music ID)
        if parsed_path.path.startswith('/api/lyrics/'):
            music_id = parsed_path.path[len('/api/lyrics/'):]
            if music_id.isdigit():
                self.handle_get_lyrics_by_id(int(music_id))
            else:
                # Legacy: by filename
                filename = unquote(music_id)
                self.handle_get_lyrics(filename)
            return

        # API: Download music file
        if parsed_path.path.startswith('/api/music/'):
            log_debug(f"Matched /api/music/ route for: {parsed_path.path}")
            parts = parsed_path.path[len('/api/music/'):].split('/')
            log_debug(f"Path parts: {parts}")
            if len(parts) >= 2 and parts[1] == 'download' and parts[0].isdigit():
                music_id = int(parts[0])
                log_debug(f"Calling handle_download_music with ID: {music_id}")
                self.handle_download_music(music_id)
                return
            else:
                log_debug(f"Route not matched: len={len(parts)}, parts[1]={parts[1] if len(parts) > 1 else 'N/A'}, isdigit={parts[0].isdigit() if len(parts) > 0 else 'N/A'}")

        # API: Get cover image
        if parsed_path.path.startswith('/api/cover/'):
            music_id = parsed_path.path[len('/api/cover/'):]
            if music_id.isdigit():
                self.handle_get_cover(int(music_id))
            return

        # API: Get favorites
        if parsed_path.path == '/api/favorites':
            self.handle_get_favorites()
            return

        # API: Get music stats (read-only)
        if parsed_path.path == '/api/stats':
            self.handle_get_stats()
            return

        # API: Search music (read-only)
        if parsed_path.path == '/api/search':
            self.handle_search_music()
            return

        # API: Get artists (read-only)
        if parsed_path.path == '/api/artists':
            self.handle_get_artists()
            return

        # Download page
        if parsed_path.path == '/download':
            self.serve_download_page()
            return

        # Delete management page
        if parsed_path.path == '/del':
            self.serve_delete_page()
            return

        # Default: Static file service from web directory
        super().do_GET()

    def serve_data_file(self, path):
        """Serve files from data directory"""
        try:
            # Security check: prevent directory traversal
            safe_path = os.path.normpath(path).lstrip('/')
            full_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), safe_path)
            real_path = os.path.realpath(full_path)
            data_dir = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data'))
            
            # Ensure the path is within data directory
            if not real_path.startswith(data_dir):
                self.send_error(403, "Forbidden")
                return
            
            if not os.path.exists(real_path):
                self.send_error(404, "File not found")
                return
            
            if os.path.isdir(real_path):
                self.send_error(403, "Directory listing not allowed")
                return
            
            # Guess content type
            from mimetypes import guess_type
            content_type, _ = guess_type(real_path)
            if content_type is None:
                content_type = 'application/octet-stream'
            
            # Send file
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Access-Control-Allow-Origin', '*')
            
            # Support range requests for audio files
            if content_type.startswith('audio/') or content_type.startswith('video/'):
                self.send_header('Accept-Ranges', 'bytes')
            
            file_size = os.path.getsize(real_path)
            self.send_header('Content-Length', str(file_size))
            self.end_headers()
            
            with open(real_path, 'rb') as f:
                self.wfile.write(f.read())
                
        except Exception as e:
            log_error(f"Failed to serve file {path}: {e}")
            self.send_error(500, str(e))

    def do_OPTIONS(self):
        """Handle OPTIONS requests for CORS preflight"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        """Handle POST requests"""
        parsed_path = urlparse(self.path)
        print(f"[POST] Received request: {parsed_path.path}")

        # API: File upload
        if parsed_path.path == '/api/upload':
            self.handle_upload()
            return

        # API: User register
        if parsed_path.path == '/api/register':
            self.handle_register()
            return

        # API: User login
        if parsed_path.path == '/api/login':
            self.handle_login()
            return

        # API: Change password
        if parsed_path.path == '/api/change-password':
            self.handle_change_password()
            return

        # API: Get favorites
        if parsed_path.path == '/api/favorites':
            self.handle_get_favorites()
            return

        # API: Add favorite
        if parsed_path.path == '/api/favorites/add':
            self.handle_add_favorite()
            return

        # API: Remove favorite
        if parsed_path.path == '/api/favorites/remove':
            self.handle_remove_favorite()
            return

        # API: Delete music
        if parsed_path.path == '/api/music/delete':
            self.handle_delete_music()
            return

        # Default: 404
        self.send_error(404)

    def get_audio_duration(self, file_path):
        """Get audio file duration (seconds)"""
        if not MUTAGEN_AVAILABLE:
            return 0

        try:
            ext = os.path.splitext(file_path)[1].lower()
            if ext == '.mp3':
                audio = MP3(file_path)
            elif ext == '.flac':
                audio = FLAC(file_path)
            elif ext in ['.wav', '.wave']:
                audio = WavPack(file_path)
            else:
                return 0

            return int(audio.info.length)
        except Exception as e:
            log_warning(f"Failed to get duration for {file_path}: {e}")
            return 0

    def parse_song_info(self, filename):
        """Parse song info from filename
        Supports format: SongName-Artist.mp3 or SongName-Artist1&Artist2.mp3
        Supports multiple separators: - 
        """
        # Remove extension
        name_without_ext = os.path.splitext(filename)[0]

        # Normalize various hyphens to English dash
        normalized_name = name_without_ext.replace('\u2013', '-').replace('\u2014', '-')

        # Try to split by "-"
        if '-' in normalized_name:
            parts = normalized_name.split('-', 1)  # Split only once
            title = parts[0].strip()
            artist = parts[1].strip()
            # Handle multiple artists (separated by & or ,)
            artist = artist.replace('&', ' & ').replace(',', ' & ')
        else:
            # If no "-", use entire filename as song name
            title = name_without_ext
            artist = 'Unknown Artist'

        return title, artist

    def handle_music_list(self):
        """Get music file list"""
        try:
            music_from_db = database.get_all_music()
            if music_from_db:
                self.send_json_response({'success': True, 'data': music_from_db, 'source': 'database'})
                return

            music_files = []

            for filename in os.listdir(MUSIC_DIR):
                if filename.lower().endswith(('.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a')):
                    file_path = os.path.join(MUSIC_DIR, filename)
                    stat = os.stat(file_path)

                    # Parse song info
                    title, artist = self.parse_song_info(filename)

                    # Check for corresponding lyrics file (using fuzzy matching)
                    lrc_filename = None
                    has_lyrics = False
                    
                    # Normalize song name for matching (remove spaces, special chars, lowercase)
                    def normalize_name(name):
                        name = os.path.splitext(name)[0]  # Remove extension
                        name = name.lower()  # Lowercase
                        # Remove common special characters and spaces
                        for char in [' ', '-', '_', '&', "'", '(', ')', '.', ',']:
                            name = name.replace(char, '')
                        return name
                    
                    song_name_normalized = normalize_name(filename)

                    # First try exact match
                    potential_lrc = os.path.splitext(filename)[0] + '.lrc'
                    if os.path.exists(os.path.join(LRC_DIR, potential_lrc)):
                        lrc_filename = potential_lrc
                        has_lyrics = True
                    else:
                        # Try fuzzy matching
                        if os.path.exists(LRC_DIR):
                            for lrc_file in os.listdir(LRC_DIR):
                                if lrc_file.lower().endswith('.lrc'):
                                    lrc_normalized = normalize_name(lrc_file)
                                    if lrc_normalized == song_name_normalized:
                                        lrc_filename = lrc_file
                                        has_lyrics = True
                                        break

                    # Check for corresponding cover file (supports jpg, jpeg, png, webp)
                    # Use more flexible matching: ignore space differences
                    cover_filename = None
                    for ext in ['.jpg', '.jpeg', '.png', '.webp']:
                        # First try exact match
                        potential_cover = os.path.splitext(filename)[0] + ext
                        if os.path.exists(os.path.join(COVER_DIR, potential_cover)):
                            cover_filename = potential_cover
                            break
                        # Then try iterating all cover files for fuzzy matching
                        if os.path.exists(COVER_DIR):
                            for cover_file in os.listdir(COVER_DIR):
                                if cover_file.lower().endswith(ext):
                                    cover_normalized = normalize_name(cover_file)
                                    if cover_normalized == song_name_normalized:
                                        cover_filename = cover_file
                                        break
                            if cover_filename:
                                break

                    # Get audio duration
                    duration = self.get_audio_duration(file_path)

                    music_files.append({
                        'id': len(music_files) + 1,
                        'filename': filename,
                        'title': title,
                        'artist': artist,
                        'album': '',
                        'url': f'/data/music/{filename}',
                        'size': stat.st_size,
                        'duration': duration,
                        'hasLyrics': has_lyrics,
                        'lrcUrl': f'/data/lrc/{lrc_filename}' if has_lyrics else None,
                        'hasCover': cover_filename is not None,
                        'coverUrl': f'/data/Segment/{cover_filename}' if cover_filename else None
                    })

            self.send_json_response({'success': True, 'data': music_files})
        except Exception as e:
            self.send_json_response({'success': False, 'error': str(e)}, 500)

    def handle_get_lyrics(self, filename):
        """Get lyrics file content"""
        try:
            # Security check: prevent directory traversal
            filename = os.path.basename(filename)
            lrc_path = os.path.join(LRC_DIR, filename)

            # Ensure path is within LRC_DIR
            real_path = os.path.realpath(lrc_path)
            real_lrc_dir = os.path.realpath(LRC_DIR)
            if not real_path.startswith(real_lrc_dir):
                self.send_json_response({'success': False, 'error': 'Invalid file path'}, 403)
                return

            if not os.path.exists(lrc_path):
                self.send_json_response({'success': False, 'error': 'Lyrics file not found'}, 404)
                return

            # Try multiple encodings to read lyrics file
            content = None
            encodings = ['utf-8', 'gbk', 'gb2312', 'latin-1']
            for encoding in encodings:
                try:
                    with open(lrc_path, 'r', encoding=encoding) as f:
                        content = f.read()
                    break
                except UnicodeDecodeError:
                    continue

            if content is None:
                self.send_json_response({'success': False, 'error': 'Cannot decode lyrics file'}, 500)
                return

            self.send_json_response({'success': True, 'data': content})
        except Exception as e:
            self.send_json_response({'success': False, 'error': str(e)}, 500)

    def handle_upload(self):
        """Handle file upload"""
        try:
            print(f"[UPLOAD] Starting upload request")
            print(f"[UPLOAD] Content-Type: {self.headers.get('Content-Type', 'N/A')}")

            content_type = self.headers.get('Content-Type', '')
            if not content_type.startswith('multipart/form-data'):
                self.send_json_response({'success': False, 'error': 'Content-Type must be multipart/form-data'}, 400)
                return

            # Parse boundary
            boundary = None
            for part in content_type.split(';'):
                if 'boundary=' in part:
                    boundary = part.split('=', 1)[1].strip('"')
                    break

            if not boundary:
                self.send_json_response({'success': False, 'error': 'Cannot find boundary'}, 400)
                return

            print(f"[UPLOAD] Boundary: {boundary}")

            # Read request body
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_json_response({'success': False, 'error': 'Empty request body'}, 400)
                return

            body = self.rfile.read(content_length)
            print(f"[UPLOAD] Body size: {len(body)} bytes")

            # Parse multipart form data
            form_data = self.parse_multipart_body(body, boundary)
            print(f"[UPLOAD] Parsed fields: {list(form_data.keys())}")
            
            # Debug: print all fields and their values
            for key, field in form_data.items():
                if field.value:
                    print(f"[UPLOAD] Field '{key}': value='{field.value}'")
                elif field.filename:
                    print(f"[UPLOAD] Field '{key}': filename='{field.filename}', data_length={len(field.data) if field.data else 0}")

            # Get file type (support both 'type' and 'fileType' for compatibility)
            file_type_field = form_data.get('type') or form_data.get('fileType')
            print(f"[UPLOAD] file_type_field: {file_type_field}")
            if not file_type_field:
                self.send_json_response({'success': False, 'error': 'Missing type parameter'}, 400)
                return
            if not file_type_field.value:
                self.send_json_response({'success': False, 'error': 'Type parameter has no value'}, 400)
                return

            file_type = file_type_field.value
            print(f"[UPLOAD] File type: {file_type}")

            # Get file field
            file_field = form_data.get('file')
            print(f"[UPLOAD] File field: {file_field}")
            print(f"[UPLOAD] File data length: {len(file_field.data) if file_field and file_field.data else 0}")
            if not file_field:
                print(f"[UPLOAD] Error: file field is None")
                self.send_json_response({'success': False, 'error': 'Missing file'}, 400)
                return
            if not file_field.data:
                print(f"[UPLOAD] Error: file field has no data")
                self.send_json_response({'success': False, 'error': 'Missing file data'}, 400)
                return

            # Determine target directory
            print(f"[UPLOAD] Determining target directory for type: {file_type}")
            if file_type == 'music':
                target_dir = MUSIC_DIR
                allowed_ext = ('.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a')
                print(f"[UPLOAD] Selected music directory: {target_dir}")
            elif file_type in ('lyrics', 'lrc'):
                target_dir = LRC_DIR
                allowed_ext = ('.lrc',)
                print(f"[UPLOAD] Selected lyrics directory: {target_dir}")
            elif file_type == 'cover':
                target_dir = COVER_DIR
                allowed_ext = ('.jpg', '.jpeg', '.png', '.webp')
                print(f"[UPLOAD] Selected cover directory: {target_dir}")
            else:
                print(f"[UPLOAD] Error: Invalid file type: {file_type}")
                self.send_json_response({'success': False, 'error': 'Invalid fileType'}, 400)
                return

            # Check file extension
            filename = file_field.filename
            print(f"[UPLOAD] Original filename: {filename}")
            print(f"[UPLOAD] Allowed extensions: {allowed_ext}")

            if not filename.lower().endswith(allowed_ext):
                print(f"[UPLOAD] File extension check failed for {filename}")
                self.send_json_response({'success': False, 'error': f'File type not allowed, allowed: {allowed_ext}'}, 400)
                return

            # Security check: prevent directory traversal
            filename = os.path.basename(filename)

            # Check for duplicate file
            file_path = os.path.join(target_dir, filename)
            print(f"[UPLOAD] Target path: {file_path}")
            
            if os.path.exists(file_path):
                print(f"[UPLOAD] Duplicate file detected: {filename}")
                self.send_json_response({
                    'success': False,
                    'error': 'File already exists',
                    'duplicate': True,
                    'filename': filename
                }, 409)
                return

            # Save file
            with open(file_path, 'wb') as f:
                f.write(file_field.data)

            print(f"[UPLOAD] File saved successfully: {filename}")

            # If uploading lyrics, update database immediately
            if file_type in ('lyrics', 'lrc'):
                try:
                    lrc_content = file_field.data.decode('utf-8')
                    database.update_lyrics_by_filename(filename, lrc_content)
                    print(f"[UPLOAD] Lyrics database updated for: {filename}")
                except Exception as e:
                    print(f"[UPLOAD] Warning: Failed to update lyrics database: {e}")

            # If uploading cover, update database immediately
            if file_type == 'cover':
                try:
                    database.update_cover_by_filename(filename, file_path)
                    print(f"[UPLOAD] Cover database updated for: {filename}")
                except Exception as e:
                    print(f"[UPLOAD] Warning: Failed to update cover database: {e}")

            self.send_json_response({
                'success': True,
                'message': 'Upload successful',
                'filename': filename
            })

        except Exception as e:
            print(f"[UPLOAD] Error: {str(e)}")
            import traceback
            traceback.print_exc()
            self.send_json_response({'success': False, 'error': str(e)}, 500)

    def read_json_body(self):
        """Read and parse JSON request body"""
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length == 0:
            return None
        body = self.rfile.read(content_length)
        try:
            return json.loads(body.decode('utf-8'))
        except Exception as e:
            log_error(f"Failed to parse JSON body: {e}")
            return None

    def handle_register(self):
        """Handle user registration"""
        try:
            data = self.read_json_body()
            if not data:
                self.send_json_response({'success': False, 'error': 'Invalid request body'}, 400)
                return

            username = data.get('username', '').strip()
            email = data.get('email', '').strip()
            password = data.get('password', '')

            if not username or not email or not password:
                self.send_json_response({'success': False, 'error': 'Missing required fields'}, 400)
                return

            # Load existing users
            users = load_users()

            # Check if email already exists
            if email in users:
                self.send_json_response({'success': False, 'error': 'Email already registered'}, 409)
                return

            # Check if username already exists
            for user in users.values():
                if user.get('username') == username:
                    self.send_json_response({'success': False, 'error': 'Username already taken'}, 409)
                    return

            # Create new user (in production, password should be hashed!)
            import hashlib
            password_hash = hashlib.sha256(password.encode()).hexdigest()

            users[email] = {
                'username': username,
                'email': email,
                'password_hash': password_hash,
                'created_at': time.strftime('%Y-%m-%d %H:%M:%S')
            }

            # Save users
            if save_users(users):
                print(f"[REGISTER] New user registered: {username} ({email})")
                self.send_json_response({
                    'success': True,
                    'message': 'Registration successful',
                    'user': {
                        'username': username,
                        'email': email
                    }
                })
            else:
                self.send_json_response({'success': False, 'error': 'Failed to save user data'}, 500)

        except Exception as e:
            print(f"[REGISTER] Error: {str(e)}")
            import traceback
            traceback.print_exc()
            self.send_json_response({'success': False, 'error': str(e)}, 500)

    def handle_login(self):
        """Handle user login"""
        try:
            data = self.read_json_body()
            if not data:
                self.send_json_response({'success': False, 'error': 'Invalid request body'}, 400)
                return

            email = data.get('email', '').strip()
            password = data.get('password', '')

            if not email or not password:
                self.send_json_response({'success': False, 'error': 'Missing required fields'}, 400)
                return

            # Load users
            users = load_users()

            # Check if user exists
            if email not in users:
                self.send_json_response({'success': False, 'error': 'User not found'}, 404)
                return

            user = users[email]

            # Verify password
            import hashlib
            password_hash = hashlib.sha256(password.encode()).hexdigest()

            if password_hash != user.get('password_hash'):
                self.send_json_response({'success': False, 'error': 'Invalid password'}, 401)
                return

            print(f"[LOGIN] User logged in: {user['username']} ({email})")
            self.send_json_response({
                'success': True,
                'message': 'Login successful',
                'user': {
                    'username': user['username'],
                    'email': email
                }
            })

        except Exception as e:
            print(f"[LOGIN] Error: {str(e)}")
            import traceback
            traceback.print_exc()
            self.send_json_response({'success': False, 'error': str(e)}, 500)

    def handle_change_password(self):
        """Handle password change"""
        try:
            data = self.read_json_body()
            if not data:
                self.send_json_response({'success': False, 'error': 'Invalid request body'}, 400)
                return

            email = data.get('email', '').strip()
            old_password = data.get('oldPassword', '')
            new_password = data.get('newPassword', '')

            if not email or not old_password or not new_password:
                self.send_json_response({'success': False, 'error': 'Missing required fields'}, 400)
                return

            # Load users
            users = load_users()

            # Check if user exists
            if email not in users:
                self.send_json_response({'success': False, 'error': 'User not found'}, 404)
                return

            user = users[email]

            # Verify old password
            import hashlib
            old_password_hash = hashlib.sha256(old_password.encode()).hexdigest()

            if old_password_hash != user.get('password_hash'):
                self.send_json_response({'success': False, 'error': 'Current password is incorrect'}, 401)
                return

            # Update password
            new_password_hash = hashlib.sha256(new_password.encode()).hexdigest()
            user['password_hash'] = new_password_hash
            user['updated_at'] = time.strftime('%Y-%m-%d %H:%M:%S')

            # Save users
            if save_users(users):
                print(f"[CHANGE_PASSWORD] Password changed for: {user['username']} ({email})")
                self.send_json_response({
                    'success': True,
                    'message': 'Password changed successfully'
                })
            else:
                self.send_json_response({'success': False, 'error': 'Failed to save password'}, 500)

        except Exception as e:
            print(f"[CHANGE_PASSWORD] Error: {str(e)}")
            import traceback
            traceback.print_exc()
            self.send_json_response({'success': False, 'error': str(e)}, 500)

    def handle_get_favorites(self):
        """Handle get user favorites"""
        try:
            # Get username from query params
            parsed_path = urlparse(self.path)
            query_params = parse_qs(parsed_path.query)
            username = query_params.get('username', [''])[0].strip()

            if not username:
                self.send_json_response({'success': False, 'error': 'Username is required'}, 400)
                return

            favorites = load_favorites()
            user_favorites = favorites.get(username, [])
            
            # Enrich favorites with current cover URLs from database
            enriched_favorites = []
            for song in user_favorites:
                # Get music info from database
                music_info = database.get_music_by_filename(song.get('filename'))
                if music_info:
                    song['coverUrl'] = f"/api/cover/{music_info['id']}" if music_info.get('has_cover') else None
                    song['lrcUrl'] = f"/api/lyrics/{music_info['id']}" if music_info.get('has_lyrics') else None
                    song['url'] = f"/api/music/{music_info['id']}/download"
                    song['duration'] = music_info.get('duration', 0)
                enriched_favorites.append(song)

            self.send_json_response({
                'success': True,
                'data': enriched_favorites
            })

        except Exception as e:
            print(f"[GET_FAVORITES] Error: {str(e)}")
            import traceback
            traceback.print_exc()
            self.send_json_response({'success': False, 'error': str(e)}, 500)

    def handle_add_favorite(self):
        """Handle add song to favorites"""
        try:
            data = self.read_json_body()
            if not data:
                self.send_json_response({'success': False, 'error': 'Invalid request body'}, 400)
                return

            username = data.get('username', '').strip()
            song = data.get('song')

            if not username or not song:
                self.send_json_response({'success': False, 'error': 'Missing required fields'}, 400)
                return

            favorites = load_favorites()

            if username not in favorites:
                favorites[username] = []

            # Check if song already exists in favorites
            existing = [f for f in favorites[username] if f.get('filename') == song.get('filename')]
            if existing:
                self.send_json_response({'success': False, 'error': 'Song already in favorites'}, 409)
                return

            # Add song to favorites
            favorites[username].append(song)

            if save_favorites(favorites):
                print(f"[ADD_FAVORITE] Added favorite for: {username}")
                self.send_json_response({
                    'success': True,
                    'message': 'Added to favorites',
                    'data': favorites[username]
                })
            else:
                self.send_json_response({'success': False, 'error': 'Failed to save favorite'}, 500)

        except Exception as e:
            print(f"[ADD_FAVORITE] Error: {str(e)}")
            import traceback
            traceback.print_exc()
            self.send_json_response({'success': False, 'error': str(e)}, 500)

    def handle_remove_favorite(self):
        """Handle remove song from favorites"""
        try:
            data = self.read_json_body()
            if not data:
                self.send_json_response({'success': False, 'error': 'Invalid request body'}, 400)
                return

            username = data.get('username', '').strip()
            filename = data.get('filename')

            if not username or not filename:
                self.send_json_response({'success': False, 'error': 'Missing required fields'}, 400)
                return

            favorites = load_favorites()

            if username not in favorites:
                self.send_json_response({'success': False, 'error': 'No favorites found'}, 404)
                return

            # Remove song from favorites
            favorites[username] = [f for f in favorites[username] if f.get('filename') != filename]

            if save_favorites(favorites):
                print(f"[REMOVE_FAVORITE] Removed favorite for: {username}")
                self.send_json_response({
                    'success': True,
                    'message': 'Removed from favorites',
                    'data': favorites[username]
                })
            else:
                self.send_json_response({'success': False, 'error': 'Failed to remove favorite'}, 500)

        except Exception as e:
            print(f"[REMOVE_FAVORITE] Error: {str(e)}")
            import traceback
            traceback.print_exc()
            self.send_json_response({'success': False, 'error': str(e)}, 500)

    def handle_get_stats(self):
        """Handle get music statistics (read-only from database)"""
        try:
            stats = database.get_music_stats()
            self.send_json_response({'success': True, 'data': stats})
        except Exception as e:
            print(f"[STATS] Error: {str(e)}")
            self.send_json_response({'success': False, 'error': str(e)}, 500)

    def handle_search_music(self):
        """Handle music search (read-only from database)"""
        try:
            parsed_path = urlparse(self.path)
            query_params = parse_qs(parsed_path.query)
            keyword = query_params.get('q', query_params.get('keyword', ['']))[0].strip()

            if not keyword:
                self.send_json_response({'success': False, 'error': 'Search keyword is required'}, 400)
                return

            results = database.search_music(keyword)
            self.send_json_response({'success': True, 'data': results, 'keyword': keyword})
        except Exception as e:
            print(f"[SEARCH] Error: {str(e)}")
            self.send_json_response({'success': False, 'error': str(e)}, 500)

    def handle_get_artists(self):
        """Handle get all artists (read-only from database)"""
        try:
            artists = database.get_all_artists()
            self.send_json_response({'success': True, 'data': artists})
        except Exception as e:
            print(f"[ARTISTS] Error: {str(e)}")
            self.send_json_response({'success': False, 'error': str(e)}, 500)

    def handle_download_music(self, music_id):
        """Handle download music file from database"""
        log_download(t('download.request', music_id=music_id))
        try:
            music_data = database.get_music_data(music_id)
            log_download(t('download.found', found=music_data is not None))
            if not music_data:
                self.send_error(404, "Music not found")
                return
            
            # Read music file from filesystem (Redis stores only metadata)
            file_path = music_data.get('file_path')
            if not file_path or not os.path.exists(file_path):
                self.send_error(404, "Music file not found")
                return
            
            # Get file size
            file_size = os.path.getsize(file_path)
            
            # Encode filename for Content-Disposition header (RFC 5987)
            filename = music_data["filename"]
            try:
                # Try ASCII first
                filename.encode('ascii')
                content_disposition = f'inline; filename="{filename}"'
            except UnicodeEncodeError:
                # Use RFC 5987 encoding for non-ASCII filenames
                from urllib.parse import quote
                filename_utf8 = quote(filename, safe='')
                content_disposition = f"inline; filename*=UTF-8''{filename_utf8}"
            
            self.send_response(200)
            self.send_header('Content-Type', music_data['mime_type'])
            self.send_header('Content-Disposition', content_disposition)
            self.send_header('Content-Length', file_size)
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            # Stream file in chunks to avoid memory issues
            try:
                with open(file_path, 'rb') as f:
                    while True:
                        chunk = f.read(8192)  # 8KB chunks
                        if not chunk:
                            break
                        self.wfile.write(chunk)
            except (ConnectionResetError, BrokenPipeError):
                # Client disconnected, ignore
                log_warning(f"Client disconnected during download: {music_id}")
                return
        except Exception as e:
            log_error(t('download.error', error=str(e)))
            # Use English error message to avoid UnicodeEncodeError
            error_msg = "Download failed"
            self.send_error(500, error_msg)

    def handle_get_lyrics_by_id(self, music_id):
        """Handle get lyrics by music ID from database"""
        try:
            lyrics_content = database.get_lyrics_by_music_id(music_id)
            if lyrics_content is None:
                self.send_json_response({'success': False, 'error': 'Lyrics not found'}, 404)
                return
            
            self.send_json_response({'success': True, 'data': lyrics_content})
        except Exception as e:
            print(f"[LYRICS_BY_ID] Error: {str(e)}")
            self.send_json_response({'success': False, 'error': str(e)}, 500)

    def handle_get_cover(self, music_id):
        """Handle get cover image from database"""
        try:
            cover_data = database.get_cover_by_music_id(music_id)
            if not cover_data:
                self.send_error(404, "Cover not found")
                return
            
            # Read cover file from filesystem (Redis stores only metadata)
            file_path = cover_data.get('file_path')
            if not file_path or not os.path.exists(file_path):
                self.send_error(404, "Cover file not found")
                return
            
            with open(file_path, 'rb') as f:
                image_data = f.read()
            
            self.send_response(200)
            self.send_header('Content-Type', cover_data['mime_type'])
            self.send_header('Content-Length', len(image_data))
            self.send_header('Access-Control-Allow-Origin', '*')
            # 添加缓存控制，缓存1小时
            self.send_header('Cache-Control', 'public, max-age=3600')
            self.send_header('Expires', self.date_time_string(time.time() + 3600))
            self.end_headers()
            self.wfile.write(image_data)
        except Exception as e:
            print(f"[COVER] Error: {str(e)}")
            self.send_error(500, str(e))

    def parse_multipart_body(self, body, boundary):
        """Parse multipart form data body"""
        form_data = {}

        # Build boundary markers
        boundary_start = f'--{boundary}'.encode()
        boundary_end = f'--{boundary}--'.encode()

        # Split parts
        parts = body.split(boundary_start)

        for part in parts[1:]:  # Skip first empty part
            part = part.strip(b'\r\n')

            # Skip end marker
            if part == boundary_end or part.startswith(boundary_end):
                continue

            # Find header and body separator
            header_end = part.find(b'\r\n\r\n')
            if header_end == -1:
                continue

            headers = part[:header_end].decode('utf-8', errors='ignore')
            data = part[header_end + 4:]

            # Parse Content-Disposition
            name = None
            filename = None

            for line in headers.split('\r\n'):
                if line.lower().startswith('content-disposition:'):
                    # Extract name
                    name_match = re.search(r'name="([^"]+)"', line)
                    if name_match:
                        name = name_match.group(1)

                    # Extract filename
                    filename_match = re.search(r'filename="([^"]*)"', line)
                    if filename_match:
                        filename = filename_match.group(1)

            if name:
                if filename is not None:
                    # File field
                    form_data[name] = FormField(name, filename=filename, data=data)
                else:
                    # Regular field
                    form_data[name] = FormField(name, value=data.decode('utf-8', errors='ignore'))

        return form_data

    def handle_song_info(self):
        """Handle get song info API"""
        try:
            if not DOWNLOADER_AVAILABLE:
                self.send_json_response({
                    'success': False,
                    'error': '下载器模块未安装，请安装依赖: pip install requests'
                }, 503)
                return

            # Get music_id from query string
            parsed_path = urlparse(self.path)
            query_params = parse_qs(parsed_path.query)
            music_id = query_params.get('id', [''])[0]

            if not music_id:
                self.send_json_response({
                    'success': False,
                    'error': '请提供歌曲ID'
                }, 400)
                return

            log_info(f"Getting song info: {music_id}")

            # Import downloader to get song info
            from music_downloader import downloader
            info = downloader.get_song_info(music_id)

            if info:
                # 检查是否有歌词（从HTML提取的）
                has_lyrics = bool(info.get('lyrics') and len(info['lyrics']) > 10)
                info['has_lyrics'] = has_lyrics
                self.send_json_response({
                    'success': True,
                    'info': info
                })
            else:
                self.send_json_response({
                    'success': False,
                    'error': '无法获取歌曲信息'
                }, 404)
        except Exception as e:
            log_error(f"Get song info failed: {e}")
            self.send_json_response({
                'success': False,
                'error': str(e)
            }, 500)

    def handle_search_songs(self):
        """Handle search songs API"""
        try:
            if not DOWNLOADER_AVAILABLE:
                self.send_json_response({
                    'success': False,
                    'error': '下载器模块未安装，请安装依赖: pip install requests'
                }, 503)
                return
            
            # Get keyword from query string
            parsed_path = urlparse(self.path)
            query_params = parse_qs(parsed_path.query)
            keyword = query_params.get('keyword', [''])[0]
            
            if not keyword:
                self.send_json_response({
                    'success': False,
                    'error': '请输入搜索关键词'
                }, 400)
                return
            
            log_info(f"Searching songs: {keyword}")
            songs = search_songs(keyword)
            
            self.send_json_response({
                'success': True,
                'songs': songs,
                'count': len(songs)
            })
        except Exception as e:
            log_error(f"Search songs failed: {e}")
            self.send_json_response({
                'success': False,
                'error': str(e)
            }, 500)

    def handle_download_song(self):
        """Handle download song API"""
        try:
            if not DOWNLOADER_AVAILABLE:
                self.send_json_response({
                    'success': False,
                    'error': '下载器模块未安装，请安装依赖: pip install requests'
                }, 503)
                return
            
            # Get music_id from query string
            parsed_path = urlparse(self.path)
            query_params = parse_qs(parsed_path.query)
            music_id = query_params.get('id', [''])[0]
            
            if not music_id:
                self.send_json_response({
                    'success': False,
                    'error': '请提供歌曲ID'
                }, 400)
                return
            
            # Download path - save to music folder directly
            download_path = MUSIC_DIR
            os.makedirs(download_path, exist_ok=True)
            
            log_info(f"Downloading song: {music_id}")
            
            # Download song (without progress callback for API)
            result = download_song(music_id, download_path)
            
            if result['success']:
                log_success(f"Downloaded: {result['filename']}")
                self.send_json_response({
                    'success': True,
                    'message': '下载成功',
                    'filename': result['filename'],
                    'title': result['title'],
                    'artist': result['artist']
                })
            else:
                log_error(f"Download failed: {result['error']}")
                self.send_json_response({
                    'success': False,
                    'error': result['error']
                }, 500)
        except Exception as e:
            log_error(f"Download song failed: {e}")
            self.send_json_response({
                'success': False,
                'error': str(e)
            }, 500)

    def handle_get_download_link(self):
        """Handle get download link API"""
        try:
            if not DOWNLOADER_AVAILABLE:
                self.send_json_response({
                    'success': False,
                    'error': '下载器模块未安装，请安装依赖: pip install requests'
                }, 503)
                return

            # Get music_id from query string
            parsed_path = urlparse(self.path)
            query_params = parse_qs(parsed_path.query)
            music_id = query_params.get('id', [''])[0]

            if not music_id:
                self.send_json_response({
                    'success': False,
                    'error': '请提供歌曲ID'
                }, 400)
                return

            log_info(f"Getting download link: {music_id}")

            # Import downloader to get download link
            from music_downloader import downloader

            # 1. Get song info
            info = downloader.get_song_info(music_id)
            if not info:
                self.send_json_response({
                    'success': False,
                    'error': '无法获取歌曲信息'
                }, 404)
                return

            if not info.get('play_id'):
                self.send_json_response({
                    'success': False,
                    'error': '无法获取播放ID'
                }, 404)
                return

            # 2. Get download URL
            download_url = downloader.get_download_url(info['play_id'])
            if not download_url:
                self.send_json_response({
                    'success': False,
                    'error': '无法获取下载链接'
                }, 404)
                return

            # Check if M3U8 format
            if download_url.endswith('.m3u8'):
                self.send_json_response({
                    'success': False,
                    'error': '该歌曲为 M3U8 格式，暂不支持下载'
                }, 400)
                return

            log_success(f"Got download link for: {info.get('title', 'Unknown')}")
            self.send_json_response({
                'success': True,
                'download_url': download_url,
                'title': info.get('title', ''),
                'artist': info.get('artist', '')
            })
        except Exception as e:
            log_error(f"Get download link failed: {e}")
            self.send_json_response({
                'success': False,
                'error': str(e)
            }, 500)

    def handle_proxy_download(self):
        """Handle proxy download - download from URL and save to server"""
        try:
            if not DOWNLOADER_AVAILABLE:
                self.send_json_response({
                    'success': False,
                    'error': '下载器模块未安装，请安装依赖: pip install requests'
                }, 503)
                return

            # Get parameters from query string
            parsed_path = urlparse(self.path)
            query_params = parse_qs(parsed_path.query)
            download_url = query_params.get('url', [''])[0]
            title = query_params.get('title', [''])[0]
            artist = query_params.get('artist', [''])[0]

            if not download_url:
                self.send_json_response({
                    'success': False,
                    'error': '请提供下载链接'
                }, 400)
                return

            log_info(f"Proxy downloading: {title} - {artist}")
            log_info(f"Download URL: {download_url[:100]}...")

            # Import requests
            import requests

            # Download file - 使用与 music_downloader 相同的 headers
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'audio/webm,audio/ogg,audio/wav,audio/*;q=0.9,application/ogg;q=0.7,video/*;q=0.6,*/*;q=0.5',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Accept-Encoding': 'identity;q=1, *;q=0',
                'Referer': 'https://www.gequbao.com/',
                'Origin': 'https://www.gequbao.com',
                'Connection': 'keep-alive',
            }

            log_info("Sending download request...")
            response = requests.get(download_url, headers=headers, timeout=30, stream=True)
            log_info(f"Response status: {response.status_code}")

            if response.status_code not in [200, 206]:
                self.send_json_response({
                    'success': False,
                    'error': f'下载失败，HTTP状态码: {response.status_code}'
                }, 500)
                return

            # Build filename
            if title and artist:
                filename = f"{artist}-{title}.mp3"
            else:
                filename = "downloaded_song.mp3"

            # Clean filename
            import re
            filename = re.sub(r'[\\/*?:"<>|]', '', filename)

            # Save path
            filepath = os.path.join(MUSIC_DIR, filename)

            # Download and save
            total_size = int(response.headers.get('content-length', 0))
            downloaded_size = 0

            with open(filepath, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
                        downloaded_size += len(chunk)

            if downloaded_size == 0:
                os.remove(filepath)
                self.send_json_response({
                    'success': False,
                    'error': '下载失败，文件大小为0'
                }, 500)
                return

            log_success(f"Proxy downloaded: {filename}")

            # Return success with file info
            self.send_json_response({
                'success': True,
                'message': '下载成功',
                'filename': filename,
                'title': title,
                'artist': artist
            })

        except Exception as e:
            log_error(f"Proxy download failed: {e}")
            self.send_json_response({
                'success': False,
                'error': str(e)
            }, 500)

    def handle_download_lyrics(self):
        """Handle download lyrics API - 从网页获取歌词并保存"""
        try:
            if not DOWNLOADER_AVAILABLE:
                self.send_json_response({
                    'success': False,
                    'error': '下载器模块未安装，请安装依赖: pip install requests'
                }, 503)
                return

            # Get music_id from query string
            parsed_path = urlparse(self.path)
            query_params = parse_qs(parsed_path.query)
            music_id = query_params.get('id', [''])[0]

            if not music_id:
                self.send_json_response({
                    'success': False,
                    'error': '请提供歌曲ID'
                }, 400)
                return

            log_info(f"Downloading lyrics for: {music_id}")

            # Import downloader to get song info
            from music_downloader import downloader
            info = downloader.get_song_info(music_id)

            if not info:
                self.send_json_response({
                    'success': False,
                    'error': '无法获取歌曲信息'
                }, 404)
                return

            # 检查是否有歌词
            if not info.get('lyrics'):
                self.send_json_response({
                    'success': False,
                    'error': '该歌曲暂无歌词'
                }, 404)
                return

            # 保存歌词到文件
            import re
            if info['title'] and info['artist']:
                base_name = f"{info['title']}-{info['artist']}"
            else:
                base_name = music_id

            # 清理文件名
            base_name = re.sub(r'[\\/*?:"<>|]', '', base_name)

            # 保存到 lrc 文件夹
            lrc_dir = os.path.join(DATA_DIR, 'lrc')
            os.makedirs(lrc_dir, exist_ok=True)
            lrc_path = os.path.join(lrc_dir, f"{base_name}.lrc")

            with open(lrc_path, 'w', encoding='utf-8') as f:
                f.write(info['lyrics'])

            log_success(f"Lyrics saved: {lrc_path}")

            self.send_json_response({
                'success': True,
                'message': '歌词下载成功',
                'path': lrc_path
            })

        except Exception as e:
            log_error(f"Download lyrics failed: {e}")
            self.send_json_response({
                'success': False,
                'error': str(e)
            }, 500)

    def handle_client_download(self, version_type):
        """Handle client download - return download link for App"""
        try:
            # Map version types to download URLs
            # These URLs point to the actual file server (port 12345)
            download_urls = {
                'msi': 'https://music.mtim.top:12345/api/download/msi',
                'zhmsi': 'https://music.mtim.top:12345/api/download/zhmsi',
                'nsn': 'https://music.mtim.top:12345/api/download/nsn'
            }

            if version_type not in download_urls:
                self.send_json_response({
                    'success': False,
                    'error': 'Version not found'
                }, 404)
                return

            # Return download link
            self.send_json_response({
                'success': True,
                'data': {
                    'url': download_urls[version_type],
                    'type': version_type
                }
            })

        except Exception as e:
            log_error(f"Client download failed: {e}")
            self.send_json_response({
                'success': False,
                'error': 'Download failed'
            }, 500)

    def handle_launch_downloader(self):
        """Handle launch music downloader"""
        try:
            import subprocess
            import sys
            
            # Path to the downloader script
            downloader_path = os.path.join(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                'gequbao_embedded.py'
            )
            
            if not os.path.exists(downloader_path):
                self.send_json_response({
                    'success': False,
                    'error': '下载器文件不存在: ' + downloader_path
                }, 404)
                return
            
            # Launch the downloader in a new process
            # Use pythonw on Windows to avoid console window
            if sys.platform == 'win32':
                subprocess.Popen(
                    [sys.executable, downloader_path],
                    creationflags=subprocess.CREATE_NO_WINDOW,
                    cwd=os.path.dirname(downloader_path)
                )
            else:
                subprocess.Popen(
                    [sys.executable, downloader_path],
                    cwd=os.path.dirname(downloader_path)
                )
            
            log_info(t('download.launching'))
            self.send_json_response({
                'success': True,
                'message': '下载器已启动'
            })
        except Exception as e:
            log_error(f"Failed to launch downloader: {e}")
            self.send_json_response({
                'success': False,
                'error': str(e)
            }, 500)

    def serve_download_page(self):
        """Serve the download page"""
        try:
            # Path to download.html
            web_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'server', 'web')
            file_path = os.path.join(web_dir, 'download.html')

            if not os.path.exists(file_path):
                self.send_error(404, "Download page not found")
                return

            # Read and serve the file
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()

            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', len(content.encode('utf-8')))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(content.encode('utf-8'))

        except Exception as e:
            log_error(f"Failed to serve download page: {e}")
            self.send_error(500, "Failed to serve download page")

    def serve_delete_page(self):
        """Serve the delete management page"""
        try:
            # Path to del.html
            web_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'server', 'web')
            file_path = os.path.join(web_dir, 'del.html')

            if not os.path.exists(file_path):
                self.send_error(404, "Delete page not found")
                return

            # Read and serve the file
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()

            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', len(content.encode('utf-8')))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(content.encode('utf-8'))

        except Exception as e:
            log_error(f"Failed to serve delete page: {e}")
            self.send_error(500, "Failed to serve delete page")

    def handle_delete_music(self):
        """Handle delete music API"""
        try:
            # Read request body
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))

            ids = data.get('ids', [])
            if not ids:
                self.send_json_response({
                    'success': False,
                    'error': 'No song IDs provided'
                }, 400)
                return

            deleted_count = 0
            errors = []

            for song_id in ids:
                try:
                    # Get music data
                    music_data = database.get_music_data(song_id)
                    if not music_data:
                        errors.append(f"Song {song_id} not found")
                        continue

                    # Delete files
                    file_path = music_data.get('file_path')
                    if file_path and os.path.exists(file_path):
                        os.remove(file_path)

                    # Delete cover
                    cover_path = music_data.get('cover_path')
                    if cover_path and os.path.exists(cover_path):
                        os.remove(cover_path)

                    # Delete lyrics
                    lrc_path = music_data.get('lrc_path')
                    if lrc_path and os.path.exists(lrc_path):
                        os.remove(lrc_path)

                    # Delete from database
                    database.delete_music(song_id)
                    deleted_count += 1

                except Exception as e:
                    errors.append(f"Failed to delete song {song_id}: {str(e)}")

            if deleted_count > 0:
                log_success(f"Deleted {deleted_count} songs")

            self.send_json_response({
                'success': True,
                'data': {
                    'deleted_count': deleted_count,
                    'errors': errors
                }
            })

        except Exception as e:
            log_error(f"Delete music failed: {e}")
            self.send_json_response({
                'success': False,
                'error': 'Delete failed'
            }, 500)


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    """Threaded HTTP server - handles each request in a separate thread"""
    daemon_threads = True
    allow_reuse_address = True


class ThreadedHTTPServerV6(ThreadingMixIn, HTTPServer):
    """Threaded IPv6 HTTP server with IPv4 support (dual-stack)"""
    address_family = socket.AF_INET6
    daemon_threads = True
    allow_reuse_address = True
    
    def server_bind(self):
        # Enable dual-stack support (IPv4 + IPv6) on IPv6 socket
        # This allows the IPv6 server to also handle IPv4 connections
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


def create_ssl_context():
    """Create SSL context for HTTPS"""
    context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    
    # Check for certificate files in crt directory (common naming patterns)
    possible_certs = [
        # crt directory with domain-specific names
        ('crt/music.mtim.top_public.crt', 'crt/music.mtim.top.key'),
        ('crt/music.mtim.top.crt', 'crt/music.mtim.top.key'),
        ('crt/server.crt', 'crt/server.key'),
        # Current directory
        ('server.crt', 'server.key'),
        ('music.mtim.top_public.crt', 'music.mtim.top.key'),
        # data/cert directory
        ('data/cert/server.crt', 'data/cert/server.key'),
        # cert directory
        ('cert/server.crt', 'cert/server.key'),
    ]
    
    cert_path = None
    key_path = None
    
    for c_path, k_path in possible_certs:
        if os.path.exists(c_path) and os.path.exists(k_path):
            cert_path = c_path
            key_path = k_path
            break
    
    if cert_path and key_path:
        try:
            # Check for certificate chain file
            chain_path = None
            possible_chains = [
                'crt/music.mtim.top_chain.crt',
                'crt/chain.crt',
                'chain.crt',
            ]
            for ch_path in possible_chains:
                if os.path.exists(ch_path):
                    chain_path = ch_path
                    break
            
            if chain_path:
                context.load_cert_chain(cert_path, key_path, chain_path)
                print(f"[SSL] Certificate loaded: {cert_path}")
                print(f"[SSL] Certificate chain loaded: {chain_path}")
                print(f"[SSL] Key loaded: {key_path}")
            else:
                context.load_cert_chain(cert_path, key_path)
                print(f"[SSL] Certificate loaded: {cert_path}")
                print(f"[SSL] Key loaded: {key_path}")
            return context
        except Exception as e:
            print(f"[SSL] Failed to load certificate: {e}")
            return None
    else:
        print("[SSL] No certificate files found, running in HTTP mode")
        print("[SSL] To enable HTTPS, place certificate files in:")
        print("       - crt/ directory (e.g., crt/your_domain.crt + crt/your_domain.key)")
        print("       - Current directory (server.crt + server.key)")
        print("       - data/cert/ directory")
        print("       - cert/ directory")
        return None

def run_server(port=80, https_port=443, dual_stack=True, use_https=True):
    """Run server with IPv4 and IPv6 support, optionally with HTTPS"""
    servers = []
    
    # Create SSL context if certificates are available
    ssl_context = None
    if use_https:
        ssl_context = create_ssl_context()
    
    if dual_stack:
        # Start both IPv4 and IPv6 servers
        # IPv4 HTTP server (mark as HTTP for redirect)
        try:
            server_v4 = ThreadedHTTPServer(('0.0.0.0', port), MusicRequestHandler)
            server_v4.is_http = True  # Mark as HTTP server for redirect
            servers.append(('IPv4 HTTP', server_v4))
            print(f"Music Player Server (IPv4 HTTP) running at http://0.0.0.0:{port}")
        except Exception as e:
            print(f"Failed to start IPv4 HTTP server: {e}")
        
        # IPv4 HTTPS server
        if ssl_context:
            try:
                server_v4_https = ThreadedHTTPServer(('0.0.0.0', https_port), MusicRequestHandler)
                server_v4_https.socket = ssl_context.wrap_socket(server_v4_https.socket, server_side=True)
                server_v4_https.is_http = False  # Mark as HTTPS server
                servers.append(('IPv4 HTTPS', server_v4_https))
                print(f"Music Player Server (IPv4 HTTPS) running at https://0.0.0.0:{https_port}")
            except Exception as e:
                print(f"Failed to start IPv4 HTTPS server: {e}")
        
        # IPv6 HTTP server (mark as HTTP for redirect)
        try:
            server_v6 = ThreadedHTTPServerV6(('::', port), MusicRequestHandler)
            server_v6.is_http = True  # Mark as HTTP server for redirect
            servers.append(('IPv6 HTTP', server_v6))
            print(f"Music Player Server (IPv6 HTTP) running at http://[::]:{port}")
        except Exception as e:
            print(f"Failed to start IPv6 HTTP server: {e}")
        
        # IPv6 HTTPS server
        if ssl_context:
            try:
                server_v6_https = ThreadedHTTPServerV6(('::', https_port), MusicRequestHandler)
                server_v6_https.socket = ssl_context.wrap_socket(server_v6_https.socket, server_side=True)
                server_v6_https.is_http = False  # Mark as HTTPS server
                servers.append(('IPv6 HTTPS', server_v6_https))
                print(f"Music Player Server (IPv6 HTTPS) running at https://[::]:{https_port}")
            except Exception as e:
                print(f"Failed to start IPv6 HTTPS server: {e}")
    else:
        # IPv4 only
        try:
            server = ThreadedHTTPServer(('0.0.0.0', port), MusicRequestHandler)
            server.is_http = True  # Mark as HTTP server for redirect
            servers.append(('IPv4 HTTP', server))
            print(f"Music Player Server (IPv4 HTTP) running at http://0.0.0.0:{port}")
        except Exception as e:
            print(f"Failed to start IPv4 HTTP server: {e}")
        
        if ssl_context:
            try:
                server_https = ThreadedHTTPServer(('0.0.0.0', https_port), MusicRequestHandler)
                server_https.socket = ssl_context.wrap_socket(server_https.socket, server_side=True)
                server_https.is_http = False  # Mark as HTTPS server
                servers.append(('IPv4 HTTPS', server_https))
                print(f"Music Player Server (IPv4 HTTPS) running at https://0.0.0.0:{https_port}")
            except Exception as e:
                print(f"Failed to start IPv4 HTTPS server: {e}")
    
    if not servers:
        print("No servers could be started!")
        return
    
    print(f"Music directory: {MUSIC_DIR}")
    print(f"Lyrics directory: {LRC_DIR}")
    print()
    
    # Start file watcher
    if WATCHER_AVAILABLE:
        try:
            start_file_watcher()
            print("[SERVER] File watcher started - monitoring music, lyrics, and cover folders")
        except Exception as e:
            log_warning(f"Failed to start file watcher: {e}")
    else:
        print("[SERVER] File watcher not available (install watchdog: pip install watchdog)")
    
    print()
    print("API Endpoints:")
    print(f"  GET  http://localhost:{port}/api/music-list")
    print(f"  GET  http://localhost:{port}/api/lyrics/<filename>")
    print(f"  POST http://localhost:{port}/api/upload")
    print(f"  POST http://localhost:{port}/api/register")
    print(f"  POST http://localhost:{port}/api/login")
    print(f"  GET  http://localhost:{port}/api/favorites?username=<username>")
    print(f"  POST http://localhost:{port}/api/favorites/add")
    print(f"  POST http://localhost:{port}/api/favorites/remove")
    if ssl_context:
        print(f"  GET  https://localhost:{https_port}/api/music-list")
        print(f"  GET  https://localhost:{https_port}/api/lyrics/<filename>")
        print(f"  POST https://localhost:{https_port}/api/upload")
        print(f"  POST https://localhost:{https_port}/api/register")
        print(f"  POST https://localhost:{https_port}/api/login")
        print(f"  GET  https://localhost:{https_port}/api/favorites?username=<username>")
        print(f"  POST https://localhost:{https_port}/api/favorites/add")
        print(f"  POST https://localhost:{https_port}/api/favorites/remove")
    print()
    print("Press Ctrl+C to stop the server")
    print("Supports multiple concurrent connections")
    
    # Run servers in separate threads
    threads = []
    
    for name, server in servers:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        threads.append(thread)
        print(f"{name} server started (threaded, supports concurrent connections)")
    
    try:
        # Keep main thread alive
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopping servers...")
        for name, server in servers:
            server.shutdown()
            print(f"{name} server stopped")
        print("All servers stopped")


if __name__ == '__main__':
    import sys
    
    # Parse command line arguments
    port = 80
    https_port = 443
    use_https = True
    
    for i, arg in enumerate(sys.argv[1:]):
        if arg == '--port' and i + 1 < len(sys.argv[1:]):
            port = int(sys.argv[i + 2])
        elif arg == '--https-port' and i + 1 < len(sys.argv[1:]):
            https_port = int(sys.argv[i + 2])
        elif arg == '--no-https':
            use_https = False
    
    run_server(port=port, https_port=https_port, use_https=use_https)
