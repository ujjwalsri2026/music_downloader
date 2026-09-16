/* ═══════════════════════════════════════════════════════════════
   FFMPEG-LOADER.JS — Lazy-load ffmpeg.wasm for M4A/WebM → MP3
   ═══════════════════════════════════════════════════════════════ */

const FFmpegLoader = (() => {
    let ffmpeg = null;
    let loaded = false;
    let loading = false;
    let loadPromise = null;

    const FFMPEG_CDN = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js';
    const FFMPEG_UTIL_CDN = 'https://unpkg.com/@ffmpeg/util@0.12.1/dist/umd/index.js';

    function loadScript(url) {
        return new Promise((resolve, reject) => {
            // Check if already loaded
            if (document.querySelector(`script[src="${url}"]`)) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = url;
            script.async = true;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
            document.head.appendChild(script);
        });
    }

    async function load() {
        if (loaded) return ffmpeg;
        if (loading) return loadPromise;
        if (loadPromise) return loadPromise;

        loading = true;

        loadPromise = (async () => {
            try {
                // Load utility first
                await loadScript(FFMPEG_UTIL_CDN);

                // Load ffmpeg
                await loadScript(FFMPEG_CDN);

                const { FFmpeg } = window.FFmpeg;
                ffmpeg = new FFmpeg();

                // Set up progress callback
                ffmpeg.on('progress', ({ progress }) => {
                    const event = new CustomEvent('ffmpeg-progress', { detail: { progress } });
                    window.dispatchEvent(event);
                });

                ffmpeg.on('log', ({ message }) => {
                    console.log('[ffmpeg]', message);
                });

                // Load the WASM binary
                const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
                await ffmpeg.load({
                    coreURL: `${baseURL}/ffmpeg-core.js`,
                    wasmURL: `${baseURL}/ffmpeg-core.wasm`,
                });

                loaded = true;
                loading = false;
                return ffmpeg;
            } catch (err) {
                console.error('FFmpeg load failed:', err);
                loading = false;
                loaded = false;
                loadPromise = null;
                throw err;
            }
        })();

        return loadPromise;
    }

    async function convertToMP3(inputBlob, onProgress) {
        if (!loaded) {
            throw new Error('FFmpeg not loaded');
        }

        const inputName = 'input_audio';
        const outputName = 'output.mp3';

        // Write input file
        const inputData = new Uint8Array(await inputBlob.arrayBuffer());
        await ffmpeg.writeFile(inputName, inputData);

        // Convert to MP3
        await ffmpeg.exec([
            '-i', inputName,
            '-codec:a', 'libmp3lame',
            '-b:a', '192k',
            '-q:a', '2',
            outputName
        ]);

        // Read output
        const outputData = await ffmpeg.readFile(outputName);

        // Clean up
        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile(outputName);

        return new Blob([outputData.buffer], { type: 'audio/mpeg' });
    }

    function isLoaded() {
        return loaded;
    }

    function isLoading() {
        return loading;
    }

    return {
        load,
        convertToMP3,
        isLoaded,
        isLoading
    };
})();
