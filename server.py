#!/usr/bin/env python3
"""
Music Player Server with Upload API
Compatible with Python 3.13+
"""

import os
import json
import shutil
import re
import time
import ssl
from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn
import socket
from urllib.parse import parse_qs, urlparse, unquote
import threading

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

# Ensure directories exist
os.makedirs(MUSIC_DIR, exist_ok=True)
os.makedirs(LRC_DIR, exist_ok=True)
os.makedirs(COVER_DIR, exist_ok=True)
os.makedirs(USER_DIR, exist_ok=True)

# User data file
USERS_FILE = os.path.join(USER_DIR, 'users.json')
FAVORITES_FILE = os.path.join(USER_DIR, 'favorites.json')


def load_users():
    """Load users from JSON file"""
    if os.path.exists(USERS_FILE):
        try:
            with open(USERS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"[ERROR] Failed to load users: {e}")
    return {}


def save_users(users):
    """Save users to JSON file"""
    try:
        with open(USERS_FILE, 'w', encoding='utf-8') as f:
            json.dump(users, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"[ERROR] Failed to save users: {e}")
        return False


def load_favorites():
    """Load user favorites from JSON file"""
    if os.path.exists(FAVORITES_FILE):
        try:
            with open(FAVORITES_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"[ERROR] Failed to load favorites: {e}")
    return {}


def save_favorites(favorites):
    """Save user favorites to JSON file"""
    try:
        with open(FAVORITES_FILE, 'w', encoding='utf-8') as f:
            json.dump(favorites, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"[ERROR] Failed to save favorites: {e}")
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
        # Set document root to current directory
        super().__init__(*args, directory=os.path.dirname(os.path.abspath(__file__)), **kwargs)

    def log_message(self, format, *args):
        """Custom log format"""
        print(f"[{self.log_date_time_string()}] {args[0]}")

    def send_json_response(self, data, status_code=200):
        """Send JSON response"""
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))

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

        # API: Get music list
        if parsed_path.path == '/api/music-list':
            self.handle_music_list()
            return

        # API: Get lyrics
        if parsed_path.path.startswith('/api/lyrics/'):
            filename = unquote(parsed_path.path[len('/api/lyrics/'):])
            self.handle_get_lyrics(filename)
            return

        # Default: Static file service
        super().do_GET()

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
            print(f"[WARNING] Failed to get duration for {file_path}: {e}")
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
            print(f"[ERROR] Failed to parse JSON body: {e}")
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

            self.send_json_response({
                'success': True,
                'data': user_favorites
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
