(() => {
    const catalogUrl = '/api/storefront/catalog';

    function normalizeService(service) {
        const pricePer1000 = Number(service.pricePer1000);
        const minimum = Number(service.minimum);
        const maximum = Number(service.maximum);
        const id = String(service.id || '').trim();
        const platform = String(service.platform || '').trim();
        const title = String(service.title || service.name || '').trim();

        if (!id || !platform || !title || !Number.isFinite(pricePer1000) || pricePer1000 < 0) {
            return null;
        }

        return {
            id,
            platform,
            title,
            name: title,
            category: String(service.category || service.type || 'Social media').trim(),
            description: String(service.description || '').trim(),
            pricePer1000,
            minimum: Number.isFinite(minimum) ? minimum : null,
            maximum: Number.isFinite(maximum) ? maximum : null,
            deliveryEstimate: typeof service.deliveryEstimate === 'string' ? service.deliveryEstimate : '',
            refillable: service.refillable === true,
            enabled: service.enabled !== false
        };
    }

    function getPreviewServices() {
        return (window.XDriveMockData?.services || [])
            .map((service) => normalizeService({
                ...service,
                pricePer1000: service.currentResellerPrice ?? service.pricePer1000
            }))
            .filter(Boolean);
    }

    async function load() {
        if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
            try {
                const response = await fetch(catalogUrl, {
                    headers: { Accept: 'application/json' },
                    cache: 'no-store'
                });

                if (!response.ok) throw new Error('Catalog request failed');

                const payload = await response.json();
                if (payload.source !== 'morethanpanel' || !Array.isArray(payload.services)) {
                    throw new Error('Unsupported catalog response');
                }

                const services = payload.services.map(normalizeService).filter(Boolean);
                if (!services.length) throw new Error('Catalog is empty');

                return {
                    source: 'morethanpanel',
                    services: services.filter((service) => service.enabled),
                    updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : null
                };
            } catch (error) {
                console.warn('Using preview catalog because the weekly catalog feed is unavailable.');
            }
        }

        return {
            source: 'preview',
            services: getPreviewServices(),
            updatedAt: null
        };
    }

    function getFeaturedServices(services, limit = 6) {
        const lowestByPlatform = new Map();

        services.forEach((service) => {
            if (!service.enabled) return;

            const existing = lowestByPlatform.get(service.platform);
            if (!existing || service.pricePer1000 < existing.pricePer1000) {
                lowestByPlatform.set(service.platform, service);
            }
        });

        const platformPriority = ['Instagram', 'TikTok', 'YouTube', 'Facebook', 'X', 'Telegram', 'Spotify'];

        return [...lowestByPlatform.values()]
            .sort((first, second) => {
                const firstPriority = platformPriority.indexOf(first.platform);
                const secondPriority = platformPriority.indexOf(second.platform);
                const normalizedFirst = firstPriority === -1 ? platformPriority.length : firstPriority;
                const normalizedSecond = secondPriority === -1 ? platformPriority.length : secondPriority;
                return normalizedFirst - normalizedSecond || first.platform.localeCompare(second.platform);
            })
            .slice(0, limit);
    }

    function formatUpdatedAt(value) {
        if (!value) return '';

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';

        return new Intl.DateTimeFormat('en', {
            dateStyle: 'medium'
        }).format(date);
    }

    window.XDriveCatalog = {
        load,
        getFeaturedServices,
        formatUpdatedAt
    };
})();