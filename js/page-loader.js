(() => {
    const root = document.documentElement;
    const loader = () => document.getElementById('xdrive-page-loader');
    const prefersReducedMotion = Boolean(
        window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
    const minimumDisplayMs = prefersReducedMotion ? 240 : 850;
    const startedAt = Number.isFinite(window.__xDriveLoaderStartedAt)
        ? window.__xDriveLoaderStartedAt
        : performance.now();
    let dismissed = false;

    function dismissLoader() {
        if (dismissed) return;
        dismissed = true;

        const remaining = Math.max(0, minimumDisplayMs - (performance.now() - startedAt));
        window.setTimeout(() => {
            const element = loader();
            if (element) element.classList.add('is-hiding');

            window.setTimeout(() => {
                root.classList.remove('xdrive-booting');
                if (element) element.remove();
            }, prefersReducedMotion ? 0 : 420);
        }, remaining);
    }

    if (document.readyState === 'complete') dismissLoader();
    else window.addEventListener('load', dismissLoader, { once: true });

    // Keep a broken or unusually slow third-party asset from trapping the visitor.
    window.setTimeout(dismissLoader, 5500);
})();
