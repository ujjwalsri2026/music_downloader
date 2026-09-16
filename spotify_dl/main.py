#!/usr/bin/env python3
"""
main.py — Spotify Track Downloader CLI

Uses spotify-dl (librespot under the hood) for actual downloads.
Handles authentication, decryption, and conversion automatically.

Usage:
    python main.py <spotify_url>
    python main.py https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC
    python main.py spotify:track:4uLU6hMCjMI75M1A2tKUQC

Options:
    --output, -o     Output directory (default: ./downloads)
    --format, -f     Output format: ogg, mp3, m4a (default: ogg)
    --quality, -q    Audio quality: 96, 160, 320 (default: 320)
"""

import os
import sys
import re
import json
import subprocess
import argparse
from pathlib import Path


def extract_track_id(url: str) -> str:
    """Extract track ID from Spotify URL."""
    # Standard URL: https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC
    match = re.search(r'open\.spotify\.com/track/([a-zA-Z0-9]+)', url)
    if match:
        return match.group(1)

    # URI: spotify:track:4uLU6hMCjMI75M1A2tKUQC
    match = re.search(r'spotify:track:([a-zA-Z0-9]+)', url)
    if match:
        return match.group(1)

    # Plain ID: 4uLU6hMCjMI75M1A2tKUQC
    if re.match(r'^[a-zA-Z0-9]{22}$', url.strip()):
        return url.strip()

    return None


def get_track_metadata_oembed(track_id: str) -> dict:
    """Get track metadata from Spotify oEmbed API (no auth needed)."""
    import urllib.request
    import urllib.error

    url = f"https://open.spotify.com/oembed?url=https://open.spotify.com/track/{track_id}"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            title = data.get('title', 'Unknown')
            artist = 'Unknown'
            if ' · ' in title:
                parts = title.split(' · ')
                artist = parts[-1].strip()
                title = ' · '.join(parts[:-1]).strip()
            return {
                'title': title,
                'artist': artist,
                'thumbnail': data.get('thumbnail_url', ''),
            }
    except Exception as e:
        return {'title': 'Unknown', 'artist': 'Unknown', 'thumbnail': ''}


def download_with_spotify_dl(track_id: str, output_dir: str, quality: str) -> bool:
    """Download using spotify-dl package."""
    try:
        from spotify_dl import download_track

        # spotify-dl handles auth, decryption, and download
        download_track(
            track_id=track_id,
            output_dir=output_dir,
            quality=int(quality)
        )
        return True
    except ImportError:
        return False
    except Exception as e:
        print(f"  spotify-dl error: {e}")
        return False


