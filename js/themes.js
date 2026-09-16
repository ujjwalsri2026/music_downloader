/* ═══════════════════════════════════════════════════════════════
   THEMES.JS — Theme Cycling, GSAP Transitions
   ═══════════════════════════════════════════════════════════════ */

const ThemeManager = (() => {
    const THEMES = ['glassmorphism', 'midcentury', 'bauhaus', 'memphis', 'luxury'];
    const THEME_NAMES = {
        glassmorphism: 'Glassmorphism',
        midcentury: 'Mid-Century',
        bauhaus: 'Bauhaus',
        memphis: 'Memphis',
        luxury: 'Luxury'
    };
    const THEME_ACCENTS = {
        glassmorphism: '#00f5ff',
        midcentury: '#E8A838',
        bauhaus: '#E63946',
        memphis: '#FFE66D',
        luxury: '#C9A96E'
    };

    let currentTheme = null;
    let cycleInterval = null;
    let isTransitioning = false;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function getRandomTheme(exclude) {
        const available = THEMES.filter(t => t !== exclude);
        return available[Math.floor(Math.random() * available.length)];
    }

    function setTheme(theme, animate = true) {
        if (isTransitioning || theme === currentTheme) return;
        isTransitioning = true;

        const html = document.documentElement;
        const themeLabel = document.getElementById('theme-label');
        const themeDot = document.getElementById('theme-dot');

        const doTransition = () => {
            // Fade out
            if (animate && !prefersReducedMotion && typeof gsap !== 'undefined') {
                gsap.to('#app', {
                    opacity: 0,
                    duration: 0.4,
                    ease: 'power2.in',
                    onComplete: () => {
                        html.setAttribute('data-theme', theme);
                        currentTheme = theme;
                        themeDot.style.background = THEME_ACCENTS[theme];
                        themeLabel.textContent = THEME_NAMES[theme];

                        gsap.fromTo('#app', { opacity: 0 }, {
                            opacity: 1,
                            duration: 0.4,
                            ease: 'power2.out',
                            onComplete: () => {
                                isTransitioning = false;
                            }
                        });

                        // Show theme label
                        gsap.fromTo(themeLabel,
                            { opacity: 0, y: 10 },
                            {
                                opacity: 0.6,
                                y: 0,
                                duration: 0.4,
                                ease: 'power2.out',
                                onComplete: () => {
                                    gsap.to(themeLabel, {
                                        opacity: 0,
                                        delay: 1.5,
                                        duration: 0.4
                                    });
                                }
                            }
                        );
                    }
                });
            } else {
                html.setAttribute('data-theme', theme);
                currentTheme = theme;
                themeDot.style.background = THEME_ACCENTS[theme];
                themeLabel.textContent = THEME_NAMES[theme];
                isTransitioning = false;
            }

            // Update particles
            if (typeof ParticleSystem !== 'undefined') {
                ParticleSystem.changeTheme(theme);
            }
        };

        doTransition();
    }

    function nextTheme() {
        const next = getRandomTheme(currentTheme);
        setTheme(next, true);
    }

    function startCycle() {
        if (cycleInterval) clearInterval(cycleInterval);
        cycleInterval = setInterval(nextTheme, 12000);
    }

    function stopCycle() {
        if (cycleInterval) {
            clearInterval(cycleInterval);
            cycleInterval = null;
        }
    }

    function init() {
        // Pick random starting theme
        const startTheme = THEMES[Math.floor(Math.random() * THEMES.length)];
        document.documentElement.setAttribute('data-theme', startTheme);
        currentTheme = startTheme;

        const themeDot = document.getElementById('theme-dot');
        if (themeDot) {
            themeDot.style.background = THEME_ACCENTS[startTheme];
        }

        // Theme toggle button
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => {
                stopCycle();
                nextTheme();
                startCycle();
            });
        }

        // Start auto-cycling
        startCycle();
    }

    return {
        init,
        setTheme,
        nextTheme,
        startCycle,
        stopCycle,
        getCurrentTheme: () => currentTheme,
        THEMES,
        THEME_NAMES,
        THEME_ACCENTS
    };
})();
