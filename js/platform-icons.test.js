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
        this.listeners = {};
    }

    setAttribute(name, value) {
        this.attributes[name] = value;
    }

    addEventListener(name, callback) {
        this.listeners[name] = callback;
    }

    replaceWith(element) {
        this.replacedWith = element;
    }
}

function loadIcons() {
    const window = {};
    const document = { createElement: (tagName) => new FakeElement(tagName) };
    vm.runInNewContext(script, { window, document }, { filename: 'platform-icons.js' });
    return window.XDrivePlatformIcons;
}

test('maps every catalog platform to its matching Simple Icons brand slug', () => {
    const icons = loadIcons();
    const expected = {
        Discord: 'discord',
        Facebook: 'facebook',
        Instagram: 'instagram',
        Kick: 'kick',
        LinkedIn: 'linkedin',
        Snapchat: 'snapchat',
        SoundCloud: 'soundcloud',
        Spotify: 'spotify',
        Telegram: 'telegram',
        TikTok: 'tiktok',
        Twitch: 'twitch',
        X: 'x',
        YouTube: 'youtube'
    };

    for (const [platform, slug] of Object.entries(expected)) {
        assert.equal(icons.definitionFor(platform)?.slug, slug, platform);
    }
    assert.equal(icons.definitionFor('Twitter')?.slug, 'x');
    assert.equal(icons.definitionFor('Unknown Platform'), null);
});

test('creates a color-branded image and falls back to a monogram if the CDN image fails', () => {
    const icons = loadIcons();
    const image = icons.create('Instagram', 'filter');

    assert.equal(image.tagName, 'IMG');
    assert.equal(image.src, 'https://cdn.simpleicons.org/instagram/E4405F');
    assert.equal(image.loading, 'lazy');
    assert.equal(image.attributes['aria-hidden'], 'true');

    image.listeners.error();
    assert.equal(image.replacedWith.tagName, 'SPAN');
    assert.equal(image.replacedWith.textContent, 'IG');
});
