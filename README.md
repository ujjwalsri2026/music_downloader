# MusicGrab - Free Music Downloader

A browser-based music downloader that resolves direct audio URLs from YouTube, Spotify, JioSaavn, Gaana, SoundCloud, and Audiomack. Most platforms work with no backend at all; Spotify requires an optional local Python daemon.

## Features

- **No backend for most platforms** — YouTube, JioSaavn, Gaana, SoundCloud, Audiomack resolve client-side
- **Optional local daemon** — enables Spotify URL downloads
- **Multi-platform** — YouTube, Spotify, JioSaavn, Gaana, SoundCloud, Audiomack
- **Smart detection** — auto-detects platform from URL
- **Theme system** — 5 animated themes that cycle automatically
- **Progress tracking** — real-time download progress with chunked reading
- **MP3 conversion** — ffmpeg.wasm for M4A/WebM to MP3 conversion
- **Mobile responsive** — works on all screen sizes

## Supported Platforms

| Platform | Resolution Method | Direct Audio |
|----------|-------------------|--------------|
| YouTube | youtubei.js (Innertube) | M4A/WebM |
| YouTube Music | youtubei.js (Innertube) | M4A/WebM |
| **Spotify** | **Local Python daemon (spotdl)** | **MP3 (or requested format)** |
| JioSaavn | Internal API | MP3 (320kbps) |
| Gaana | Page scraping | MP3/M4A |
| SoundCloud | Page scraping | MP3 |
| Audiomack | Page scraping | MP3 |

> **Note on Spotify:** the daemon does not speak Spotify's audio protocol. It
> hands the Spotify URL to `spotdl`, which matches the track and downloads the
> audio. The UI labels the result with the tool that actually produced it so the
> source is never misrepresented.

## Quick Start (Browser Only)

1. Open `index.html` in a browser (or serve the folder)
2. Paste a music URL
3. Click "Fetch"
4. Click "Download MP3"

## Spotify Downloads (Requires Python)

Spotify URLs are resolved by an optional local daemon.

### Setup

```bash
cd spotify_dl
pip install -r requirements.txt   # installs spotdl + yt-dlp
./start.sh                        # macOS/Linux
# or: start.bat                   # Windows
```

The daemon listens on `http://127.0.0.1:54321` by default. If no daemon is
running, the frontend automatically falls back to searching the track by
title/artist instead of failing.

To use a different port, start the daemon with `--port` and tell the page about
it with a `?daemon=` query parameter:

```bash
python daemon.py --port 1234
# then open:  index.html?daemon=1234
```

The port is also remembered if you set it once in the browser console:

```js
localStorage.setItem('musicgrab.daemonPort', '1234');
```

ffmpeg is optional but recommended — without it, audio that is not already MP3 is
kept in its original format rather than converted.

```bash
brew install ffmpeg              # macOS
sudo apt install ffmpeg          # Debian/Ubuntu
choco install ffmpeg             # Windows
```

### Daemon options

```bash
python daemon.py --port 54321                        # custom port
python daemon.py --allow-origin https://example.com  # extra CORS origin
```

By default the daemon only echoes `Access-Control-Allow-Origin` for browsers on
`https://*.github.io`, `http(s)://localhost`, and `http(s)://127.0.0.1`. Any
other origin receives `Access-Control-Allow-Origin: null`, which makes the
browser block the response.

This is a browser-enforced control, not authentication. It stops other web pages
from reading the daemon's replies through the browser, but it is not a secret
and it does not stop a direct non-browser client (e.g. `curl`) on the same
machine. Do not expose this port to a network you do not control — the
`--host` default is `127.0.0.1` for that reason.

### CLI

```bash
python main.py "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"
python main.py -o ./music -f mp3 "spotify:track:4uLU6hMCjMI75M1A2tKUQC"
python main.py -q 160 "4uLU6hMCjMI75M1A2tKUQC"        # bare ID also works
python main.py --install                              # install the tools
```

| Flag | Values | Default |
|------|--------|---------|
| `-o`, `--output` | any path | `./downloads` |
| `-f`, `--format` | `mp3`, `ogg`, `m4a`, `opus` | `mp3` |
| `-q`, `--quality` | `96`, `160`, `320` | `320` |

