/* ═══════════════════════════════════════════════════════════════
   APP.JS — Main Application Logic, URL Detection, Download Flow
   ═══════════════════════════════════════════════════════════════ */

const App = (() => {
    // DOM Elements
    const els = {};
    let currentResult = null;
    let isDownloading = false;

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
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleFetch();
            if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) handleFetch();
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

        showLoading('Resolving track...');
        hideError();
        hideResult();

        try {
            const result = await Resolvers.resolve(url);
            currentResult = result;
            showResult(result);
        } catch (err) {
            showError(err.message || 'Failed to resolve the URL. Please try another link.');
        } finally {
            hideLoading();
        }
    }

    // ─── DOWNLOAD ───
    async function handleDownload() {
        if (!currentResult || isDownloading) return;

        isDownloading = true;
        els.downloadBtn.disabled = true;

        try {
            let audioBlob;

            if (currentResult.streamUrl) {
                // Check if it's a JioSaavn CDN direct MP3 (saavncdn.com)
                const isDirect = currentResult.streamUrl.includes('saavncdn.com') ||
                                 currentResult.streamUrl.includes('.mp3') ||
                                 !currentResult.needsConversion;

                if (isDirect) {
                    audioBlob = await fetchWithProgress(currentResult.streamUrl);
                } else {
                    // Fetch via CORS proxy
                    audioBlob = await fetchWithProgressViaProxy(currentResult.streamUrl);
                }

                // Convert if needed and ffmpeg is available
                if (currentResult.needsConversion && audioBlob) {
                    const canConvert = await ensureFFmpeg();
                    if (canConvert) {
                        showProgress('Converting to MP3...', 0);
                        try {
                            audioBlob = await FFmpegLoader.convertToMP3(audioBlob, (progress) => {
                                showProgress('Converting to MP3...', Math.round(progress * 100));
                            });
                        } catch (convErr) {
                            console.warn('FFmpeg conversion failed:', convErr);
                            showProgress('Download complete (raw format)', 100);
                        }
                    } else {
                        showProgress('Download complete (raw format)', 100);
                    }
                }

                // Trigger download
                if (audioBlob) {
                    triggerDownload(audioBlob);
                }
            }
        } catch (err) {
            showError('Download failed: ' + (err.message || 'Unknown error'));
        } finally {
            isDownloading = false;
            els.downloadBtn.disabled = false;
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
    async function fetchWithProgress(url) {
        showProgress('Downloading...', 0);

        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
        const reader = response.body.getReader();
        const chunks = [];
        let received = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            chunks.push(value);
            received += value.length;

            if (contentLength > 0) {
                const percent = Math.round((received / contentLength) * 100);
                const mbReceived = (received / (1024 * 1024)).toFixed(1);
                const mbTotal = (contentLength / (1024 * 1024)).toFixed(1);
                showProgress('Downloading...', percent, `${mbReceived} MB / ${mbTotal} MB`);
            } else {
                const mbReceived = (received / (1024 * 1024)).toFixed(1);
                showProgress('Downloading...', -1, `${mbReceived} MB`);
            }
        }

        return new Blob(chunks, { type: response.headers.get('content-type') || 'audio/mpeg' });
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
            els.progressBar.style.width = percent + '%';
            els.progressPercent.textContent = percent + '%';
        } else {
            els.progressBar.style.width = '100%';
            els.progressPercent.textContent = '';
        }
        if (sizeText) els.progressSize.textContent = sizeText;
    }

    // ─── TRIGGER DOWNLOAD ───
    function triggerDownload(blob) {
        const filename = sanitizeFilename(`${currentResult.title} - ${currentResult.artist}.mp3`);
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
        els.loadingText.textContent = text;
        els.loadingState.classList.remove('hidden');
        els.errorState.classList.add('hidden');
        els.resultState.classList.add('hidden');

        if (typeof gsap !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            gsap.from(els.loadingState, { opacity: 0, y: 10, duration: 0.3 });
        }
    }

    function hideLoading() {
        els.loadingState.classList.add('hidden');
    }

    function showError(message) {
        els.errorMessage.textContent = message;
        els.errorState.classList.remove('hidden');
        els.resultState.classList.add('hidden');
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
        els.progressContainer.classList.add('hidden');
        els.progressBar.style.width = '0%';

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
