const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const dotenv = require('dotenv');
const { createCatalogStore } = require('./catalog-store');
const { createOrderStore } = require('./order-store');
const { MoreThanPanelClient } = require('./morethanpanel-client');
const { registerCommerceRoutes } = require('./commerce-routes');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const app = express();
app.set('trust proxy', 1);
const allowedOrigins = new Set(
    (process.env.XDRIVE_ALLOWED_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
);

app.use((request, response, next) => {
    const origin = request.get('Origin');
    response.vary('Origin');

    if (origin && allowedOrigins.has(origin)) {
        response.set('Access-Control-Allow-Origin', origin);
        response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        response.set('Access-Control-Allow-Headers', 'Accept, Content-Type, Authorization, Idempotency-Key, X-XDrive-Order-Token');
        response.set('Access-Control-Max-Age', '600');
        if (request.method === 'OPTIONS') return response.sendStatus(204);
    } else if (origin || request.method === 'OPTIONS') {
        return response.status(403).json({ error: 'Origin is not allowed.' });
    }

    next();
});

app.use(express.json({
    limit: '1mb',
    verify: (request, response, buffer) => {
        if (request.path === '/api/payments/webhook') request.rawBody = Buffer.from(buffer);
    }
}));
app.use(express.urlencoded({ extended: true }));

const siteRoot = path.resolve(__dirname, '..');
let catalogStore;
let orderStore;
let postgresStores = null;
let catalogCache = null;
let storeReady;
if (process.env.DATABASE_URL) {
    const { createPostgresStores } = require('./postgres-store');
    postgresStores = createPostgresStores(process.env.DATABASE_URL);
    catalogStore = postgresStores.catalogStore;
    orderStore = postgresStores.orderStore;
    storeReady = postgresStores.initialize().then(async () => {
        catalogCache = await catalogStore.getCatalog();
    });
} else {
    const databasePath = process.env.XDRIVE_DATABASE_PATH || path.resolve(siteRoot, 'data', 'xdrive.sqlite');
    catalogStore = createCatalogStore(databasePath);
    orderStore = createOrderStore(databasePath);
    catalogCache = catalogStore.getCatalog();
    storeReady = Promise.resolve();
}

app.use('/api', async (request, response, next) => {
    try {
        await storeReady;
        return next();
    } catch (error) {
        console.error('Database initialization failed:', error.message);
        return response.status(503).json({ error: 'The X-Drive data store is temporarily unavailable.' });
    }
});

const mtpClient = new MoreThanPanelClient(
    process.env.MORETHANPANEL_API_KEY,
    'https://morethanpanel.com/api/v2'
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

let refreshInFlight = null;

registerCommerceRoutes(app, {
    orderStore,
    getCatalog: () => catalogCache,
    allowedOrigins
});

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

const mockProviderServices = [
    { service: 'mock-ig-followers', name: 'Instagram Followers · Mock', category: 'Instagram Followers', rate: '1.20', min: '50', max: '10000', refill: true },
    { service: 'mock-ig-likes', name: 'Instagram Likes · Mock', category: 'Instagram Likes', rate: '0.45', min: '10', max: '50000', refill: false },
    { service: 'mock-tt-views', name: 'TikTok Views · Mock', category: 'TikTok Views', rate: '0.18', min: '100', max: '1000000', refill: false },
    { service: 'mock-yt-views', name: 'YouTube Views · Mock', category: 'YouTube Views', rate: '2.50', min: '100', max: '500000', refill: false },
    { service: 'mock-fb-followers', name: 'Facebook Followers · Mock', category: 'Facebook Followers', rate: '1.75', min: '50', max: '25000', refill: true },
    { service: 'mock-spotify-plays', name: 'Spotify Plays · Mock', category: 'Spotify Plays', rate: '0.80', min: '100', max: '100000', refill: false }
];

async function refreshCatalog() {
    if (refreshInFlight) return refreshInFlight;
    await storeReady;

    const useMockCatalog = process.env.XDRIVE_USE_MOCK_CATALOG === 'true';
    const apiKey = process.env.MORETHANPANEL_API_KEY;
    const markupPercent = getMarkupPercent();
    if (markupPercent === null || (!useMockCatalog && !apiKey)) return false;

    refreshInFlight = (async () => {
        try {
            if (useMockCatalog) {
                const services = mockProviderServices
                    .map((service) => normalizeProviderService(service, markupPercent))
                    .filter(Boolean);
                if (!services.length) throw new Error('Mock catalog has no supported services');

                catalogCache = await catalogStore.saveCatalog({
                    source: 'mock',
                    updatedAt: new Date().toISOString(),
                    services
                });
                console.warn(`Local mock catalog loaded: ${services.length} services. Provider calls and orders are disabled in this mode.`);
                return true;
            }

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

            catalogCache = await catalogStore.saveCatalog({
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

app.post('/api/storefront/orders', async (request, response) => {
    try {
        const { serviceId, link, quantity, customerEmail } = request.body;

        if (!serviceId || !link || !quantity || !customerEmail) {
            return response.status(400).json({ error: 'Missing required fields: serviceId, link, quantity, customerEmail' });
        }

        if (!catalogCache) {
            return response.status(503).json({ error: 'Service catalog is not available' });
        }

        const service = catalogCache.services.find(s => s.id === serviceId);
        if (!service) {
            return response.status(404).json({ error: 'Service not found' });
        }

        if (catalogCache.source === 'mock') {
            return response.status(409).json({ error: 'Orders are disabled while the local mock catalog is active.' });
        }

        const quantityNum = Number(quantity);
        if (!Number.isInteger(quantityNum) || quantityNum < (service.minimum || 1)) {
            return response.status(400).json({ error: `Quantity must be at least ${service.minimum || 1}` });
        }

        if (service.maximum && quantityNum > service.maximum) {
            return response.status(400).json({ error: `Quantity cannot exceed ${service.maximum}` });
        }

        const charge = Number(((quantityNum / 1000) * service.pricePer1000).toFixed(2));
        const orderId = `xd-order-${crypto.randomBytes(16).toString('hex')}`;

        const order = await orderStore.createOrder({
            id: orderId,
            customerEmail,
            serviceId: service.id,
            serviceTitle: service.title,
            platform: service.platform,
            link,
            quantity: quantityNum,
            charge,
            refillable: service.refillable
        });

        const providerServiceId = catalogCache.services
            .find(s => s.id === serviceId)
            ? await getProviderServiceId(serviceId)
            : null;

        if (!providerServiceId) {
            return response.status(500).json({ error: 'Unable to process order. Provider service not available.' });
        }

        try {
            const providerOrder = await mtpClient.createOrder({
                service: providerServiceId,
                link,
                quantity: quantityNum
            });

            await orderStore.updateOrderWithProviderData(orderId, providerOrder);

            response.status(201).json({
                success: true,
                order: await orderStore.getOrder(orderId)
            });
        } catch (providerError) {
            console.error('Provider order creation failed:', providerError);
            return response.status(500).json({ error: 'Failed to place order with provider' });
        }
    } catch (error) {
        console.error('Order creation error:', error);
        response.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/storefront/orders/:orderId', async (request, response) => {
    try {
        const { orderId } = request.params;
        const order = await orderStore.getOrder(orderId);

        if (!order) {
            return response.status(404).json({ error: 'Order not found' });
        }

        if (order.providerOrderId) {
            try {
                const providerStatus = await mtpClient.getOrderStatus(order.providerOrderId);
                await orderStore.updateOrderStatus(orderId, providerStatus);
                const updatedOrder = await orderStore.getOrder(orderId);
                response.json({ order: updatedOrder });
            } catch (providerError) {
                response.json({ order });
            }
        } else {
            response.json({ order });
        }
    } catch (error) {
        console.error('Order status error:', error);
        response.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/storefront/orders', async (request, response) => {
    try {
        const { email } = request.query;

        if (!email) {
            return response.status(400).json({ error: 'Email parameter is required' });
        }

        const orders = await orderStore.getOrdersByEmail(email);
        response.json({ orders });
    } catch (error) {
        console.error('Orders retrieval error:', error);
        response.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/storefront/orders/:orderId/history', async (request, response) => {
    try {
        const { orderId } = request.params;
        const order = await orderStore.getOrder(orderId);

        if (!order) {
            return response.status(404).json({ error: 'Order not found' });
        }

        const history = await orderStore.getOrderStatusHistory(orderId);
        response.json({ history });
    } catch (error) {
        console.error('Order history error:', error);
        response.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/storefront/orders/:orderId/refill', async (request, response) => {
    try {
        const { orderId } = request.params;
        const order = await orderStore.getOrder(orderId);

        if (!order) {
            return response.status(404).json({ error: 'Order not found' });
        }

        if (!order.refillable) {
            return response.status(400).json({ error: 'This order is not refillable' });
        }

        if (!order.providerOrderId) {
            return response.status(400).json({ error: 'Order has not been processed yet' });
        }

        const refillResponse = await mtpClient.refillOrder(order.providerOrderId);
        
        if (refillResponse.refill) {
            await orderStore.updateRefillStatus(orderId, refillResponse.refill, 'Pending');
        }

        response.json({
            success: true,
            refill: refillResponse
        });
    } catch (error) {
        console.error('Refill request error:', error);
        response.status(500).json({ error: error.message || 'Internal server error' });
    }
});

app.post('/api/storefront/orders/:orderId/cancel', async (request, response) => {
    try {
        const { orderId } = request.params;
        const order = await orderStore.getOrder(orderId);

        if (!order) {
            return response.status(404).json({ error: 'Order not found' });
        }

        if (!order.providerOrderId) {
            return response.status(400).json({ error: 'Order has not been processed yet' });
        }

        if (['Completed', 'Canceled', 'Refunded'].includes(order.status)) {
            return response.status(400).json({ error: `Cannot cancel order with status: ${order.status}` });
        }

        const cancelResponse = await mtpClient.cancelOrder(order.providerOrderId);
        await orderStore.markCancelRequested(orderId);

        response.json({
            success: true,
            cancel: cancelResponse
        });
    } catch (error) {
        console.error('Cancel request error:', error);
        response.status(500).json({ error: error.message || 'Internal server error' });
    }
});

app.get('/api/admin/balance', async (request, response) => {
    try {
        const balance = await mtpClient.getBalance();
        response.json({ balance });
    } catch (error) {
        console.error('Balance check error:', error);
        response.status(500).json({ error: 'Failed to retrieve balance' });
    }
});

app.post('/api/admin/sync-services', async (request, response) => {
    try {
        const success = await refreshCatalog();
        if (success) {
            response.json({
                success: true,
                message: 'Services synchronized successfully',
                serviceCount: catalogCache?.services?.length || 0
            });
        } else {
            response.status(500).json({ error: 'Failed to sync services' });
        }
    } catch (error) {
        console.error('Service sync error:', error);
        response.status(500).json({ error: 'Internal server error' });
    }
});

async function getProviderServiceId(publicServiceId) {
    const catalogData = catalogCache;
    if (!catalogData || !catalogData.services.some((service) => service.id === publicServiceId)) return null;
    return catalogStore.getProviderServiceId(publicServiceId);
}

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

let server = null;
storeReady.then(() => {
    server = app.listen(port, () => {
        console.info(`X Drive is available at http://localhost:${port}`);
        void refreshCatalog();
    });
}).catch(async (error) => {
    console.error('Data store initialization failed; the server was not started:', error.message);
    if (postgresStores) await postgresStores.close().catch(() => {});
    process.exitCode = 1;
});

async function shutdown() {
    clearInterval(weeklyRefreshTimer);
    if (server) await new Promise((resolve) => server.close(resolve));
    if (postgresStores) {
        await postgresStores.close();
    } else {
        catalogStore.close();
        orderStore.close();
    }
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