### Daemon API

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/api/status` | Liveness check |
| `POST` | `/api/download` | `{"track_id": "<22-char id>", "format": "mp3"}` |
| `GET`  | `/api/file/{id}/{name}` | Download a fetched file |
| `HEAD` | `/api/file/{id}/{name}` | Probe a file (headers only) |

## Deployment (GitHub Pages)

1. Push this folder to a GitHub repository
2. Go to **Settings → Pages**
3. Set **Source** to "Deploy from a branch"
4. Select `main` branch, folder `/ (root)`
5. Your app will be available at `https://<username>.github.io/<repo-name>/`

The included `deploy.yml` workflow publishes only the static assets
(`index.html`, `css/`, `js/`, `assets/`). The Python daemon source and any local
downloads are excluded.

## CORS Proxies

The app uses free public CORS proxies for cross-origin requests:

- **Primary:** `https://api.allorigins.win/raw?url=`
- **Fallback:** `https://corsproxy.io/?`

These are third-party services and may be rate-limited. Every proxied URL passes
through them, so they can observe what you are downloading.

## Technical Stack

### Browser (Frontend)
- HTML5, CSS3, Vanilla JavaScript
- Tailwind CSS (CDN)
- GSAP 3.12 (CDN)
- Font Awesome 6.5 (CDN)
- Google Fonts (Inter, Playfair Display, Poppins, Montserrat)
- ffmpeg.wasm 0.12 (lazy-loaded for MP3 conversion)
- youtubei.js 9 (lazy-loaded for YouTube resolution)

### Python (Optional Local Daemon)
- Python standard library `http.server` (threaded)
- `spotdl` / `yt-dlp` (invoked as subprocesses)
- `ffmpeg` (invoked for conversion)

## File Structure

```
music_downloader/
├── index.html                 # Main web app
├── .nojekyll
├── .gitignore
├── css/
│   ├── themes.css             # 5 themes
│   └── animations.css         # Keyframes and utilities
├── js/
│   ├── app.js                 # Main logic
│   ├── resolvers.js           # Platform resolvers + daemon client
│   ├── themes.js              # Theme cycling
│   ├── particles.js           # Particle systems
│   └── ffmpeg-loader.js       # MP3 conversion
├── spotify_dl/
│   ├── daemon.py              # Local HTTP server
│   ├── main.py                # CLI tool
│   ├── requirements.txt
│   ├── start.sh               # Linux/Mac launcher
│   └── start.bat              # Windows launcher
├── assets/
│   ├── favicon.svg
│   └── patterns/              # SVG patterns
└── README.md
```

## Known Limitations

- CORS proxies are free services and may be rate-limited or go down
- YouTube audio is M4A/WebM; MP3 conversion requires ffmpeg.wasm (~25MB, lazy-loaded)
- **Spotify** requires the local daemon; without it the app falls back to a
  title/artist search
- A daemon download can take 10–60 s. The browser waits up to 200 s; the daemon
  itself gives the download tool 180 s
- YouTube and SoundCloud frequently block direct cross-origin fetches, so those
  downloads depend on the CORS proxies. The app tries a direct fetch first and
  falls back to a proxy if it fails
- Some platforms may change their API endpoints or page structure

## Troubleshooting

### Spotify download not working

1. Start the daemon: `./start.sh` (or `python spotify_dl/daemon.py`)
2. Check it responds: `curl http://127.0.0.1:54321/api/status`
3. Install dependencies: `pip install -r spotify_dl/requirements.txt`
4. If you changed the port, open the page with `?daemon=<port>`

If the daemon is running but the browser shows a CORS error, your page origin is
not in the allowlist — start the daemon with `--allow-origin <your-origin>`.

Note that `spotdl` changed its quality flag between major versions (3.x used
`--quality`, 4.x uses `--bitrate`). The CLI detects the installed version and
uses the right one, so `-q` works on both. The web app does not pass a bitrate
at all, so it always takes `spotdl`'s default quality.

Also note that `spotdl` 4.x caps output at 128 kbps unless the account has
YTMusic Premium, so requesting `-q 320` may just re-encode to 128 kbps.

### Downloads always fail

```bash
spotdl --version     # should print a version
yt-dlp --version
ffmpeg -version
```

If `spotdl` and `yt-dlp` both fail, the issue is usually network-related or the
source is region-blocked.

## Legal Disclaimer

This tool is for **educational and personal use only**. Downloading copyrighted music may violate platform Terms of Service and copyright laws in your jurisdiction. Always respect artists' rights and applicable laws.
