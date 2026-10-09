const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const dotenv = require('dotenv');
const { createCatalogStore } = require('./catalog-store');
const { createOrderStore } = require('./order-store');
const { MoreThanPanelClient } = require('./morethanpanel-client');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const siteRoot = path.resolve(__dirname, '..');
const catalogStore = createCatalogStore(
    process.env.XDRIVE_DATABASE_PATH || path.resolve(siteRoot, 'data', 'xdrive.sqlite')
);
const orderStore = createOrderStore(
    process.env.XDRIVE_DATABASE_PATH || path.resolve(siteRoot, 'data', 'xdrive.sqlite')
);
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

        const quantityNum = Number(quantity);
        if (!Number.isInteger(quantityNum) || quantityNum < (service.minimum || 1)) {
            return response.status(400).json({ error: `Quantity must be at least ${service.minimum || 1}` });
        }

        if (service.maximum && quantityNum > service.maximum) {
            return response.status(400).json({ error: `Quantity cannot exceed ${service.maximum}` });
        }

        const charge = Number(((quantityNum / 1000) * service.pricePer1000).toFixed(2));
        const orderId = `xd-order-${crypto.randomBytes(16).toString('hex')}`;

        const order = orderStore.createOrder({
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

            orderStore.updateOrderWithProviderData(orderId, providerOrder);

            response.status(201).json({
                success: true,
                order: orderStore.getOrder(orderId)
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
        const order = orderStore.getOrder(orderId);

        if (!order) {
            return response.status(404).json({ error: 'Order not found' });
        }

        if (order.providerOrderId) {
            try {
                const providerStatus = await mtpClient.getOrderStatus(order.providerOrderId);
                orderStore.updateOrderStatus(orderId, providerStatus);
                const updatedOrder = orderStore.getOrder(orderId);
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

        const orders = orderStore.getOrdersByEmail(email);
        response.json({ orders });
    } catch (error) {
        console.error('Orders retrieval error:', error);
        response.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/storefront/orders/:orderId/history', (request, response) => {
    try {
        const { orderId } = request.params;
        const order = orderStore.getOrder(orderId);

        if (!order) {
            return response.status(404).json({ error: 'Order not found' });
        }

        const history = orderStore.getOrderStatusHistory(orderId);
        response.json({ history });
    } catch (error) {
        console.error('Order history error:', error);
        response.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/storefront/orders/:orderId/refill', async (request, response) => {
    try {
        const { orderId } = request.params;
        const order = orderStore.getOrder(orderId);

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
            orderStore.updateRefillStatus(orderId, refillResponse.refill, 'Pending');
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
        const order = orderStore.getOrder(orderId);

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
        orderStore.markCancelRequested(orderId);

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
    const db = catalogStore;
    const catalogData = db.getCatalog();
    if (!catalogData) return null;
    
    const serviceEntry = catalogData.services.find(s => s.id === publicServiceId);
    if (!serviceEntry) return null;
    
    const dbPath = process.env.XDRIVE_DATABASE_PATH || path.resolve(siteRoot, 'data', 'xdrive.sqlite');
    const { DatabaseSync } = require('node:sqlite');
    const database = new DatabaseSync(dbPath);
    
    try {
        const stmt = database.prepare('SELECT provider_service_id FROM catalog_services WHERE public_id = ?');
        const result = stmt.get(publicServiceId);
        database.close();
        return result?.provider_service_id || null;
    } catch {
        database.close();
        return null;
    }
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

const server = app.listen(port, () => {
    console.info(`X Drive is available at http://localhost:${port}`);
    void refreshCatalog();
});

function shutdown() {
    clearInterval(weeklyRefreshTimer);
    server.close(() => {
        catalogStore.close();
        orderStore.close();
        process.exit(0);
    });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);