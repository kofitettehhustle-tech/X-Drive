document.addEventListener('DOMContentLoaded', async () => {
    const serviceList = document.getElementById('service-list');
    const platformFilters = document.getElementById('platform-filters');
    const searchInput = document.getElementById('service-search');
    const sortSelect = document.getElementById('service-sort');
    const resultsLabel = document.getElementById('catalog-results');
    const pagination = document.getElementById('catalog-pagination');
    const catalogMeta = document.getElementById('catalog-meta');
    const clearFiltersButton = document.getElementById('clear-catalog-filters');
    const featureFilterInputs = Array.from(document.querySelectorAll('[data-feature-filter]'));
    const pageSize = 30;
    const selectedPlatforms = new Set();
    const selectedFeatures = new Set();
    let currentPage = 1;

    if (!window.XDriveCatalog || !serviceList) return;

    const catalog = await window.XDriveCatalog.load();
    const services = catalog.services;
    const requestedService = new URLSearchParams(window.location.search).get('service');
    const selectedService = services.find((service) => service.id === requestedService);

    const totalCountElement = document.getElementById('total-services-count');
    if (totalCountElement) {
        totalCountElement.innerHTML = `<span class="live-indicator">${catalog.source === 'mock' ? 'MOCK' : catalog.source === 'morethanpanel' ? 'LIVE' : 'PREVIEW'}</span> ${services.length.toLocaleString()} services`;
    }

    const catalogStats = document.getElementById('catalog-stats');
    if (catalogStats) {
        const platforms = new Set(services.map((service) => service.platform));
        const refillableCount = services.filter((service) => service.refillable).length;
        catalogStats.innerHTML = `
            <div><strong>${platforms.size}</strong> platforms</div>
            <div><strong>${refillableCount.toLocaleString()}</strong> refillable services</div>
        `;
    }

    if (catalog.source === 'mock') {
        catalogMeta.textContent = `LOCAL MOCK CATALOG · ${services.length} sample services · orders disabled · no provider connection`;
    } else if (catalog.source === 'morethanpanel') {
        const updatedAt = window.XDriveCatalog.formatUpdatedAt(catalog.updatedAt);
        catalogMeta.textContent = updatedAt
            ? `✓ X-Drive service catalog · refreshed ${updatedAt} · updated weekly · 50% markup applied`
            : '✓ X-Drive service catalog · updated weekly · 50% markup applied';
    } else {
        catalogMeta.textContent = `Preview mode · ${services.length} sample offers · X-Drive live catalog sync unavailable`;
    }

    if (requestedService && selectedService) {
        searchInput.value = selectedService.title;
    }

    const platformCounts = new Map();
    services.forEach((service) => {
        platformCounts.set(service.platform, (platformCounts.get(service.platform) || 0) + 1);
    });

    [...platformCounts.keys()]
        .sort((first, second) => first.localeCompare(second))
        .forEach((platform) => {
            const label = document.createElement('label');
            label.className = 'platform-filter-option';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = platform;
            checkbox.setAttribute('aria-label', `Filter by ${platform}`);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) selectedPlatforms.add(platform);
                else selectedPlatforms.delete(platform);
                currentPage = 1;
                render();
            });

            const icon = window.XDrivePlatformIcons?.create(platform, 'filter');
            const platformName = document.createElement('span');
            platformName.className = 'platform-filter-name';
            platformName.textContent = platform;
            const count = document.createElement('span');
            count.className = 'filter-count';
            count.textContent = platformCounts.get(platform).toLocaleString();

            label.append(checkbox);
            if (icon) label.append(icon);
            label.append(platformName, count);
            platformFilters.appendChild(label);
        });

    featureFilterInputs.forEach((input) => {
        const count = services.filter((service) => service[input.value] === true).length;
        const countLabel = input.closest('label')?.querySelector('[data-feature-count]');
        if (countLabel) countLabel.textContent = count.toLocaleString();
        input.disabled = count === 0;
        if (count === 0) input.title = 'No services are explicitly listed with this feature.';

        input.addEventListener('change', () => {
            if (input.checked) selectedFeatures.add(input.value);
            else selectedFeatures.delete(input.value);
            currentPage = 1;
            render();
        });
    });

    function getFilteredServices() {
        const query = searchInput.value.trim().toLowerCase();
        const filtered = services.filter((service) => {
            if (selectedPlatforms.size && !selectedPlatforms.has(service.platform)) return false;
            if ([...selectedFeatures].some((feature) => service[feature] !== true)) return false;
            if (query && ![
                service.platform,
                service.title,
                service.category,
                service.description
            ].join(' ').toLowerCase().includes(query)) return false;
            return true;
        });

        if (sortSelect.value === 'price-desc') {
            filtered.sort((first, second) => second.pricePer1000 - first.pricePer1000 || first.title.localeCompare(second.title));
        } else if (sortSelect.value === 'platform') {
            filtered.sort((first, second) => first.platform.localeCompare(second.platform) || first.pricePer1000 - second.pricePer1000);
        } else {
            filtered.sort((first, second) => first.pricePer1000 - second.pricePer1000 || first.title.localeCompare(second.title));
        }

        return filtered;
    }

    function createServiceCard(service) {
        const card = document.createElement('article');
        card.className = 'service-card';

        const info = document.createElement('div');
        info.className = 'service-info';
        const platform = document.createElement('div');
        platform.className = 'service-platform';
        const platformIcon = window.XDrivePlatformIcons?.create(service.platform, 'service');
        const platformName = document.createElement('span');
        platformName.textContent = service.platform;
        if (platformIcon) platform.appendChild(platformIcon);
        platform.appendChild(platformName);

        const name = document.createElement('h3');
        name.className = 'service-name';
        name.textContent = service.title;
        const description = document.createElement('p');
        description.className = 'text-muted';
        description.textContent = service.description || service.category;

        const meta = document.createElement('div');
        meta.className = 'service-meta';
        const minimum = document.createElement('span');
        minimum.textContent = `Min: ${Number.isFinite(service.minimum) ? service.minimum.toLocaleString() : '—'}`;
        const maximum = document.createElement('span');
        maximum.textContent = `Max: ${Number.isFinite(service.maximum) ? service.maximum.toLocaleString() : '—'}`;
        meta.append(minimum, maximum);

        if (service.deliveryEstimate) {
            const delivery = document.createElement('span');
            delivery.dataset.deliveryEstimate = 'true';
            delivery.textContent = `Typical start: ${service.deliveryEstimate}`;
            meta.appendChild(delivery);
        }

        const featureBadges = [
            service.refillable ? ['refillable', 'Refill available'] : service.refillMentioned ? ['refillMentioned', 'Refill mentioned—verify details'] : null,
            ['nonDrop', 'Non-drop'],
            ['guaranteed', 'Guaranteed'],
            ['fastStart', 'Fast start']
        ].filter(Boolean).filter(([feature]) => service[feature] === true);

        if (featureBadges.length) {
            const badgeList = document.createElement('div');
            badgeList.className = 'service-feature-badges';
            featureBadges.forEach(([feature, label]) => {
                const badge = document.createElement('span');
                badge.className = 'service-feature-badge';
                if (feature === 'refillable' || feature === 'refillMentioned') {
                    const refillIcon = window.XDrivePlatformIcons?.createRefillIcon();
                    if (refillIcon) badge.appendChild(refillIcon);
                }
                badge.appendChild(document.createTextNode(label));
                badgeList.appendChild(badge);
            });
            meta.appendChild(badgeList);
        }

        info.append(platform, name, description, meta);

        const action = document.createElement('div');
        action.className = 'service-action';
        const price = document.createElement('div');
        price.className = 'service-price';
        price.textContent = `${window.formatCurrency(service.pricePer1000)} / 1K`;
        const order = document.createElement('a');
        order.className = 'btn btn-primary';
        order.href = `checkout.html?service=${encodeURIComponent(service.id)}`;
        order.textContent = 'Order Now';
        action.append(price, order);

        card.append(info, action);
        return card;
    }

    function renderPagination(pageCount) {
        pagination.replaceChildren();
        pagination.hidden = pageCount <= 1;
        if (pageCount <= 1) return;

        const previous = document.createElement('button');
        previous.className = 'btn btn-outline';
        previous.type = 'button';
        previous.textContent = 'Previous';
        previous.disabled = currentPage === 1;
        previous.addEventListener('click', () => {
            currentPage -= 1;
            render();
        });

        const pageStatus = document.createElement('span');
        pageStatus.className = 'text-muted';
        pageStatus.textContent = `Page ${currentPage} of ${pageCount}`;

        const next = document.createElement('button');
        next.className = 'btn btn-outline';
        next.type = 'button';
        next.textContent = 'Next';
        next.disabled = currentPage === pageCount;
        next.addEventListener('click', () => {
            currentPage += 1;
            render();
        });

        pagination.append(previous, pageStatus, next);
    }

    function render() {
        const filteredServices = getFilteredServices();
        const pageCount = Math.max(1, Math.ceil(filteredServices.length / pageSize));
        currentPage = Math.min(currentPage, pageCount);
        const start = (currentPage - 1) * pageSize;
        const visibleServices = filteredServices.slice(start, start + pageSize);

        serviceList.replaceChildren(...visibleServices.map(createServiceCard));
        resultsLabel.textContent = filteredServices.length
            ? `Showing ${start + 1}–${Math.min(start + pageSize, filteredServices.length)} of ${filteredServices.length} services`
            : 'No services match these filters.';
        if (clearFiltersButton) {
            clearFiltersButton.disabled = !searchInput.value.trim()
                && selectedPlatforms.size === 0
                && selectedFeatures.size === 0
                && sortSelect.value === 'price-asc';
        }
        renderPagination(pageCount);
    }

    searchInput.addEventListener('input', () => {
        currentPage = 1;
        render();
    });
    sortSelect.addEventListener('change', () => {
        currentPage = 1;
        render();
    });

    if (clearFiltersButton) {
        clearFiltersButton.addEventListener('click', () => {
            searchInput.value = '';
            sortSelect.value = 'price-asc';
            selectedPlatforms.clear();
            selectedFeatures.clear();
            platformFilters.querySelectorAll('input[type="checkbox"]').forEach((input) => {
                input.checked = false;
            });
            featureFilterInputs.forEach((input) => {
                input.checked = false;
            });
            currentPage = 1;
            render();
        });
    }

    render();
});
