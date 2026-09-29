"""
daemon.py — Local HTTP Server for Spotify Downloads

Runs a local HTTP server that the browser frontend can use to download tracks
by Spotify URL. Audio is fetched by the external `spotdl` / `yt-dlp` tools;
this module does not implement Spotify's audio protocol itself.

Usage:
    python daemon.py
    python daemon.py --port 54321

API Endpoints:
    POST /api/download   - Download a track by Spotify ID
    GET  /api/status     - Check daemon status
    GET  /api/file/{id}  - Download a previously fetched file
    HEAD /api/file/{id}  - Probe a file (headers only)
"""

import atexit
import json
import re
import shutil
import signal
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

TRACK_ID_RE = re.compile(r'^[A-Za-z0-9]{22}$')
AUDIO_SUFFIXES = {'.mp3', '.ogg', '.oga', '.m4a', '.opus', '.webm', '.wav'}
MIME_TYPES = {
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.opus': 'audio/ogg',
    '.webm': 'audio/webm',
    '.wav': 'audio/wav',
}
MAX_BODY_BYTES = 64 * 1024
DOWNLOAD_TIMEOUT = 180
ALLOWED_FORMATS = {'mp3', 'ogg', 'm4a', 'opus'}

# Browsers on a GitHub Pages origin. Requests with no Origin header (curl, etc.)
# are still served; a *foreign* Origin is refused so arbitrary sites cannot
# drive this daemon.
DEFAULT_ALLOWED_ORIGINS = (
    'https://github.io',
    'https://*.github.io',
    'http://localhost',
    'http://127.0.0.1',
)


def find_executable(name: str) -> str:
    """Find executable in PATH or common user-install locations."""
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


def origin_allowed(origin: str, allowed: tuple) -> bool:
    """
    Decide whether to echo back an Origin header.

    Matching is on the parsed host, never a string prefix. A prefix test would
    let 'https://github.io.evil.example' or 'http://127.0.0.1.evil.example'
    through, since both start with an allowed string. Subdomains are matched
    per label, so 'evil-github.io' does not satisfy '*.github.io'.
    """
    if not origin or origin == 'null':
        return True  # non-browser client (curl) sends no Origin

    try:
        parsed = urlparse(origin)
    except ValueError:
        return False
    if parsed.scheme not in ('http', 'https'):
        return False
    host = (parsed.hostname or '').lower()
    if not host:
        return False

    for pattern in allowed:
        try:
            allowed_parsed = urlparse(pattern if '://' in pattern
                                      else f"https://{pattern}")
        except ValueError:
            continue
        allowed_host = (allowed_parsed.hostname or '').lower()
        if not allowed_host:
            continue

        if '*' in allowed_host:
            suffix = allowed_host[allowed_host.index('*') + 1:]
            # Require a label boundary: '*.github.io' must not match
            # 'evil-github.io', and must not match the bare apex.
            if suffix and host.endswith(suffix) and host != suffix.lstrip('.'):
                return True
        elif host == allowed_host:
            return True
    return False


