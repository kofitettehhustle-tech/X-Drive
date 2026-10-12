const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, 'platform-icons.js'), 'utf8');

class FakeElement {
    constructor(tagName) {
        this.tagName = tagName.toUpperCase();
        this.attributes = {};
        this.style = {};
    }

    setAttribute(name, value) {
        this.attributes[name] = value;
    }
}

function loadIcons() {
    const window = {};
    const document = { createElement: (tagName) => new FakeElement(tagName) };
    vm.runInNewContext(script, { window, document }, { filename: 'platform-icons.js' });
    return window.XDrivePlatformIcons;
}

test('maps catalog platform names to Remix Icon brand glyph classes', () => {
    const icons = loadIcons();
    const expected = {
        Discord: 'ri-discord-fill',
        Facebook: 'ri-facebook-fill',
        Instagram: 'ri-instagram-fill',
        Kick: 'ri-kick-fill',
        LinkedIn: 'ri-linkedin-fill',
        Snapchat: 'ri-snapchat-fill',
        SoundCloud: 'ri-soundcloud-fill',
        Spotify: 'ri-spotify-fill',
        Telegram: 'ri-telegram-fill',
        TikTok: 'ri-tiktok-fill',
        Twitch: 'ri-twitch-fill',
        X: 'ri-twitter-x-fill',
        YouTube: 'ri-youtube-fill'
    };

    for (const [platform, className] of Object.entries(expected)) {
        assert.equal(icons.definitionFor(platform)?.className, className, platform);
    }
    assert.equal(icons.definitionFor('Twitter')?.className, 'ri-twitter-x-fill');
    assert.equal(icons.definitionFor('Unknown Platform'), null);
});

test('creates accessible, brand-colored Remix font icons and a refill glyph', () => {
    const icons = loadIcons();
    const platformIcon = icons.create('Instagram', 'filter');

    assert.equal(platformIcon.tagName, 'I');
    assert.equal(platformIcon.className, 'ri-instagram-fill xdrive-platform-mark xdrive-platform-mark--filter');
    assert.equal(platformIcon.style.color, '#E4405F');
    assert.equal(platformIcon.attributes['aria-hidden'], 'true');

    const refillIcon = icons.createRefillIcon();
    assert.equal(refillIcon.className, 'ri-refresh-line xdrive-refill-mark');
    assert.equal(refillIcon.attributes['aria-hidden'], 'true');

    const fallback = icons.create('Unknown Platform', 'filter');
    assert.equal(fallback.tagName, 'SPAN');
    assert.equal(fallback.textContent, 'UP');
});
