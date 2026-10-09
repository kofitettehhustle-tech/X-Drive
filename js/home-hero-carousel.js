(() => {
    const carousel = document.querySelector('[data-home-hero]');
    if (!carousel) return;

    const slides = [
        {
            eyebrow: 'SOCIAL GROWTH, SIMPLIFIED',
            lines: ['GROW YOUR', 'SOCIAL PRESENCE.'],
            description: 'Powerful social-media growth services for creators, brands and businesses.',
            action: 'Learn more',
            href: 'services.html',
            label: 'Social growth'
        },
        {
            eyebrow: 'BUSINESS PRESENCE',
            lines: ['GET FOUND', 'GROW LOCALLY.'],
            description: 'Build a clearer Google Search presence and make it easier for nearby customers to find you.',
            action: 'Explore business services',
            href: 'services.html#business-presence',
            label: 'Business presence'
        },
        {
            eyebrow: 'ARTIST SERVICES',
            lines: ['LET THE WORK', 'TRAVEL FURTHER.'],
            description: 'Help listeners discover your music with artist pages, release details, and authorized downloads.',
            action: 'Explore artist services',
            href: 'services.html#artist-services',
            label: 'Artist services'
        }
    ];

    const content = carousel.querySelector('[data-hero-content]');
    const eyebrow = carousel.querySelector('[data-hero-eyebrow]');
    const title = carousel.querySelector('[data-hero-title]');
    const titleLines = [...carousel.querySelectorAll('[data-hero-title-line]')];
    const description = carousel.querySelector('[data-hero-description]');
    const action = carousel.querySelector('[data-hero-cta]');
    const actionLabel = carousel.querySelector('[data-hero-cta-label]');
    const indicators = [...carousel.querySelectorAll('[data-hero-slide-to]')];
    const previous = carousel.querySelector('[data-hero-previous]');
    const next = carousel.querySelector('[data-hero-next]');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let activeIndex = 0;
    let updateTimer = 0;

    function updateSlide(index, animate = true) {
        const nextIndex = (index + slides.length) % slides.length;
        const slide = slides[nextIndex];
        window.clearTimeout(updateTimer);

        const apply = () => {
            activeIndex = nextIndex;
            carousel.dataset.slide = String(nextIndex + 1);
            eyebrow.textContent = slide.eyebrow;
            titleLines.forEach((line, lineIndex) => {
                line.textContent = slide.lines[lineIndex] || '';
            });
            title.setAttribute('aria-label', slide.lines.join(' '));
            description.textContent = slide.description;
            action.href = slide.href;
            actionLabel.textContent = slide.action;

            indicators.forEach((indicator, indicatorIndex) => {
                const isCurrent = indicatorIndex === nextIndex;
                indicator.classList.toggle('is-active', isCurrent);
                indicator.setAttribute('aria-current', String(isCurrent));
            });

            content.classList.remove('is-changing');
        };

        if (animate && !reduceMotion) {
            content.classList.add('is-changing');
            updateTimer = window.setTimeout(apply, 180);
        } else {
            content.classList.remove('is-changing');
            apply();
        }
    }

    previous?.addEventListener('click', () => updateSlide(activeIndex - 1));
    next?.addEventListener('click', () => updateSlide(activeIndex + 1));
    indicators.forEach((indicator) => {
        indicator.addEventListener('click', () => {
            updateSlide(Number(indicator.dataset.heroSlideTo));
        });
    });

    updateSlide(0, false);
})();
