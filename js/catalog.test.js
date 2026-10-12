const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const catalogScript = fs.readFileSync(path.join(__dirname, 'catalog.js'), 'utf8');

function createCatalog(payload) {
    const window = {
        XDRIVE_API_BASE_URL: 'https://api.example.test',
        location: { protocol: 'https:' }
    };
    const context = {
        window,
        fetch: async () => ({
            ok: true,
            json: async () => payload
        }),
        console: { warn() {} }
    };

    vm.runInNewContext(catalogScript, context, { filename: 'catalog.js' });
    return window.XDriveCatalog;
}

test('brandText replaces provider names, spelling variants, and MTP for display', () => {
    const catalog = createCatalog({ source: 'morethanpanel', services: [] });

    assert.equal(
        catalog.brandText('MoreThanPanel / Morethanpannel / More Than Panel / MTP'),
        'X-Drive / X-Drive / X-Drive / X-Drive'
    );
});

test('brandText removes leading colored feed dots while preserving country flags', () => {
    const catalog = createCatalog({ source: 'morethanpanel', services: [] });

    assert.equal(catalog.brandText('🟢 🇧🇷 Instagram service'), '🇧🇷 Instagram service');
    assert.equal(catalog.brandText('🔵 Services for Gamers'), 'Services for Gamers');
});

test('live service display text is branded without changing provider IDs or prices', async () => {
    const serviceId = 'provider-service-418';
    const catalog = createCatalog({
        source: 'morethanpanel',
        updatedAt: '2026-10-12T00:00:00.000Z',
        services: [{
            id: serviceId,
            platform: 'Instagram',
            title: '🟢 🇧🇷 MTP Instagram Non-drop Views from MoreThanPanel Guaranteed Fast Start',
            category: '🔵 Morethanpannel Views',
            description: '🔵 MTP service by More Than Panel',
            pricePer1000: 1.25,
            minimum: 10,
            maximum: 10000,
            refillable: true,
            enabled: true
        }, {
            id: 'provider-service-refill-title',
            platform: 'Instagram',
            title: '🟢 Instagram Views | 30 Day Refill |',
            category: '🔵 Instagram Views',
            description: 'Views for Instagram',
            pricePer1000: 2.5,
            minimum: 10,
            maximum: 2000,
            refillable: false,
            enabled: true
        }]
    });

    const result = await catalog.load();
    const [service, refillConflict] = result.services;

    assert.equal(result.source, 'morethanpanel');
    assert.equal(service.id, serviceId);
    assert.equal(service.pricePer1000, 1.25);
    assert.equal(service.title, '🇧🇷 X-Drive Instagram Non-drop Views from X-Drive Guaranteed Fast Start');
    assert.equal(service.category, 'X-Drive Views');
    assert.equal(service.description, 'X-Drive service by X-Drive');
    assert.equal(service.refillable, true);
    assert.equal(service.nonDrop, true);
    assert.equal(service.guaranteed, true);
    assert.equal(service.fastStart, true);
    assert.equal(refillConflict.refillable, false);
    assert.equal(refillConflict.refillMentioned, true);
});