class SpotifyDaemon:
    """Local daemon for Spotify track downloads."""

    def __init__(self, host: str = '127.0.0.1', port: int = 54321,
                 allowed_origins=DEFAULT_ALLOWED_ORIGINS):
        self.host = host
        self.port = port
        self.allowed_origins = tuple(allowed_origins)
        self.server = None
        self.temp_dir = Path(tempfile.mkdtemp(prefix='spotify_dl_'))
        atexit.register(self.cleanup)
        self._install_signal_handlers()

    def _install_signal_handlers(self):
        """atexit does not run on SIGTERM, which is how supervisors stop us."""
        def _on_term(signum, _frame):
            self.cleanup()
            raise SystemExit(0)

        for sig in (signal.SIGTERM, signal.SIGHUP):
            try:
                signal.signal(sig, _on_term)
            except (ValueError, OSError):
                pass  # not on the main thread, or unsupported on this platform

    def cleanup(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def track_dir(self, track_id: str) -> Path:
        """Return the download directory for a track, or None if the ID is invalid."""
        if not track_id or not TRACK_ID_RE.match(track_id):
            return None
        return self.temp_dir / track_id

    def start(self):
        handler = create_handler(self)
        self.server = ThreadingHTTPServer((self.host, self.port), handler)
        print(f"Spotify Daemon running on http://{self.host}:{self.port}")
        print(f"Downloads folder: {self.temp_dir}")
        print("\nEndpoints:")
        print(f"  POST http://{self.host}:{self.port}/api/download")
        print(f"  GET  http://{self.host}:{self.port}/api/status")
        print("\nPress Ctrl+C to stop\n")
        try:
            self.server.serve_forever()
        finally:
            self.cleanup()

    def stop(self):
        if self.server:
            self.server.shutdown()

    @staticmethod
    def _find_audio(output_dir: Path):
        """Return the single audio file produced in output_dir, if any."""
        if not output_dir.is_dir():
            return None
        for f in sorted(output_dir.iterdir()):
            if f.is_file() and f.suffix.lower() in AUDIO_SUFFIXES:
                return f
        return None

    def _run(self, cmd):
        """Run a download tool. Returns (ok, stderr)."""
        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=DOWNLOAD_TIMEOUT
            )
            return result.returncode == 0, (result.stderr or '')
        except FileNotFoundError:
            return False, 'not installed'
        except subprocess.TimeoutExpired:
            return False, 'timed out'
        except Exception as e:  # noqa: BLE001 - report and move on to next tool
            return False, str(e)

    def download_track(self, track_id: str, output_format: str = 'mp3') -> dict:
        track_dir = self.track_dir(track_id)
        if track_dir is None:
            return {'success': False, 'error': f'Invalid Spotify track ID: {track_id!r}'}

        if output_format not in ALLOWED_FORMATS:
            output_format = 'mp3'

        track_url = f"https://open.spotify.com/track/{track_id}"
        track_dir.mkdir(parents=True, exist_ok=True)

        # Every attempt gets a clean subdirectory. Sharing one directory lets a
        # partial file from a failed tool be picked up as if it were the next
        # tool's successful output.
        for index, (tool, tool_args) in enumerate((
            ('spotdl', ['download', track_url, '--format', output_format]),
            ('yt-dlp', ['--extract-audio', '--audio-format', output_format,
                        '--audio-quality', '0', track_url]),
        ), start=1):
            attempt_dir = track_dir / f"attempt{index}"
            self._reset_dir(attempt_dir)

            if tool == 'spotdl':
                cmd = [find_executable('spotdl'), *tool_args,
                       '--output', str(attempt_dir)]
            else:
                cmd = [find_executable('yt-dlp'), *tool_args,
                       '-o', str(attempt_dir / '%(title)s.%(ext)s')]

            ok, err = self._run(cmd)
            if not ok:
                if err != 'not installed':
                    print(f"{tool} failed: {err.strip()[:300]}")
                continue

            audio = self._find_audio(attempt_dir)
            if audio is None:
                print(f"{tool} reported success but produced no audio file")
                continue
            if audio.stat().st_size == 0:
                print(f"{tool} produced a zero-byte file, treating as failure")
                continue

            # Promote the winning file to the track directory, replacing any
            # leftover from an earlier request for the same track.
            final = track_dir / audio.name
            if final.exists():
                final.unlink()
            shutil.move(str(audio), str(final))

            suffix = final.suffix.lower().lstrip('.')
            return {
                'success': True,
                'track_id': track_id,
                'filename': final.name,
                'size': final.stat().st_size,
                'source_format': suffix,
                'found_on': f'{tool} (YouTube-backed)',
                # Percent-encode: download tool filenames routinely contain
                # spaces, which are not valid in a URL.
                'download_url': (
                    f"http://{self.host}:{self.port}"
                    f"/api/file/{track_id}/{quote(final.name)}"
                ),
            }

        return {
            'success': False,
            'error': 'No download tool available. Install: pip install spotdl',
        }

    @staticmethod
    def _reset_dir(path: Path):
        """Recreate a directory empty, discarding anything left by a prior run."""
        shutil.rmtree(path, ignore_errors=True)
        path.mkdir(parents=True, exist_ok=True)


