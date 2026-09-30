#!/usr/bin/env python3
"""
main.py — Spotify Track Downloader CLI

Resolves a Spotify track URL to audio using the external `spotdl` and `yt-dlp`
tools, then optionally converts the result with ffmpeg.

Usage:
    python main.py <spotify_url>
    python main.py https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC
    python main.py spotify:track:4uLU6hMCjMI75M1A2tKUQC

Options:
    --output, -o     Output directory (default: ./downloads)
    --format, -f     Output format: mp3, ogg, m4a, opus (default: mp3)
    --quality, -q    Audio quality in kbps: 96, 160, 320 (default: 320)
    --install        Install the download tools and exit
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

AUDIO_SUFFIXES = {'.mp3', '.ogg', '.oga', '.m4a', '.opus', '.webm', '.wav'}
TRACK_ID_RE = re.compile(r'^[A-Za-z0-9]{22}$')
DOWNLOAD_TIMEOUT = 180


def extract_track_id(url: str):
    """Extract track ID from a Spotify URL, URI, or bare ID."""
    url = url.strip()

    match = re.search(r'open\.spotify\.com/track/([A-Za-z0-9]+)', url)
    if match:
        return match.group(1)

    match = re.search(r'spotify:track:([A-Za-z0-9]+)', url)
    if match:
        return match.group(1)

    if TRACK_ID_RE.match(url):
        return url

    return None


def get_track_metadata_oembed(track_id: str) -> dict:
    """Get track metadata from Spotify's oEmbed API (no auth needed)."""
    url = f"https://open.spotify.com/oembed?url=https://open.spotify.com/track/{track_id}"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            title = data.get('title', 'Unknown')
            artist = 'Unknown'
            # oEmbed returns "Track · Artist"
            if ' · ' in title:
                parts = title.split(' · ')
                artist = parts[-1].strip()
                title = ' · '.join(parts[:-1]).strip()
            return {
                'title': title,
                'artist': artist,
                'thumbnail': data.get('thumbnail_url', ''),
            }
    except (urllib.error.URLError, ValueError, OSError):
        return {'title': 'Unknown', 'artist': 'Unknown', 'thumbnail': ''}


def find_executable(name: str) -> str:
    """Find an executable on PATH or in common user-install locations."""
    path = shutil.which(name)
    if path:
        return path
    home = Path.home()
    for candidate in (
        home / f'.local/bin/{name}',
        *(home / f'Library/Python/3.{minor}/bin/{name}' for minor in range(9, 14)),
    ):
        if candidate.exists():
            return str(candidate)
    return name


def _run_tool(cmd):
    """Run a download tool. Returns (ok, stderr_text)."""
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=DOWNLOAD_TIMEOUT
        )
        return result.returncode == 0, (result.stderr or '')
    except FileNotFoundError:
        return False, 'not installed'
    except subprocess.TimeoutExpired:
        return False, 'timed out'
    except Exception as e:  # noqa: BLE001 - report and try the next tool
        return False, str(e)


def _diagnose(tool: str, stderr: str):
    """Print a targeted hint for common tool failures."""
    if not stderr or stderr == 'not installed':
        return
    hints = [
        ('FFmpegError', 'ffmpeg is required. Install: brew install ffmpeg'),
        ('Deprecated Feature', 'spotdl requires Python 3.10+'),
        ('Connection', 'Network connection issue. Check your internet, or use a VPN '
                       'if the source is region-blocked'),
        ('Sign in to confirm', 'YouTube is blocking the request. Cookies or a proxy '
                               'may be required'),
    ]
    for needle, hint in hints:
        if needle in stderr:
            print(f"  Note: {hint}")
            return


