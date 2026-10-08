// Main Application Logic for X Drive

document.addEventListener('DOMContentLoaded', () => {
    const revealItems = document.querySelectorAll('[data-scroll-reveal]');
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (revealItems.length && !prefersReducedMotion && 'IntersectionObserver' in window) {
        document.documentElement.classList.add('scroll-reveal-enabled');

        const revealObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.16 });

        revealItems.forEach((item) => {
            const revealDelay = Number(item.dataset.revealDelay);
            if (Number.isFinite(revealDelay)) {
                item.style.setProperty('--reveal-delay', `${revealDelay}ms`);
            }
            revealObserver.observe(item);
        });
    }

    const deliverySpeedStrip = document.querySelector('[data-delivery-speed]');
    const deliverySpeed = window.XDriveMoreThanPanelDeliverySpeed;

    if (deliverySpeedStrip && deliverySpeed) {
        const message = deliverySpeedStrip.querySelector('[data-delivery-speed-message]');
        const updated = deliverySpeedStrip.querySelector('[data-delivery-speed-updated]');

        if (typeof deliverySpeed.message === 'string' && deliverySpeed.message.trim()) {
            message.textContent = deliverySpeed.message;
        }

        if (typeof deliverySpeed.updatedAt === 'string' && deliverySpeed.updatedAt.trim()) {
            updated.textContent = `Updated ${deliverySpeed.updatedAt}`;
            updated.hidden = false;
        }
    }

    // 1. Mobile Navigation Toggle
    const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
    const navLinks = document.querySelector('.nav-links');
    
    if (mobileMenuBtn && navLinks) {
        mobileMenuBtn.addEventListener('click', () => {
            // Simple toggle for demonstration. 
            // In a real app, this would use a class toggle and CSS transitions
            if (navLinks.style.display === 'flex') {
                navLinks.style.display = 'none';
            } else {
                navLinks.style.display = 'flex';
                navLinks.style.flexDirection = 'column';
                navLinks.style.position = 'absolute';
                navLinks.style.top = '72px';
                navLinks.style.left = '0';
                navLinks.style.width = '100%';
                navLinks.style.backgroundColor = 'var(--color-surface)';
                navLinks.style.padding = 'var(--space-md)';
                navLinks.style.borderBottom = '1px solid var(--color-border)';
            }
        });
    }

    // 2. Dashboard Sidebar Toggle (if on dashboard pages)
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebar = document.querySelector('.sidebar');
    
    if (sidebarToggle && sidebar) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
        });
    }

    // 3. Format Currency Helper
    window.formatCurrency = (amount, currency = 'USD') => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency
        }).format(amount);
    };

    // 4. Utility: Populate Services Table (Example for Reseller/Admin)
    window.populateServicesTable = (tableBodyId, role = 'CUSTOMER') => {
        const tbody = document.getElementById(tableBodyId);
        if (!tbody || !window.XDriveMockData) return;

        tbody.innerHTML = '';
        
        window.XDriveMockData.services.forEach(service => {
            const tr = document.createElement('tr');
            
            let priceHtml = '';
            let actionHtml = '';

            if (role === 'MASTER_ADMIN') {
                priceHtml = `
                    <td>${window.formatCurrency(service.supplierCost)}</td>
                    <td>${window.formatCurrency(service.xDriveBasePrice)}</td>
                    <td>${service.defaultResellerMarkup * 100}%</td>
                `;
                actionHtml = `<td><button class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.875rem;">Edit</button></td>`;
            } else if (role === 'RESELLER') {
                const profit = service.currentResellerPrice - service.xDriveBasePrice;
                priceHtml = `
                    <td>${window.formatCurrency(service.xDriveBasePrice)}</td>
                    <td>${window.formatCurrency(service.currentResellerPrice)}</td>
                    <td class="text-success">${window.formatCurrency(profit)}</td>
                `;
                actionHtml = `<td><button class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.875rem;">Set Price</button></td>`;
            } else {
                // Customer
                priceHtml = `<td>${window.formatCurrency(service.currentResellerPrice)} / 1K</td>`;
                actionHtml = `<td><button class="btn btn-primary" style="padding: 0.25rem 0.5rem; font-size: 0.875rem;">Order</button></td>`;
            }

            tr.innerHTML = `
                <td>${service.platform}</td>
                <td><strong>${service.name}</strong></td>
                ${priceHtml}
                <td><span class="badge ${service.enabled ? 'badge-success' : 'badge-danger'}">${service.enabled ? 'Enabled' : 'Disabled'}</span></td>
                ${actionHtml}
            `;
            
            tbody.appendChild(tr);
        });
    };
});
