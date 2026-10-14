const crypto = require('node:crypto');
const {
    createSessionTokens,
    hashOpaqueToken,
    hashPassword,
    isValidEmail,
    normalizeEmail,
    validatePassword,
    verifyPassword
} = require('./auth');
const {
    PaystackClient,
    toMinorUnits,
    validateReference,
    validateVerifiedTransaction,
    verifyWebhookSignature
} = require('./paystack-client');
const {
    getSupabaseUserFromToken,
    hasSupabaseConfig
} = require('./supabase-auth');

const CURRENCY = 'USD';
const MINOR_DIGITS = 2;
const KNOWN_PROVIDER_STATUSES = new Set(['pending', 'ongoing', 'processing', 'queued', 'failed', 'abandoned', 'reversed']);

function safeCustomer(customer) {
    return customer ? { id: customer.id, email: customer.email, createdAt: customer.createdAt } : null;
}

function publicOrder(order) {
    if (!order) return null;
    return {
        id: order.id,
        serviceId: order.serviceId,
        serviceTitle: order.serviceTitle,
        platform: order.platform,
        link: order.link,
        quantity: order.quantity,
        charge: order.charge,
        startCount: order.startCount,
        remains: order.remains,
        status: order.status,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        refillable: order.refillable === true
    };
}

function validIdempotencyKey(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{16,100}$/.test(value);
}

