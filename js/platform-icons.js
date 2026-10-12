(() => {
    const definitions = [
        { match: /\bdiscord\b/i, slug: 'discord', color: '5865F2', short: 'D' },
        { match: /\bfacebook\b/i, slug: 'facebook', color: '0866FF', short: 'f' },
        { match: /\binstagram\b/i, slug: 'instagram', color: 'E4405F', short: 'IG' },
        { match: /\bkick\b/i, slug: 'kick', color: '53FC18', short: 'K' },
        { match: /\blinkedin\b/i, slug: 'linkedin', color: '0A66C2', short: 'in' },
        { match: /\bsnapchat\b/i, slug: 'snapchat', color: 'FFFC00', short: 'S' },
        { match: /\bsoundcloud\b/i, slug: 'soundcloud', color: 'FF5500', short: 'SC' },
        { match: /\bspotify\b/i, slug: 'spotify', color: '1ED760', short: 'S' },
        { match: /\btelegram\b/i, slug: 'telegram', color: '26A5E4', short: 'T' },
        { match: /\btiktok\b/i, slug: 'tiktok', color: '25F4EE', short: '♪' },
        { match: /\btwitch\b/i, slug: 'twitch', color: '9146FF', short: 'T' },
        { match: /^(?:x|twitter)(?:\s*\/\s*(?:twitter|x)|\s*\(\s*(?:twitter|x)\s*\))?$/i, slug: 'x', color: 'E7E9EA', short: 'X' },
        { match: /\byoutube\b/i, slug: 'youtube', color: 'FF0033', short: '▶' }
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

        const image = document.createElement('img');
        image.className = `xdrive-platform-mark xdrive-platform-mark--${variant}`;
        image.alt = '';
        image.setAttribute('aria-hidden', 'true');
        image.loading = 'lazy';
        image.decoding = 'async';
        image.referrerPolicy = 'no-referrer';
        image.addEventListener('error', () => image.replaceWith(fallbackIcon(name, variant, definition)), { once: true });
        image.src = `https://cdn.simpleicons.org/${definition.slug}/${definition.color}`;
        return image;
    }

    window.XDrivePlatformIcons = { create, definitionFor };
})();
