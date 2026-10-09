(() => {
    const header = document.querySelector('.home-page .site-header');
    if (!header) return;

    const scrollThreshold = 48;
    let scheduledFrame = 0;

    function updateHeaderState() {
        header.classList.toggle('is-scrolled', window.scrollY > scrollThreshold);
        scheduledFrame = 0;
    }

    function scheduleHeaderUpdate() {
        if (scheduledFrame) return;
        scheduledFrame = window.requestAnimationFrame(updateHeaderState);
    }

    window.addEventListener('scroll', scheduleHeaderUpdate, { passive: true });
    window.addEventListener('pageshow', scheduleHeaderUpdate);
    updateHeaderState();
})();