function validGuestTrackingToken(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

function getDepositLimits() {
    const min = Number.parseInt(process.env.XDRIVE_DEPOSIT_MIN_MINOR || '100', 10);
    const max = Number.parseInt(process.env.XDRIVE_DEPOSIT_MAX_MINOR || '500000', 10);
    return {
        minMinor: Number.isSafeInteger(min) && min > 0 ? min : 100,
        maxMinor: Number.isSafeInteger(max) && max >= min ? max : 500000
    };
}

function createWindowLimiter() {
    const attempts = new Map();
    return function isLimited(key, limit, windowMs) {
        const now = Date.now();
        const recent = (attempts.get(key) || []).filter((timestamp) => now - timestamp < windowMs);
        if (recent.length >= limit) {
            attempts.set(key, recent);
            return true;
        }
        recent.push(now);
        attempts.set(key, recent);
        if (attempts.size > 10000) {
            for (const [entryKey, timestamps] of attempts) {
                if (!timestamps.some((timestamp) => now - timestamp < windowMs)) attempts.delete(entryKey);
            }
        }
        return false;
    };
}

function getConfiguredCurrency() {
    const configured = (process.env.XDRIVE_PAYMENT_CURRENCY || CURRENCY).trim();
    return /^[A-Z]{3}$/i.test(configured) ? configured.toUpperCase() : CURRENCY;
}

function registerCommerceRoutes(app, { orderStore, getCatalog, allowedOrigins }) {
    const secretKey = process.env.PAYSTACK_SECRET_KEY || '';
    const paystackClient = new PaystackClient(secretKey);
    const allowlistedOrigins = allowedOrigins instanceof Set ? allowedOrigins : new Set();
    const isLimited = createWindowLimiter();
    const configuredCurrency = getConfiguredCurrency();

    function paymentRuntime() {
        const callbackUrl = process.env.XDRIVE_PAYSTACK_CALLBACK_URL || '';
        let callback;
        try { callback = new URL(callbackUrl); } catch { callback = null; }
        const callbackValid = Boolean(callback && callback.protocol === 'https:' && allowlistedOrigins.has(callback.origin));
        const enabled = process.env.XDRIVE_PAYMENTS_ENABLED === 'true';
        const modeIsTest = (process.env.XDRIVE_PAYSTACK_MODE || 'test') === 'test';
        const testKeyOnly = /^sk_test_[A-Za-z0-9]+$/.test(secretKey);
        const currencyMatchesCatalog = configuredCurrency.toUpperCase() === (process.env.XDRIVE_PAYMENT_CURRENCY || configuredCurrency).toUpperCase();
        const ready = enabled && modeIsTest && testKeyOnly && callbackValid && currencyMatchesCatalog;
        return { ready, callbackUrl, enabled, modeIsTest, testKeyOnly, callbackValid, currencyMatchesCatalog, currency: configuredCurrency };
    }

    function requireCustomer(request, response, next) {
        if (!request.xdriveCustomer) {
            return response.status(401).json({ error: 'Sign in to continue.', loginRequired: true });
        }
        return next();
    }

    function runtimeError(response) {
        return response.status(503).json({
            error: 'Paystack test checkout is disabled until the server has test-mode credentials and a configured callback URL.',
            livePaymentsEnabled: false,
            realFulfillmentEnabled: false
        });
    }

    async function getServiceOrder(input, customer) {
        const catalog = await getCatalog();
        if (!catalog || !Array.isArray(catalog.services)) {
            const error = new Error('The X Drive service catalog is not available.');
            error.statusCode = 503;
            throw error;
        }
        if (catalog.source === 'mock') {
            const error = new Error('Orders cannot be purchased from the local mock catalog.');
            error.statusCode = 409;
            throw error;
        }

        const service = catalog.services.find((candidate) => candidate.id === input.serviceId && candidate.enabled !== false);
        if (!service) {
            const error = new Error('The selected service is not available.');
            error.statusCode = 404;
            throw error;
        }

        const quantity = Number(input.quantity);
        const minimum = Number.isFinite(service.minimum) ? service.minimum : 1;
        const maximum = Number.isFinite(service.maximum) ? service.maximum : Number.MAX_SAFE_INTEGER;
        const link = typeof input.link === 'string' ? input.link.trim() : '';
        if (!Number.isSafeInteger(quantity) || quantity < minimum || quantity > maximum) {
            const error = new Error(`Quantity must be between ${minimum.toLocaleString()} and ${maximum.toLocaleString()}.`);
            error.statusCode = 400;
            throw error;
        }
        if (!link || link.length > 2048 || /[\u0000-\u001f]/.test(link)) {
            const error = new Error('Enter a valid target link or username.');
            error.statusCode = 400;
            throw error;
        }

        const pricePer1000 = Number(service.pricePer1000);
        if (!Number.isFinite(pricePer1000) || pricePer1000 <= 0) {
            const error = new Error('The selected service has no valid price.');
            error.statusCode = 409;
            throw error;
        }
        const majorAmount = Number(((quantity / 1000) * pricePer1000).toFixed(MINOR_DIGITS));
        const amountMinor = toMinorUnits(majorAmount, MINOR_DIGITS);
        const customerEmail = customer?.email || normalizeEmail(input.customerEmail);
        if (!isValidEmail(customerEmail)) {
            const error = new Error('Enter a valid email address.');
            error.statusCode = 400;
            throw error;
        }

        return {
            order: {
                id: `xd-order-${crypto.randomBytes(16).toString('hex')}`,
                customerEmail,
                customerId: customer?.id || null,
                serviceId: service.id,
                serviceTitle: service.title,
                platform: service.platform,
                link,
                quantity,
                charge: majorAmount,
                refillable: service.refillable === true
            },
            amountMinor
        };
    }

    app.use(async (request, response, next) => {
        if (!request.path.startsWith('/api/')) return next();
        const authorization = request.get('Authorization') || '';
        const match = authorization.match(/^Bearer\s+([A-Za-z0-9_-]{43,128})$/);
        const tokenHash = match ? hashOpaqueToken(match[1]) : null;
        const session = tokenHash ? await orderStore.getSessionByTokenHash(tokenHash) : null;
        if (session) {
            request.xdriveSession = session;
            request.xdriveCustomer = { id: session.customerId, email: session.email };
            return next();
        }

        if (hasSupabaseConfig()) {
            const user = await getSupabaseUserFromToken(authorization);
            if (user?.email) {
                const normalizedEmail = normalizeEmail(user.email);
                let customer = await orderStore.getCustomerByEmail(normalizedEmail);
                if (!customer) {
                    customer = await orderStore.createCustomer({
                        id: crypto.randomUUID(),
                        email: user.email,
                        emailNormalized: normalizedEmail,
                        passwordSalt: 'supabase-auth',
                        passwordHash: 'supabase-auth'
                    });
                }
                request.xdriveCustomer = { id: customer.id, email: customer.email };
                request.xdriveSession = { customerId: customer.id, email: customer.email, tokenHash: 'supabase-auth-session' };
                return next();
            }
        }

        request.xdriveSession = null;
        request.xdriveCustomer = null;
        return next();
    });

    async function getAuthorizedOrder(request, orderId) {
        return orderStore.getAuthorizedOrder(orderId, {
            customerId: request.xdriveCustomer?.id || null,
            trackingTokenHash: hashOpaqueToken(request.get('X-XDrive-Order-Token'))
        });
    }

    // These secure handlers are registered before the legacy handlers in server/index.js.
    app.post('/api/storefront/orders', (request, response) => response.status(410).json({
        error: 'Direct order submission is disabled. Use the payment-gated checkout.'
    }));

    app.get('/api/storefront/orders', requireCustomer, async (request, response) => {
        response.set('Cache-Control', 'no-store');
        response.json({ orders: (await orderStore.getOrdersForCustomer(request.xdriveCustomer.id)).map(publicOrder) });
    });

    app.get('/api/storefront/orders/:orderId/history', async (request, response) => {
        const order = await getAuthorizedOrder(request, request.params.orderId);
        if (!order) return response.status(404).json({ error: 'Order not found.' });
        response.set('Cache-Control', 'no-store');
        return response.json({ history: await orderStore.getOrderStatusHistory(order.id) });
    });

    app.get('/api/storefront/orders/:orderId', async (request, response) => {
        const order = await getAuthorizedOrder(request, request.params.orderId);
        if (!order) return response.status(404).json({ error: 'Order not found.' });
        response.set('Cache-Control', 'no-store');
        return response.json({ order: publicOrder(order) });
    });

    app.post('/api/storefront/orders/:orderId/refill', async (request, response) => {
        const order = await getAuthorizedOrder(request, request.params.orderId);
        if (!order) return response.status(404).json({ error: 'Order not found.' });
        return response.status(503).json({ error: 'Real supplier fulfillment is disabled; no refill request was sent.' });
    });

    app.post('/api/storefront/orders/:orderId/cancel', async (request, response) => {
        const order = await getAuthorizedOrder(request, request.params.orderId);
        if (!order) return response.status(404).json({ error: 'Order not found.' });
        return response.status(503).json({ error: 'Real supplier fulfillment is disabled; no cancellation request was sent.' });
    });

    app.get('/api/security/config', (request, response) => {
        response.set('Cache-Control', 'no-store');
        response.json({
            currency: configuredCurrency,
            paymentEnabled: paymentRuntime().ready,
            livePaymentsEnabled: false,
            realFulfillmentEnabled: false,
            walletEnabled: true,
            walletOrderPaymentsEnabled: process.env.XDRIVE_WALLET_PAYMENTS_ENABLED === 'true',
            guestTrackingEnabled: true,
            depositLimits: getDepositLimits()
        });
    });

    app.post('/api/auth/register', async (request, response) => {
        if (hasSupabaseConfig()) {
            return response.status(410).json({
                error: 'The legacy email/password registration route is disabled. Use Supabase Auth in the browser and keep the Supabase JWT in the Authorization header.'
            });
        }
        const email = normalizeEmail(request.body?.email);
        const password = request.body?.password;
        if (!isValidEmail(email)) return response.status(400).json({ error: 'Enter a valid email address.' });
        const passwordCheck = validatePassword(password);
        if (!passwordCheck.valid) return response.status(400).json({ error: passwordCheck.message });
        if (isLimited(`register:${request.ip || 'unknown'}`, 6, 60 * 60 * 1000)) {
            return response.status(429).json({ error: 'Too many account attempts. Try again later.' });
        }

        try {
            const hashed = await hashPassword(password);
            const customer = await orderStore.createCustomer({
                id: crypto.randomUUID(),
                email,
                emailNormalized: email,
                passwordSalt: hashed.salt,
                passwordHash: hashed.hash
            });
            const tokens = createSessionTokens();
            await orderStore.createSession({ tokenHash: tokens.sessionTokenHash, customerId: customer.id, expiresAt: tokens.expiresAt });
            response.status(201).json({
                customer: safeCustomer(customer),
                accessToken: tokens.sessionToken,
                expiresAt: tokens.expiresAt,
                sessionStorageOnly: true
            });
        } catch (error) {
            if ((error.code === '23505' && error.constraint === 'customers_email_normalized_key') ||
                String(error.message).includes('UNIQUE constraint failed: customers.email_normalized')) {
                return response.status(409).json({ error: 'An account with this email already exists.' });
            }
            console.error('Customer registration failed:', error.message);
            response.status(500).json({ error: 'Unable to create the account right now.' });
        }
    });

    app.post('/api/auth/login', async (request, response) => {
        if (hasSupabaseConfig()) {
            return response.status(410).json({
                error: 'The legacy email/password sign-in route is disabled. Use Supabase Auth in the browser and keep the Supabase JWT in the Authorization header.'
            });
        }
        const email = normalizeEmail(request.body?.email);
        const password = request.body?.password;
        if (!isValidEmail(email) || typeof password !== 'string' || password.length > 128) {
            return response.status(400).json({ error: 'Enter a valid email address and password.' });
        }

        const lookupKey = crypto.createHash('sha256').update(`${email}|${request.ip || 'unknown'}`).digest('hex');
        if (!await orderStore.canAttemptLogin(lookupKey)) {
            return response.status(429).json({ error: 'Too many sign-in attempts. Try again in 15 minutes.' });
        }

        const customer = await orderStore.getCustomerByEmail(email);
        const matches = customer
            ? await verifyPassword(password, customer.passwordSalt, customer.passwordHash)
            : await verifyPassword(password, 'xdrive-dummy-login-salt', '0'.repeat(128));
        if (!customer || !matches) {
            await orderStore.recordFailedLogin(lookupKey);
            return response.status(401).json({ error: 'Email or password is incorrect.' });
        }

        await orderStore.clearLoginAttempts(lookupKey);
        if (request.xdriveSession) await orderStore.deleteSession(request.xdriveSession.tokenHash);
        const tokens = createSessionTokens();
        await orderStore.createSession({ tokenHash: tokens.sessionTokenHash, customerId: customer.id, expiresAt: tokens.expiresAt });
        response.json({
            customer: safeCustomer(customer),
            accessToken: tokens.sessionToken,
            expiresAt: tokens.expiresAt,
            sessionStorageOnly: true
        });
    });

    app.get('/api/auth/me', (request, response) => {
        response.set('Cache-Control', 'no-store');
        response.json({ authenticated: Boolean(request.xdriveCustomer), customer: safeCustomer(request.xdriveCustomer) });
    });

    app.post('/api/auth/logout', async (request, response) => {
        if (request.xdriveSession && request.xdriveSession.tokenHash !== 'supabase-auth-session') {
            await orderStore.deleteSession(request.xdriveSession.tokenHash);
        }
        response.json({ success: true });
    });

    app.get('/api/wallet', requireCustomer, async (request, response) => {
        response.set('Cache-Control', 'no-store');
        response.json({
            ...await orderStore.getWalletSnapshot(request.xdriveCustomer.id, configuredCurrency),
            depositLimits: getDepositLimits(),
            walletOrderPaymentsEnabled: process.env.XDRIVE_WALLET_PAYMENTS_ENABLED === 'true'
        });
    });

    app.post('/api/payments/orders', async (request, response) => {
        const runtime = paymentRuntime();
        if (!runtime.ready) return runtimeError(response);
        if (isLimited(`order-payment:${request.ip || 'unknown'}`, 12, 15 * 60 * 1000)) {
            return response.status(429).json({ error: 'Too many payment attempts. Try again later.' });
        }

        let prepared;
        try {
            prepared = await getServiceOrder(request.body || {}, request.xdriveCustomer);
        } catch (error) {
            return response.status(error.statusCode || 400).json({ error: error.message });
        }

        const idempotencyKey = request.get('Idempotency-Key');
        if (!validIdempotencyKey(idempotencyKey)) {
            return response.status(400).json({ error: 'A unique checkout request key is required.' });
        }
        const guestToken = request.xdriveCustomer ? null : request.body?.trackingToken;
        if (!request.xdriveCustomer && !validGuestTrackingToken(guestToken)) {
            return response.status(400).json({ error: 'A secure guest order tracking token is required.' });
        }

        const reference = `xdp-${crypto.randomBytes(16).toString('hex')}`;
        const orderId = prepared.order.id;
        let created;
        try {
            created = await orderStore.createPendingOrderAndPayment({
                order: prepared.order,
                trackingTokenHash: guestToken ? hashOpaqueToken(guestToken) : null,
                idempotencyKey,
                payment: {
                    id: crypto.randomUUID(),
                    reference,
                    amountMinor: prepared.amountMinor,
                    currency: configuredCurrency
                }
            });
        } catch (error) {
            if (error.code === 'IDEMPOTENCY_CONFLICT') return response.status(409).json({ error: error.message });
            console.error('Could not create pending checkout record:', error.message);
            return response.status(500).json({ error: 'Unable to start checkout.' });
        }

        const payment = created.payment;
        if (!payment || payment.status !== 'pending') {
            return response.status(409).json({ error: 'This checkout attempt is no longer active. Start a new checkout attempt.' });
        }
        if (!created.created && payment.authorizationUrl) {
            return response.json({
                authorizationUrl: payment.authorizationUrl,
                reference: payment.reference,
                orderId: created.order.id,
                trackingToken: guestToken,
                amountMinor: payment.amountMinor,
                currency: payment.currency
            });
        }
        if (!created.created) {
            return response.status(409).json({ error: 'This checkout attempt needs a new request key. Start a new attempt.' });
        }

        try {
            const authorization = await paystackClient.initializeTransaction({
                email: prepared.order.customerEmail,
                amountMinor: prepared.amountMinor,
                currency: configuredCurrency,
                reference,
                callbackUrl: runtime.callbackUrl,
                metadata: { payment_kind: 'order', order_id: orderId }
            });
            await orderStore.storePaymentAuthorization(reference, authorization);
            response.status(201).json({
                authorizationUrl: authorization.authorizationUrl,
                reference,
                orderId,
                trackingToken: guestToken,
                amountMinor: prepared.amountMinor,
                currency: configuredCurrency
            });
        } catch (error) {
            try { await orderStore.markPaymentInitializationFailed(reference); } catch (storeError) {
                console.error('Could not record failed checkout initialization:', storeError.message);
            }
            console.error('Paystack checkout initialization failed:', error.message);
            if (!response.headersSent) response.status(502).json({
                error: error.message || 'Paystack could not start checkout. No service has been submitted.'
            });
        }
    });

    app.post('/api/wallet/deposits', requireCustomer, async (request, response) => {
        const runtime = paymentRuntime();
        if (!runtime.ready) return runtimeError(response);
        if (isLimited(`wallet-deposit:${request.ip || 'unknown'}`, 8, 15 * 60 * 1000)) {
            return response.status(429).json({ error: 'Too many deposit attempts. Try again later.' });
        }
        const amountMinor = Number(request.body?.amountMinor);
        const limits = getDepositLimits();
        if (!Number.isSafeInteger(amountMinor) || amountMinor < limits.minMinor || amountMinor > limits.maxMinor) {
            return response.status(400).json({ error: 'The deposit amount is outside the permitted limits.', depositLimits: limits });
        }
        const idempotencyKey = request.get('Idempotency-Key');
        if (!validIdempotencyKey(idempotencyKey)) return response.status(400).json({ error: 'A unique deposit request key is required.' });

        const reference = `xdw-${crypto.randomBytes(16).toString('hex')}`;
        let created;
        try {
            created = await orderStore.createWalletDepositPayment({
                id: crypto.randomUUID(), reference, idempotencyKey,
                customerId: request.xdriveCustomer.id,
                customerEmail: request.xdriveCustomer.email,
                amountMinor, currency: configuredCurrency
            });
        } catch (error) {
            if (error.code === 'IDEMPOTENCY_CONFLICT') return response.status(409).json({ error: error.message });
            console.error('Could not create wallet deposit record:', error.message);
            return response.status(500).json({ error: 'Unable to start the wallet deposit.' });
        }

        const payment = created.payment;
        if (!payment || payment.status !== 'pending') return response.status(409).json({ error: 'This deposit attempt is no longer active.' });
        if (!created.created && payment.authorizationUrl) {
            return response.json({ authorizationUrl: payment.authorizationUrl, reference: payment.reference, amountMinor: payment.amountMinor, currency: payment.currency });
        }
        if (!created.created) return response.status(409).json({ error: 'This deposit attempt needs a new request key.' });

        try {
            const authorization = await paystackClient.initializeTransaction({
                email: request.xdriveCustomer.email,
                amountMinor,
                currency: configuredCurrency,
                reference,
                callbackUrl: runtime.callbackUrl,
                metadata: { payment_kind: 'wallet_deposit', customer_id: request.xdriveCustomer.id }
            });
            await orderStore.storePaymentAuthorization(reference, authorization);
            response.status(201).json({ authorizationUrl: authorization.authorizationUrl, reference, amountMinor, currency: configuredCurrency });
        } catch (error) {
            try { await orderStore.markPaymentInitializationFailed(reference); } catch (storeError) {
                console.error('Could not record failed deposit initialization:', storeError.message);
            }
            console.error('Paystack wallet deposit initialization failed:', error.message);
            if (!response.headersSent) response.status(502).json({ error: 'Paystack could not start the deposit. No wallet balance was added.' });
        }
    });

    app.post('/api/wallet/orders', requireCustomer, async (request, response) => {
        if (process.env.XDRIVE_WALLET_PAYMENTS_ENABLED !== 'true') {
            return response.status(503).json({ error: 'Wallet order payments are disabled until explicitly enabled.' });
        }
        let prepared;
        try {
            prepared = await getServiceOrder(request.body || {}, request.xdriveCustomer);
        } catch (error) {
            return response.status(error.statusCode || 400).json({ error: error.message });
        }
        const idempotencyKey = request.get('Idempotency-Key');
        if (!validIdempotencyKey(idempotencyKey)) return response.status(400).json({ error: 'A unique checkout request key is required.' });

        try {
            const result = await orderStore.createWalletOrderAndDebit({
                order: prepared.order,
                amountMinor: prepared.amountMinor,
                currency: configuredCurrency,
                idempotencyKey
            });
            return response.status(result.created ? 201 : 200).json({
                order: publicOrder(result.order),
                balance: await orderStore.getWalletSnapshot(request.xdriveCustomer.id, configuredCurrency)
            });
        } catch (error) {
            if (error.code === 'INSUFFICIENT_WALLET_FUNDS') return response.status(409).json({ error: error.message });
            if (error.code === 'IDEMPOTENCY_CONFLICT') return response.status(409).json({ error: error.message });
            console.error('Wallet order failed:', error.message);
            return response.status(500).json({ error: 'Unable to pay from wallet.' });
        }
    });

    app.post('/api/payments/verify', async (request, response) => {
        const runtime = paymentRuntime();
        if (!runtime.ready) return runtimeError(response);
        const reference = request.body?.reference;
        if (!validateReference(reference)) return response.status(400).json({ error: 'A valid transaction reference is required.' });

        const payment = await orderStore.getPayment(reference);
        const trackingTokenHash = hashOpaqueToken(request.body?.trackingToken);
        const authorizedPayment = await orderStore.getAuthorizedPayment(reference, {
            customerId: request.xdriveCustomer?.id || null,
            trackingTokenHash
        });
        if (!payment || !authorizedPayment) return response.status(404).json({ error: 'Payment not found.' });
        if (payment.status === 'paid') {
            return response.json({ status: 'paid', kind: payment.kind, orderId: payment.orderId, amountMinor: payment.amountMinor, currency: payment.currency });
        }

        let transaction;
        try {
            transaction = await paystackClient.verifyTransaction(reference);
        } catch (error) {
            console.error('Paystack transaction verification request failed:', error.message);
            return response.status(502).json({ error: 'Payment status is not confirmed yet. Retry verification shortly.' });
        }

        if (transaction.status !== 'success') {
            const status = KNOWN_PROVIDER_STATUSES.has(transaction.status) ? transaction.status : 'pending';
            await orderStore.updatePaymentStatus(reference, status);
            return response.json({ status, verified: false, kind: payment.kind, orderId: payment.orderId });
        }

        try {
            validateVerifiedTransaction(transaction, {
                reference: payment.reference,
                amountMinor: payment.amountMinor,
                currency: payment.currency
            });
        } catch (error) {
            await orderStore.updatePaymentStatus(reference, 'mismatch');
            console.error('Verified Paystack transaction did not match the pending record:', error.message);
            return response.status(409).json({ error: 'Payment details could not be matched. Contact X Drive support; no wallet credit or service fulfillment was issued.' });
        }

        try {
            await orderStore.settleVerifiedPayment(reference, String(transaction.id || ''));
            return response.json({
                status: 'paid',
                verified: true,
                kind: payment.kind,
                orderId: payment.orderId,
                amountMinor: payment.amountMinor,
                currency: payment.currency,
                realFulfillmentEnabled: false
            });
        } catch (error) {
            console.error('Verified payment settlement failed:', error.message);
            return response.status(500).json({ error: 'Payment was verified but could not be recorded. Contact X Drive support before retrying.' });
        }
    });

    app.post('/api/payments/webhook', async (request, response) => {
        if (!secretKey || !verifyWebhookSignature(request.rawBody, request.get('x-paystack-signature'), secretKey)) {
            return response.sendStatus(401);
        }
        const event = request.body;
        if (!event || event.event !== 'charge.success' || !validateReference(event.data?.reference)) {
            return response.sendStatus(200);
        }
        const reference = event.data.reference;
        const payment = await orderStore.getPayment(reference);
        if (!payment) return response.sendStatus(200);

        try {
            const transaction = await paystackClient.verifyTransaction(reference);
            if (transaction.status !== 'success') {
                const status = KNOWN_PROVIDER_STATUSES.has(transaction.status) ? transaction.status : 'pending';
                await orderStore.updatePaymentStatus(reference, status);
                return response.sendStatus(200);
            }
            try {
                validateVerifiedTransaction(transaction, {
                    reference: payment.reference,
                    amountMinor: payment.amountMinor,
                    currency: payment.currency
                });
            } catch (error) {
                await orderStore.updatePaymentStatus(reference, 'mismatch');
                console.error('Signed Paystack event failed verification checks:', error.message);
                return response.sendStatus(200);
            }
            await orderStore.settleVerifiedPayment(reference, String(transaction.id || ''));
            return response.sendStatus(200);
        } catch (error) {
            console.error('Paystack webhook verification or settlement failed; provider may retry:', error.message);
            return response.sendStatus(503);
        }
    });
}

module.exports = { publicOrder, registerCommerceRoutes };
