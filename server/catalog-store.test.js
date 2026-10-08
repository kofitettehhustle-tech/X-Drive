const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createCatalogStore } = require('./catalog-store');

function createService(id, providerServiceId, pricePer1000) {
    return {
        providerServiceId,
        public: {
            id,
            platform: 'Instagram',
            title: 'Instagram Followers',
            category: 'Followers',
            description: 'Followers for Instagram',
            pricePer1000,
            minimum: 50,
            maximum: 10000,
            refillable: true,
            deliveryEstimate: '',
            enabled: true
        }
    };
}

function createTemporaryDatabase() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-catalog-'));
    const databasePath = path.join(directory, 'catalog.sqlite');
    return { directory, databasePath };
}

test('catalog snapshot survives closing and reopening the database', (t) => {
    const { directory, databasePath } = createTemporaryDatabase();
    const catalog = {
        source: 'morethanpanel',
        updatedAt: '2026-10-07T12:00:00.000Z',
        services: [createService('xd-service-one', 'provider-101', 1.25)]
    };

    const firstStore = createCatalogStore(databasePath);
    firstStore.saveCatalog(catalog);
    firstStore.close();

    const reopenedStore = createCatalogStore(databasePath);
    t.after(() => {
        reopenedStore.close();
        fs.rmSync(directory, { recursive: true, force: true });
    });
    const restoredCatalog = reopenedStore.getCatalog();

    assert.equal(restoredCatalog.source, 'morethanpanel');
    assert.equal(restoredCatalog.updatedAt, catalog.updatedAt);
    assert.equal(restoredCatalog.services[0].id, 'xd-service-one');
    assert.equal(restoredCatalog.services[0].pricePer1000, 1.25);
    assert.equal(restoredCatalog.services[0].providerServiceId, undefined);
});

test('failed catalog replacement leaves the last complete snapshot intact', (t) => {
    const { directory, databasePath } = createTemporaryDatabase();
    const store = createCatalogStore(databasePath);
    t.after(() => {
        store.close();
        fs.rmSync(directory, { recursive: true, force: true });
    });

    store.saveCatalog({
        source: 'morethanpanel',
        updatedAt: '2026-10-07T12:00:00.000Z',
        services: [createService('xd-old-service', 'provider-old', 2.5)]
    });

    assert.throws(() => store.saveCatalog({
        source: 'morethanpanel',
        updatedAt: '2026-10-07T13:00:00.000Z',
        services: [
            createService('xd-new-service', 'provider-new', 1.5),
            createService('xd-invalid-service', null, 0.5)
        ]
    }));

    const retainedCatalog = store.getCatalog();
    assert.equal(retainedCatalog.updatedAt, '2026-10-07T12:00:00.000Z');
    assert.deepEqual(retainedCatalog.services.map((service) => service.id), ['xd-old-service']);
});
