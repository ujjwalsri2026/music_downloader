#!/bin/bash
# start.sh — Start the MusicGrab local download daemon
set -euo pipefail

echo "=========================================="
echo "  MusicGrab Download Daemon"
echo "=========================================="
echo ""

if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 not found"
    echo "Install: brew install python3"
    exit 1
fi

echo "Checking dependencies..."
if ! command -v spotdl &> /dev/null; then
    echo "  spotdl not found — installing..."
    pip3 install -q spotdl 2>/dev/null || echo "  WARNING: could not install spotdl"
fi
if ! command -v yt-dlp &> /dev/null; then
    echo "  yt-dlp not found — installing..."
    pip3 install -q yt-dlp 2>/dev/null || echo "  WARNING: could not install yt-dlp"
fi

if ! command -v ffmpeg &> /dev/null; then
    echo ""
    echo "Note: ffmpeg not found."
    echo "  Without it, non-MP3 audio is kept in its original format."
    echo "  Install: brew install ffmpeg"
    echo ""
fi

echo "Starting daemon..."
echo ""
exec python3 -u "$(dirname "$0")/daemon.py" "$@"
