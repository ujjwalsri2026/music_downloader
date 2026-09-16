# MusicGrab - Free Music Downloader

A 100% browser-based music downloader that resolves direct audio URLs from YouTube, Spotify, JioSaavn, Gaana, SoundCloud, and Audiomack. No backend server required.

## Features

- **No backend** — All logic runs client-side in the browser
- **Multi-platform** — YouTube, Spotify, JioSaavn, Gaana, SoundCloud, Audiomack
- **Smart detection** — Auto-detects platform from URL
- **Theme system** — 5 animated themes that cycle automatically
- **Progress tracking** — Real-time download progress with chunked reading
- **MP3 conversion** — ffmpeg.wasm for M4A/WebM to MP3 conversion
- **Mobile responsive** — Works on all screen sizes
- **Spotify support** — Direct download via local Python daemon (AES-128-CTR decryption)

## Supported Platforms

| Platform | Resolution Method | Direct Audio |
|----------|-------------------|--------------|
| YouTube | youtubei.js (Innertube) | M4A/WebM |
| YouTube Music | youtubei.js (Innertube) | M4A/WebM |
| **Spotify** | **Local Python daemon (librespot)** | **OGG Vorbis** |
| JioSaavn | Internal API | MP3 (320kbps) |
| Gaana | Page scraping | MP3/M4A |
| SoundCloud | Page scraping | MP3 |
| Audiomack | Page scraping | MP3 |

## Quick Start (Browser Only)

1. Open `index.html` in a browser
2. Paste a music URL
3. Click "Fetch"
4. Click "Download MP3"

## Spotify Direct Download (Requires Python)

For direct Spotify downloads, run the local Python daemon:

### Prerequisites

- Python 3.8+
- pip (Python package manager)

### Setup

```bash
# Navigate to spotify_dl directory
cd spotify_dl

# Install dependencies
pip install -r requirements.txt

# Start the daemon
python daemon.py
```

### Using the CLI

```bash
# Download a single track
python main.py "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"

# Download with specific quality
python main.py -q very_high "spotify:track:4uLU6hMCjMI75M1A2tKUQC"

# Download to specific directory
python main.py -o ./music "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"

# Run as daemon (for browser integration)
python daemon.py --port 54321
```

### How It Works

1. **Browser** identifies Spotify track and sends track ID to local daemon
2. **Daemon** authenticates with Spotify (via librespot)
3. **Daemon** fetches encrypted audio stream
4. **Daemon** decrypts using AES-128-CTR with session key
5. **Browser** receives decrypted OGG audio and triggers download

### Spotify Encryption Details

Spotify encrypts audio using:
- **Algorithm:** AES-128-CTR
- **Key:** First 16 bytes of session key
- **IV:** Next 16 bytes of session key, XOR'd with chunk counter
- **Chunks:** ~320KB blocks, each with incrementing counter

The daemon handles all key exchange and decryption automatically.

## Deployment (GitHub Pages)

1. Push this folder to a GitHub repository
2. Go to **Settings → Pages**
3. Set **Source** to "Deploy from a branch"
4. Select **main** branch, folder **/ (root)**
5. Your app will be available at `https://<username>.github.io/<repo-name>/`

## CORS Proxies

The app uses free public CORS proxies for cross-origin requests:

- **Primary:** `https://api.allorigins.win/raw?url=`
- **Fallback:** `https://corsproxy.io/?`

These are third-party services and may be rate-limited.

## Technical Stack

### Browser (Frontend)
- HTML5, CSS3, Vanilla JavaScript
- Tailwind CSS (CDN)
- GSAP 3.12 (CDN)
- Font Awesome 6.5 (CDN)
- Google Fonts (Inter, Playfair Display, Poppins, Montserrat)
- ffmpeg.wasm 0.12 (lazy-loaded for MP3 conversion)

### Python (Spotify Daemon)
- librespot (Spotify protocol implementation)
- pycryptodome (AES-128-CTR decryption)
- FastAPI/HTTP server (local REST API)

## File Structure

```
music_downloader/
├── index.html                 # Main web app
├── css/
│   ├── themes.css            # 5 animation themes
│   └── animations.css        # Keyframes and utilities
├── js/
│   ├── app.js                # Main logic
│   ├── resolvers.js          # Platform resolvers
│   ├── themes.js             # Theme cycling
│   ├── particles.js          # Particle systems
│   └── ffmpeg-loader.js      # MP3 conversion
├── spotify_dl/
│   ├── daemon.py             # Local HTTP server
│   ├── decryptor.py          # AES-128-CTR decryption
│   ├── spotify_auth.py       # Spotify authentication
│   ├── main.py               # CLI tool
│   ├── requirements.txt      # Python dependencies
│   ├── start.sh              # Linux/Mac launcher
│   └── start.bat             # Windows launcher
├── assets/
│   ├── favicon.svg
│   └── patterns/             # SVG patterns
├── .nojekyll
└── README.md
```

## Known Limitations

- CORS proxies are free services and may have downtime
- YouTube audio streams are M4A/WebM; MP3 conversion requires ffmpeg.wasm (~25MB)
- **Spotify** requires the local Python daemon for direct downloads
- Some platforms may change their API endpoints

## Troubleshooting

### Spotify Download Not Working

1. Ensure Python daemon is running: `python spotify_dl/daemon.py`
2. Check daemon status: `curl http://127.0.0.1:54321/api/status`
3. Install dependencies: `pip install -r spotify_dl/requirements.txt`

### librespot Installation Issues

librespot requires Rust toolchain. If installation fails:
```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Then install librespot
pip install librespot
```

### Anonymous Mode Limitations

Anonymous sessions are limited to 96kbps OGG quality. For higher quality:
- Use Spotify Premium credentials
- Run: `python daemon.py --auth-method username_password --username YOUR_USER --password YOUR_PASS`

## Legal Disclaimer

This tool is for **educational and personal use only**. Downloading copyrighted music may violate platform Terms of Service and copyright laws in your jurisdiction. Always respect artists' rights and applicable laws.
