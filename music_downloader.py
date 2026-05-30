#!/usr/bin/env python3
"""
Music Downloader Module - 网页版音乐下载器
基于歌曲宝 API，提供搜索和下载功能
"""

import os
import re
import json
import time
import requests
import html as html_module
from urllib.parse import quote, urlparse
from logger import log_info, log_error, log_success, log_warning


class GequbaoDownloader:
    """歌曲宝下载器"""
    
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0',
        })
        self.base_url = 'https://www.gequbao.com'
    
    def search_songs(self, keyword: str):
        """搜索歌曲"""
        try:
            search_url = f"{self.base_url}/s/{quote(keyword)}"
            response = self.session.get(search_url, timeout=10)
            response.encoding = 'utf-8'
            
            songs = []
            seen_ids = set()
            
            # 解析搜索结果
            pattern = r'<a href="/music/(\d+)"[^>]*title="([^"]+)"[^>]*>[\s\S]*?<span[^>]*>([^<]+)</span>[\s\S]*?<small[^>]*>([^<]+)</small>'
            matches = re.findall(pattern, response.text)
            
            for music_id, full_title, song_name, artist in matches:
                if music_id not in seen_ids:
                    seen_ids.add(music_id)
                    songs.append({
                        'id': music_id,
                        'title': html_module.unescape(song_name.strip()),
                        'artist': html_module.unescape(artist.strip()),
                        'full_title': html_module.unescape(full_title.strip()),
                    })
            
            return songs
        except Exception as e:
            log_error(f"Search failed: {e}")
            return []
    
    def get_song_info(self, music_id: str):
        """获取歌曲详细信息"""
        try:
            import os
            detail_url = f"{self.base_url}/music/{music_id}"
            response = self.session.get(detail_url, timeout=10)
            response.encoding = 'utf-8'
            html_content = response.text

            # 保存 HTML 文件用于调试
            temp_html_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'temp', f'song_{music_id}.html')
            os.makedirs(os.path.dirname(temp_html_path), exist_ok=True)
            with open(temp_html_path, 'w', encoding='utf-8') as f:
                f.write(html_content)
            log_info(f"Saved HTML to: {temp_html_path}")

            # 从 appData 提取信息
            appdata_match = re.search(
                r'window\.appData\s*=\s*JSON\.parse\([\'"](.+?)[\'"]\);',
                html_content,
                re.DOTALL
            )
            
            info = {
                'id': music_id,
                'title': '',
                'artist': '',
                'play_id': '',
                'cover_url': '',
                'lyrics': ''
            }
            
            if appdata_match:
                json_str = appdata_match.group(1)
                json_str = json_str.replace('\\u0022', '"').replace('\\/', '/')
                try:
                    app_data = json.loads(json_str)
                    info['title'] = app_data.get('mp3_title', '').encode('utf-8').decode('unicode_escape') if app_data.get('mp3_title') else ''
                    info['artist'] = app_data.get('mp3_author', '').encode('utf-8').decode('unicode_escape') if app_data.get('mp3_author') else ''
                    info['play_id'] = app_data.get('play_id', '')
                    info['cover_url'] = app_data.get('mp3_cover', '').replace('\\/', '/') if app_data.get('mp3_cover') else ''
                    # 优先从 HTML 中提取歌词
                    info['lyrics'] = self._extract_lyrics_from_html(html_content)
                    if not info['lyrics']:
                        info['lyrics'] = app_data.get('mp3_lyrics', '')
                except:
                    pass
            
            # 如果从 appData 没有获取到歌词，尝试直接从 HTML 提取
            if not info['lyrics']:
                info['lyrics'] = self._extract_lyrics_from_html(html_content)

            # 如果歌曲宝没有歌词，尝试从笑匠音乐获取
            if not info['lyrics'] and info['title']:
                log_info(f"No lyrics from gequbao, trying xiaojiang...")
                info['lyrics'] = self._get_lyrics_from_xiaojiang(info['title'], info['artist'])

            # 尝试从 HTML 中提取 play_id
            if not info['play_id']:
                play_id_match = re.search(r'"play_id":"([^"]+)"', html_content)
                if play_id_match:
                    info['play_id'] = play_id_match.group(1)
            
            # 从 HTML 中提取下载链接（低品质MP3）
            # 查找包含 download-option-card 和 detail-link 的 <a> 标签
            # 格式: <a href="https://..." download="..." class="download-option-card default detail-link" ...
            download_url = None

            # 方法1: 精确匹配 class 包含 download-option-card 和 detail-link
            download_link_match = re.search(
                r'<a[^>]*href="(https://[^"]+)"[^>]*class="[^"]*download-option-card[^"]*detail-link[^"]*"',
                html_content
            )
            if download_link_match:
                url = download_link_match.group(1)
                if 'kuwo.cn' in url and 'trackmedia' in url:
                    download_url = url
                    log_info(f"Method 1 - Found URL: {download_url[:80]}...")

            # 方法2: 查找所有 kuwo.cn 的 trackmedia 链接
            if not download_url:
                all_matches = re.findall(r'href="(https://[^"]*kuwo\.cn[^"]*trackmedia[^"]*)"', html_content)
                for url in all_matches:
                    if 'M500' in url or 'M800' in url:  # MP3 文件通常包含 M500 或 M800
                        download_url = url
                        log_info(f"Method 2 - Found URL: {download_url[:80]}...")
                        break

            # 方法3: 查找 data-index="0" 的下载链接（低品质MP3）
            if not download_url:
                download_link_match = re.search(
                    r'<a[^>]*data-index="0"[^>]*href="(https://[^"]+)"',
                    html_content
                )
                if download_link_match:
                    url = download_link_match.group(1)
                    if 'kuwo.cn' in url:
                        download_url = url
                        log_info(f"Method 3 - Found URL: {download_url[:80]}...")

            if download_url:
                info['download_url'] = download_url
                log_info(f"Final download URL: {info['download_url'][:80]}...")
            else:
                log_warning("Could not find valid download URL in HTML")
            
            return info
        except Exception as e:
            log_error(f"Get song info failed: {e}")
            return None
    
    def get_download_url(self, play_id: str):
        """获取下载链接"""
        try:
            api_url = "https://www.gequbao.com/api/play-url"
            data = {'id': play_id}
            
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest',
                'Origin': 'https://www.gequbao.com',
                'Referer': f'https://www.gequbao.com/music/{play_id}',
            }
            
            resp = self.session.post(api_url, data=data, timeout=10, headers=headers)
            result = resp.json()
            
            if result.get('code') == 1:
                url = result['data']['url']
                # 处理 URL 编码
                if '\\u0026' in url:
                    url = url.replace('\\u0026', '&')
                log_info(f"Got download URL: {url[:100]}...")  # 只记录前100个字符
                return url
            else:
                log_warning(f"Get download url failed: {result.get('msg', 'unknown error')}")
                return None
        except Exception as e:
            log_error(f"Get download url failed: {e}")
            return None
    
    def download_song(self, music_id: str, download_path: str, progress_callback=None):
        """下载歌曲"""
        try:
            # 1. 获取歌曲信息
            if progress_callback:
                progress_callback(10, "正在获取歌曲信息...")

            info = self.get_song_info(music_id)
            if not info:
                return {'success': False, 'error': '无法获取歌曲信息'}

            # 2. 获取下载链接（优先使用 HTML 中提取的链接）
            if progress_callback:
                progress_callback(30, "正在获取下载链接...")

            download_url = None

            # 优先使用从 HTML 中提取的下载链接
            if info.get('download_url'):
                download_url = info['download_url']
                log_info(f"Using download URL from HTML: {download_url[:80]}...")
            elif info.get('play_id'):
                # 如果 HTML 中没有，则通过 API 获取
                download_url = self.get_download_url(info['play_id'])

            if not download_url:
                return {'success': False, 'error': '无法获取下载链接'}

            # 检查链接类型
            if download_url.endswith('.m3u8'):
                return {'success': False, 'error': '该歌曲为 M3U8 格式，暂不支持下载'}
            
            # 3. 下载文件
            if progress_callback:
                progress_callback(50, "正在下载文件...")
            
            # 构建文件名（使用歌名-歌手格式）
            if info['title'] and info['artist']:
                filename = f"{info['title']}-{info['artist']}.mp3"
            else:
                filename = f"{music_id}.mp3"
            
            # 清理文件名
            filename = re.sub(r'[\\/*?:"<>|]', '', filename)
            
            # 保存到 music 文件夹
            filepath = os.path.join(download_path, filename)
            
            # 下载文件 - 使用简单的请求头
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            }

            log_info(f"Downloading from URL: {download_url[:80]}...")

            # 使用新的请求，不携带 session 的 cookies
            file_response = requests.get(download_url, timeout=30, stream=True, headers=headers)
            
            if file_response.status_code not in [200, 206]:
                return {'success': False, 'error': f'下载失败，HTTP状态码: {file_response.status_code}'}
            
            total_size = int(file_response.headers.get('content-length', 0))
            downloaded_size = 0
            
            with open(filepath, 'wb') as f:
                for chunk in file_response.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
                        downloaded_size += len(chunk)
                        if total_size > 0 and progress_callback:
                            progress = 50 + int((downloaded_size / total_size) * 40)
                            progress_callback(progress, f"下载中... {progress}%")
            
            if downloaded_size == 0:
                os.remove(filepath)
                return {'success': False, 'error': '下载失败，文件大小为0'}
            
            # 4. 下载封面和歌词
            if progress_callback:
                progress_callback(90, "正在下载封面和歌词...")

            # 构建基础文件名（不含扩展名）
            base_name = os.path.splitext(filename)[0]
            log_info(f"Downloading cover and lyrics with base_name: {base_name}")
            log_info(f"Cover URL: {info.get('cover_url', 'N/A')}")
            self._download_cover_and_lyrics(info, download_path, base_name)
            
            if progress_callback:
                progress_callback(100, "下载完成！")
            
            # 5. 暂时不删除 HTML 文件，用于调试
            # try:
            #     temp_html_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'temp', f'song_{music_id}.html')
            #     if os.path.exists(temp_html_path):
            #         os.remove(temp_html_path)
            #         log_info(f"Deleted temp HTML: {temp_html_path}")
            # except Exception as e:
            #     log_warning(f"Failed to delete temp HTML: {e}")

            log_success(f"Downloaded: {filename}")
            return {
                'success': True,
                'filepath': filepath,
                'filename': filename,
                'title': info['title'],
                'artist': info['artist']
            }

        except Exception as e:
            log_error(f"Download failed: {e}")
            return {'success': False, 'error': str(e)}

    def _extract_lyrics_from_html(self, html_content: str) -> str:
        """从 HTML 中提取歌词"""
        try:
            # 查找 content-lrc div
            lrc_match = re.search(r'id="content-lrc"[^>]*>(.*?)</div>', html_content, re.DOTALL)
            if lrc_match:
                content = lrc_match.group(1)
                log_info(f"Found content-lrc div, content preview: {content[:100]}...")
                # 检查是否是"暂无歌词"
                if '暂无歌词' in content:
                    log_info("Lyrics not available (暂无歌词)")
                    return ''
                # 将 <br /> 替换为换行符
                lyrics = content.replace('<br />', '\n').replace('<br>', '\n')
                # 清理 HTML 标签
                lyrics = re.sub(r'<[^>]+>', '', lyrics)
                # 清理多余的空行
                lyrics = '\n'.join(line.strip() for line in lyrics.split('\n') if line.strip())
                if lyrics:
                    log_info(f"Extracted lyrics from HTML: {len(lyrics)} chars")
                    return lyrics
            else:
                log_warning("No content-lrc div found in HTML")
        except Exception as e:
            log_warning(f"Failed to extract lyrics from HTML: {e}")
        return ''

    def _get_lyrics_from_xiaojiang(self, title: str, artist: str) -> str:
        """从笑匠音乐歌词库获取歌词"""
        try:
            import time
            # 使用完整的浏览器 headers
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Cache-Control': 'max-age=0',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
            }

            # 直接搜索歌词（不需要先访问首页）
            search_url = f"https://xiaojiangclub.com/search.php?q={requests.utils.quote(title + ' ' + artist)}"
            log_info(f"Searching lyrics from xiaojiang: {search_url}")

            # 添加 Referer
            headers['Referer'] = 'https://xiaojiangclub.com/'

            response = requests.get(search_url, headers=headers, timeout=10)
            response.encoding = 'utf-8'
            log_info(f"Search response status: {response.status_code}")

            # 查找第一个歌词链接
            # 格式: /lyrics/12345.html
            lyric_match = re.search(r'href="(/lyrics/\d+\.html)"', response.text)
            if not lyric_match:
                log_warning("No lyrics found in xiaojiang search results")
                return ''

            lyric_url = f"https://xiaojiangclub.com{lyric_match.group(1)}"
            log_info(f"Found lyric page: {lyric_url}")

            # 获取歌词页面
            lyric_response = requests.get(lyric_url, headers=headers, timeout=10)
            lyric_response.encoding = 'utf-8'
            log_info(f"Lyric page status: {lyric_response.status_code}")

            # 查找 LRC 歌词 - 直接从整个页面中提取时间戳行
            # 格式: [00:00.50]歌词内容
            lrc_lines = re.findall(r'\[\d{2}:\d{2}\.\d{2,3}\][^\n]+', lyric_response.text)

            if lrc_lines:
                # 按时间戳分组，合并中英文歌词
                from collections import OrderedDict
                lyrics_dict = OrderedDict()  # 保持顺序

                for line in lrc_lines:
                    # 提取时间戳和歌词内容
                    match = re.match(r'(\[\d{2}:\d{2}\.\d{2,3}\])(.+)', line)
                    if match:
                        timestamp = match.group(1)
                        content = match.group(2).strip()

                        if timestamp not in lyrics_dict:
                            lyrics_dict[timestamp] = {'en': '', 'cn': ''}

                        # 判断是中文还是英文
                        # 如果包含中文字符，认为是中文歌词
                        if re.search(r'[\u4e00-\u9fff]', content):
                            lyrics_dict[timestamp]['cn'] = content
                        else:
                            lyrics_dict[timestamp]['en'] = content

                # 构建双语歌词
                bilingual_lines = []
                for timestamp, contents in lyrics_dict.items():
                    if contents['en'] and contents['cn']:
                        # 中英文都有，合并显示
                        bilingual_lines.append(f"{timestamp}{contents['en']}")
                        bilingual_lines.append(f"{timestamp}{contents['cn']}")
                    elif contents['en']:
                        bilingual_lines.append(f"{timestamp}{contents['en']}")
                    elif contents['cn']:
                        bilingual_lines.append(f"{timestamp}{contents['cn']}")

                if bilingual_lines:
                    lyrics = '\n'.join(bilingual_lines)
                    log_info(f"Got bilingual lyrics from xiaojiang: {len(lyrics)} chars, {len(bilingual_lines)} lines")
                    return lyrics

            log_warning("No LRC content found in lyric page")
            return ''

        except Exception as e:
            log_warning(f"Failed to get lyrics from xiaojiang: {e}")
            import traceback
            log_warning(traceback.format_exc())
            return ''

    def _download_cover_and_lyrics(self, info: dict, music_path: str, base_name: str):
        """下载封面和歌词到对应文件夹"""
        try:
            # 获取项目根目录 (wmp 文件夹)
            project_root = os.path.dirname(os.path.abspath(__file__))

            # 封面保存到 Segment 文件夹 (与现有封面同一位置)
            if info.get('cover_url'):
                try:
                    log_info(f"Downloading cover from: {info['cover_url']}")
                    # 使用简单的请求头下载封面
                    cover_headers = {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    }
                    cover_response = requests.get(info['cover_url'], timeout=10, headers=cover_headers)
                    log_info(f"Cover download status: {cover_response.status_code}")
                    if cover_response.status_code == 200:
                        cover_dir = os.path.join(project_root, 'data', 'Segment')
                        os.makedirs(cover_dir, exist_ok=True)
                        cover_path = os.path.join(cover_dir, f"{base_name}.jpg")
                        with open(cover_path, 'wb') as f:
                            f.write(cover_response.content)
                        log_success(f"Cover saved: {cover_path}")
                    else:
                        log_warning(f"Cover download failed with status: {cover_response.status_code}")
                except Exception as e:
                    log_warning(f"Failed to download cover: {e}")
            else:
                log_warning("No cover_url in info")

            # 歌词保存到 lrc 文件夹
            if info.get('lyrics'):
                try:
                    lyrics = info['lyrics']
                    if '\\u' in lyrics:
                        lyrics = lyrics.encode('utf-8').decode('unicode_escape')
                    lyrics = lyrics.replace('\\n', '\n').replace('\\r', '').replace('\\t', '\t')
                    # 只保留 LRC 格式的行
                    lyrics_lines = []
                    for line in lyrics.split('\n'):
                        line = line.strip()
                        if line and re.match(r'\[\d{2}:\d{2}\.\d{2,3}\]', line):
                            lyrics_lines.append(line)
                    lyrics = '\n'.join(lyrics_lines)

                    if lyrics:  # 只保存有内容的歌词
                        lrc_dir = os.path.join(project_root, 'data', 'lrc')
                        os.makedirs(lrc_dir, exist_ok=True)
                        lyrics_path = os.path.join(lrc_dir, f"{base_name}.lrc")
                        with open(lyrics_path, 'w', encoding='utf-8') as f:
                            f.write(lyrics)
                        log_success(f"Lyrics saved: {lyrics_path}")
                except Exception as e:
                    log_warning(f"Failed to save lyrics: {e}")
        except Exception as e:
            log_warning(f"Failed to download cover/lyrics: {e}")


# 全局下载器实例
downloader = GequbaoDownloader()


def search_songs(keyword: str):
    """搜索歌曲 - 供 server.py 调用"""
    return downloader.search_songs(keyword)


def download_song(music_id: str, download_path: str, progress_callback=None):
    """下载歌曲 - 供 server.py 调用"""
    return downloader.download_song(music_id, download_path, progress_callback)
