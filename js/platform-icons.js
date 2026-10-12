(() => {
    const definitions = [
        { match: /\bdiscord\b/i, className: 'ri-discord-fill', color: '#5865F2', short: 'D' },
        { match: /\bfacebook\b/i, className: 'ri-facebook-fill', color: '#0866FF', short: 'f' },
        { match: /\binstagram\b/i, className: 'ri-instagram-fill', color: '#E4405F', short: 'IG' },
        { match: /\bkick\b/i, className: 'ri-kick-fill', color: '#53FC18', short: 'K' },
        { match: /\blinkedin\b/i, className: 'ri-linkedin-fill', color: '#0A66C2', short: 'in' },
        { match: /\bsnapchat\b/i, className: 'ri-snapchat-fill', color: '#FFFC00', short: 'S' },
        { match: /\bsoundcloud\b/i, className: 'ri-soundcloud-fill', color: '#FF5500', short: 'SC' },
        { match: /\bspotify\b/i, className: 'ri-spotify-fill', color: '#1ED760', short: 'S' },
        { match: /\btelegram\b/i, className: 'ri-telegram-fill', color: '#26A5E4', short: 'T' },
        { match: /\btiktok\b/i, className: 'ri-tiktok-fill', color: '#25F4EE', short: '♪' },
        { match: /\btwitch\b/i, className: 'ri-twitch-fill', color: '#9146FF', short: 'T' },
        { match: /^(?:x|twitter)(?:\s*\/\s*(?:twitter|x)|\s*\(\s*(?:twitter|x)\s*\))?$/i, className: 'ri-twitter-x-fill', color: '#E7E9EA', short: 'X' },
        { match: /\byoutube\b/i, className: 'ri-youtube-fill', color: '#FF0033', short: '▶' }
    ];

    function definitionFor(platform) {
        const name = String(platform || '').trim();
        return definitions.find((definition) => definition.match.test(name)) || null;
    }

    function fallbackIcon(platform, variant, definition) {
        const name = String(platform || '').trim();
        const words = name.split(/[\s/_-]+/).filter(Boolean);
        const monogram = definition?.short || words.slice(0, 2).map((word) => word.charAt(0)).join('').toUpperCase() || '?';
        const fallback = document.createElement('span');
        fallback.className = `xdrive-platform-mark xdrive-platform-mark--${variant} xdrive-platform-mark--fallback`;
        fallback.textContent = monogram;
        fallback.setAttribute('aria-hidden', 'true');
        return fallback;
    }

    function create(platform, variant = 'default') {
        const name = String(platform || '').trim();
        const definition = definitionFor(name);
        if (!definition) return fallbackIcon(name, variant, null);

        const icon = document.createElement('i');
        icon.className = `${definition.className} xdrive-platform-mark xdrive-platform-mark--${variant}`;
        icon.style.color = definition.color;
        icon.setAttribute('aria-hidden', 'true');
        return icon;
    }

    function createRefillIcon() {
        const icon = document.createElement('i');
        icon.className = 'ri-refresh-line xdrive-refill-mark';
        icon.setAttribute('aria-hidden', 'true');
        return icon;
    }

    window.XDrivePlatformIcons = { create, createRefillIcon, definitionFor };
})();
