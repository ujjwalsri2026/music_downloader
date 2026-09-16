#!/bin/bash
# start.sh — Start Spotify Download Daemon

echo "=========================================="
echo "  Spotify Download Daemon"
echo "=========================================="
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 not found"
    echo "Install: brew install python3"
    exit 1
fi

# Check/install dependencies
echo "Checking dependencies..."
pip3 install -q spotipy mutagen 2>/dev/null

# Check for download tools
if ! command -v spotdl &> /dev/null; then
    echo ""
    echo "Note: spotdl not installed"
    echo "Install for direct downloads: pip3 install spotdl"
    echo ""
fi

if ! command -v yt-dlp &> /dev/null; then
    echo "Note: yt-dlp not installed"
    echo "Install: pip3 install yt-dlp"
    echo ""
fi

# Start daemon
echo "Starting daemon..."
echo ""
python3 "$(dirname "$0")/daemon.py" "$@"
