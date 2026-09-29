/* ═══════════════════════════════════════════════════════════════
   RESOLVERS.JS — Platform-Specific URL Resolution
   ═══════════════════════════════════════════════════════════════ */
 
const Resolvers = (() => {
    const CORS_PROXIES = [
        'https://api.allorigins.win/raw?url=',
        'https://corsproxy.io/?'
    ];

    const DEFAULT_DAEMON_PORT = 54321;
    const DAEMON_TIMEOUT_MS = 2000;
    const TRACK_ID_RE = /^[A-Za-z0-9]{22}$/;

    // ─── LOCAL DAEMON CLIENT ───
    // The daemon is optional; every call resolves to null on any failure so a
    // missing daemon degrades to the browser-only path instead of throwing.
    function daemonBase() {
        let port = DEFAULT_DAEMON_PORT;
        try {
            // Set ?daemon=1234 (or localStorage) when running the daemon on a
            // non-default port, e.g. `python daemon.py --port 1234`.
            const fromQuery = new URLSearchParams(location.search).get('daemon');
            if (fromQuery && /^\d{2,5}$/.test(fromQuery)) {
                port = parseInt(fromQuery, 10);
            } else {
                const stored = localStorage.getItem('musicgrab.daemonPort');
                if (stored && /^\d{2,5}$/.test(stored)) port = parseInt(stored, 10);
            }
        } catch (e) {
            // localStorage can throw in private mode; fall back to the default.
        }
        return `http://127.0.0.1:${port}`;
    }

    async function daemonFetch(path, options = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DAEMON_TIMEOUT_MS);
        try {
            const response = await fetch(daemonBase() + path, {
                ...options,
                signal: controller.signal
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } finally {
            clearTimeout(timer);
        }
    }

    async function checkDaemonStatus() {
        try {
            return await daemonFetch('/api/status');
        } catch (err) {
            console.warn('Spotify daemon not reachable:', err.message);
            return null;
        }
    }

    async function requestDaemonDownload(trackId, format = 'mp3') {
        if (!TRACK_ID_RE.test(trackId)) {
            throw new Error(`Invalid Spotify track ID: ${trackId}`);
        }
        return await daemonFetch('/api/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ track_id: trackId, format })
        });
    }

    // ─── RESULT NORMALISATION ───
    // Every resolver returns the same shape so callers never have to guess
    // whether a field is present.
    //
    // needsProxy is only a HINT about the best first attempt. The downloader
    // tries the hinted route and falls back to the other, so getting the hint
    // wrong costs one extra round trip rather than a failed download. Hosts
    // differ in whether they send CORS headers and that changes over time, so
    // it is not something to hardcode here.
    function normalize(result) {
        const r = result || {};
        const streamUrl = r.streamUrl || null;
        const sourceFormat = r.sourceFormat || (streamUrl ? guessFormat(streamUrl) : 'mp3');
        // GoogleVideo and similar streaming URLs are never directly fetchable.
        const needsProxy = r.needsProxy !== undefined
            ? r.needsProxy === true
            : (streamUrl !== null && r.needsConversion === true);

        return {
            ...r,
            streamUrl,
            sourceFormat,
            needsConversion: r.needsConversion === true,
            needsProxy
        };
    }

    function guessFormat(url) {
        const ext = (url.split('?')[0].split('#')[0].match(/\.([a-z0-9]{2,5})$/i) || [])[1];
        return (ext || 'mp3').toLowerCase();
    }

    // ─── CORS-PROXIED FETCH ───
    async function proxyFetch(url, options = {}) {
        let lastError;
        for (const proxy of CORS_PROXIES) {
            try {
                const proxyUrl = proxy + encodeURIComponent(url);
                const response = await fetch(proxyUrl, options);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response;
            } catch (err) {
                lastError = err;
                console.warn(`Proxy ${proxy} failed for ${url}:`, err.message);
            }
        }
        throw new Error(`All CORS proxies failed for: ${url}. ${lastError?.message || ''}`);
    }

    async function proxyFetchText(url) {
        const response = await proxyFetch(url);
        return response.text();
    }

    async function proxyFetchJSON(url) {
        const response = await proxyFetch(url);
        return response.json();
    }

    // ─── URL DETECTION ───
    function detectPlatform(url) {
        const lower = url.toLowerCase();
        if (/youtube\.com|youtu\.be|m\.youtube\.com|music\.youtube\.com/.test(lower)) return 'youtube';
        if (/spotify\.com/.test(lower)) return 'spotify';
        if (/jiosaavn\.com/.test(lower)) return 'jiosaavn';
        if (/gaana\.com/.test(lower)) return 'gaana';
        if (/soundcloud\.com/.test(lower)) return 'soundcloud';
        if (/audiomack\.com/.test(lower)) return 'audiomack';
        return 'unknown';
    }

    function getPlatformIcon(platform) {
        const icons = {
            youtube: 'fa-brands fa-youtube',
            spotify: 'fa-brands fa-spotify',
            jiosaavn: 'fa-solid fa-music',
            gaana: 'fa-solid fa-headphones',
            soundcloud: 'fa-brands fa-soundcloud',
            audiomack: 'fa-solid fa-wave-square',
            unknown: 'fa-solid fa-link'
        };
        return icons[platform] || icons.unknown;
    }

    function getPlatformName(platform) {
        const names = {
            youtube: 'YouTube',
            spotify: 'Spotify',
            jiosaavn: 'JioSaavn',
            gaana: 'Gaana',
            soundcloud: 'SoundCloud',
            audiomack: 'Audiomack',
            unknown: 'Unknown'
        };
        return names[platform] || 'Unknown';
    }

    // ─── YOUTUBE RESOLVER ───
    const INNERTUBE_CDN = 'https://cdn.jsdelivr.net/npm/youtubei.js@9/dist/umd.min.js';
    const SCRIPT_LOAD_TIMEOUT_MS = 10000;

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[data-src="${src}"]`);
            if (existing) {
                if (existing.dataset.loaded === 'true') return resolve();
                existing.addEventListener('load', () => resolve());
                existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)));
                return;
            }

            const script = document.createElement('script');
            script.src = src;
            script.dataset.src = src;
            script.async = true;
            script.addEventListener('load', () => {
                script.dataset.loaded = 'true';
                resolve();
            });
            // Must reject, otherwise a blocked CDN leaves this promise pending forever.
            script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)));
            document.head.appendChild(script);
        });
    }

    function loadInnertube() {
        return Promise.race([
            loadScript(INNERTUBE_CDN),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('youtubei.js load timed out')), SCRIPT_LOAD_TIMEOUT_MS)
            )
        ]);
    }

    function extractYouTubeId(url) {
        const patterns = [
            /(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/|music\.youtube\.com\/watch\?.*v=)([a-zA-Z0-9_-]{11})/,
            /^([a-zA-Z0-9_-]{11})$/
        ];
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }
        return null;
    }

    async function resolveYouTube(url) {
        const videoId = extractYouTubeId(url);
        if (!videoId) throw new Error('Could not extract YouTube video ID from URL');

        // Try to get metadata via oEmbed (always works, no CORS issues)
        let metadata = { title: 'Unknown Title', artist: 'Unknown Artist', thumbnail: '' };
        try {
            const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
            const oembed = await proxyFetchJSON(oembedUrl);
            if (oembed.title && oembed.title !== 'Watch on YouTube') {
                metadata.title = oembed.title;
            }
            if (oembed.author_name) {
                metadata.artist = oembed.author_name;
            }
            if (oembed.thumbnail_url) {
                metadata.thumbnail = oembed.thumbnail_url;
            } else {
                metadata.thumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
            }
        } catch (e) {
            console.warn('oEmbed failed:', e);
            // Keep default metadata - user will see "Unknown Title"
        }

        // Try youtubei.js for audio stream
        let streamUrl = null;
        let audioFormat = 'audio';

        try {
            if (typeof Innertube === 'undefined') {
                await loadInnertube();
            }

            const yt = await Innertube.create({ client: 'WEB' });
            const info = await yt.getInfo(videoId);

            // Get best audio format
            const format = info.chooseFormat({ type: 'audio', quality: 'best' });

            if (format) {
                streamUrl = format.decipher(yt.session.player);
                audioFormat = format.mimeType?.includes('webm') ? 'audio/webm' : 'audio/mp4';
            }

            // Update metadata from video info
            if (info.basic_info) {
                if (info.basic_info.title && info.basic_info.title !== 'Watch on YouTube') {
                    metadata.title = info.basic_info.title;
                }
                if (info.basic_info.channel?.name) {
                    metadata.artist = info.basic_info.channel.name;
                } else if (info.basic_info.author) {
                    metadata.artist = info.basic_info.author;
                }
                if (info.basic_info.duration) {
                    metadata.duration = formatDuration(info.basic_info.duration);
                }
                if (info.basic_info.thumbnail?.length > 0) {
                    metadata.thumbnail = info.basic_info.thumbnail[0].url || metadata.thumbnail;
                }
            }
        } catch (e) {
            console.warn('youtubei.js failed:', e);
            // Continue with oEmbed metadata only - this is expected
        }

        // Determine if we have valid metadata
        const titleValid = metadata.title && metadata.title !== 'Watch on YouTube' && metadata.title !== 'Unknown Title';
        const artistValid = metadata.artist && metadata.artist !== 'Unknown Artist';

        if (titleValid || artistValid) {
            // We have some metadata - return what we have
            const result = {
                title: metadata.title,
                artist: metadata.artist,
                thumbnail: metadata.thumbnail,
                streamUrl,
                audioFormat,
                platform: 'youtube',
                needsConversion: audioFormat !== 'audio/mpeg',
                sourceFormat: audioFormat.includes('webm') ? 'webm' : 'm4a'
            };
            
            // Add note if direct download not available
            if (!streamUrl) {
                result.downloadNote = 'Direct YouTube download requires the Innertube API. ' +
                    'Metadata extracted via oEmbed. Try JioSaavn or Spotify for direct MP3 download.';
            }
            
            return result;
        }

        // If no valid metadata at all, return what we have with download note
        return {
            title: metadata.title,
            artist: metadata.artist,
            thumbnail: metadata.thumbnail,
            streamUrl: null,
            audioFormat: 'audio/mpeg',
            platform: 'youtube',
            needsConversion: false,
            sourceFormat: 'm4a',
            downloadNote: 'Could not extract YouTube audio stream. ' +
                'Video metadata was extracted via oEmbed API. ' +
                'For direct MP3 download, try a JioSaavn or Spotify link.'
        };
    }

    // ─── SPOTIFY RESOLVER ───
    function extractSpotifyId(url) {
        const patterns = [
            /spotify\.com\/track\/([a-zA-Z0-9]+)/,
            /spotify\.com\/embed\/track\/([a-zA-Z0-9]+)/
        ];
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }
        return null;
    }

    async function resolveSpotify(url) {
        const trackId = extractSpotifyId(url);
        if (!trackId) throw new Error('Could not extract Spotify track ID from URL');

        // Get metadata via oEmbed
        let metadata = { title: 'Unknown', artist: 'Unknown' };
        try {
            const oembedUrl = `https://open.spotify.com/oembed?url=https://open.spotify.com/track/${trackId}`;
            const oembed = await proxyFetchJSON(oembedUrl);
            metadata.title = oembed.title || metadata.title;
            // oEmbed returns "Track · Artist" format
            const parts = (oembed.title || '').split(' · ');
            if (parts.length >= 2) {
                metadata.title = parts.slice(0, -1).join(' · ').trim();
                metadata.artist = parts[parts.length - 1].trim();
            }
            metadata.thumbnail = oembed.thumbnail_url || '';
        } catch (e) {
            console.warn('Spotify oEmbed failed:', e);
        }

        // Prefer the local daemon, which can download straight from a Spotify URL.
        const daemonStatus = await checkDaemonStatus();
        if (daemonStatus && daemonStatus.status === 'running') {
            try {
                const result = await requestDaemonDownload(trackId, 'mp3');
                if (result && result.success) {
                    // Report the format the daemon actually produced rather than
                    // assuming OGG — spotdl emits MP3 by default.
                    const suffix = (result.source_format || guessFormat(result.download_url) || 'mp3').toLowerCase();
                    return {
                        title: metadata.title,
                        artist: metadata.artist,
                        thumbnail: metadata.thumbnail,
                        streamUrl: result.download_url,
                        sourceFormat: suffix,
                        needsConversion: false,
                        needsProxy: false,
                        platform: 'spotify',
                        originalPlatform: 'spotify',
                        foundOn: result.found_on || 'Spotify (local daemon)',
                        daemonDownload: true
                    };
                }
            } catch (e) {
                console.warn('Spotify daemon download failed, falling back:', e.message);
            }
        }

        // Fallback: JioSaavn search by title/artist.
        try {
            const jioResult = await searchJioSaavn(metadata.title, metadata.artist);
            return {
                ...jioResult,
                platform: 'spotify',
                originalPlatform: 'spotify',
                foundOn: 'JioSaavn'
            };
        } catch (e) {
            console.warn('JioSaavn search failed:', e);
        }

        if (daemonStatus && daemonStatus.status === 'running') {
            throw new Error(
                `Found "${metadata.title}" by ${metadata.artist} on Spotify, but the ` +
                `local daemon could not download it. Check the daemon terminal for errors.`
            );
        }
        throw new Error(
            `Found "${metadata.title}" by ${metadata.artist} on Spotify, but couldn't ` +
            `find a downloadable source.\n\nFor direct downloads, start the local daemon:\n` +
            `python spotify_dl/daemon.py\n\nOr try a JioSaavn or YouTube link instead.`
        );
    }

    // ─── JIOSAAVN RESOLVER ───
    function extractJioSaavnId(url) {
        // URLs like https://www.jiosaavn.com/song/...
        const patterns = [
            /jiosaavn\.com\/song\/[^/]+\/([A-Za-z0-9]+)/,
            /jiosaavn\.com\/featured\/[^/]+\/([A-Za-z0-9]+)/
        ];
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }
        // Try to extract from any URL path
        const pathMatch = url.match(/jiosaavn\.com\/([a-z]+)\/([^/?]+)/);
        if (pathMatch) return pathMatch[2];
        return null;
    }

    async function searchJioSaavn(title, artist) {
        const query = `${artist} ${title}`.trim();
        const searchUrl = `https://www.jiosaavn.com/api/search/songs?query=${encodeURIComponent(query)}&p=1&n=10`;

        try {
            const data = await proxyFetchJSON(searchUrl);
            if (data?.data?.results?.length > 0) {
                const song = data.data.results[0];
                return buildJioSaavnResult(song);
            }
        } catch (e) {
            console.warn('JioSaavn search API failed:', e);
        }

        throw new Error('No results found on JioSaavn');
    }

    function buildJioSaavnResult(song) {
        const title = song.title || song.name || 'Unknown';
        const artist = song.description || song.primaryArtists || song.artistMap?.primary_artists?.[0]?.name || 'Unknown';
        const duration = song.duration ? formatDuration(parseInt(song.duration)) : '';

        // Get best quality URL
        let audioUrl = '';
        if (song.downloadUrl) {
            const urls = song.downloadUrl;
            audioUrl = urls['320'] || urls['160'] || urls['96'] || urls['48'] || Object.values(urls)[0] || '';
        } else if (song.more_info?.encrypted_media_url) {
            audioUrl = song.more_info.encrypted_media_url;
        }

        let thumbnail = '';
        if (song.image) {
            if (typeof song.image === 'object') {
                thumbnail = song.image['500x500'] || song.image['300x300'] || song.image['150x150'] || Object.values(song.image)[0] || '';
            } else {
                thumbnail = song.image;
            }
        }

        return {
            title,
            artist,
            duration,
            thumbnail,
            streamUrl: audioUrl,
            audioFormat: 'audio/mpeg',
            platform: 'jiosaavn',
            needsConversion: false,
            sourceFormat: 'mp3'
        };
    }

    async function resolveJioSaavn(url) {
        const songId = extractJioSaavnId(url);

        // Try to fetch page and extract data
        try {
            const html = await proxyFetchText(url);

            // Try to find JSON-LD or embedded data
            const dataMatch = html.match(/window\.__INITIAL_DATA__\s*=\s*({.+?})\s*;\s*<\/script>/s) ||
                             html.match(/window\._songsData\s*=\s*({.+?})\s*;\s*<\/script>/s);

            if (dataMatch) {
                try {
                    const data = JSON.parse(dataMatch[1]);
                    const song = data?.songDetails || data?.songs?.[0] || data;
                    if (song) {
                        return buildJioSaavnResult(song);
                    }
                } catch (parseErr) {
                    console.warn('Failed to parse JioSaavn embedded data:', parseErr);
                }
            }

            // Extract title from HTML
            const titleMatch = html.match(/<title>([^<]+)<\/title>/);
            const title = titleMatch ? titleMatch[1].replace(' - JioSaavn', '').trim() : '';
            const artistMatch = html.match(/name="description"\s+content="([^"]+)"/);
            const artist = artistMatch ? artistMatch[1].split(' - ')[0].trim() : '';

            if (title) {
                return await searchJioSaavn(title, artist);
            }
        } catch (e) {
            console.warn('JioSaavn page fetch failed:', e);
        }

        // Try direct API with ID
        if (songId) {
            try {
                const apiUrl = `https://www.jiosaavn.com/api/songs/${songId}`;
                const song = await proxyFetchJSON(apiUrl);
                if (song) return buildJioSaavnResult(song);
            } catch (e) {
                console.warn('JioSaavn song API failed:', e);
            }
        }

        // Last resort: search with URL as query
        try {
            return await searchJioSaavn(url.replace(/^https?:\/\//, ''), '');
        } catch (e) {
            throw new Error('Could not resolve JioSaavn link. Try pasting the song title directly.');
        }
    }

    // ─── GAANA RESOLVER ───
    function extractGaanaId(url) {
        const patterns = [
            /gaana\.com\/song\/[^/]+\/([A-Za-z0-9]+)/,
            /gaana\.com\/([a-z]+)\/([A-Za-z0-9]+)/
        ];
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1] || match[2];
        }
        return null;
    }

    async function resolveGaana(url) {
        const trackId = extractGaanaId(url);

        try {
            const html = await proxyFetchText(url);

            // Try to find og:audio or audio src
            const audioMatch = html.match(/property="og:audio"\s+content="([^"]+)"/) ||
                              html.match(/<audio[^>]+src="([^"]+)"/) ||
                              html.match(/"audioUrl"\s*:\s*"([^"]+)"/) ||
                              html.match(/"url"\s*:\s*"(https?:\/\/[^"]+\.mp3[^"]*)"/);

            const titleMatch = html.match(/property="og:title"\s+content="([^"]+)"/) ||
                              html.match(/<title>([^<]+)<\/title>/);
            const artistMatch = html.match(/property="og:description"\s+content="([^"]+)"/) ||
                               html.match(/"artist"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/);
            const imageMatch = html.match(/property="og:image"\s+content="([^"]+)"/);

            if (audioMatch && audioMatch[1]) {
                const audioUrl = audioMatch[1];
                const title = titleMatch ? titleMatch[1].replace(' - Gaana.com', '').trim() : 'Unknown';
                const artist = artistMatch ? artistMatch[1].split('-')[0].trim() : 'Unknown';
                const thumbnail = imageMatch ? imageMatch[1] : '';

                return {
                    title,
                    artist,
                    thumbnail,
                    streamUrl: audioUrl,
                    audioFormat: audioUrl.includes('.mp3') ? 'audio/mpeg' : 'audio/mp4',
                    platform: 'gaana',
                    needsConversion: !audioUrl.includes('.mp3'),
                    sourceFormat: audioUrl.includes('.mp3') ? 'mp3' : 'm4a'
                };
            }
        } catch (e) {
            console.warn('Gaana page fetch failed:', e);
        }

        throw new Error(
            'Could not resolve Gaana link for direct download. ' +
            'Try searching for the song on YouTube or JioSaavn instead.'
        );
    }

    // ─── SOUNDCLOUD RESOLVER ───
    async function resolveSoundCloud(url) {
        try {
            const html = await proxyFetchText(url);

            // Look for audio sources
            const audioMatch = html.match(/"soundCloudApiData"\s*:\s*\{[^}]*"mediaEntity"\s*:\s*\{[^}]*"transcodings"\s*:\s*\[[^\]]*?"url"\s*:\s*"([^"]+)"/) ||
                              html.match(/<audio[^>]+src="([^"]+)"/) ||
                              html.match(/property="og:audio"\s+content="([^"]+)"/) ||
                              html.match(/"stream_url"\s*:\s*"([^"]+)"/) ||
                              html.match(/"contentUrl"\s*:\s*"([^"]+)"/);

            const titleMatch = html.match(/property="og:title"\s+content="([^"]+)"/) ||
                              html.match(/<title>([^<]+)<\/title>/);
            const artistMatch = html.match(/"username"\s*:\s*"([^"]+)"/) ||
                               html.match(/property="og:description"\s+content="([^"]+)"/);
            const imageMatch = html.match(/property="og:image"\s+content="([^"]+)"/);

            if (audioMatch && audioMatch[1]) {
                let audioUrl = audioMatch[1];

                // SoundCloud transcodings may need client_id
                if (audioUrl.includes('api-v2.soundcloud.com')) {
                    // Try to get a direct stream
                    const streamMatch = html.match(/client_id=([a-zA-Z0-9]+)/);
                    if (streamMatch) {
                        const sep = audioUrl.includes('?') ? '&' : '?';
                        audioUrl += `${sep}client_id=${streamMatch[1]}`;
                    }
                }

                const title = titleMatch ? titleMatch[1].replace(' | Free Listen on SoundCloud', '').trim() : 'Unknown';
                const artist = artistMatch ? artistMatch[1].trim() : 'Unknown';
                const thumbnail = imageMatch ? imageMatch[1] : '';

                return {
                    title,
                    artist,
                    thumbnail,
                    streamUrl: audioUrl,
                    audioFormat: 'audio/mpeg',
                    platform: 'soundcloud',
                    needsConversion: false,
                    sourceFormat: 'mp3'
                };
            }
        } catch (e) {
            console.warn('SoundCloud page fetch failed:', e);
        }

        throw new Error(
            'Could not resolve SoundCloud link for direct download. ' +
            'SoundCloud often restricts direct stream access.'
        );
    }

    // ─── AUDIOMACK RESOLVER ───
    async function resolveAudiomack(url) {
        try {
            const html = await proxyFetchText(url);

            const audioMatch = html.match(/"audioUrl"\s*:\s*"([^"]+)"/) ||
                              html.match(/"streamUrl"\s*:\s*"([^"]+)"/) ||
                              html.match(/<audio[^>]+src="([^"]+)"/) ||
                              html.match(/property="og:audio"\s+content="([^"]+)"/);

            const titleMatch = html.match(/property="og:title"\s+content="([^"]+)"/) ||
                              html.match(/<title>([^<]+)<\/title>/);
            const artistMatch = html.match(/property="og:description"\s+content="([^"]+)"/);
            const imageMatch = html.match(/property="og:image"\s+content="([^"]+)"/);

            if (audioMatch && audioMatch[1]) {
                const title = titleMatch ? titleMatch[1].replace(' - Audiomack', '').trim() : 'Unknown';
                const artist = artistMatch ? artistMatch[1].trim() : 'Unknown';
                const thumbnail = imageMatch ? imageMatch[1] : '';

                return {
                    title,
                    artist,
                    thumbnail,
                    streamUrl: audioMatch[1],
                    audioFormat: 'audio/mpeg',
                    platform: 'audiomack',
                    needsConversion: false,
                    sourceFormat: 'mp3'
                };
            }
        } catch (e) {
            console.warn('Audiomack page fetch failed:', e);
        }

        throw new Error(
            'Could not resolve Audiomack link for direct download. ' +
            'Try searching for the song on YouTube or JioSaavn instead.'
        );
    }

    // ─── GENERIC RESOLVER (Unknown platform) ───
    async function resolveGeneric(url) {
        try {
            const html = await proxyFetchText(url);

            // Look for audio elements
            const audioMatch = html.match(/property="og:audio"\s+content="([^"]+)"/) ||
                              html.match(/<audio[^>]+src="([^"]+)"/) ||
                              html.match(/"contentUrl"\s*:\s*"([^"]+)"/) ||
                              html.match(/"audioUrl"\s*:\s*"([^"]+)"/);

            const titleMatch = html.match(/property="og:title"\s+content="([^"]+)"/) ||
                              html.match(/<title>([^<]+)<\/title>/);
            const imageMatch = html.match(/property="og:image"\s+content="([^"]+)"/);

            if (audioMatch && audioMatch[1]) {
                const title = titleMatch ? titleMatch[1].trim() : 'Unknown';
                const thumbnail = imageMatch ? imageMatch[1] : '';

                return {
                    title,
                    artist: 'Unknown',
                    thumbnail,
                    streamUrl: audioMatch[1],
                    audioFormat: 'audio/mpeg',
                    platform: 'unknown',
                    needsConversion: false,
                    sourceFormat: 'mp3'
                };
            }
        } catch (e) {
            console.warn('Generic page fetch failed:', e);
        }

        throw new Error(
            'Direct download not available for this URL. ' +
            'Try a YouTube, Spotify, or JioSaavn link instead.'
        );
    }

    // ─── MAIN RESOLVE FUNCTION ───
    async function resolve(url) {
        const platform = detectPlatform(url);

        const dispatch = {
            youtube: resolveYouTube,
            spotify: resolveSpotify,
            jiosaavn: resolveJioSaavn,
            gaana: resolveGaana,
            soundcloud: resolveSoundCloud,
            audiomack: resolveAudiomack
        }[platform] || resolveGeneric;

        return normalize(await dispatch(url));
    }

    // ─── UTILITY ───
    function formatDuration(seconds) {
        if (!seconds || isNaN(seconds)) return '';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    const windowResolvers = {
        resolve,
        detectPlatform,
        getPlatformIcon,
        getPlatformName,
        extractYouTubeId,
        extractSpotifyId,
        extractJioSaavnId,
        extractGaanaId,
        formatDuration
    };
    window.Resolvers = windowResolvers;
    return windowResolvers;
})();