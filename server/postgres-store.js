const crypto = require('node:crypto');

const ORDER_COLUMNS = `id, provider_order_id, customer_email, customer_id, service_id, service_title,
    platform, link, quantity, charge, start_count, remains, status, payment_status, payment_method,
    payment_reference, tracking_token_hash, checkout_idempotency_key, created_at, updated_at,
    refillable, refill_id, refill_status, cancel_requested`;
const PAYMENT_COLUMNS = `id, reference, idempotency_key, kind, customer_id, order_id, customer_email,
    amount_minor, currency, status, payment_method, authorization_url, access_code,
    provider_transaction_id, created_at, updated_at, verified_at`;

function createPostgresStores(connectionString) {
    if (typeof connectionString !== 'string' || !connectionString.startsWith('postgres')) {
        throw new TypeError('A PostgreSQL DATABASE_URL is required.');
    }

    const { Pool } = require('pg');
    const pool = new Pool({
        connectionString,
        max: 4,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
        ssl: { rejectUnauthorized: true }
    });
    pool.on('error', (error) => console.error('Idle PostgreSQL client error:', error.message));

    async function initializeCatalog() {
        const statements = [
            `CREATE TABLE IF NOT EXISTS catalog_metadata (
                id INTEGER PRIMARY KEY CHECK (id = 1), source TEXT NOT NULL, updated_at TEXT NOT NULL
            )`,
            `CREATE TABLE IF NOT EXISTS catalog_services (
                public_id TEXT PRIMARY KEY, provider_service_id TEXT NOT NULL, platform TEXT NOT NULL,
                title TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL,
                price_per_1000 DOUBLE PRECISION NOT NULL CHECK (price_per_1000 >= 0),
                minimum INTEGER, maximum INTEGER, refillable BOOLEAN NOT NULL DEFAULT FALSE,
                delivery_estimate TEXT NOT NULL DEFAULT '', enabled BOOLEAN NOT NULL DEFAULT TRUE
            )`,
            `CREATE INDEX IF NOT EXISTS catalog_services_platform_idx
                ON catalog_services (platform, enabled, price_per_1000)`
        ];
        for (const sql of statements) await pool.query(sql);
    }

    async function getCatalog() {
        const metadataResult = await pool.query('SELECT source, updated_at FROM catalog_metadata WHERE id = 1');
        const metadata = metadataResult.rows[0];
        if (!metadata) return null;
        const result = await pool.query(`
            SELECT public_id, platform, title, category, description, price_per_1000,
                   minimum, maximum, refillable, delivery_estimate, enabled
            FROM catalog_services WHERE enabled = TRUE
            ORDER BY lower(platform), price_per_1000 ASC, lower(title)
        `);
        return {
            source: metadata.source,
            updatedAt: metadata.updated_at,
            services: result.rows.map((service) => ({
                id: service.public_id,
                platform: service.platform,
                title: service.title,
                category: service.category,
                description: service.description,
                pricePer1000: Number(service.price_per_1000),
                minimum: service.minimum,
                maximum: service.maximum,
                refillable: Boolean(service.refillable),
                deliveryEstimate: service.delivery_estimate,
                enabled: Boolean(service.enabled)
            }))
        };
    }

    async function saveCatalog(catalog) {
        if (!['morethanpanel', 'mock'].includes(catalog?.source) || !catalog.updatedAt || !Array.isArray(catalog.services) || catalog.services.length === 0) {
            throw new TypeError('A complete provider or explicitly tagged mock catalog is required.');
        }
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('DELETE FROM catalog_services');
            await client.query(`
                INSERT INTO catalog_metadata (id, source, updated_at) VALUES (1, $1, $2)
                ON CONFLICT (id) DO UPDATE SET source = EXCLUDED.source, updated_at = EXCLUDED.updated_at
            `, [catalog.source, catalog.updatedAt]);
            for (const service of catalog.services) {
                await client.query(`
                    INSERT INTO catalog_services (
                        public_id, provider_service_id, platform, title, category, description,
                        price_per_1000, minimum, maximum, refillable, delivery_estimate, enabled
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                `, [
                    service.public.id, service.providerServiceId, service.public.platform,
                    service.public.title, service.public.category, service.public.description,
                    service.public.pricePer1000, service.public.minimum, service.public.maximum,
                    service.public.refillable === true, service.public.deliveryEstimate || '',
                    service.public.enabled !== false
                ]);
            }
            await client.query('COMMIT');
        } catch (error) {
            try { await client.query('ROLLBACK'); } catch { /* Preserve the original error. */ }
            throw error;
        } finally {
            client.release();
        }
        return getCatalog();
    }

    async function getProviderServiceId(publicId) {
        const result = await pool.query('SELECT provider_service_id FROM catalog_services WHERE public_id = $1', [publicId]);
        return result.rows[0]?.provider_service_id || null;
    }

    const catalogStore = {
        initialize: initializeCatalog,
        getCatalog,
        saveCatalog,
        getProviderServiceId,
        close: async () => {}
    };

    const allowedPaymentStatuses = new Set([
        'pending', 'ongoing', 'processing', 'queued', 'failed', 'abandoned', 'reversed',
        'mismatch', 'initialization_failed', 'paid'
    ]);

    async function withTransaction(work) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const result = await work(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            try { await client.query('ROLLBACK'); } catch { /* Preserve the original error. */ }
            throw error;
        } finally {
            client.release();
        }
    }

    function mapOrder(order) {
        if (!order) return null;
        return {
            id: order.id,
            providerOrderId: order.provider_order_id,
            customerEmail: order.customer_email,
            customerId: order.customer_id || null,
            serviceId: order.service_id,
            serviceTitle: order.service_title,
            platform: order.platform,
            link: order.link,
            quantity: Number(order.quantity),
            charge: Number(order.charge),
            startCount: order.start_count === null ? null : Number(order.start_count),
            remains: order.remains === null ? null : Number(order.remains),
            status: order.status,
            paymentStatus: order.payment_status || 'legacy',
            paymentMethod: order.payment_method || null,
            paymentReference: order.payment_reference || null,
            trackingTokenHash: order.tracking_token_hash || null,
            checkoutIdempotencyKey: order.checkout_idempotency_key || null,
            createdAt: order.created_at,
            updatedAt: order.updated_at,
            refillable: Boolean(order.refillable),
            refillId: order.refill_id,
            refillStatus: order.refill_status,
            cancelRequested: Boolean(order.cancel_requested)
        };
    }

    function mapPayment(payment) {
        if (!payment) return null;
        return {
            id: payment.id,
            reference: payment.reference,
            idempotencyKey: payment.idempotency_key,
            kind: payment.kind,
            customerId: payment.customer_id || null,
            orderId: payment.order_id || null,
            customerEmail: payment.customer_email,
            amountMinor: Number(payment.amount_minor),
            currency: payment.currency,
            status: payment.status,
            paymentMethod: payment.payment_method || 'paystack',
            authorizationUrl: payment.authorization_url,
            accessCode: payment.access_code,
            providerTransactionId: payment.provider_transaction_id,
            createdAt: payment.created_at,
            updatedAt: payment.updated_at,
            verifiedAt: payment.verified_at
        };
    }

    async function selectOrder(orderId, client = pool) {
        const result = await client.query(`SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1`, [orderId]);
        return result.rows[0] || null;
    }

    async function selectPayment(reference, client = pool, forUpdate = false) {
        const result = await client.query(`SELECT ${PAYMENT_COLUMNS} FROM commerce_payments WHERE reference = $1${forUpdate ? ' FOR UPDATE' : ''}`, [reference]);
        return result.rows[0] || null;
    }

    async function getOrder(orderId, client = pool) {
        return mapOrder(await selectOrder(orderId, client));
    }

    async function getPayment(reference, client = pool) {
        return mapPayment(await selectPayment(reference, client));
    }

    async function getPaymentForOrder(orderId, client = pool) {
        const result = await client.query(`
            SELECT reference FROM commerce_payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1
        `, [orderId]);
        return result.rows[0] ? getPayment(result.rows[0].reference, client) : null;
    }

    async function initializeOrderStore() {
        const statements = [
            `CREATE TABLE IF NOT EXISTS customers (
                id TEXT PRIMARY KEY, email TEXT NOT NULL, email_normalized TEXT NOT NULL UNIQUE,
                password_salt TEXT NOT NULL, password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            )`,
            `CREATE INDEX IF NOT EXISTS customers_email_idx ON customers (email_normalized)`,
            `CREATE TABLE IF NOT EXISTS orders (
                id TEXT PRIMARY KEY, provider_order_id TEXT UNIQUE, customer_email TEXT NOT NULL,
                service_id TEXT NOT NULL, service_title TEXT NOT NULL, platform TEXT NOT NULL, link TEXT NOT NULL,
                quantity INTEGER NOT NULL CHECK (quantity > 0), charge DOUBLE PRECISION NOT NULL CHECK (charge >= 0),
                start_count INTEGER, remains INTEGER, status TEXT NOT NULL DEFAULT 'Pending',
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL, refillable BOOLEAN NOT NULL DEFAULT FALSE,
                refill_id TEXT, refill_status TEXT, cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
                customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
                payment_status TEXT NOT NULL DEFAULT 'legacy', payment_method TEXT, payment_reference TEXT,
                tracking_token_hash TEXT, checkout_idempotency_key TEXT UNIQUE
            )`,
            `CREATE INDEX IF NOT EXISTS orders_customer_email_idx ON orders (customer_email, created_at DESC)`,
            `CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status, updated_at DESC)`,
            `CREATE INDEX IF NOT EXISTS orders_provider_order_id_idx ON orders (provider_order_id)`,
            `CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders (customer_id, created_at DESC)`,
            `CREATE TABLE IF NOT EXISTS customer_sessions (
                token_hash TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL
            )`,
            `CREATE INDEX IF NOT EXISTS customer_sessions_customer_idx ON customer_sessions (customer_id, expires_at)`,
            `CREATE TABLE IF NOT EXISTS auth_attempts (
                lookup_key TEXT PRIMARY KEY, attempts INTEGER NOT NULL,
                window_started_at DOUBLE PRECISION NOT NULL, blocked_until DOUBLE PRECISION NOT NULL DEFAULT 0
            )`,
            `CREATE TABLE IF NOT EXISTS commerce_payments (
                id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE, idempotency_key TEXT UNIQUE,
                kind TEXT NOT NULL CHECK (kind IN ('order', 'wallet_deposit')),
                customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
                order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
                customer_email TEXT NOT NULL, amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
                currency TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
                payment_method TEXT NOT NULL DEFAULT 'paystack', authorization_url TEXT, access_code TEXT,
                provider_transaction_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, verified_at TEXT
            )`,
            `CREATE INDEX IF NOT EXISTS commerce_payments_customer_idx ON commerce_payments (customer_id, created_at DESC)`,
            `CREATE INDEX IF NOT EXISTS commerce_payments_order_idx ON commerce_payments (order_id)`,
            `CREATE TABLE IF NOT EXISTS wallet_ledger (
                id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
                reference TEXT NOT NULL UNIQUE, amount_minor BIGINT NOT NULL CHECK (amount_minor <> 0),
                currency TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('deposit', 'order_debit', 'adjustment')),
                order_id TEXT REFERENCES orders(id) ON DELETE SET NULL, created_at TEXT NOT NULL
            )`,
            `CREATE INDEX IF NOT EXISTS wallet_ledger_customer_idx ON wallet_ledger (customer_id, currency, created_at DESC)`,
            `CREATE TABLE IF NOT EXISTS order_status_history (
                id BIGSERIAL PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
                status TEXT NOT NULL, remains INTEGER, start_count INTEGER, recorded_at TEXT NOT NULL
            )`,
            `CREATE INDEX IF NOT EXISTS order_status_history_order_id_idx ON order_status_history (order_id, recorded_at DESC)`
        ];
        for (const sql of statements) await pool.query(sql);
    }

    async function createOrder(order) {
        const now = new Date().toISOString();
        await pool.query(`
            INSERT INTO orders (id, customer_email, service_id, service_title, platform, link, quantity, charge,
                status, created_at, updated_at, refillable)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Pending', $9, $9, $10)
        `, [order.id, order.customerEmail, order.serviceId, order.serviceTitle, order.platform,
            order.link, order.quantity, order.charge, now, order.refillable === true]);
        return getOrder(order.id);
    }

    async function createPendingOrderAndPayment({ order, payment, trackingTokenHash, idempotencyKey }) {
        return withTransaction(async (client) => {
            const now = new Date().toISOString();
            const inserted = await client.query(`
                INSERT INTO orders (id, customer_email, service_id, service_title, platform, link, quantity, charge,
                    status, created_at, updated_at, refillable, customer_id, payment_status, payment_method,
                    payment_reference, tracking_token_hash, checkout_idempotency_key)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Pending', $9, $9, $10, $11,
                    'pending', 'paystack', $12, $13, $14)
                ON CONFLICT (checkout_idempotency_key) DO NOTHING RETURNING id
            `, [order.id, order.customerEmail, order.serviceId, order.serviceTitle, order.platform,
                order.link, order.quantity, order.charge, now, order.refillable === true,
                order.customerId || null, payment.reference, trackingTokenHash || null, idempotencyKey]);
            if (!inserted.rowCount) {
                const existing = await client.query(`
                    SELECT id, customer_id, tracking_token_hash FROM orders WHERE checkout_idempotency_key = $1
                `, [idempotencyKey]);
                const row = existing.rows[0];
                if (!row || (row.customer_id || null) !== (order.customerId || null) || (row.tracking_token_hash || null) !== (trackingTokenHash || null)) {
                    const error = new Error('This checkout request key is already in use.');
                    error.code = 'IDEMPOTENCY_CONFLICT';
                    throw error;
                }
                return { created: false, order: await getOrder(row.id, client), payment: await getPaymentForOrder(row.id, client) };
            }
            await client.query(`
                INSERT INTO commerce_payments (id, reference, idempotency_key, kind, customer_id, order_id,
                    customer_email, amount_minor, currency, status, created_at, updated_at)
                VALUES ($1, $2, $3, 'order', $4, $5, $6, $7, $8, 'pending', $9, $9)
            `, [payment.id, payment.reference, `order:${idempotencyKey}`, order.customerId || null, order.id,
                order.customerEmail, payment.amountMinor, payment.currency, now]);
            return { created: true, order: await getOrder(order.id, client), payment: await getPayment(payment.reference, client) };
        });
    }

    async function createWalletDepositPayment(payment) {
        return withTransaction(async (client) => {
            const now = new Date().toISOString();
            const inserted = await client.query(`
                INSERT INTO commerce_payments (id, reference, idempotency_key, kind, customer_id, order_id,
                    customer_email, amount_minor, currency, status, created_at, updated_at)
                VALUES ($1, $2, $3, 'wallet_deposit', $4, NULL, $5, $6, $7, 'pending', $8, $8)
                ON CONFLICT (idempotency_key) DO NOTHING RETURNING ${PAYMENT_COLUMNS}
            `, [payment.id, payment.reference, `wallet-deposit:${payment.idempotencyKey}`, payment.customerId,
                payment.customerEmail, payment.amountMinor, payment.currency, now]);
            if (inserted.rowCount) return { created: true, payment: mapPayment(inserted.rows[0]) };
            const existingResult = await client.query(`SELECT ${PAYMENT_COLUMNS} FROM commerce_payments WHERE idempotency_key = $1`, [`wallet-deposit:${payment.idempotencyKey}`]);
            const existing = existingResult.rows[0];
            if (!existing || existing.customer_id !== payment.customerId || existing.kind !== 'wallet_deposit') {
                const error = new Error('This deposit request key is already in use.');
                error.code = 'IDEMPOTENCY_CONFLICT';
                throw error;
            }
            return { created: false, payment: mapPayment(existing) };
        });
    }

    async function createWalletOrderAndDebit({ order, amountMinor, currency, idempotencyKey }) {
        return withTransaction(async (client) => {
            const customerResult = await client.query('SELECT id FROM customers WHERE id = $1 FOR UPDATE', [order.customerId]);
            if (!customerResult.rowCount) throw new Error('Customer account was not found.');
            const now = new Date().toISOString();
            const inserted = await client.query(`
                INSERT INTO orders (id, customer_email, service_id, service_title, platform, link, quantity, charge,
                    status, created_at, updated_at, refillable, customer_id, payment_status, payment_method,
                    payment_reference, checkout_idempotency_key)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Pending', $9, $9, $10, $11,
                    'paid', 'wallet', $12, $13)
                ON CONFLICT (checkout_idempotency_key) DO NOTHING RETURNING id
            `, [order.id, order.customerEmail, order.serviceId, order.serviceTitle, order.platform,
                order.link, order.quantity, order.charge, now, order.refillable === true, order.customerId,
                `wallet-order-${order.id}`, idempotencyKey]);
            if (!inserted.rowCount) {
                const existingResult = await client.query('SELECT id, customer_id FROM orders WHERE checkout_idempotency_key = $1', [idempotencyKey]);
                const existing = existingResult.rows[0];
                if (!existing || existing.customer_id !== order.customerId) {
                    const error = new Error('This checkout request key is already in use.');
                    error.code = 'IDEMPOTENCY_CONFLICT';
                    throw error;
                }
                return { created: false, order: await getOrder(existing.id, client) };
            }

            const balanceResult = await client.query(`
                SELECT COALESCE(SUM(amount_minor), 0)::text AS amount FROM wallet_ledger
                WHERE customer_id = $1 AND currency = $2
            `, [order.customerId, currency]);
            const balance = Number(balanceResult.rows[0].amount);
            if (!Number.isSafeInteger(balance) || balance < amountMinor) {
                const error = new Error('Insufficient wallet balance.');
                error.code = 'INSUFFICIENT_WALLET_FUNDS';
                throw error;
            }
            await client.query(`
                INSERT INTO wallet_ledger (id, customer_id, reference, amount_minor, currency, kind, order_id, created_at)
                VALUES ($1, $2, $3, $4, $5, 'order_debit', $6, $7)
            `, [crypto.randomUUID(), order.customerId, `wallet-order-${order.id}`, -amountMinor, currency, order.id, now]);
            await client.query(`
                INSERT INTO commerce_payments (id, reference, idempotency_key, kind, customer_id, order_id,
                    customer_email, amount_minor, currency, status, payment_method, created_at, updated_at, verified_at)
                VALUES ($1, $2, $3, 'order', $4, $5, $6, $7, $8, 'paid', 'wallet', $9, $9, $9)
            `, [crypto.randomUUID(), `wallet-order-${order.id}`, `wallet-order:${idempotencyKey}`, order.customerId,
                order.id, order.customerEmail, amountMinor, currency, now]);
            return { created: true, order: await getOrder(order.id, client) };
        });
    }

    async function storePaymentAuthorization(reference, authorization) {
        await pool.query(`
            UPDATE commerce_payments SET authorization_url = $1, access_code = $2, updated_at = $3
            WHERE reference = $4 AND status = 'pending'
        `, [authorization.authorizationUrl, authorization.accessCode || null, new Date().toISOString(), reference]);
        return getPayment(reference);
    }

    async function markPaymentInitializationFailed(reference) {
        return withTransaction(async (client) => {
            const payment = mapPayment(await selectPayment(reference, client, true));
            if (!payment || payment.status === 'paid') return payment;
            const now = new Date().toISOString();
            await client.query(`UPDATE commerce_payments SET status = 'initialization_failed', updated_at = $1 WHERE reference = $2 AND status <> 'paid'`, [now, reference]);
            if (payment.orderId) await client.query(`UPDATE orders SET payment_status = 'initialization_failed', updated_at = $1 WHERE id = $2`, [now, payment.orderId]);
            return getPayment(reference, client);
        });
    }

    async function updatePaymentStatus(reference, status) {
        if (!allowedPaymentStatuses.has(status) || status === 'paid') throw new TypeError('Unsupported non-success payment status.');
        return withTransaction(async (client) => {
            const payment = mapPayment(await selectPayment(reference, client, true));
            if (!payment || payment.status === 'paid') return payment;
            const now = new Date().toISOString();
            await client.query(`UPDATE commerce_payments SET status = $1, updated_at = $2 WHERE reference = $3 AND status <> 'paid'`, [status, now, reference]);
            if (payment.orderId) await client.query(`UPDATE orders SET payment_status = $1, updated_at = $2 WHERE id = $3`, [status, now, payment.orderId]);
            return getPayment(reference, client);
        });
    }

    async function settleVerifiedPayment(reference, providerTransactionId) {
        return withTransaction(async (client) => {
            const payment = mapPayment(await selectPayment(reference, client, true));
            if (!payment) {
                const error = new Error('Payment reference was not found.');
                error.code = 'PAYMENT_NOT_FOUND';
                throw error;
            }
            if (payment.status === 'paid') return { alreadySettled: true, payment };
            if (!['pending', 'ongoing', 'processing', 'queued'].includes(payment.status)) {
                const error = new Error('Payment is not in a settleable state.');
                error.code = 'PAYMENT_NOT_SETTLEABLE';
                throw error;
            }
            const now = new Date().toISOString();
            if (payment.kind === 'wallet_deposit') {
                await client.query('SELECT id FROM customers WHERE id = $1 FOR UPDATE', [payment.customerId]);
                await client.query(`
                    INSERT INTO wallet_ledger (id, customer_id, reference, amount_minor, currency, kind, order_id, created_at)
                    VALUES ($1, $2, $3, $4, $5, 'deposit', NULL, $6) ON CONFLICT (reference) DO NOTHING
                `, [crypto.randomUUID(), payment.customerId, `paystack-${payment.reference}`, payment.amountMinor, payment.currency, now]);
            } else if (payment.kind === 'order') {
                await client.query(`
                    UPDATE orders SET payment_status = 'paid', payment_method = 'paystack', updated_at = $1
                    WHERE id = $2
                `, [now, payment.orderId]);
            }
            await client.query(`
                UPDATE commerce_payments SET status = 'paid', provider_transaction_id = $1,
                    verified_at = $2, updated_at = $2 WHERE reference = $3 AND status <> 'paid'
            `, [providerTransactionId || null, now, reference]);
            return { alreadySettled: false, payment: await getPayment(reference, client) };
        });
    }

    async function getAuthorizedPayment(reference, { customerId = null, trackingTokenHash = null } = {}) {
        const payment = await getPayment(reference);
        if (!payment) return null;
        if (payment.customerId) return customerId === payment.customerId ? payment : null;
        if (payment.kind === 'wallet_deposit' || !payment.orderId || !trackingTokenHash) return null;
        const order = await getOrder(payment.orderId);
        if (!order?.trackingTokenHash) return null;
        const expected = Buffer.from(order.trackingTokenHash, 'hex');
        const supplied = Buffer.from(trackingTokenHash, 'hex');
        return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied) ? payment : null;
    }

    async function createCustomer({ id, email, emailNormalized, passwordSalt, passwordHash }) {
        const now = new Date().toISOString();
        await pool.query(`
            INSERT INTO customers (id, email, email_normalized, password_salt, password_hash, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $6)
        `, [id, email, emailNormalized, passwordSalt, passwordHash, now]);
        return getCustomerById(id);
    }

    async function getCustomerByEmail(emailNormalized) {
        const result = await pool.query(`
            SELECT id, email, email_normalized, password_salt, password_hash, created_at
            FROM customers WHERE email_normalized = $1
        `, [emailNormalized]);
        const customer = result.rows[0];
        return customer ? {
            id: customer.id, email: customer.email, emailNormalized: customer.email_normalized,
            passwordSalt: customer.password_salt, passwordHash: customer.password_hash, createdAt: customer.created_at
        } : null;
    }

    async function getCustomerById(customerId) {
        const result = await pool.query('SELECT id, email, email_normalized, created_at FROM customers WHERE id = $1', [customerId]);
        const customer = result.rows[0];
        return customer ? { id: customer.id, email: customer.email, emailNormalized: customer.email_normalized, createdAt: customer.created_at } : null;
    }

    async function createSession({ tokenHash, customerId, expiresAt }) {
        const now = new Date().toISOString();
        await pool.query(`
            INSERT INTO customer_sessions (token_hash, customer_id, expires_at, created_at, last_seen_at)
            VALUES ($1, $2, $3, $4, $4)
        `, [tokenHash, customerId, expiresAt, now]);
    }

    async function getSessionByTokenHash(tokenHash) {
        const now = new Date().toISOString();
        const result = await pool.query(`
            UPDATE customer_sessions AS s SET last_seen_at = $2
            FROM customers AS c
            WHERE s.customer_id = c.id AND s.token_hash = $1 AND s.expires_at > $2
            RETURNING s.token_hash, s.customer_id, s.expires_at, c.email, c.email_normalized
        `, [tokenHash, now]);
        const row = result.rows[0];
        if (!row) {
            await pool.query('DELETE FROM customer_sessions WHERE token_hash = $1 AND expires_at <= $2', [tokenHash, now]);
            return null;
        }
        return {
            tokenHash: row.token_hash, customerId: row.customer_id, expiresAt: row.expires_at,
            email: row.email, emailNormalized: row.email_normalized
        };
    }

    async function deleteSession(tokenHash) {
        await pool.query('DELETE FROM customer_sessions WHERE token_hash = $1', [tokenHash]);
    }

    async function canAttemptLogin(lookupKey, now = Date.now()) {
        const result = await pool.query('SELECT blocked_until FROM auth_attempts WHERE lookup_key = $1', [lookupKey]);
        return !result.rows[0] || Number(result.rows[0].blocked_until) <= now;
    }

    async function recordFailedLogin(lookupKey, { maxAttempts = 8, windowMs = 15 * 60 * 1000, now = Date.now() } = {}) {
        return withTransaction(async (client) => {
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [lookupKey]);
            const result = await client.query('SELECT attempts, window_started_at FROM auth_attempts WHERE lookup_key = $1 FOR UPDATE', [lookupKey]);
            const existing = result.rows[0];
            const inWindow = existing && now - Number(existing.window_started_at) < windowMs;
            const attempts = inWindow ? Number(existing.attempts) + 1 : 1;
            const windowStartedAt = inWindow ? Number(existing.window_started_at) : now;
            const blockedUntil = attempts >= maxAttempts ? now + windowMs : 0;
            await client.query(`
                INSERT INTO auth_attempts (lookup_key, attempts, window_started_at, blocked_until)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (lookup_key) DO UPDATE SET attempts = EXCLUDED.attempts,
                    window_started_at = EXCLUDED.window_started_at, blocked_until = EXCLUDED.blocked_until
            `, [lookupKey, attempts, windowStartedAt, blockedUntil]);
            return { attempts, blockedUntil };
        });
    }

    async function clearLoginAttempts(lookupKey) {
        await pool.query('DELETE FROM auth_attempts WHERE lookup_key = $1', [lookupKey]);
    }

    async function getWalletSnapshot(customerId, currency, limit = 50) {
        const [balanceResult, ledgerResult] = await Promise.all([
            pool.query(`SELECT COALESCE(SUM(amount_minor), 0)::text AS amount FROM wallet_ledger WHERE customer_id = $1 AND currency = $2`, [customerId, currency]),
            pool.query(`SELECT id, reference, amount_minor, currency, kind, order_id, created_at FROM wallet_ledger
                WHERE customer_id = $1 AND currency = $2 ORDER BY created_at DESC LIMIT $3`, [customerId, currency, limit])
        ]);
        const balanceMinor = Number(balanceResult.rows[0].amount);
        if (!Number.isSafeInteger(balanceMinor)) throw new RangeError('Wallet balance is outside the supported integer range.');
        return {
            balanceMinor,
            currency,
            transactions: ledgerResult.rows.map((entry) => ({
                id: entry.id, reference: entry.reference, amountMinor: Number(entry.amount_minor),
                currency: entry.currency, kind: entry.kind, orderId: entry.order_id, createdAt: entry.created_at
            }))
        };
    }

    async function getAuthorizedOrder(orderId, { customerId = null, trackingTokenHash = null } = {}) {
        const order = await getOrder(orderId);
        if (!order) return null;
        if (order.customerId) return customerId === order.customerId ? order : null;
        if (!trackingTokenHash || !order.trackingTokenHash) return null;
        const expected = Buffer.from(order.trackingTokenHash, 'hex');
        const supplied = Buffer.from(trackingTokenHash, 'hex');
        return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied) ? order : null;
    }

    async function getOrdersForCustomer(customerId, limit = 50) {
        const result = await pool.query(`SELECT ${ORDER_COLUMNS} FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT $2`, [customerId, limit]);
        return result.rows.map(mapOrder);
    }

    async function getOrdersByEmail(email, limit = 50) {
        const result = await pool.query(`SELECT ${ORDER_COLUMNS} FROM orders WHERE customer_email = $1 ORDER BY created_at DESC LIMIT $2`, [email, limit]);
        return result.rows.map(mapOrder);
    }

    async function getOrderStatusHistory(orderId) {
        const result = await pool.query(`
            SELECT status, remains, start_count, recorded_at FROM order_status_history
            WHERE order_id = $1 ORDER BY recorded_at DESC
        `, [orderId]);
        return result.rows.map((record) => ({
            status: record.status,
            remains: record.remains === null ? null : Number(record.remains),
            startCount: record.start_count === null ? null : Number(record.start_count),
            recordedAt: record.recorded_at
        }));
    }

    async function updateOrderWithProviderData(orderId, providerData) {
        await withTransaction(async (client) => {
            const now = new Date().toISOString();
            const status = providerData.status || 'Processing';
            const result = await client.query(`
                UPDATE orders SET provider_order_id = $1, status = $2, start_count = $3, remains = $4, updated_at = $5
                WHERE id = $6 AND payment_status = 'paid'
            `, [providerData.order || providerData.provider_order_id, status,
                providerData.start_count || null, providerData.remains !== undefined ? providerData.remains : null, now, orderId]);
            if (!result.rowCount) throw new Error('Only verified paid orders may be sent to fulfillment.');
            await client.query(`
                INSERT INTO order_status_history (order_id, status, remains, start_count, recorded_at)
                VALUES ($1, $2, $3, $4, $5)
            `, [orderId, status, providerData.remains !== undefined ? providerData.remains : null, providerData.start_count || null, now]);
        });
    }

    async function updateOrderStatus(orderId, statusData) {
        await withTransaction(async (client) => {
            const now = new Date().toISOString();
            const result = await client.query(`
                UPDATE orders SET status = $1, start_count = COALESCE($2, start_count),
                    remains = COALESCE($3, remains), updated_at = $4
                WHERE id = $5 AND payment_status = 'paid'
            `, [statusData.status, statusData.start_count || null,
                statusData.remains !== undefined ? statusData.remains : null, now, orderId]);
            if (!result.rowCount) throw new Error('Only verified paid orders may update fulfillment status.');
            await client.query(`
                INSERT INTO order_status_history (order_id, status, remains, start_count, recorded_at)
                VALUES ($1, $2, $3, $4, $5)
            `, [orderId, statusData.status, statusData.remains !== undefined ? statusData.remains : null, statusData.start_count || null, now]);
        });
    }

    async function updateRefillStatus(orderId, refillId, refillStatus) {
        await pool.query('UPDATE orders SET refill_id = $1, refill_status = $2, updated_at = $3 WHERE id = $4', [refillId, refillStatus, new Date().toISOString(), orderId]);
    }

    async function markCancelRequested(orderId) {
        await pool.query('UPDATE orders SET cancel_requested = TRUE, updated_at = $1 WHERE id = $2', [new Date().toISOString(), orderId]);
    }

    const orderStore = {
        initialize: initializeOrderStore,
        createOrder,
        createPendingOrderAndPayment,
        createWalletDepositPayment,
        createWalletOrderAndDebit,
        storePaymentAuthorization,
        markPaymentInitializationFailed,
        updatePaymentStatus,
        settleVerifiedPayment,
        getPayment,
        getPaymentForOrder,
        getAuthorizedPayment,
        createCustomer,
        getCustomerByEmail,
        getCustomerById,
        createSession,
        getSessionByTokenHash,
        deleteSession,
        canAttemptLogin,
        recordFailedLogin,
        clearLoginAttempts,
        getWalletSnapshot,
        updateOrderWithProviderData,
        updateOrderStatus,
        getOrder,
        getAuthorizedOrder,
        getOrdersForCustomer,
        getOrdersByEmail,
        getOrderStatusHistory,
        updateRefillStatus,
        markCancelRequested,
        close: async () => pool.end()
    };

    return {
        pool,
        catalogStore,
        orderStore,
        initialize: async () => {
            await initializeCatalog();
            await initializeOrderStore();
        },
        close: () => pool.end()
    };
}

module.exports = { createPostgresStores };