def spotdl_quality_flag(quality: str):
    """
    Return the quality flag spotdl understands, or None if unknown.

    spotdl 3.x used '--quality <kbps>'; 4.x renamed it to '--bitrate <Nk>'.
    Passing the wrong one makes spotdl exit before downloading, so we detect
    the installed major version and fall back to omitting the flag entirely
    rather than failing.
    """
    spotdl = find_executable('spotdl')
    if not shutil.which(spotdl) and not Path(spotdl).exists():
        return None

    try:
        result = subprocess.run([spotdl, '--version'], capture_output=True,
                                text=True, timeout=15)
        raw = (result.stdout or result.stderr or '').strip()
    except (OSError, subprocess.SubprocessError):
        return None

    # A banner can contain unrelated dotted numbers ("Python 3.11.9 (main)"),
    # so prefer a spotdl-tagged line, then a standalone version, and only then
    # give up. Never guess from an arbitrary number.
    major = None
    tagged = re.search(r'spotdl\s+v?(\d+)\.(\d+)', raw, re.IGNORECASE)
    if tagged:
        major = int(tagged.group(1))
    else:
        # A whole line that is just a version, allowing a patch component.
        standalone = re.findall(r'(?m)^v?(\d+)\.\d+(?:\.\d+)*\s*$', raw)
        if standalone:
            major = int(standalone[-1].split('.')[0])

    if major is None:
        return None

    if major >= 4:
        return ['--bitrate', f'{quality}k']
    return ['--quality', quality]


def download_with_spotdl(track_url: str, output_dir: Path, quality: str) -> bool:
    """Download using spotdl (Spotify URL -> audio via its own matching)."""
    spotdl = find_executable('spotdl')
    cmd = [spotdl, 'download', track_url, '--output', str(output_dir)]
    flag = spotdl_quality_flag(quality)
    if flag:
        cmd += flag
    else:
        print("  Note: could not determine spotdl version, omitting quality flag")

    ok, err = _run_tool(cmd)
    if not ok:
        if err == 'not installed':
            print("  spotdl not found. Install: pip install spotdl")
        else:
            _diagnose('spotdl', err)
        return False
    return True


def download_with_ytdlp(track_url: str, output_dir: Path, quality: str) -> bool:
    """Download using yt-dlp (searches YouTube for the track)."""
    ytdlp = find_executable('yt-dlp')
    metadata = get_track_metadata_oembed(extract_track_id(track_url) or '')
    if metadata['title'] == 'Unknown':
        query = track_url
    else:
        query = f"{metadata['artist']} {metadata['title']}"

    ok, err = _run_tool([
        ytdlp,
        '--extract-audio',
        '--audio-format', 'mp3',
        '--audio-quality', quality,
        '-o', str(output_dir / '%(title)s.%(ext)s'),
        f'ytsearch1:{query}',
    ])
    if not ok:
        if err == 'not installed':
            print("  yt-dlp not found. Install: pip install yt-dlp")
        else:
            _diagnose('yt-dlp', err)
        return False
    return True


def find_audio_file(directory: Path):
    """Return the single audio file in a directory, or None."""
    if not directory.is_dir():
        return None
    for f in sorted(directory.iterdir()):
        if f.is_file() and f.suffix.lower() in AUDIO_SUFFIXES:
            return f
    return None


def convert_to_mp3(input_path: Path, output_path: Path) -> bool:
    """Convert an audio file to MP3 using ffmpeg."""
    ffmpeg = find_executable('ffmpeg')
    ok, _ = _run_tool_ffmpeg(ffmpeg, input_path, output_path)
    if not ok and not shutil.which(ffmpeg):
        print("  ffmpeg not found. Install it: brew install ffmpeg")
    return ok


def _run_tool_ffmpeg(ffmpeg: str, input_path: Path, output_path: Path):
    try:
        result = subprocess.run(
            [ffmpeg, '-i', str(input_path), '-codec:a', 'libmp3lame',
             '-b:a', '192k', '-y', str(output_path)],
            capture_output=True, text=True, timeout=120
        )
        return result.returncode == 0, (result.stderr or '')
    except FileNotFoundError:
        return False, 'not installed'
    except subprocess.TimeoutExpired:
        return False, 'timed out'
    except Exception as e:  # noqa: BLE001
        return False, str(e)


def install_dependencies():
    """Install the download tools this script actually shells out to."""
    print("\nInstalling dependencies...")
    for pkg in ('spotdl', 'yt-dlp'):
        try:
            subprocess.run(
                [sys.executable, '-m', 'pip', 'install', '-q', pkg],
                capture_output=True, timeout=180
            )
            print(f"  {pkg}: ok")
        except Exception as e:  # noqa: BLE001
            print(f"  {pkg}: failed ({e})")
    print("Note: ffmpeg is also required for MP3 conversion: brew install ffmpeg")


