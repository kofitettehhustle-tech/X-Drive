const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function createOrderStore(databasePath) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    const database = new DatabaseSync(databasePath);

    database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

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
            cancel_requested INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS orders_customer_email_idx ON orders (customer_email, created_at DESC);
        CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS orders_provider_order_id_idx ON orders (provider_order_id);

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

        return this.getOrder(order.id);
    }

    function updateOrderWithProviderData(orderId, providerData) {
        database.exec('BEGIN IMMEDIATE');
        try {
            const updateStmt = database.prepare(`
                UPDATE orders
                SET provider_order_id = ?,
                    status = ?,
                    start_count = ?,
                    remains = ?,
                    updated_at = ?
                WHERE id = ?
            `);

            const now = new Date().toISOString();
            updateStmt.run(
                providerData.order || providerData.provider_order_id,
                providerData.status || 'Processing',
                providerData.start_count || null,
                providerData.remains !== undefined ? providerData.remains : null,
                now,
                orderId
            );

            const historyStmt = database.prepare(`
                INSERT INTO order_status_history (order_id, status, remains, start_count, recorded_at)
                VALUES (?, ?, ?, ?, ?)
            `);

            historyStmt.run(
                orderId,
                providerData.status || 'Processing',
                providerData.remains !== undefined ? providerData.remains : null,
                providerData.start_count || null,
                now
            );

            database.exec('COMMIT');
        } catch (error) {
            database.exec('ROLLBACK');
            throw error;
        }
    }

    function updateOrderStatus(orderId, statusData) {
        database.exec('BEGIN IMMEDIATE');
        try {
            const updateStmt = database.prepare(`
                UPDATE orders
                SET status = ?,
                    start_count = COALESCE(?, start_count),
                    remains = COALESCE(?, remains),
                    updated_at = ?
                WHERE id = ?
            `);

            const now = new Date().toISOString();
            updateStmt.run(
                statusData.status,
                statusData.start_count || null,
                statusData.remains !== undefined ? statusData.remains : null,
                now,
                orderId
            );

            const historyStmt = database.prepare(`
                INSERT INTO order_status_history (order_id, status, remains, start_count, recorded_at)
                VALUES (?, ?, ?, ?, ?)
            `);

            historyStmt.run(
                orderId,
                statusData.status,
                statusData.remains !== undefined ? statusData.remains : null,
                statusData.start_count || null,
                now
            );

            database.exec('COMMIT');
        } catch (error) {
            database.exec('ROLLBACK');
            throw error;
        }
    }

    function getOrder(orderId) {
        const stmt = database.prepare(`
            SELECT id, provider_order_id, customer_email, service_id, service_title, platform,
                   link, quantity, charge, start_count, remains, status, created_at, updated_at,
                   refillable, refill_id, refill_status, cancel_requested
            FROM orders
            WHERE id = ?
        `);

        const order = stmt.get(orderId);
        if (!order) return null;

        return {
            id: order.id,
            providerOrderId: order.provider_order_id,
            customerEmail: order.customer_email,
            serviceId: order.service_id,
            serviceTitle: order.service_title,
            platform: order.platform,
            link: order.link,
            quantity: order.quantity,
            charge: order.charge,
            startCount: order.start_count,
            remains: order.remains,
            status: order.status,
            createdAt: order.created_at,
            updatedAt: order.updated_at,
            refillable: Boolean(order.refillable),
            refillId: order.refill_id,
            refillStatus: order.refill_status,
            cancelRequested: Boolean(order.cancel_requested)
        };
    }

    function getOrdersByEmail(email, limit = 50) {
        const stmt = database.prepare(`
            SELECT id, provider_order_id, customer_email, service_id, service_title, platform,
                   link, quantity, charge, start_count, remains, status, created_at, updated_at,
                   refillable, refill_id, refill_status, cancel_requested
            FROM orders
            WHERE customer_email = ?
            ORDER BY created_at DESC
            LIMIT ?
        `);

        return stmt.all(email, limit).map(order => ({
            id: order.id,
            providerOrderId: order.provider_order_id,
            customerEmail: order.customer_email,
            serviceId: order.service_id,
            serviceTitle: order.service_title,
            platform: order.platform,
            link: order.link,
            quantity: order.quantity,
            charge: order.charge,
            startCount: order.start_count,
            remains: order.remains,
            status: order.status,
            createdAt: order.created_at,
            updatedAt: order.updated_at,
            refillable: Boolean(order.refillable),
            refillId: order.refill_id,
            refillStatus: order.refill_status,
            cancelRequested: Boolean(order.cancel_requested)
        }));
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

    function updateRefillStatus(orderId, refillId, refillStatus) {
        const stmt = database.prepare(`
            UPDATE orders
            SET refill_id = ?, refill_status = ?, updated_at = ?
            WHERE id = ?
        `);

        stmt.run(refillId, refillStatus, new Date().toISOString(), orderId);
    }

    function markCancelRequested(orderId) {
        const stmt = database.prepare(`
            UPDATE orders
            SET cancel_requested = 1, updated_at = ?
            WHERE id = ?
        `);

        stmt.run(new Date().toISOString(), orderId);
    }

    function close() {
        database.close();
    }

    return {
        createOrder,
        updateOrderWithProviderData,
        updateOrderStatus,
        getOrder,
        getOrdersByEmail,
        getOrderStatusHistory,
        updateRefillStatus,
        markCancelRequested,
        close
    };
}

module.exports = { createOrderStore };
