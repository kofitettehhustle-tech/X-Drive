const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function createOrderStore(databasePath) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    const database = new DatabaseSync(databasePath);

    database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;

        CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY,
            provider_order_id TEXT UNIQUE,
            customer_email TEXT NOT NULL,
            service_id TEXT NOT NULL,
            service_title TEXT NOT NULL,
            platform TEXT NOT NULL,
            link TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            charge REAL NOT NULL,
            start_count INTEGER,
            remains INTEGER,
            status TEXT NOT NULL DEFAULT 'Pending',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            refillable INTEGER NOT NULL DEFAULT 0,
            refill_id TEXT,
            refill_status TEXT,
            cancel_requested INTEGER NOT NULL DEFAULT 0,
            customer_id TEXT,
            payment_status TEXT NOT NULL DEFAULT 'legacy',
            payment_method TEXT,
            payment_reference TEXT,
            tracking_token_hash TEXT,
            supplier_tracking_code TEXT,
            checkout_idempotency_key TEXT
        );

        CREATE INDEX IF NOT EXISTS orders_customer_email_idx ON orders (customer_email, created_at DESC);
        CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS orders_provider_order_id_idx ON orders (provider_order_id);

        CREATE TABLE IF NOT EXISTS customers (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL,
            email_normalized TEXT NOT NULL UNIQUE,
            password_salt TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS customers_email_idx ON customers (email_normalized);

        CREATE TABLE IF NOT EXISTS customer_sessions (
            token_hash TEXT PRIMARY KEY,
            customer_id TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS customer_sessions_customer_idx ON customer_sessions (customer_id, expires_at);

        CREATE TABLE IF NOT EXISTS auth_attempts (
            lookup_key TEXT PRIMARY KEY,
            attempts INTEGER NOT NULL,
            window_started_at INTEGER NOT NULL,
            blocked_until INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS commerce_payments (
            id TEXT PRIMARY KEY,
            reference TEXT NOT NULL UNIQUE,
            idempotency_key TEXT UNIQUE,
            kind TEXT NOT NULL CHECK (kind IN ('order', 'wallet_deposit')),
            customer_id TEXT,
            order_id TEXT,
            customer_email TEXT NOT NULL,
            amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
            currency TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            payment_method TEXT NOT NULL DEFAULT 'paystack',
            authorization_url TEXT,
            access_code TEXT,
            provider_transaction_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            verified_at TEXT,
            FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS commerce_payments_customer_idx ON commerce_payments (customer_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS commerce_payments_order_idx ON commerce_payments (order_id);

        CREATE TABLE IF NOT EXISTS wallet_ledger (
            id TEXT PRIMARY KEY,
            customer_id TEXT NOT NULL,
            reference TEXT NOT NULL UNIQUE,
            amount_minor INTEGER NOT NULL CHECK (amount_minor <> 0),
            currency TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('deposit', 'order_debit', 'adjustment')),
            order_id TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS wallet_ledger_customer_idx ON wallet_ledger (customer_id, currency, created_at DESC);

        CREATE TABLE IF NOT EXISTS order_status_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT NOT NULL,
            status TEXT NOT NULL,
            remains INTEGER,
            start_count INTEGER,
            recorded_at TEXT NOT NULL,
            FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS order_status_history_order_id_idx ON order_status_history (order_id, recorded_at DESC);
    `);

    // Migrate existing SQLite files without touching their stored order or catalog data.
    const existingOrderColumns = new Set(database.prepare('PRAGMA table_info(orders)').all().map((column) => column.name));
    const requiredOrderColumns = [
        ['customer_id', 'TEXT'],
        ['payment_status', "TEXT NOT NULL DEFAULT 'legacy'"],
        ['payment_method', 'TEXT'],
        ['payment_reference', 'TEXT'],
        ['tracking_token_hash', 'TEXT'],
        ['checkout_idempotency_key', 'TEXT'],
        ['supplier_tracking_code', 'TEXT']
    ];
    for (const [column, definition] of requiredOrderColumns) {
        if (!existingOrderColumns.has(column)) database.exec(`ALTER TABLE orders ADD COLUMN ${column} ${definition}`);
    }
    const existingPaymentColumns = new Set(database.prepare('PRAGMA table_info(commerce_payments)').all().map((column) => column.name));
    if (!existingPaymentColumns.has('payment_method')) {
        database.exec("ALTER TABLE commerce_payments ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'paystack'");
    }
    database.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS orders_checkout_idempotency_idx
            ON orders (checkout_idempotency_key) WHERE checkout_idempotency_key IS NOT NULL;
    `);

    const allowedPaymentStatuses = new Set(['pending', 'ongoing', 'processing', 'queued', 'failed', 'abandoned', 'reversed', 'mismatch', 'initialization_failed', 'paid']);

    function withTransaction(work) {
        database.exec('BEGIN IMMEDIATE');
        try {
            const result = work();
            database.exec('COMMIT');
            return result;
        } catch (error) {
            try { database.exec('ROLLBACK'); } catch { /* Preserve the original error. */ }
            throw error;
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
            quantity: order.quantity,
            charge: order.charge,
            startCount: order.start_count,
            remains: order.remains,
            status: order.status,
            paymentStatus: order.payment_status || 'legacy',
            paymentMethod: order.payment_method || null,
            paymentReference: order.payment_reference || null,
            trackingTokenHash: order.tracking_token_hash || null,
            supplierTrackingCode: order.supplier_tracking_code || null,
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
            amountMinor: payment.amount_minor,
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

    function selectOrder(orderId) {
        return database.prepare(`
            SELECT id, provider_order_id, customer_email, customer_id, service_id, service_title, platform,
                   link, quantity, charge, start_count, remains, status, payment_status, payment_method,
                   payment_reference, tracking_token_hash, supplier_tracking_code, checkout_idempotency_key, created_at, updated_at,
                   refillable, refill_id, refill_status, cancel_requested
            FROM orders WHERE id = ?
        `).get(orderId);
    }

    function selectPayment(reference) {
        return database.prepare(`
            SELECT id, reference, idempotency_key, kind, customer_id, order_id, customer_email,
                   amount_minor, currency, status, payment_method, authorization_url, access_code,
                   provider_transaction_id, created_at, updated_at, verified_at
            FROM commerce_payments WHERE reference = ?
        `).get(reference);
    }

    function createOrder(order) {
        const stmt = database.prepare(`
            INSERT INTO orders (
                id, customer_email, service_id, service_title, platform, link, quantity, charge,
                status, created_at, updated_at, refillable
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const now = new Date().toISOString();
        stmt.run(
            order.id,
            order.customerEmail,
            order.serviceId,
            order.serviceTitle,
            order.platform,
            order.link,
            order.quantity,
            order.charge,
            'Pending',
            now,
            now,
            order.refillable ? 1 : 0
        );

        return getOrder(order.id);
    }

    function createPendingOrderAndPayment({ order, payment, trackingTokenHash, idempotencyKey }) {
        return withTransaction(() => {
            const existing = database.prepare(`
                SELECT id, customer_id, tracking_token_hash FROM orders WHERE checkout_idempotency_key = ?
            `).get(idempotencyKey);
            if (existing) {
                if ((existing.customer_id || null) !== (order.customerId || null) || (existing.tracking_token_hash || null) !== (trackingTokenHash || null)) {
                    const error = new Error('This checkout request key is already in use.');
                    error.code = 'IDEMPOTENCY_CONFLICT';
                    throw error;
                }
                const existingOrder = getOrder(existing.id);
                const existingPayment = getPaymentForOrder(existing.id);
                return { created: false, order: existingOrder, payment: existingPayment };
            }

            const now = new Date().toISOString();
            database.prepare(`
                INSERT INTO orders (
                    id, customer_email, service_id, service_title, platform, link, quantity, charge,
                    status, created_at, updated_at, refillable, customer_id, payment_status,
                    payment_method, payment_reference, tracking_token_hash, supplier_tracking_code, checkout_idempotency_key
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                order.id,
                order.customerEmail,
                order.serviceId,
                order.serviceTitle,
                order.platform,
                order.link,
                order.quantity,
                order.charge,
                'Pending',
                now,
                now,
                order.refillable ? 1 : 0,
                order.customerId || null,
                'pending',
                'paystack',
                payment.reference,
                trackingTokenHash || null,
                null,
                idempotencyKey
            );

            database.prepare(`
                INSERT INTO commerce_payments (
                    id, reference, idempotency_key, kind, customer_id, order_id, customer_email,
                    amount_minor, currency, status, created_at, updated_at
                ) VALUES (?, ?, ?, 'order', ?, ?, ?, ?, ?, 'pending', ?, ?)
            `).run(
                payment.id, payment.reference, idempotencyKey, order.customerId || null, order.id,
                order.customerEmail, payment.amountMinor, payment.currency, now, now
            );

            return { created: true, order: getOrder(order.id), payment: getPayment(payment.reference) };
        });
    }

    function createWalletDepositPayment(payment) {
        return withTransaction(() => {
            const existing = database.prepare(`
                SELECT * FROM commerce_payments WHERE idempotency_key = ?
            `).get(payment.idempotencyKey);
            if (existing) {
                if (existing.customer_id !== payment.customerId || existing.kind !== 'wallet_deposit') {
                    const error = new Error('This deposit request key is already in use.');
                    error.code = 'IDEMPOTENCY_CONFLICT';
                    throw error;
                }
                return { created: false, payment: mapPayment(existing) };
            }

            const now = new Date().toISOString();
            database.prepare(`
                INSERT INTO commerce_payments (
                    id, reference, idempotency_key, kind, customer_id, order_id, customer_email,
                    amount_minor, currency, status, created_at, updated_at
                ) VALUES (?, ?, ?, 'wallet_deposit', ?, NULL, ?, ?, ?, 'pending', ?, ?)
            `).run(
                payment.id, payment.reference, payment.idempotencyKey, payment.customerId,
                payment.customerEmail, payment.amountMinor, payment.currency, now, now
            );
            return { created: true, payment: getPayment(payment.reference) };
        });
    }

    function createWalletOrderAndDebit({ order, amountMinor, currency, idempotencyKey }) {
        return withTransaction(() => {
            const existing = database.prepare(`
                SELECT id, customer_id FROM orders WHERE checkout_idempotency_key = ?
            `).get(idempotencyKey);
            if (existing) {
                if (existing.customer_id !== order.customerId) {
                    const error = new Error('This checkout request key is already in use.');
                    error.code = 'IDEMPOTENCY_CONFLICT';
                    throw error;
                }
                return { created: false, order: getOrder(existing.id) };
            }

            const balance = database.prepare(`
                SELECT COALESCE(SUM(amount_minor), 0) AS amount
                FROM wallet_ledger WHERE customer_id = ? AND currency = ?
            `).get(order.customerId, currency).amount;
            if (balance < amountMinor) {
                const error = new Error('Insufficient wallet balance.');
                error.code = 'INSUFFICIENT_WALLET_FUNDS';
                throw error;
            }

            const now = new Date().toISOString();
            const ledgerReference = `wallet-order-${order.id}`;
            database.prepare(`
                INSERT INTO orders (
                    id, customer_email, service_id, service_title, platform, link, quantity, charge,
                    status, created_at, updated_at, refillable, customer_id, payment_status,
                    payment_method, payment_reference, tracking_token_hash, supplier_tracking_code, checkout_idempotency_key
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                order.id,
                order.customerEmail,
                order.serviceId,
                order.serviceTitle,
                order.platform,
                order.link,
                order.quantity,
                order.charge,
                'Pending',
                now,
                now,
                order.refillable ? 1 : 0,
                order.customerId,
                'paid',
                'wallet',
                ledgerReference,
                null,
                null,
                idempotencyKey
            );
            database.prepare(`
                INSERT INTO wallet_ledger (id, customer_id, reference, amount_minor, currency, kind, order_id, created_at)
                VALUES (?, ?, ?, ?, ?, 'order_debit', ?, ?)
            `).run(crypto.randomUUID(), order.customerId, ledgerReference, -amountMinor, currency, order.id, now);
            database.prepare(`
                INSERT INTO commerce_payments (
                    id, reference, idempotency_key, kind, customer_id, order_id, customer_email,
                    amount_minor, currency, status, payment_method, created_at, updated_at, verified_at
                ) VALUES (?, ?, ?, 'order', ?, ?, ?, ?, ?, 'paid', 'wallet', ?, ?, ?)
            `).run(
                crypto.randomUUID(), ledgerReference, idempotencyKey, order.customerId, order.id,
                order.customerEmail, amountMinor, currency, now, now, now
            );

            return { created: true, order: getOrder(order.id) };
        });
    }

    function storePaymentAuthorization(reference, authorization) {
        database.prepare(`
            UPDATE commerce_payments
            SET authorization_url = ?, access_code = ?, updated_at = ?
            WHERE reference = ? AND status = 'pending'
        `).run(authorization.authorizationUrl, authorization.accessCode || null, new Date().toISOString(), reference);
        return getPayment(reference);
    }

    function markPaymentInitializationFailed(reference) {
        const now = new Date().toISOString();
        return withTransaction(() => {
            const payment = getPayment(reference);
            if (!payment || payment.status === 'paid') return payment;
            database.prepare(`
                UPDATE commerce_payments SET status = 'initialization_failed', updated_at = ?
                WHERE reference = ? AND status <> 'paid'
            `).run(now, reference);
            if (payment.orderId) {
                database.prepare(`
                    UPDATE orders SET payment_status = 'initialization_failed', updated_at = ? WHERE id = ?
                `).run(now, payment.orderId);
            }
            return getPayment(reference);
        });
    }

    function updatePaymentStatus(reference, status) {
        if (!allowedPaymentStatuses.has(status) || status === 'paid') throw new TypeError('Unsupported non-success payment status.');
        return withTransaction(() => {
            const payment = getPayment(reference);
            if (!payment || payment.status === 'paid') return payment;
            const now = new Date().toISOString();
            database.prepare(`
                UPDATE commerce_payments SET status = ?, updated_at = ?
                WHERE reference = ? AND status <> 'paid'
            `).run(status, now, reference);
            if (payment.orderId) {
                database.prepare(`
                    UPDATE orders SET payment_status = ?, updated_at = ? WHERE id = ?
                `).run(status, now, payment.orderId);
            }
            return getPayment(reference);
        });
    }

    function settleVerifiedPayment(reference, providerTransactionId) {
        return withTransaction(() => {
            const payment = getPayment(reference);
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
                database.prepare(`
                    INSERT OR IGNORE INTO wallet_ledger (
                        id, customer_id, reference, amount_minor, currency, kind, order_id, created_at
                    ) VALUES (?, ?, ?, ?, ?, 'deposit', NULL, ?)
                `).run(
                    crypto.randomUUID(), payment.customerId, `paystack-${payment.reference}`,
                    payment.amountMinor, payment.currency, now
                );
            } else if (payment.kind === 'order') {
                database.prepare(`
                    UPDATE orders SET payment_status = 'paid', payment_method = 'paystack', updated_at = ?
                    WHERE id = ?
                `).run(now, payment.orderId);
            }

            database.prepare(`
                UPDATE commerce_payments
                SET status = 'paid', provider_transaction_id = ?, verified_at = ?, updated_at = ?
                WHERE reference = ? AND status <> 'paid'
            `).run(providerTransactionId || null, now, now, reference);

            return { alreadySettled: false, payment: getPayment(reference) };
        });
    }

    function getPayment(reference) {
        return mapPayment(selectPayment(reference));
    }

    function getPaymentForOrder(orderId) {
        const payment = database.prepare(`SELECT reference FROM commerce_payments WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`).get(orderId);
        return payment ? getPayment(payment.reference) : null;
    }

    function getAuthorizedPayment(reference, { customerId = null, trackingTokenHash = null } = {}) {
        const payment = getPayment(reference);
        if (!payment) return null;
        if (payment.customerId) return customerId === payment.customerId ? payment : null;
        if (!trackingTokenHash || !payment.orderId) return null;
        const order = getOrder(payment.orderId);
        if (!order || !order.trackingTokenHash) return null;
        const expected = Buffer.from(order.trackingTokenHash, 'hex');
        const supplied = Buffer.from(trackingTokenHash, 'hex');
        return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied) ? payment : null;
    }

    function getAuthorizedOrder(orderId, { customerId = null, trackingTokenHash = null } = {}) {
        const order = getOrder(orderId);
        if (!order) return null;
        if (order.customerId) return customerId === order.customerId ? order : null;
        if (!trackingTokenHash || !order.trackingTokenHash) return null;
        const expected = Buffer.from(order.trackingTokenHash, 'hex');
        const supplied = Buffer.from(trackingTokenHash, 'hex');
        return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied) ? order : null;
    }

    function createCustomer({ id, email, emailNormalized, passwordSalt, passwordHash }) {
        const now = new Date().toISOString();
        database.prepare(`
            INSERT INTO customers (id, email, email_normalized, password_salt, password_hash, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, email, emailNormalized, passwordSalt, passwordHash, now, now);
        return getCustomerById(id);
    }

    function getCustomerByEmail(emailNormalized) {
        const customer = database.prepare(`
            SELECT id, email, email_normalized, password_salt, password_hash, created_at
            FROM customers WHERE email_normalized = ?
        `).get(emailNormalized);
        return customer ? {
            id: customer.id,
            email: customer.email,
            emailNormalized: customer.email_normalized,
            passwordSalt: customer.password_salt,
            passwordHash: customer.password_hash,
            createdAt: customer.created_at
        } : null;
    }

    function getCustomerById(customerId) {
        const customer = database.prepare(`
            SELECT id, email, email_normalized, created_at FROM customers WHERE id = ?
        `).get(customerId);
        return customer ? { id: customer.id, email: customer.email, emailNormalized: customer.email_normalized, createdAt: customer.created_at } : null;
    }

    function createSession({ tokenHash, customerId, expiresAt }) {
        const now = new Date().toISOString();
        database.prepare(`
            INSERT INTO customer_sessions (token_hash, customer_id, expires_at, created_at, last_seen_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(tokenHash, customerId, expiresAt, now, now);
    }

    function getSessionByTokenHash(tokenHash) {
        const row = database.prepare(`
            SELECT s.token_hash, s.customer_id, s.expires_at,
                   c.email, c.email_normalized
            FROM customer_sessions s JOIN customers c ON c.id = s.customer_id
            WHERE s.token_hash = ?
        `).get(tokenHash);
        if (!row) return null;
        if (Date.parse(row.expires_at) <= Date.now()) {
            deleteSession(tokenHash);
            return null;
        }
        database.prepare('UPDATE customer_sessions SET last_seen_at = ? WHERE token_hash = ?')
            .run(new Date().toISOString(), tokenHash);
        return {
            tokenHash: row.token_hash,
            customerId: row.customer_id,
            expiresAt: row.expires_at,
            email: row.email,
            emailNormalized: row.email_normalized
        };
    }

    function deleteSession(tokenHash) {
        database.prepare('DELETE FROM customer_sessions WHERE token_hash = ?').run(tokenHash);
    }

    function canAttemptLogin(lookupKey, now = Date.now()) {
        const row = database.prepare('SELECT blocked_until FROM auth_attempts WHERE lookup_key = ?').get(lookupKey);
        return !row || row.blocked_until <= now;
    }

    function recordFailedLogin(lookupKey, { maxAttempts = 8, windowMs = 15 * 60 * 1000, now = Date.now() } = {}) {
        const existing = database.prepare('SELECT attempts, window_started_at FROM auth_attempts WHERE lookup_key = ?').get(lookupKey);
        const inWindow = existing && now - existing.window_started_at < windowMs;
        const attempts = inWindow ? existing.attempts + 1 : 1;
        const windowStartedAt = inWindow ? existing.window_started_at : now;
        const blockedUntil = attempts >= maxAttempts ? now + windowMs : 0;
        database.prepare(`
            INSERT INTO auth_attempts (lookup_key, attempts, window_started_at, blocked_until)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(lookup_key) DO UPDATE SET
                attempts = excluded.attempts,
                window_started_at = excluded.window_started_at,
                blocked_until = excluded.blocked_until
        `).run(lookupKey, attempts, windowStartedAt, blockedUntil);
        return { attempts, blockedUntil };
    }

    function clearLoginAttempts(lookupKey) {
        database.prepare('DELETE FROM auth_attempts WHERE lookup_key = ?').run(lookupKey);
    }

    function getWalletSnapshot(customerId, currency, limit = 50) {
        const balance = database.prepare(`
            SELECT COALESCE(SUM(amount_minor), 0) AS amount
            FROM wallet_ledger WHERE customer_id = ? AND currency = ?
        `).get(customerId, currency).amount;
        const transactions = database.prepare(`
            SELECT id, reference, amount_minor, currency, kind, order_id, created_at
            FROM wallet_ledger WHERE customer_id = ? AND currency = ?
            ORDER BY created_at DESC LIMIT ?
        `).all(customerId, currency).map((entry) => ({
            id: entry.id,
            reference: entry.reference,
            amountMinor: entry.amount_minor,
            currency: entry.currency,
            kind: entry.kind,
            orderId: entry.order_id,
            createdAt: entry.created_at
        }));
        return { balanceMinor: balance, currency, transactions };
    }

    function getOrder(orderId) {
        const row = selectOrder(orderId);
        if (!row) return null;
        return mapOrder(row);
    }

    function getOrdersForCustomer(customerId) {
        const rows = database.prepare(`
            SELECT id, provider_order_id, customer_email, customer_id, service_id, service_title, platform,
                   link, quantity, charge, start_count, remains, status, payment_status, payment_method,
                   payment_reference, tracking_token_hash, supplier_tracking_code, checkout_idempotency_key, created_at, updated_at,
                   refillable, refill_id, refill_status, cancel_requested
            FROM orders WHERE customer_id = ? ORDER BY created_at DESC
        `).all(customerId);
        return rows.map(mapOrder);
    }

    function getOrdersByEmail(email, limit = 50) {
        const rows = database.prepare(`
            SELECT id FROM orders WHERE customer_email = ? ORDER BY created_at DESC LIMIT ?
        `).all(email, limit);
        return rows.map((row) => getOrder(row.id));
    }

    function getOrderStatusHistory(orderId) {
        const stmt = database.prepare(`
            SELECT status, remains, start_count, recorded_at
            FROM order_status_history
            WHERE order_id = ?
            ORDER BY recorded_at DESC
        `);

        return stmt.all(orderId).map(record => ({
            status: record.status,
            remains: record.remains,
            startCount: record.start_count,
            recordedAt: record.recorded_at
        }));
    }

    function updateOrderWithProviderData(orderId, providerData) {
        database.exec('BEGIN IMMEDIATE');
        try {
            const updateStmt = database.prepare(`
                UPDATE orders
                SET provider_order_id = ?, status = ?, start_count = ?, remains = ?, updated_at = ?
                WHERE id = ? AND payment_status = 'paid'
            `);
            const now = new Date().toISOString();
            const result = updateStmt.run(
                providerData.order || providerData.provider_order_id,
                providerData.status || 'Processing',
                providerData.start_count || null,
                providerData.remains !== undefined ? providerData.remains : null,
                now,
                orderId
            );
            if (result.changes === 0) throw new Error('Only verified paid orders may be sent to fulfillment.');

            database.prepare(`
                INSERT INTO order_status_history (order_id, status, remains, start_count, recorded_at)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                orderId,
                providerData.status || 'Processing',
                providerData.remains !== undefined ? providerData.remains : null,
                providerData.start_count || null,
                now
            );
            database.exec('COMMIT');
        } catch (error) {
            try { database.exec('ROLLBACK'); } catch { /* Preserve the original error. */ }
            throw error;
        }
    }

    function updateOrderStatus(orderId, statusData) {
        database.exec('BEGIN IMMEDIATE');
        try {
            const updateStmt = database.prepare(`
                UPDATE orders
                SET status = ?, start_count = COALESCE(?, start_count),
                    remains = COALESCE(?, remains), updated_at = ?
                WHERE id = ? AND payment_status = 'paid'
            `);
            const now = new Date().toISOString();
            const result = updateStmt.run(
                statusData.status,
                statusData.start_count || null,
                statusData.remains !== undefined ? statusData.remains : null,
                now,
                orderId
            );
            if (result.changes === 0) throw new Error('Only verified paid orders may update fulfillment status.');

            database.prepare(`
                INSERT INTO order_status_history (order_id, status, remains, start_count, recorded_at)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                orderId,
                statusData.status,
                statusData.remains !== undefined ? statusData.remains : null,
                statusData.start_count || null,
                now
            );
            database.exec('COMMIT');
        } catch (error) {
            try { database.exec('ROLLBACK'); } catch { /* Preserve the original error. */ }
            throw error;
        }
    }

    function updateRefillStatus(orderId, refillId, refillStatus) {
        database.prepare(`
            UPDATE orders SET refill_id = ?, refill_status = ?, updated_at = ? WHERE id = ?
        `).run(refillId, refillStatus, new Date().toISOString(), orderId);
    }

    function markCancelRequested(orderId) {
        database.prepare(`
            UPDATE orders SET cancel_requested = 1, updated_at = ? WHERE id = ?
        `).run(new Date().toISOString(), orderId);
    }

    function close() {
        database.close();
    }

    return {
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
        getAuthorizedOrder,
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
        getOrdersForCustomer,
        getOrdersByEmail,
        getOrderStatusHistory,
        updateRefillStatus,
        markCancelRequested,
        close
    };
}

module.exports = { createOrderStore };
