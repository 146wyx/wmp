#!/usr/bin/env python3
"""
Logger Module - 彩色日志和国际化支持
"""

import os
import sys
import json

# Enable ANSI colors and UTF-8 on Windows
if sys.platform == 'win32':
    import ctypes
    kernel32 = ctypes.windll.kernel32
    kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7)
    # Set console to UTF-8 mode
    kernel32.SetConsoleOutputCP(65001)  # UTF-8
    kernel32.SetConsoleCP(65001)  # UTF-8
    # Set stdout/stderr to UTF-8
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

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

# Global locale data
TERMINAL_LOCALE = {}
DEFAULT_LANG = 'en-us'


def load_locale(lang):
    """Load terminal locale file"""
    global TERMINAL_LOCALE, DEFAULT_LANG
    DEFAULT_LANG = lang
    
    locales_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'locales')
    locale_file = os.path.join(locales_dir, f'{lang}.json')
    
    if os.path.exists(locale_file):
        try:
            with open(locale_file, 'r', encoding='utf-8') as f:
                TERMINAL_LOCALE = json.load(f)
            return True
        except Exception as e:
            print(f"Failed to load locale file: {e}")
    
    # Fallback to en-us
    locale_file = os.path.join(locales_dir, 'en-us.json')
    if os.path.exists(locale_file):
        try:
            with open(locale_file, 'r', encoding='utf-8') as f:
                TERMINAL_LOCALE = json.load(f)
        except:
            pass
    return False


def t(key, **kwargs):
    """Get translated text from terminal locale
    Usage: t('server.starting') or t('redis.started', port=6379)
    """
    keys = key.split('.')
    value = TERMINAL_LOCALE
    for k in keys:
        if isinstance(value, dict) and k in value:
            value = value[k]
        else:
            return key  # Return key if translation not found
    
    if isinstance(value, str) and kwargs:
        try:
            return value.format(**kwargs)
        except:
            pass
    return value if isinstance(value, str) else key


def get_label(key):
    """Get log label from terminal locale"""
    return t(f'log.labels.{key}', default=key)


# Log functions
def log_info(msg):
    """Info log - white"""
    print(f"{COLORS['WHITE']}[{get_label('INFO')}]{COLORS['RESET']} {msg}")


def log_success(msg):
    """Success log - green"""
    print(f"{COLORS['GREEN']}[{get_label('OK')}]{COLORS['RESET']} {msg}")


def log_warning(msg):
    """Warning log - yellow"""
    print(f"{COLORS['YELLOW']}[{get_label('WARN')}]{COLORS['RESET']} {msg}")


def log_error(msg):
    """Error log - red"""
    print(f"{COLORS['RED']}[{get_label('ERROR')}]{COLORS['RESET']} {msg}")


def log_debug(msg):
    """Debug log - gray"""
    print(f"{COLORS['GRAY']}[{get_label('DEBUG')}]{COLORS['RESET']} {msg}")


def log_server(msg):
    """Server log - cyan"""
    print(f"{COLORS['CYAN']}[{get_label('SERVER')}]{COLORS['RESET']} {msg}")


def log_db(msg):
    """Database log - magenta"""
    print(f"{COLORS['MAGENTA']}[{get_label('DB')}]{COLORS['RESET']} {msg}")


def log_redis(msg):
    """Redis log - blue"""
    print(f"{COLORS['BLUE']}[{get_label('REDIS')}]{COLORS['RESET']} {msg}")


def log_download(msg):
    """Download log - yellow"""
    print(f"{COLORS['YELLOW']}[{get_label('DOWNLOAD')}]{COLORS['RESET']} {msg}")


# HTTP Request colored log (for server use)
def format_http_log(timestamp, client_ip, method, path, protocol=''):
    """Format HTTP request log with colors"""
    # Colorize method
    method_colors = {
        'GET': COLORS['GREEN'],
        'POST': COLORS['BLUE'],
        'PUT': COLORS['YELLOW'],
        'DELETE': COLORS['RED'],
        'PATCH': COLORS['MAGENTA'],
    }
    method_color = method_colors.get(method, COLORS['WHITE'])
    
    # Colorize path based on type
    if '/api/' in path:
        path_color = COLORS['CYAN']
    elif path.endswith(('.js', '.css', '.html')):
        path_color = COLORS['GRAY']
    elif path.endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico')):
        path_color = COLORS['MAGENTA']
    elif path.endswith(('.mp3', '.flac', '.wav', '.aac', '.ogg')):
        path_color = COLORS['YELLOW']
    else:
        path_color = COLORS['WHITE']
    
    # Build colored log
    colored_request = f"{method_color}{method}{COLORS['RESET']} {path_color}{path}{COLORS['RESET']}"
    if protocol:
        colored_request += f" {COLORS['DIM']}{protocol}{COLORS['RESET']}"
    
    return f"{COLORS['GRAY']}[{timestamp}]{COLORS['RESET']} {COLORS['CYAN']}{client_ip}{COLORS['RESET']} {colored_request}"
