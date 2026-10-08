const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function createCatalogStore(databasePath) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    const database = new DatabaseSync(databasePath);

    database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS catalog_metadata (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            source TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS catalog_services (
            public_id TEXT PRIMARY KEY,
            provider_service_id TEXT NOT NULL,
            platform TEXT NOT NULL,
            title TEXT NOT NULL,
            category TEXT NOT NULL,
            description TEXT NOT NULL,
            price_per_1000 REAL NOT NULL CHECK (price_per_1000 >= 0),
            minimum INTEGER,
            maximum INTEGER,
            refillable INTEGER NOT NULL DEFAULT 0,
            delivery_estimate TEXT NOT NULL DEFAULT '',
            enabled INTEGER NOT NULL DEFAULT 1
        );

        CREATE INDEX IF NOT EXISTS catalog_services_platform_idx
            ON catalog_services (platform, enabled, price_per_1000);
    `);

    const readMetadata = database.prepare(`
        SELECT source, updated_at FROM catalog_metadata WHERE id = 1
    `);
    const readServices = database.prepare(`
        SELECT public_id, platform, title, category, description, price_per_1000,
               minimum, maximum, refillable, delivery_estimate, enabled
        FROM catalog_services
        WHERE enabled = 1
        ORDER BY platform COLLATE NOCASE, price_per_1000 ASC, title COLLATE NOCASE
    `);

    function getCatalog() {
        const metadata = readMetadata.get();
        if (!metadata) return null;

        return {
            source: metadata.source,
            updatedAt: metadata.updated_at,
            services: readServices.all().map((service) => ({
                id: service.public_id,
                platform: service.platform,
                title: service.title,
                category: service.category,
                description: service.description,
                pricePer1000: service.price_per_1000,
                minimum: service.minimum,
                maximum: service.maximum,
                refillable: Boolean(service.refillable),
                deliveryEstimate: service.delivery_estimate,
                enabled: Boolean(service.enabled)
            }))
        };
    }

    function saveCatalog(catalog) {
        if (catalog?.source !== 'morethanpanel' || !catalog.updatedAt || !Array.isArray(catalog.services) || catalog.services.length === 0) {
            throw new TypeError('A complete Morethanpanel catalog is required.');
        }

        database.exec('BEGIN IMMEDIATE');
        try {
            database.prepare('DELETE FROM catalog_services').run();
            database.prepare(`
                INSERT INTO catalog_metadata (id, source, updated_at)
                VALUES (1, ?, ?)
                ON CONFLICT(id) DO UPDATE SET source = excluded.source, updated_at = excluded.updated_at
            `).run(catalog.source, catalog.updatedAt);

            const insertService = database.prepare(`
                INSERT INTO catalog_services (
                    public_id, provider_service_id, platform, title, category, description,
                    price_per_1000, minimum, maximum, refillable, delivery_estimate, enabled
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            catalog.services.forEach((service) => {
                insertService.run(
                    service.public.id,
                    service.providerServiceId,
                    service.public.platform,
                    service.public.title,
                    service.public.category,
                    service.public.description,
                    service.public.pricePer1000,
                    service.public.minimum,
                    service.public.maximum,
                    service.public.refillable ? 1 : 0,
                    service.public.deliveryEstimate || '',
                    service.public.enabled === false ? 0 : 1
                );
            });

            database.exec('COMMIT');
        } catch (error) {
            database.exec('ROLLBACK');
            throw error;
        }

        return getCatalog();
    }

    function close() {
        database.close();
    }

    return { getCatalog, saveCatalog, close };
}

module.exports = { createCatalogStore };
