document.addEventListener('DOMContentLoaded', async () => {
    const serviceList = document.getElementById('service-list');
    const platformFilters = document.getElementById('platform-filters');
    const searchInput = document.getElementById('service-search');
    const sortSelect = document.getElementById('service-sort');
    const resultsLabel = document.getElementById('catalog-results');
    const pagination = document.getElementById('catalog-pagination');
    const catalogMeta = document.getElementById('catalog-meta');
    const pageSize = 30;
    const selectedPlatforms = new Set();
    let currentPage = 1;

    if (!window.XDriveCatalog || !serviceList) return;

    const catalog = await window.XDriveCatalog.load();
    const services = catalog.services;
    const requestedService = new URLSearchParams(window.location.search).get('service');
    const selectedService = services.find((service) => service.id === requestedService);

    if (catalog.source === 'morethanpanel') {
        const updatedAt = window.XDriveCatalog.formatUpdatedAt(catalog.updatedAt);
        catalogMeta.textContent = updatedAt
            ? `X Drive catalog · refreshed ${updatedAt} · updated weekly`
            : 'X Drive catalog · updated weekly';
    } else {
        catalogMeta.textContent = `X Drive preview · ${services.length} sample offers · weekly catalog sync is not connected.`;
    }

    if (requestedService && selectedService) {
        searchInput.value = selectedService.title;
    }

    [...new Set(services.map((service) => service.platform))]
        .sort((first, second) => first.localeCompare(second))
        .forEach((platform) => {
            const label = document.createElement('label');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = platform;
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) selectedPlatforms.add(platform);
                else selectedPlatforms.delete(platform);
                currentPage = 1;
                render();
            });

            const platformName = document.createElement('span');
            platformName.textContent = platform;
            label.append(checkbox, platformName);
            platformFilters.appendChild(label);
        });

    function getFilteredServices() {
        const query = searchInput.value.trim().toLowerCase();
        const filtered = services.filter((service) => {
            if (selectedPlatforms.size && !selectedPlatforms.has(service.platform)) return false;
            if (query && ![
                service.platform,
                service.title,
                service.category,
                service.description
            ].join(' ').toLowerCase().includes(query)) return false;
            return true;
        });

        if (sortSelect.value === 'price-desc') {
            filtered.sort((first, second) => second.pricePer1000 - first.pricePer1000);
        } else if (sortSelect.value === 'platform') {
            filtered.sort((first, second) => first.platform.localeCompare(second.platform) || first.pricePer1000 - second.pricePer1000);
        } else {
            filtered.sort((first, second) => first.pricePer1000 - second.pricePer1000);
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
        platform.textContent = service.platform;
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

        if (service.refillable === true) {
            const refill = document.createElement('span');
            refill.textContent = 'Refill available';
            meta.appendChild(refill);
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

    render();
});