(() => {
    const apiBaseUrl = String(window.XDRIVE_API_BASE_URL || '').replace(/\/+$/, '');
    const catalogUrl = `${apiBaseUrl}/api/storefront/catalog`;

    function cleanLeadingStatusDots(value) {
        return String(value || '').replace(/^\s*(?:(?:🔴|🟠|🟡|🟢|🔵|🟣|⚫|⚪|🟤)\s*)+/u, '').trim();
    }

    function brandCatalogText(value) {
        return cleanLeadingStatusDots(value)
            .replace(/\bMore\s*Than\s*P(?:a)?n(?:n)?el\b/gi, 'X-Drive')
            .replace(/\bMTP\b/gi, 'X-Drive');
    }

    function normalizeService(service) {
        const pricePer1000 = Number(service.pricePer1000);
        const minimum = Number(service.minimum);
        const maximum = Number(service.maximum);
        const id = String(service.id || '').trim();
        const platform = brandCatalogText(String(service.platform || '').trim());
        const title = String(service.title || service.name || '').trim();

        if (!id || !platform || !title || !Number.isFinite(pricePer1000) || pricePer1000 < 0) {
            return null;
        }

        const category = brandCatalogText(String(service.category || service.type || 'Social media').trim());
        const description = brandCatalogText(String(service.description || '').trim());
        const deliveryEstimate = typeof service.deliveryEstimate === 'string' ? brandCatalogText(service.deliveryEstimate) : '';
        const featureText = [title, category, description, deliveryEstimate].join(' ');

        return {
            id,
            platform,
            title: brandCatalogText(title),
            name: brandCatalogText(title),
            category,
            description,
            pricePer1000,
            minimum: Number.isFinite(minimum) ? minimum : null,
            maximum: Number.isFinite(maximum) ? maximum : null,
            deliveryEstimate,
            refillable: service.refillable === true,
            refillMentioned: service.refillable === true || /\brefill(?:able)?\b/i.test(featureText),
            nonDrop: service.nonDrop === true || service.noDrop === true || service.dropProtected === true || service.dropProtection === true || /\b(?:non[-\s]?drop|no[-\s]?drop|zero[-\s]?drop|drop[-\s]?protect(?:ed|ion))\b/i.test(featureText),
            guaranteed: service.guaranteed === true || /\b(?:guaranteed|guarantee)\b/i.test(featureText),
            fastStart: service.fastStart === true || /\b(?:instant\s*(?:start|delivery)|fast\s*(?:start|delivery)|(?:start|delivery)\s*within\s*\d+\s*(?:m|min|mins|minute|minutes))\b/i.test(featureText),
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
                if (!['morethanpanel', 'mock'].includes(payload.source) || !Array.isArray(payload.services)) {
                    throw new Error('Unsupported catalog response');
                }

                const services = payload.services.map(normalizeService).filter(Boolean);
                if (!services.length) throw new Error('Catalog is empty');

                return {
                    source: payload.source,
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
        formatUpdatedAt,
        brandText: brandCatalogText
    };
})();
