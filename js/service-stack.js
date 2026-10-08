document.addEventListener('DOMContentLoaded', async () => {
    if (!window.XDriveCatalog) return;

    const catalog = await window.XDriveCatalog.load();
    const services = window.XDriveCatalog.getFeaturedServices(catalog.services);
    const stackContainer = document.getElementById('card-stack');
    const dotsContainer = document.getElementById('stack-dots');
    const interactiveArea = document.querySelector('.service-stack-interactive');
    const catalogNote = document.querySelector('[data-featured-catalog-note]');

    if (catalogNote) {
        if (catalog.source === 'morethanpanel') {
            const updatedAt = window.XDriveCatalog.formatUpdatedAt(catalog.updatedAt);
            catalogNote.textContent = updatedAt
                ? `X Drive weekly picks · updated ${updatedAt}`
                : 'X Drive weekly picks';
        } else {
            catalogNote.textContent = 'X Drive preview picks · weekly catalog sync is not connected.';
        }
    }
    
    if (!stackContainer || !dotsContainer || !interactiveArea) return;
    if (!services.length) {
        stackContainer.textContent = 'No social services are available right now.';
        return;
    }
    
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let activeIndex = 0;
    let cards = [];
    let dots = [];
    let autoAdvanceTimer = null;
    let isDragging = false;
    let startX = 0;
    let currentX = 0;
    
    // Initialize cards
    services.forEach((service, index) => {
        // Build card HTML
        const card = document.createElement('div');
        card.className = 'service-card';
        card.setAttribute('data-index', index);
        card.setAttribute('role', 'group');
        card.setAttribute('aria-roledescription', 'slide');
        card.setAttribute('aria-label', `${service.platform}: ${service.title}`);
        card.addEventListener('animationend', (event) => {
            if (event.animationName === 'featuredCardArrival') {
                card.classList.remove('is-entering');
            }
        });
        
        const num = (index + 1).toString().padStart(2, '0');

        const details = document.createElement('div');
        const header = document.createElement('div');
        header.className = 'card-header';
        const number = document.createElement('span');
        number.className = 'card-number';
        number.textContent = num;
        const platform = document.createElement('span');
        platform.className = 'card-platform';
        platform.textContent = service.platform;
        header.append(number, platform);

        const title = document.createElement('h3');
        title.className = 'card-title';
        title.textContent = service.title;
        const description = document.createElement('p');
        description.className = 'card-desc';
        description.textContent = service.description || `${service.category} for ${service.platform}`;
        details.append(header, title, description);

        const order = document.createElement('div');
        const pricing = document.createElement('div');
        pricing.className = 'card-pricing';
        const price = document.createElement('div');
        price.className = 'card-price';
        price.textContent = `From ${window.formatCurrency(service.pricePer1000)} / 1K`;
        const range = document.createElement('div');
        range.className = 'card-meta';
        range.textContent = `Min ${service.minimum.toLocaleString()} · Max ${service.maximum.toLocaleString()}`;
        pricing.append(price, range);

        const cta = document.createElement('a');
        cta.className = 'card-cta';
        cta.href = `services.html?service=${encodeURIComponent(service.id)}`;
        cta.tabIndex = -1;
        cta.textContent = 'View Service';
        order.append(pricing, cta);
        card.append(details, order);
        
        stackContainer.appendChild(card);
        cards.push(card);
        
        // Build dot
        const dot = document.createElement('button');
        dot.className = 'stack-dot';
        dot.setAttribute('aria-label', `Go to service ${index + 1}`);
        dot.addEventListener('click', () => {
            goToCard(index);
            resetAutoAdvance();
        });
        dotsContainer.appendChild(dot);
        dots.push(dot);
        
        // Drag events
        if (!prefersReducedMotion) {
            card.addEventListener('pointerdown', handlePointerDown);
        }
    });
    
    // Initial update
    updateStack();
    startAutoAdvance();
    
    // Controls
    document.getElementById('stack-prev')?.addEventListener('click', () => {
        prevCard();
        resetAutoAdvance();
    });
    
    document.getElementById('stack-next')?.addEventListener('click', () => {
        nextCard();
        resetAutoAdvance();
    });
    
    // Keyboard support
    interactiveArea.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') {
            prevCard();
            resetAutoAdvance();
            e.preventDefault();
        } else if (e.key === 'ArrowRight') {
            nextCard();
            resetAutoAdvance();
            e.preventDefault();
        }
    });
    
    // Hover pause
    interactiveArea.addEventListener('mouseenter', stopAutoAdvance);
    interactiveArea.addEventListener('mouseleave', () => {
        if (!isDragging) startAutoAdvance();
    });
    
    // Core update logic
    function updateStack(arrivalDirection = 1) {
        cards.forEach((card, cardIndex) => {
            // Calculate relative offset (0 = active, 1 = behind, 2 = behind that...)
            const wasActive = card.classList.contains('active');
            const diff = (cardIndex - activeIndex + cards.length) % cards.length;
            
            const cta = card.querySelector('.card-cta');
            if (diff === 0) {
                // Active Card
                card.className = 'service-card active';
                if (!wasActive && !prefersReducedMotion) {
                    card.classList.add('is-entering');
                }
                card.style.setProperty('--arrival-direction', arrivalDirection < 0 ? '-1' : '1');
                card.style.transform = `translate3d(-50%, 0, 0px) scale(1) rotate(0deg)`;
                card.style.opacity = '1';
                card.style.zIndex = '10';
                card.style.boxShadow = '0 20px 40px -10px rgba(0,0,0,0.8)';
                card.setAttribute('aria-hidden', 'false');
                cta.setAttribute('tabindex', '0');
            } else {
                // Behind Cards
                card.className = 'service-card';
                card.setAttribute('aria-hidden', 'true');
                cta.setAttribute('tabindex', '-1');
                
                const isNextCard = diff === 1;
                const isPreviousCard = cards.length > 2 && diff === cards.length - 1;

                if (isNextCard || isPreviousCard) {
                    const isCompact = window.innerWidth <= 600;
                    const sideOffset = isCompact ? (stackContainer.clientWidth + 10) / 3 : 250;
                    const xOffset = isNextCard ? sideOffset : -sideOffset;
                    const yOffset = isCompact ? 0 : 12;
                    const zOffset = isCompact ? 0 : 24;
                    const rotation = isCompact ? 0 : isNextCard ? 2 : -2;
                    const scale = isCompact ? 1 : 0.92;
                    const opacity = 0.84;
                    const z = 10 - diff;
                    
                    card.style.transform = `translate3d(calc(-50% + ${xOffset}px), -${yOffset}px, -${zOffset}px) scale(${scale}) rotate(${rotation}deg)`;
                    card.style.opacity = opacity.toString();
                    card.style.zIndex = z.toString();
                    card.style.boxShadow = '0 10px 20px -10px rgba(0,0,0,0.5)';
                } else {
                    // Hidden
                    card.style.transform = `translate3d(-50%, -80px, -200px) scale(0.7)`;
                    card.style.opacity = '0';
                    card.style.zIndex = '0';
                }
            }
        });
        
        dots.forEach((dot, i) => {
            if (i === activeIndex) {
                dot.classList.add('active');
                dot.setAttribute('aria-current', 'true');
            } else {
                dot.classList.remove('active');
                dot.setAttribute('aria-current', 'false');
            }
        });
    }
    
    function nextCard() {
        activeIndex = (activeIndex + 1) % cards.length;
        updateStack(1);
    }
    
    function prevCard() {
        activeIndex = (activeIndex - 1 + cards.length) % cards.length;
        updateStack(-1);
    }
    
    function goToCard(targetIndex) {
        const forwardDistance = (targetIndex - activeIndex + cards.length) % cards.length;
        const arrivalDirection = forwardDistance <= cards.length / 2 ? 1 : -1;
        activeIndex = targetIndex;
        updateStack(arrivalDirection);
    }
    
    function startAutoAdvance() {
        if (prefersReducedMotion) return;
        stopAutoAdvance();
        autoAdvanceTimer = setInterval(nextCard, 4500);
    }
    
    function stopAutoAdvance() {
        if (autoAdvanceTimer) {
            clearInterval(autoAdvanceTimer);
            autoAdvanceTimer = null;
        }
    }
    
    function resetAutoAdvance() {
        if (!prefersReducedMotion && !interactiveArea.matches(':hover')) {
            startAutoAdvance();
        }
    }
    
    // Dragging Logic
    function handlePointerDown(e) {
        if (!e.target.closest('.service-card.active')) return;
        
        // Prevent default text selection during drag
        if (e.target.tagName !== 'A') {
            e.preventDefault();
        }
        
        isDragging = true;
        startX = e.clientX;
        stopAutoAdvance();
        
        const activeCard = cards[activeIndex];
        activeCard.classList.add('is-dragging');
        
        // Bind to document to catch drag outside the container
        document.addEventListener('pointermove', handlePointerMove);
        document.addEventListener('pointerup', handlePointerUp);
        document.addEventListener('pointercancel', handlePointerUp);
    }
    
    function handlePointerMove(e) {
        if (!isDragging) return;
        
        currentX = e.clientX - startX;
        
        // Resistance factor
        const moveX = currentX * 0.8; 
        // Slight rotation based on drag
        const rotate = moveX * 0.05;
        
        const activeCard = cards[activeIndex];
        activeCard.style.transform = `translate3d(calc(-50% + ${moveX}px), 0, 0) rotate(${rotate}deg) scale(1)`;
    }
    
    function handlePointerUp() {
        if (!isDragging) return;
        isDragging = false;
        
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', handlePointerUp);
        document.removeEventListener('pointercancel', handlePointerUp);
        
        const activeCard = cards[activeIndex];
        activeCard.classList.remove('is-dragging');
        
        const threshold = 100;
        
        if (currentX < -threshold) {
            nextCard();
        } else if (currentX > threshold) {
            prevCard();
        } else {
            // Snap back
            updateStack(); 
        }
        
        currentX = 0;
        resetAutoAdvance();
    }
    
    // Re-evaluate positions on resize (for mobile stacking switch)
    window.addEventListener('resize', () => {
        if (!isDragging) updateStack();
    });
});
