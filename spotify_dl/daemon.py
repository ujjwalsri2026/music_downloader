"""
daemon.py — Local HTTP Server for Spotify Downloads

Runs a local HTTP server that the browser frontend can communicate with
to download Spotify tracks.

Usage:
    python daemon.py
    python daemon.py --port 54321

API Endpoints:
    POST /api/download  - Download a track
    GET  /api/status    - Check daemon status
    GET  /api/file/{id} - Download file
"""

import os
import sys
import json
import time
import subprocess
import tempfile
import re
import shutil
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse
import threading


def find_executable(name: str) -> str:
    """Find executable in PATH or common locations."""
    path = shutil.which(name)
    if path:
        return path
    home = Path.home()
    candidates = [
        home / f'.local/bin/{name}',
        home / f'Library/Python/3.9/bin/{name}',
        home / f'Library/Python/3.10/bin/{name}',
        home / f'Library/Python/3.11/bin/{name}',
        home / f'Library/Python/3.12/bin/{name}',
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    return name


class SpotifyDaemon:
    """Local daemon for Spotify track downloads."""

    def __init__(self, host: str = '127.0.0.1', port: int = 54321):
        self.host = host
        self.port = port
        self.server = None
        self.temp_dir = Path(tempfile.mkdtemp(prefix='spotify_dl_'))
        self.downloads = {}

    def start(self):
        handler = create_handler(self)
        self.server = HTTPServer((self.host, self.port), handler)
        print(f"Spotify Daemon running on http://{self.host}:{self.port}")
        print(f"Downloads folder: {self.temp_dir}")
        print("\nEndpoints:")
        print(f"  POST http://{self.host}:{self.port}/api/download")
        print(f"  GET  http://{self.host}:{self.port}/api/status")
        print("\nPress Ctrl+C to stop\n")
        self.server.serve_forever()

    def stop(self):
        if self.server:
            self.server.shutdown()

    def extract_track_id(self, url: str) -> str:
        match = re.search(r'open\.spotify\.com/track/([a-zA-Z0-9]+)', url)
        if match:
            return match.group(1)
        match = re.search(r'spotify:track:([a-zA-Z0-9]+)', url)
        if match:
            return match.group(1)
        if re.match(r'^[a-zA-Z0-9]{22}$', url.strip()):
            return url.strip()
        return None

    def download_track(self, track_id: str, output_format: str = 'mp3') -> dict:
        track_url = f"https://open.spotify.com/track/{track_id}"
        output_dir = self.temp_dir / track_id
        output_dir.mkdir(exist_ok=True)

        # Try spotdl first
        spotdl_path = find_executable('spotdl')
        try:
            result = subprocess.run(
                [spotdl_path, 'download', track_url, '--output', str(output_dir),
                 '--format', output_format],
                capture_output=True, text=True, timeout=120
            )
            if result.returncode == 0:
                for f in output_dir.iterdir():
                    if f.suffix in ['.mp3', '.ogg', '.m4a', '.opus']:
                        self.downloads[track_id] = str(f)
                        return {
                            'success': True,
                            'track_id': track_id,
                            'file': str(f),
                            'filename': f.name,
                            'size': f.stat().st_size,
                            'download_url': f"http://{self.host}:{self.port}/api/file/{track_id}/{f.name}"
                        }
        except FileNotFoundError:
            pass
        except Exception as e:
            print(f"spotdl failed: {e}")

        # Try yt-dlp
        ytdlp_path = find_executable('yt-dlp')
        try:
            output_template = str(output_dir / '%(title)s.%(ext)s')
            result = subprocess.run(
                [ytdlp_path, '--extract-audio', '--audio-format', output_format,
                 '--audio-quality', '0', '-o', output_template, track_url],
                capture_output=True, text=True, timeout=120
            )
            if result.returncode == 0:
                for f in output_dir.iterdir():
                    if f.suffix in ['.mp3', '.ogg', '.m4a', '.opus', '.webm']:
                        self.downloads[track_id] = str(f)
                        return {
                            'success': True,
                            'track_id': track_id,
                            'file': str(f),
                            'filename': f.name,
                            'size': f.stat().st_size,
                            'download_url': f"http://{self.host}:{self.port}/api/file/{track_id}/{f.name}"
                        }
        except FileNotFoundError:
            pass
        except Exception as e:
            print(f"yt-dlp failed: {e}")

        return {
            'success': False,
            'error': 'No download tool available. Install: pip install spotdl'
        }


def create_handler(daemon):
    class RequestHandler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            pass

        def do_OPTIONS(self):
            self.send_response(200)
            self._cors()
            self.end_headers()

        def do_GET(self):
            parsed = urlparse(self.path)
            if parsed.path == '/api/status':
                self._json({'status': 'running', 'host': daemon.host, 'port': daemon.port})
            elif parsed.path.startswith('/api/file/'):
                parts = parsed.path.split('/')
                if len(parts) >= 4:
                    track_id = parts[3]
                    filename = '/'.join(parts[4:]) if len(parts) > 4 else ''
                    self._serve_file(track_id, filename)
                else:
                    self._json({'error': 'Invalid path'}, 404)
            else:
                self._json({'error': 'Not found'}, 404)

        def do_POST(self):
            parsed = urlparse(self.path)
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length) if content_length else b''

            try:
                data = json.loads(body) if body else {}
            except json.JSONDecodeError:
                data = {}

            if parsed.path == '/api/download':
                track_id = data.get('track_id', '')
                fmt = data.get('format', 'mp3')
                if not track_id:
                    self._json({'error': 'track_id required'}, 400)
                    return
                result = daemon.download_track(track_id, fmt)
                self._json(result)
            else:
                self._json({'error': 'Not found'}, 404)

        def _serve_file(self, track_id, filename):
            file_path = daemon.temp_dir / track_id / filename
            if not file_path.exists():
                # Try finding any file in the track directory
                track_dir = daemon.temp_dir / track_id
                if track_dir.exists():
                    for f in track_dir.iterdir():
                        if f.is_file():
                            file_path = f
                            break
            if file_path.exists():
                self.send_response(200)
                self.send_header('Content-Type', 'audio/mpeg')
                self.send_header('Content-Disposition', f'attachment; filename="{file_path.name}"')
                self._cors()
                self.end_headers()
                with open(file_path, 'rb') as f:
                    self.wfile.write(f.read())
            else:
                self._json({'error': 'File not found'}, 404)

        def _json(self, data, status=200):
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self._cors()
            self.end_headers()
            self.wfile.write(json.dumps(data).encode())

        def _cors(self):
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    return RequestHandler


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Spotify Download Daemon')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('-p', '--port', type=int, default=54321)
    args = parser.parse_args()

    daemon = SpotifyDaemon(args.host, args.port)
    try:
        daemon.start()
    except KeyboardInterrupt:
        print("\nShutting down...")
        daemon.stop()


if __name__ == "__main__":
    main()
