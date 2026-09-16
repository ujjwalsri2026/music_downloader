/* ═══════════════════════════════════════════════════════════════
   PARTICLES.JS — Background Particle Systems (Per Theme)
   ═══════════════════════════════════════════════════════════════ */

const ParticleSystem = (() => {
    const container = () => document.getElementById('particles-container');
    let currentParticles = [];
    let currentTheme = null;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function clearParticles() {
        currentParticles.forEach(p => {
            if (p.el && p.el.parentNode) p.el.parentNode.removeChild(p.el);
        });
        currentParticles = [];
    }

    function createGlassmorphismParticles() {
        if (prefersReducedMotion) return;
        const count = 15;
        for (let i = 0; i < count; i++) {
            const el = document.createElement('div');
            el.className = 'particle';
            const size = Math.random() * 20 + 10;
            const x = Math.random() * 100;
            const startY = Math.random() * 100;
            const hue = Math.random() > 0.5 ? 180 : 270;
            el.style.cssText = `
                width: ${size}px;
                height: ${size}px;
                left: ${x}%;
                top: ${startY}%;
                background: hsla(${hue}, 80%, 60%, 0.15);
                filter: blur(${size / 2}px);
            `;
            container().appendChild(el);
            currentParticles.push({ el });

            if (typeof gsap !== 'undefined') {
                gsap.to(el, {
                    y: -(200 + Math.random() * 400),
                    x: (Math.random() - 0.5) * 100,
                    opacity: 0,
                    duration: 8 + Math.random() * 8,
                    repeat: -1,
                    ease: 'none',
                    delay: Math.random() * 5,
                    onRepeat: function() {
                        gsap.set(el, {
                            y: 0,
                            x: 0,
                            opacity: 0.15,
                            left: Math.random() * 100 + '%',
                            top: (80 + Math.random() * 20) + '%'
                        });
                    }
                });
            }
        }
    }

    function createMidCenturyParticles() {
        if (prefersReducedMotion) return;
        const shapes = ['circle', 'triangle'];
        const colors = ['#E8A838', '#2E8B8B', '#D4652F'];

        for (let i = 0; i < 8; i++) {
            const el = document.createElement('div');
            el.className = 'particle';
            const size = 15 + Math.random() * 25;
            const x = Math.random() * 100;
            const y = Math.random() * 100;
            const color = colors[Math.floor(Math.random() * colors.length)];
            const shape = shapes[Math.floor(Math.random() * shapes.length)];

            el.style.cssText = `
                width: ${size}px;
                height: ${size}px;
                left: ${x}%;
                top: ${y}%;
                background: ${color};
                opacity: 0.12;
                ${shape === 'circle' ? 'border-radius: 50%;' : 'clip-path: polygon(50% 0%, 100% 100%, 0% 100%);'}
            `;
            container().appendChild(el);
            currentParticles.push({ el });

            if (typeof gsap !== 'undefined') {
                gsap.to(el, {
                    rotation: 360,
                    duration: 30,
                    repeat: -1,
                    ease: 'none',
                    delay: Math.random() * 5
                });
                gsap.to(el, {
                    y: -20 + Math.random() * 40,
                    duration: 4 + Math.random() * 4,
                    repeat: -1,
                    yoyo: true,
                    ease: 'sine.inOut',
                    delay: Math.random() * 3
                });
            }
        }
    }

    function createBauhausParticles() {
        if (prefersReducedMotion) return;
        const colors = ['#E63946', '#1D3557', '#F4D35E'];
        const shapes = [
            { type: 'circle', size: 40 },
            { type: 'square', size: 35 },
            { type: 'triangle', size: 45 }
        ];

        shapes.forEach((shape, i) => {
            const el = document.createElement('div');
            el.className = 'particle';
            const color = colors[i % colors.length];
            el.style.cssText = `
                width: ${shape.size}px;
                height: ${shape.size}px;
                left: ${15 + i * 30}%;
                top: ${20 + (i % 2) * 50}%;
                background: ${color};
                opacity: 0.15;
                ${shape.type === 'circle' ? 'border-radius: 50%;' : ''}
                ${shape.type === 'triangle' ? 'clip-path: polygon(50% 0%, 100% 100%, 0% 100%);' : ''}
            `;
            container().appendChild(el);
            currentParticles.push({ el });

            if (typeof gsap !== 'undefined') {
                gsap.to(el, {
                    scale: 1.1,
                    opacity: 0.2,
                    duration: 3,
                    repeat: -1,
                    yoyo: true,
                    ease: 'sine.inOut',
                    delay: i * 0.5
                });
            }
        });
    }

    function createMemphisParticles() {
        if (prefersReducedMotion) return;
        const decorTypes = [
            { emoji: '★', color: '#FFE66D' },
            { emoji: '✦', color: '#4ECDC4' },
            { emoji: '+', color: '#FF006E' },
            { emoji: '~', color: '#8338EC' },
            { emoji: '●', color: '#000000' },
            { emoji: '◆', color: '#FFE66D' },
        ];

        for (let i = 0; i < 12; i++) {
            const decor = decorTypes[i % decorTypes.length];
            const el = document.createElement('div');
            el.className = 'particle';
            const x = Math.random() * 100;
            const y = Math.random() * 100;
            el.textContent = decor.emoji;
            el.style.cssText = `
                left: ${x}%;
                top: ${y}%;
                font-size: ${12 + Math.random() * 16}px;
                color: ${decor.color};
                opacity: 0.2;
                pointer-events: none;
            `;
            container().appendChild(el);
            currentParticles.push({ el });

            if (typeof gsap !== 'undefined') {
                const animName = `memphisFloat${(i % 3) + 1}`;
                const dur = 2 + Math.random() * 3;
                gsap.to(el, {
                    y: -10 + Math.random() * 20,
                    x: -10 + Math.random() * 20,
                    rotation: -15 + Math.random() * 30,
                    duration: dur,
                    repeat: -1,
                    yoyo: true,
                    ease: 'sine.inOut',
                    delay: Math.random() * 2
                });
            }
        }
    }

    function createLuxuryParticles() {
        if (prefersReducedMotion) return;

        // Gold line sliding across top
        const line = document.createElement('div');
        line.className = 'luxury-gold-line';
        line.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 1px;
            background: linear-gradient(90deg, transparent, #C9A96E, transparent);
            opacity: 0.3;
            z-index: 100;
            pointer-events: none;
        `;
        container().appendChild(line);
        currentParticles.push({ el: line });

        if (typeof gsap !== 'undefined') {
            gsap.fromTo(line,
                { x: '-100%' },
                {
                    x: '100%',
                    duration: 4,
                    repeat: -1,
                    ease: 'none',
                    delay: 1
                }
            );
        }
    }

    function changeTheme(theme) {
        if (theme === currentTheme) return;
        currentTheme = theme;
        clearParticles();

        switch (theme) {
            case 'glassmorphism':
                createGlassmorphismParticles();
                break;
            case 'midcentury':
                createMidCenturyParticles();
                break;
            case 'bauhaus':
                createBauhausParticles();
                break;
            case 'memphis':
                createMemphisParticles();
                break;
            case 'luxury':
                createLuxuryParticles();
                break;
        }
    }

    function init() {
        const theme = document.documentElement.getAttribute('data-theme') || 'glassmorphism';
        changeTheme(theme);
    }

    return { init, changeTheme };
})();
