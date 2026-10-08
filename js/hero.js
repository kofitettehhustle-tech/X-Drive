document.addEventListener('DOMContentLoaded', () => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const asciiContainer = document.getElementById('asciiVisual');
    
    if (asciiContainer) {
        setTimeout(() => {
            asciiContainer.classList.add('visible');
        }, 200);
        
        if (!prefersReducedMotion) {
            const hero = asciiContainer.closest('.x-drive-hero');
            hero?.addEventListener('pointermove', (event) => {
                const bounds = hero.getBoundingClientRect();
                const offsetX = ((event.clientX - bounds.left) / bounds.width - 0.5) * -12;
                const offsetY = ((event.clientY - bounds.top) / bounds.height - 0.5) * -8;
                asciiContainer.style.setProperty('--pointer-x', `${offsetX}px`);
                asciiContainer.style.setProperty('--pointer-y', `${offsetY}px`);
            });
        }
    }
});
