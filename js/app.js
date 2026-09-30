/* ═══════════════════════════════════════════════════════════════
   APP.JS — Main Application Logic, URL Detection, Download Flow
   ═══════════════════════════════════════════════════════════════ */

const App = (() => {
    // DOM Elements
    const els = {};
    let currentResult = null;
    let isDownloading = false;
    let isFetching = false;

    // ─── INIT ───
    function init() {
        cacheElements();
        bindEvents();
        ThemeManager.init();
        ParticleSystem.init();
        animateEntrance();
    }

    function cacheElements() {
        els.urlInput = document.getElementById('url-input');
        els.fetchBtn = document.getElementById('fetch-btn');
        els.downloadBtn = document.getElementById('download-btn');
        els.copyLinkBtn = document.getElementById('copy-link-btn');
        els.platformIcon = document.getElementById('platform-icon');
        els.loadingState = document.getElementById('loading-state');
        els.loadingText = document.getElementById('loading-text');
        els.errorState = document.getElementById('error-state');
        els.errorMessage = document.getElementById('error-message');
        els.errorCard = document.getElementById('error-card');
        els.errorClose = document.getElementById('error-close');
        els.resultState = document.getElementById('result-state');
        els.resultCard = document.getElementById('result-card');
        els.coverArt = document.getElementById('cover-art');
        els.trackTitle = document.getElementById('track-title');
        els.trackArtist = document.getElementById('track-artist');
        els.trackDuration = document.getElementById('track-duration');
        els.trackPlatform = document.getElementById('track-platform');
        els.progressContainer = document.getElementById('progress-container');
        els.progressBar = document.getElementById('progress-bar');
        els.progressPercent = document.getElementById('progress-percent');
        els.progressLabel = document.getElementById('progress-label');
        els.progressSize = document.getElementById('progress-size');
        els.heroSection = document.getElementById('hero-section');
        els.inputCard = document.getElementById('input-card');
    }

    function bindEvents() {
        els.fetchBtn.addEventListener('click', handleFetch);
        els.urlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleFetch();
        });
        els.urlInput.addEventListener('input', handleInputChange);
        els.downloadBtn.addEventListener('click', handleDownload);
        els.copyLinkBtn.addEventListener('click', handleCopyLink);
        els.errorClose.addEventListener('click', hideError);
    }

    function animateEntrance() {
        if (typeof gsap === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        gsap.from('#hero-title', { opacity: 0, y: 20, duration: 0.6, delay: 0.1 });
        gsap.from('#hero-subtitle', { opacity: 0, y: 15, duration: 0.6, delay: 0.2 });
        gsap.from('#input-card', { opacity: 0, y: 20, duration: 0.6, delay: 0.3 });
        gsap.from('#supported-section', { opacity: 0, duration: 0.6, delay: 0.5 });
        gsap.from('#footer', { opacity: 0, duration: 0.6, delay: 0.6 });
    }

    // ─── INPUT HANDLING ───
    function handleInputChange() {
        const url = els.urlInput.value.trim();
        if (!url) {
            els.platformIcon.classList.add('hidden');
            return;
        }

        const platform = Resolvers.detectPlatform(url);
        const iconEl = els.platformIcon.querySelector('i') || els.platformIcon;
        iconEl.className = Resolvers.getPlatformIcon(platform);
        els.platformIcon.classList.remove('hidden');
        els.platformIcon.classList.add('icon-bounce');
        setTimeout(() => els.platformIcon.classList.remove('icon-bounce'), 300);
    }

    // ─── FETCH ───
    async function handleFetch() {
        // Without this, a double-click or Enter+Enter fires two full resolve
        // pipelines. For Spotify that means two POST /api/download for the
        // same track, which races the daemon.
        if (isFetching) return;

        const url = els.urlInput.value.trim();
        if (!url) {
            shakeElement(els.inputCard);
            return;
        }

        // Validate URL
        try {
            new URL(url);
        } catch {
            shakeElement(els.inputCard);
            showError('Please enter a valid URL.');
            return;
        }

        isFetching = true;
        els.fetchBtn.disabled = true;
        setLoadingText('Resolving track...');
        hideError();
        hideResult();

        try {
            const result = await Resolvers.resolve(url);
            currentResult = result;
            showResult(result);
        } catch (err) {
            showError(err.message || 'Failed to resolve the URL. Please try another link.');
        } finally {
            isFetching = false;
            els.fetchBtn.disabled = false;
            hideLoading();
        }
    }

    // ─── DOWNLOAD ───
    let activeController = null;

    function setDownloadButton(label, iconClass, disabled) {
        els.downloadBtn.querySelector('span').textContent = label;
        els.downloadBtn.querySelector('i').className = iconClass;
        els.downloadBtn.disabled = disabled;
    }

    async function handleDownload() {
        // A second click cancels the in-flight download rather than being
        // ignored, so the AbortController is actually reachable.
        if (isDownloading) {
            if (activeController) activeController.abort();
            return;
        }
        if (!currentResult) return;
        if (!currentResult.streamUrl) {
            showError(currentResult.downloadNote ||
                'No downloadable stream was found for this track.', { keepResult: true });
            return;
        }

        isDownloading = true;
        setDownloadButton('Cancel', 'fa-solid fa-xmark', false);
        let audioBlob;

        try {
            // needsProxy is only a hint about the best first attempt. Most
            // audio CDNs omit CORS headers, so if the direct route fails we
            // retry through a proxy rather than surfacing a CORS error.
            audioBlob = await fetchWithFallback(currentResult);

            let converted = false;
            if (currentResult.needsConversion && audioBlob) {
                if (await ensureFFmpeg()) {
                    showProgress('Converting to MP3...', 0);
                    try {
                        audioBlob = await FFmpegLoader.convertToMP3(audioBlob, (progress) => {
                            // ffmpeg reports a time ratio that can exceed 1.
                            const pct = Math.min(100, Math.max(0, Math.round(progress * 100)));
                            showProgress('Converting to MP3...', pct);
                        });
                        converted = true;
                    } catch (convErr) {
                        console.warn('FFmpeg conversion failed:', convErr);
                        showProgress('Download complete (raw format)', 100);
                    }
                } else {
                    showProgress('Download complete (raw format)', 100);
                }
            }

            if (audioBlob) {
                triggerDownload(audioBlob, converted);
            }
        } catch (err) {
            if (err.name === 'AbortError') {
                hideProgress();
                showError('Download cancelled.', { keepResult: true });
            } else {
                hideProgress();
                showError('Download failed: ' + (err.message || 'Unknown error'),
                          { keepResult: true });
            }
        } finally {
            isDownloading = false;
            setDownloadButton('Download MP3', 'fa-solid fa-download', false);
            activeController = null;
        }
    }

    async function ensureFFmpeg() {
        if (FFmpegLoader.isLoaded()) return true;

        showProgress('Loading MP3 converter...', 0);
        try {
            await FFmpegLoader.load();
            return true;
        } catch (err) {
            console.warn('ffmpeg.wasm failed to load:', err);
            showProgress('Converter unavailable, downloading raw format', 100);
            return false;
        }
    }

    // ─── FETCH WITH PROGRESS ───
    async function fetchWithFallback(result) {
        const url = result.streamUrl;
        const order = result.needsProxy
            ? [['proxy', fetchWithProgressViaProxy], ['direct', fetchWithProgress]]
            : [['direct', fetchWithProgress], ['proxy', fetchWithProgressViaProxy]];

        let lastError;
        for (const [label, fetcher] of order) {
            try {
                return await fetcher(url);
            } catch (err) {
                if (err.name === 'AbortError') throw err;  // user cancelled
                lastError = err;
                console.warn(`${label} download failed:`, err.message);
            }
        }
        throw new Error(
            `Could not download the audio. Tried direct and via proxy. ${lastError?.message || ''}`.trim()
        );
    }

    async function fetchWithProgress(url) {
        showProgress('Downloading...', 0);

        const controller = new AbortController();
        activeController = controller;

        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const contentType = response.headers.get('content-type') || 'audio/mpeg';

        if (!response.body) {
            // No streaming body (e.g. opaque response) — fall back to a single read.
            const buffer = await response.arrayBuffer();
            showProgress('Downloading...', 100,
                `${(buffer.byteLength / (1024 * 1024)).toFixed(1)} MB`);
            return new Blob([buffer], { type: contentType });
        }

        const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
        const reader = response.body.getReader();
        const chunks = [];
        let received = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            chunks.push(value);
            received += value.length;

            const mbReceived = (received / (1024 * 1024)).toFixed(1);
            if (contentLength > 0) {
                const percent = Math.min(100, Math.round((received / contentLength) * 100));
                const mbTotal = (contentLength / (1024 * 1024)).toFixed(1);
                showProgress('Downloading...', percent, `${mbReceived} MB / ${mbTotal} MB`);
            } else {
                showProgress('Downloading...', -1, `${mbReceived} MB`);
            }
        }

        return new Blob(chunks, { type: contentType });
    }

    async function fetchWithProgressViaProxy(url) {
        showProgress('Downloading...', 0);

        const CORS_PROXIES = [
            'https://api.allorigins.win/raw?url=',
            'https://corsproxy.io/?'
        ];

        let lastError;
        for (const proxy of CORS_PROXIES) {
            try {
                const proxyUrl = proxy + encodeURIComponent(url);
                return await fetchWithProgress(proxyUrl);
            } catch (err) {
                // A cancel must stop the loop, not silently restart the
                // download against the next proxy.
                if (err.name === 'AbortError') throw err;
                lastError = err;
                console.warn(`Proxy download failed:`, err);
            }
        }

        throw new Error('Download failed: All CORS proxies are unavailable. Please try again later.');
    }

    function showProgress(label, percent, sizeText) {
        els.progressContainer.classList.remove('hidden');
        els.progressLabel.textContent = label;
        if (percent >= 0) {
            els.progressBar.classList.remove('progress-indeterminate');
            els.progressBar.style.width = percent + '%';
            els.progressPercent.textContent = percent + '%';
        } else {
            // No content-length: sweep instead of claiming a fake percentage.
            els.progressBar.classList.add('progress-indeterminate');
            els.progressBar.style.width = '40%';
            els.progressPercent.textContent = '';
        }
        if (sizeText) els.progressSize.textContent = sizeText;
    }

    function hideProgress() {
        els.progressContainer.classList.add('hidden');
        els.progressBar.classList.remove('progress-indeterminate');
        els.progressBar.style.width = '0%';
        els.progressPercent.textContent = '0%';
        els.progressSize.textContent = '';
    }

    // ─── TRIGGER DOWNLOAD ───
    function triggerDownload(blob, converted) {
        // Only label the file .mp3 when ffmpeg actually produced an MP3 —
        // otherwise keep the source extension the resolver reported.
        const ext = converted ? 'mp3' : (currentResult.sourceFormat || 'mp3');
        const filename = sanitizeFilename(`${currentResult.title} - ${currentResult.artist}.${ext}`);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            a.remove();
            URL.revokeObjectURL(url);
        }, 100);

        // Success animation
        if (typeof gsap !== 'undefined') {
            gsap.fromTo(els.downloadBtn,
                { scale: 1 },
                { scale: 1.05, duration: 0.15, yoyo: true, repeat: 1, ease: 'power2.out' }
            );
        }
    }

    // ─── COPY LINK ───
    async function handleCopyLink() {
        if (!currentResult?.streamUrl) return;

        try {
            await navigator.clipboard.writeText(currentResult.streamUrl);
            els.copyLinkBtn.querySelector('span').textContent = 'Copied!';
            els.copyLinkBtn.querySelector('i').className = 'fa-solid fa-check';
            setTimeout(() => {
                els.copyLinkBtn.querySelector('span').textContent = 'Copy Link';
                els.copyLinkBtn.querySelector('i').className = 'fa-regular fa-copy';
            }, 2000);
        } catch (err) {
            // Fallback
            const textarea = document.createElement('textarea');
            textarea.value = currentResult.streamUrl;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            els.copyLinkBtn.querySelector('span').textContent = 'Copied!';
            setTimeout(() => {
                els.copyLinkBtn.querySelector('span').textContent = 'Copy Link';
            }, 2000);
        }
    }

    // ─── UI STATE ───
    function showLoading(text) {
        setLoadingText(text);
        els.loadingState.classList.remove('hidden');
        els.errorState.classList.add('hidden');
        els.resultState.classList.add('hidden');

        if (typeof gsap !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            gsap.from(els.loadingState, { opacity: 0, y: 10, duration: 0.3 });
        }
    }

    function setLoadingText(text) {
        els.loadingText.textContent = text;
        els.loadingState.classList.remove('hidden');
    }

    function hideLoading() {
        els.loadingState.classList.add('hidden');
    }

    function showError(message, options = {}) {
        // A download failure should not destroy the result the user just
        // fetched — they need it to retry or copy the link.
        const keepResult = options.keepResult === true;
        els.errorMessage.textContent = message;
        els.errorState.classList.remove('hidden');
        if (!keepResult) els.resultState.classList.add('hidden');
        els.loadingState.classList.add('hidden');

        shakeElement(els.errorCard);

        if (typeof gsap !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            gsap.from(els.errorState, { opacity: 0, y: 10, duration: 0.3 });
        }
    }

    function hideError() {
        els.errorState.classList.add('hidden');
    }

    function showResult(result) {
        els.trackTitle.textContent = result.title || 'Unknown';
        els.trackArtist.textContent = result.artist || 'Unknown';

        // Duration
        const durationText = result.duration || '';
        els.trackDuration.querySelector('span').textContent = durationText;
        els.trackDuration.style.display = durationText ? 'flex' : 'none';

        // Platform
        const platformName = result.foundOn || Resolvers.getPlatformName(result.platform);
        const platformIcon = result.platform === 'spotify' ? 'fa-brands fa-spotify' :
                            result.platform === 'youtube' ? 'fa-brands fa-youtube' :
                            Resolvers.getPlatformIcon(result.platform);
        els.trackPlatform.querySelector('i').className = platformIcon;
        els.trackPlatform.querySelector('span').textContent = platformName;

        // Cover art
        if (result.thumbnail) {
            els.coverArt.src = result.thumbnail;
            els.coverArt.alt = `${result.title} cover art`;
            els.coverArt.parentElement.style.display = 'block';
        } else {
            els.coverArt.parentElement.style.display = 'none';
        }

        // Reset progress
        hideProgress();

        // Show any download note (e.g., for YouTube metadata-only results)
        if (result.downloadNote) {
            const noteEl = document.createElement('div');
            noteEl.className = 'download-note text-xs opacity-70 mt-2';
            noteEl.textContent = result.downloadNote;
            // Remove existing note if present
            const existingNote = els.resultCard.querySelector('.download-note');
            if (existingNote) existingNote.remove();
            els.resultCard.querySelector('.meta-info').appendChild(noteEl);
        }

        // Show result
        els.resultState.classList.remove('hidden');
        els.errorState.classList.add('hidden');
        els.loadingState.classList.add('hidden');

        if (typeof gsap !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            gsap.from(els.resultCard, { opacity: 0, y: 20, duration: 0.5, ease: 'power2.out' });
        }
    }

    function hideResult() {
        els.resultState.classList.add('hidden');
    }

    function shakeElement(el) {
        if (typeof gsap !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            gsap.fromTo(el,
                { x: 0 },
                { x: [-10, 10, -10, 10, 0], duration: 0.4, ease: 'power2.inOut' }
            );
        } else {
            el.classList.add('shake');
            setTimeout(() => el.classList.remove('shake'), 500);
        }
    }

    function sanitizeFilename(name) {
        return name
            .replace(/[<>:"/\\|?*]/g, '_')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 200);
    }

    // ─── PUBLIC API ───
    return { init };
})();

// ─── BOOT ───
document.addEventListener('DOMContentLoaded', App.init);
