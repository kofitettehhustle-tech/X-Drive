const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const dotenv = require('dotenv');
const { createCatalogStore } = require('./catalog-store');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const app = express();
const siteRoot = path.resolve(__dirname, '..');
const catalogStore = createCatalogStore(
    process.env.XDRIVE_DATABASE_PATH || path.resolve(siteRoot, 'data', 'xdrive.sqlite')
);
const moreThanPanelEndpoint = 'https://morethanpanel.com/api/v2';
const weeklyRefreshMs = 7 * 24 * 60 * 60 * 1000;
const platformMatchers = [
    [/instagram/i, 'Instagram'],
    [/tiktok/i, 'TikTok'],
    [/youtube/i, 'YouTube'],
    [/facebook/i, 'Facebook'],
    [/twitter|(^|[^a-z0-9])x([^a-z0-9]|$)/i, 'X'],
    [/telegram/i, 'Telegram'],
    [/spotify/i, 'Spotify'],
    [/soundcloud/i, 'SoundCloud'],
    [/snapchat/i, 'Snapchat'],
    [/discord/i, 'Discord'],
    [/twitch/i, 'Twitch'],
    [/(^|[^a-z0-9])kick([^a-z0-9]|$)/i, 'Kick'],
    [/linkedin/i, 'LinkedIn']
];

let catalogCache = catalogStore.getCatalog();
let refreshInFlight = null;

function getMarkupPercent() {
    const configuredMarkup = process.env.XDRIVE_MARKUP_PERCENT;
    if (typeof configuredMarkup !== 'string' || configuredMarkup.trim() === '') return null;

    const markup = Number(configuredMarkup);
    return Number.isFinite(markup) && markup >= 0 ? markup : null;
}

function detectPlatform(service) {
    const searchableName = `${service.name || ''} ${service.category || ''} ${service.type || ''}`;
    return platformMatchers.find(([pattern]) => pattern.test(searchableName))?.[1] || null;
}

function normalizeProviderService(service, markupPercent) {
    const providerServiceId = String(service.service ?? '').trim();
    const platform = detectPlatform(service);
    const title = String(service.name || '').trim();
    const supplierRate = Number(service.rate);
    const minimum = Number(service.min);
    const maximum = Number(service.max);

    if (!providerServiceId || !platform || !title || !Number.isFinite(supplierRate) || supplierRate < 0) {
        return null;
    }

    const publicId = `xd-${crypto.createHash('sha256').update(providerServiceId).digest('hex').slice(0, 16)}`;
    const category = String(service.category || service.type || 'Platform service').trim();
    const customerPricePer1000 = Number((supplierRate * (1 + markupPercent / 100)).toFixed(4));

    return {
        public: {
            id: publicId,
            platform,
            title,
            category,
            description: `${category} for ${platform}`,
            pricePer1000: customerPricePer1000,
            minimum: Number.isFinite(minimum) ? minimum : null,
            maximum: Number.isFinite(maximum) ? maximum : null,
            refillable: service.refill === true,
            deliveryEstimate: '',
            enabled: true
        },
        providerServiceId
    };
}

async function refreshCatalog() {
    if (refreshInFlight) return refreshInFlight;

    const apiKey = process.env.MORETHANPANEL_API_KEY;
    const markupPercent = getMarkupPercent();
    if (!apiKey || markupPercent === null) return false;

    refreshInFlight = (async () => {
        try {
            const response = await fetch(moreThanPanelEndpoint, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({ key: apiKey, action: 'services' }),
                signal: AbortSignal.timeout(20000)
            });

            if (!response.ok) throw new Error('Provider catalog request failed');

            const providerServices = await response.json();
            if (!Array.isArray(providerServices)) throw new Error('Provider returned an invalid catalog');

            const normalizedServices = providerServices
                .map((service) => normalizeProviderService(service, markupPercent))
                .filter(Boolean);

            if (!normalizedServices.length) throw new Error('Provider catalog has no supported services');

            catalogCache = catalogStore.saveCatalog({
                source: 'morethanpanel',
                updatedAt: new Date().toISOString(),
                services: normalizedServices
            });
            console.info(`Catalog refreshed: ${normalizedServices.length} services.`);
            return true;
        } catch {
            console.error('Morethanpanel catalog refresh failed; the current cache was retained.');
            return false;
        } finally {
            refreshInFlight = null;
        }
    })();

    return refreshInFlight;
}

app.get('/api/storefront/catalog', (request, response) => {
    if (!catalogCache) {
        response.status(503).json({ error: 'The X Drive service catalog is not available yet.' });
        return;
    }

    response.set('Cache-Control', 'public, max-age=300');
    response.json({
        source: catalogCache.source,
        updatedAt: catalogCache.updatedAt,
        services: catalogCache.services
    });
});

app.use(express.static(siteRoot, {
    dotfiles: 'deny',
    index: 'index.html',
    maxAge: '1h'
}));

const port = Number(process.env.PORT) || 3000;
const weeklyRefreshTimer = setInterval(() => {
    void refreshCatalog();
}, weeklyRefreshMs);
weeklyRefreshTimer.unref();

const server = app.listen(port, () => {
    console.info(`X Drive is available at http://localhost:${port}`);
    void refreshCatalog();
});

function shutdown() {
    clearInterval(weeklyRefreshTimer);
    server.close(() => {
        catalogStore.close();
        process.exit(0);
    });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);