def main():
    parser = argparse.ArgumentParser(
        description='Spotify Track Downloader',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"
  %(prog)s -o ./music -f mp3 "spotify:track:4uLU6hMCjMI75M1A2tKUQC"

Download methods (tried in order):
  1. spotdl  - resolves the Spotify URL directly
  2. yt-dlp  - searches YouTube for the track by title/artist
        """
    )

    parser.add_argument('url', help='Spotify track URL, URI, or ID')
    parser.add_argument('-o', '--output', default='./downloads',
                        help='Output directory (default: ./downloads)')
    parser.add_argument('-f', '--format',
                        choices=['mp3', 'ogg', 'm4a', 'opus'], default='mp3',
                        help='Output format (default: mp3)')
    parser.add_argument('-q', '--quality', choices=['96', '160', '320'],
                        default='320',
                        help='Audio quality in kbps (default: 320)')
    parser.add_argument('--install', action='store_true',
                        help='Install the download tools and exit')

    args = parser.parse_args()

    if args.install:
        install_dependencies()
        return

    track_id = extract_track_id(args.url)
    if not track_id:
        print(f"Error: Could not extract track ID from: {args.url}")
        print("Expected: https://open.spotify.com/track/... or a 22-char ID")
        sys.exit(1)

    track_url = f"https://open.spotify.com/track/{track_id}"

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n{'=' * 60}")
    print("  Spotify Track Downloader")
    print(f"{'=' * 60}\n")

    metadata = get_track_metadata_oembed(track_id)
    print(f"  Track:  {metadata['title']}")
    print(f"  Artist: {metadata['artist']}")
    print(f"  ID:     {track_id}\n")

    # Each attempt downloads into its own scratch directory. Scanning the final
    # output directory instead would let a previous run's file be picked up,
    # converted, and deleted. The file must be moved out *before* the scratch
    # directory is torn down.
    final_path = None
    with tempfile.TemporaryDirectory(prefix='spdl_') as scratch:
        for index, (label, downloader) in enumerate(
            (("spotdl", download_with_spotdl), ("yt-dlp", download_with_ytdlp)),
            start=1,
        ):
            attempt_dir = Path(scratch) / f"attempt{index}"
            attempt_dir.mkdir()

            print(f"[{index}/2] Trying {label}...")
            if not downloader(track_url, attempt_dir, args.quality):
                continue

            found = find_audio_file(attempt_dir)
            if found is None:
                print(f"  {label} reported success but produced no audio file")
                continue

            base = re.sub(r'[<>:"/\\|?*]', '_', found.stem).strip() or track_id
            # Keep the downloaded extension; the format is reconciled below.
            final_path = output_dir / f"{base}{found.suffix.lower()}"
            shutil.copy2(str(found), str(final_path))
            break

    if final_path is None:
        print("\n" + "=" * 60)
        print("  Download failed!")
        print("=" * 60)
        print("\nTroubleshooting:")
        print("  1. Check your internet connection")
        print("  2. Install the tools:  python main.py --install")
        print("  3. Install ffmpeg:     brew install ffmpeg")
        print("  4. If the source is region-blocked, use a VPN")
        print(f"\nManual download:\n  spotdl download {track_url}")
        sys.exit(1)

    # Reconcile the downloaded format with --format.
    if args.format == 'mp3' and final_path.suffix.lower() != '.mp3':
        converted = final_path.with_name(final_path.stem + '.converting.mp3')
        print("\nConverting to MP3...")
        if convert_to_mp3(final_path, converted):
            mp3_path = final_path.with_suffix('.mp3')
            converted.replace(mp3_path)
            final_path.unlink()
            final_path = mp3_path
            print("  ✓ Converted to MP3")
        else:
            converted.unlink(missing_ok=True)
            print(f"  Keeping original format: {final_path.suffix}")
    elif final_path.suffix.lower() != f".{args.format}":
        target = final_path.with_suffix(f".{args.format}")
        final_path.replace(target)
        final_path = target

    print(f"\n{'=' * 60}")
    print("  Download Complete!")
    print(f"{'=' * 60}")
    print(f"  File: {final_path}")
    print(f"  Size: {final_path.stat().st_size / 1024:.1f} KB\n")


if __name__ == "__main__":
    main()