def create_handler(daemon):
    class RequestHandler(BaseHTTPRequestHandler):
        server_version = 'MusicGrabDaemon/1.0'
        protocol_version = 'HTTP/1.1'

        def log_message(self, fmt, *args):
            pass

        # ─── CORS ───
        def _cors(self):
            origin = self.headers.get('Origin')
            if origin_allowed(origin, daemon.allowed_origins):
                if origin and origin != 'null':
                    self.send_header('Access-Control-Allow-Origin', origin)
                    self.send_header('Vary', 'Origin')
            else:
                self.send_header('Access-Control-Allow-Origin', 'null')

        def _send_json(self, data, status=200):
            body = json.dumps(data).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self._cors()
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(body)

        # ─── OPTIONS ───
        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.send_header('Access-Control-Max-Age', '600')
            self._cors()
            self.send_header('Content-Length', '0')
            self.end_headers()

        # ─── GET / HEAD ───
        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            parsed = urlparse(self.path)
            if parsed.path == '/api/status':
                self._send_json({
                    'status': 'running',
                    'host': daemon.host,
                    'port': daemon.port,
                })
            elif parsed.path.startswith('/api/file/'):
                parts = parsed.path.split('/')
                if len(parts) < 4:
                    self._send_json({'error': 'Invalid path'}, 404)
                    return
                track_id = unquote(parts[3])
                filename = unquote('/'.join(parts[4:])) if len(parts) > 4 else ''
                self._serve_file(track_id, filename)
            else:
                self._send_json({'error': 'Not found'}, 404)

        # ─── POST ───
        def do_POST(self):
            parsed = urlparse(self.path)
            if parsed.path != '/api/download':
                self._send_json({'error': 'Not found'}, 404)
                return

            try:
                length = int(self.headers.get('Content-Length') or 0)
            except (TypeError, ValueError):
                self._send_json({'error': 'Invalid Content-Length'}, 400)
                return

            if length < 0 or length > MAX_BODY_BYTES:
                self._send_json({'error': 'Request body too large'}, 413)
                return

            body = self.rfile.read(length) if length else b''
            try:
                data = json.loads(body) if body else {}
            except (json.JSONDecodeError, UnicodeDecodeError):
                self._send_json({'error': 'Invalid JSON body'}, 400)
                return

            if not isinstance(data, dict):
                self._send_json({'error': 'Body must be a JSON object'}, 400)
                return

            track_id = data.get('track_id', '')
            if not isinstance(track_id, str):
                self._send_json({'error': 'track_id must be a string'}, 400)
                return
            if not track_id:
                self._send_json({'error': 'track_id required'}, 400)
                return

            fmt = data.get('format', 'mp3')
            if not isinstance(fmt, str):
                self._send_json({'error': 'format must be a string'}, 400)
                return

            try:
                result = daemon.download_track(track_id, fmt)
            except Exception as e:  # noqa: BLE001 - never kill the thread
                self._send_json({'success': False, 'error': str(e)}, 500)
                return
            self._send_json(result)

        # ─── FILE SERVING ───
        def _serve_file(self, track_id, filename):
            track_dir = daemon.track_dir(track_id)
            if track_dir is None:
                self._send_json({'error': 'Invalid track ID'}, 404)
                return

            file_path = None
            if filename:
                # Path(...).name drops any directory component the client sent.
                safe_name = Path(filename).name
                if safe_name and safe_name not in ('.', '..'):
                    candidate = track_dir / safe_name
                    # Defence in depth: confirm the resolved path is still inside.
                    try:
                        resolved = candidate.resolve()
                        if resolved.is_relative_to(track_dir.resolve()) and resolved.is_file():
                            file_path = resolved
                    except (OSError, ValueError):
                        file_path = None

            # A missing or bogus filename is a 404. We deliberately do NOT fall
            # back to "any file in the directory" — that silently served the
            # wrong track under the requested name.
            if file_path is None:
                self._send_json({'error': 'File not found'}, 404)
                return

            size = file_path.stat().st_size
            ctype = MIME_TYPES.get(file_path.suffix.lower(), 'application/octet-stream')
            self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(size))
            # Quote-escape the filename so a crafted name can't inject headers.
            safe_name = file_path.name.replace('"', '').replace('\\', '')
            self.send_header('Content-Disposition',
                             f'attachment; filename="{safe_name}"')
            self._cors()
            self.end_headers()

            if self.command == 'HEAD':
                return
            try:
                with open(file_path, 'rb') as f:
                    shutil.copyfileobj(f, self.wfile)
            except (BrokenPipeError, ConnectionResetError):
                pass  # client navigated away mid-transfer

    return RequestHandler


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Spotify Download Daemon')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('-p', '--port', type=int, default=54321)
    parser.add_argument('--allow-origin', action='append', default=None,
                        metavar='ORIGIN',
                        help='Extra allowed CORS origin (repeatable).')
    args = parser.parse_args()

    allowed = list(DEFAULT_ALLOWED_ORIGINS)
    for extra in (args.allow_origin or []):
        allowed.append(extra)

    daemon = SpotifyDaemon(args.host, args.port, allowed)
    try:
        daemon.start()
    except KeyboardInterrupt:
        print("\nShutting down...")
        daemon.stop()
    except OSError as e:
        print(f"\nFailed to start daemon on {args.host}:{args.port}: {e}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