def find_spotdl() -> str:
    """Find spotdl executable path."""
    import shutil
    # Check PATH first
    path = shutil.which('spotdl')
    if path:
        return path
    # Check common Python user install locations
    home = Path.home()
    candidates = [
        home / '.local/bin/spotdl',
        home / 'Library/Python/3.9/bin/spotdl',
        home / 'Library/Python/3.10/bin/spotdl',
        home / 'Library/Python/3.11/bin/spotdl',
        home / 'Library/Python/3.12/bin/spotdl',
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    return 'spotdl'  # Fallback, will fail if not found


def download_with_spotdl(track_url: str, output_dir: str) -> bool:
    """Download using spotdl (alternative tool)."""
    spotdl_path = find_spotdl()
    try:
        result = subprocess.run(
            [spotdl_path, 'download', track_url, '--output', output_dir],
            capture_output=True,
            text=True,
            timeout=120
        )
        if result.returncode != 0 and result.stderr:
            # Check for common errors
            if 'FFmpegError' in result.stderr:
                print("  Note: spotdl requires ffmpeg. Install: brew install ffmpeg")
            elif 'Deprecated Feature' in result.stderr:
                print("  Note: spotdl requires Python 3.10+. Current: 3.9")
            elif 'Connection' in result.stderr:
                print("  Note: Network connection issue. Check your internet.")
        return result.returncode == 0
    except FileNotFoundError:
        return False
    except Exception as e:
        print(f"  spotdl error: {e}")
        return False


def find_ytdlp() -> str:
    """Find yt-dlp executable path."""
    import shutil
    path = shutil.which('yt-dlp')
    if path:
        return path
    home = Path.home()
    candidates = [
        home / '.local/bin/yt-dlp',
        home / 'Library/Python/3.9/bin/yt-dlp',
        home / 'Library/Python/3.10/bin/yt-dlp',
        home / 'Library/Python/3.11/bin/yt-dlp',
        home / 'Library/Python/3.12/bin/yt-dlp',
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    return 'yt-dlp'


def download_with_ytdlp(track_url: str, output_dir: str, audio_format: str) -> bool:
    """Download using yt-dlp (works with YouTube search)."""
    ytdlp_path = find_ytdlp()

    # Get metadata for YouTube search
    metadata = get_track_metadata_oembed(extract_track_id(track_url) or '')
    search_query = f"{metadata['artist']} {metadata['title']}" if metadata['title'] != 'Unknown' else track_url

    # Try YouTube search
    try:
        output_template = os.path.join(output_dir, '%(title)s.%(ext)s')
        search_term = f'ytsearch1:{search_query}'

        result = subprocess.run(
            [
                ytdlp_path,
                '--extract-audio',
                '--audio-format', audio_format,
                '--audio-quality', '0',
                '-o', output_template,
                search_term
            ],
            capture_output=True,
            text=True,
            timeout=120
        )
        if result.returncode == 0:
            return True

        if 'Connection' in (result.stderr or ''):
            print("  Note: Network connection issue. YouTube may be blocked in your region.")
            print("  Try using a VPN or proxy.")
    except FileNotFoundError:
        return False
    except subprocess.TimeoutExpired:
        print("  Note: Download timed out. Check your internet connection.")
    except Exception as e:
        print(f"  yt-dlp error: {e}")

    return False


def convert_to_mp3(input_path: str, output_path: str) -> bool:
    """Convert audio file to MP3 using ffmpeg."""
    try:
        result = subprocess.run(
            [
                'ffmpeg', '-i', input_path,
                '-codec:a', 'libmp3lame',
                '-b:a', '192k',
                '-y', output_path
            ],
            capture_output=True,
            text=True,
            timeout=60
        )
        return result.returncode == 0
    except FileNotFoundError:
        print("  ffmpeg not found. Install it: brew install ffmpeg")
        return False
    except Exception as e:
        print(f"  ffmpeg error: {e}")
        return False


def install_dependencies():
    """Install required Python packages."""
    print("\nInstalling dependencies...")
    packages = ['spotipy', 'mutagen']
    for pkg in packages:
        try:
            subprocess.run(
                [sys.executable, '-m', 'pip', 'install', '-q', pkg],
                capture_output=True,
                timeout=60
            )
        except Exception:
            pass


def main():
    parser = argparse.ArgumentParser(
        description='Spotify Track Downloader',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"
  %(prog)s -o ./music -f mp3 "spotify:track:4uLU6hMCjMI75M1A2tKUQC"

Supported download methods (tried in order):
  1. spotify-dl (best quality, requires authentication)
  2. spotdl (uses YouTube as source)
  3. yt-dlp (uses Spotify embed + YouTube)
        """
    )

    parser.add_argument('url', help='Spotify track URL or ID')
    parser.add_argument('-o', '--output', default='./downloads',
                       help='Output directory (default: ./downloads)')
    parser.add_argument('-f', '--format', choices=['ogg', 'mp3', 'm4a', 'wav'],
                       default='mp3', help='Output format (default: mp3)')
    parser.add_argument('-q', '--quality', choices=['96', '160', '320'],
                       default='320', help='Audio quality in kbps (default: 320)')
    parser.add_argument('--install', action='store_true',
                       help='Install dependencies and exit')

    args = parser.parse_args()

    if args.install:
        install_dependencies()
        print("Dependencies installed.")
        return

    # Extract track ID
    track_id = extract_track_id(args.url)
    if not track_id:
        print(f"Error: Could not extract track ID from: {args.url}")
        print("Expected format: https://open.spotify.com/track/...")
        sys.exit(1)

    track_url = f"https://open.spotify.com/track/{track_id}"

    # Create output directory
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Get metadata
    print(f"\n{'='*60}")
    print(f"  Spotify Track Downloader")
    print(f"{'='*60}\n")

    metadata = get_track_metadata_oembed(track_id)
    print(f"  Track: {metadata['title']}")
    print(f"  Artist: {metadata['artist']}")
    print(f"  ID: {track_id}")
    print()

    # Try download methods in order
    downloaded = False
    final_path = None

    # Method 1: spotify-dl
    print("[1/3] Trying spotify-dl...")
    downloaded = download_with_spotify_dl(track_id, str(output_dir), args.quality)
    if downloaded:
        # Find the downloaded file
        for f in output_dir.iterdir():
            if track_id in f.name or metadata['title'][:20] in f.name:
                final_path = f
                break

    # Method 2: spotdl
    if not downloaded:
        print("[2/3] Trying spotdl...")
        downloaded = download_with_spotdl(track_url, str(output_dir))
        if downloaded:
            for f in output_dir.iterdir():
                if f.suffix in ['.ogg', '.mp3', '.m4a', '.opus']:
                    final_path = f
                    break

    # Method 3: yt-dlp
    if not downloaded:
        print("[3/3] Trying yt-dlp...")
        downloaded = download_with_ytdlp(track_url, str(output_dir), args.format)
        if downloaded:
            for f in output_dir.iterdir():
                if f.suffix in ['.ogg', '.mp3', '.m4a', '.opus']:
                    final_path = f
                    break

    if not downloaded:
        print("\n" + "="*60)
        print("  Download failed!")
        print("="*60)
        print("\nTroubleshooting:")
        print("  1. Check your internet connection")
        print("  2. Install ffmpeg: brew install ffmpeg")
        print("  3. Install tools:")
        print("     pip install spotdl        # Recommended")
        print("     pip install yt-dlp        # Alternative")
        print("\n  If YouTube is blocked in your region, use a VPN.")
        print("\nManual download:")
        print(f"  spotdl download {track_url}")
        sys.exit(1)

    # Convert format if needed
    if final_path and final_path.exists():
        target_ext = f".{args.format}"
        if final_path.suffix != target_ext:
            output_path = final_path.with_suffix(target_ext)
            if args.format == 'mp3':
                print(f"\nConverting to MP3...")
                if convert_to_mp3(str(final_path), str(output_path)):
                    final_path.unlink()  # Remove original
                    final_path = output_path
                    print(f"  ✓ Converted to MP3")
                else:
                    print(f"  Keeping original format: {final_path.suffix}")
                    final_path = output_path.with_suffix(final_path.suffix)

        print(f"\n{'='*60}")
        print(f"  Download Complete!")
        print(f"{'='*60}")
        print(f"  File: {final_path}")
        print(f"  Size: {final_path.stat().st_size / 1024:.1f} KB")
        print()
    else:
        print("\nDownload completed but file location unclear.")
        print(f"Check: {output_dir}")


if __name__ == "__main__":
    main()
