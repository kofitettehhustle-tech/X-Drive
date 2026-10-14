(() => {
    const form = document.getElementById('checkout-form');
    if (!form || !window.xdriveAPI) return;

    const qtyInput = document.getElementById('quantity-input');
    const linkInput = document.getElementById('target-link');
    const emailInput = document.getElementById('customer-email');
    const passwordInput = document.getElementById('account-password');
    const passwordGroup = document.getElementById('password-group');
    const statusNode = document.getElementById('checkout-status');
    const submitButton = document.getElementById('submit-payment');
    const modeButtons = {
        login: document.getElementById('toggle-signin'),
        register: document.getElementById('toggle-register'),
        guest: document.getElementById('account-cancel')
    };
    const signOutButton = document.getElementById('sign-out');

    let selectedService = null;
    let accountMode = 'guest';
    let securityConfig = null;
    let idempotencyKey = '';
    let guestTrackingToken = '';

    function resetCheckoutAttempt() {
        idempotencyKey = '';
        guestTrackingToken = '';
    }

    function setStatus(message, isError = false) {
        statusNode.textContent = message;
        statusNode.setAttribute('aria-invalid', isError ? 'true' : 'false');
    }

    function formatCurrency(amount) {
        const displayCurrency = (window.XDRIVE_DISPLAY_CURRENCY || 'GHS').toUpperCase();
        return typeof window.formatCurrency === 'function'
            ? window.formatCurrency(amount, displayCurrency)
            : new Intl.NumberFormat('en-US', { style: 'currency', currency: displayCurrency }).format(amount);
    }

    function createOpaqueToken() {
        if (!window.crypto?.getRandomValues || !window.btoa) throw new Error('Secure guest tracking is unavailable in this browser.');
        const bytes = new Uint8Array(32);
        window.crypto.getRandomValues(bytes);
        let binary = '';
        bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
        const rawToken = window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
        return `xdrive_guest_${rawToken}`;
    }

    function setAccountMode(mode) {
        accountMode = mode;
        const authenticated = Boolean(window.xdriveAPI.customer && window.xdriveAPI.accessToken);
        passwordGroup.hidden = mode === 'guest' || authenticated;
        passwordInput.required = mode !== 'guest' && !authenticated;
        passwordInput.value = '';
        modeButtons.guest.hidden = mode === 'guest' || authenticated;
        modeButtons.login.setAttribute('aria-pressed', String(mode === 'login'));
        modeButtons.register.setAttribute('aria-pressed', String(mode === 'register'));
        modeButtons.login.hidden = authenticated;
        modeButtons.register.hidden = authenticated;
        signOutButton.hidden = !authenticated;
        submitButton.textContent = mode === 'login' && !authenticated
            ? 'Sign in & continue to Paystack'
            : mode === 'register' && !authenticated
                ? 'Create account & continue'
                : 'Continue to Paystack';
        if (!authenticated) {
            document.getElementById('account-state').textContent = mode === 'guest'
                ? 'Guest checkout is available. A private tracking token will be saved in this browser session.'
                : mode === 'login'
                    ? 'Sign in with your X-Drive account. Your orders will be linked to your account.'
                    : 'Create an account with a password of at least 12 characters. Your orders and wallet will be linked to it.';
        }
    }

    function showAuthenticated(customer) {
        window.xdriveAPI.customer = customer;
        emailInput.value = customer.email;
        emailInput.readOnly = true;
        passwordInput.value = '';
        accountMode = 'guest';
        setAccountMode('guest');
        document.getElementById('account-state').textContent = `Signed in as ${customer.email}. This order will be linked to your account.`;
    }

    function updateSummary() {
        if (!selectedService) return;
        const quantity = Number.parseInt(qtyInput.value, 10) || 0;
        document.getElementById('summary-qty').textContent = quantity.toLocaleString();
        document.getElementById('summary-total').textContent = formatCurrency(quantity / 1000 * selectedService.pricePer1000);
    }

    const walletPayOption = document.getElementById('wallet-pay-option');
    const walletUseBalance = document.getElementById('use-wallet-balance');
    const walletBalanceNote = document.getElementById('wallet-balance-note');
    let walletBalance = 0;
    let walletCurrency = 'GHS';
    let walletOrderPaymentsEnabled = false;

    function getOrderTotalMinor() {
        if (!selectedService) return 0;
        const quantity = Number(qtyInput.value || 0);
        const priceTotal = (quantity / 1000) * Number(selectedService.pricePer1000 || 0);
        return Math.round(priceTotal * 100);
    }

    function updateWalletPaymentOption() {
        const signedIn = Boolean(window.xdriveAPI.accessToken);
        if (!signedIn || !walletOrderPaymentsEnabled) {
            walletPayOption.hidden = true;
            walletUseBalance.checked = false;
            return;
        }
        const totalMinor = getOrderTotalMinor();
        const enough = walletBalance >= totalMinor;
        walletPayOption.hidden = false;
        walletUseBalance.disabled = !enough;
        if (!enough) {
            walletUseBalance.checked = false;
            walletBalanceNote.textContent = `Wallet available: ${new Intl.NumberFormat('en-US', { style: 'currency', currency: walletCurrency }).format(walletBalance / 100)}. Need ${new Intl.NumberFormat('en-US', { style: 'currency', currency: walletCurrency }).format(totalMinor / 100)}.`;
            return;
        }
        walletBalanceNote.textContent = `Wallet available: ${new Intl.NumberFormat('en-US', { style: 'currency', currency: walletCurrency }).format(walletBalance / 100)}. This order can be paid from wallet balance.`;
    }

    async function loadWalletStatus() {
        if (!window.xdriveAPI.accessToken) return;
        try {
            const wallet = await window.xdriveAPI.getWallet();
            walletBalance = Number(wallet.balanceMinor || 0);
            walletCurrency = wallet.currency || securityConfig?.currency || 'GHS';
            walletOrderPaymentsEnabled = Boolean(wallet.walletOrderPaymentsEnabled);
            updateWalletPaymentOption();
        } catch {
            walletOrderPaymentsEnabled = false;
            walletPayOption.hidden = true;
        }
    }

    async function initialize() {
        const params = new URLSearchParams(window.location.search);
        const serviceId = params.get('service');
        try {
            const [catalog, config] = await Promise.all([
                window.XDriveCatalog.load(),
                window.xdriveAPI.getSecurityConfig()
            ]);
            securityConfig = config;
            selectedService = catalog.services?.find((service) => service.id === serviceId) || null;
            if (!selectedService) {
                setStatus('This service link is missing or no longer available. Return to Services and select a service.', true);
                submitButton.disabled = true;
                return;
            }
            document.getElementById('summary-platform').textContent = selectedService.platform;
            document.getElementById('summary-name').textContent = selectedService.title;
            document.getElementById('summary-price').textContent = formatCurrency(selectedService.pricePer1000);
            qtyInput.min = selectedService.minimum;
            qtyInput.max = selectedService.maximum;
            qtyInput.value = selectedService.minimum;
            document.getElementById('qty-limits').textContent = `Min: ${selectedService.minimum.toLocaleString()} | Max: ${selectedService.maximum.toLocaleString()}`;
            updateSummary();

            if (catalog.source === 'mock') {
                setStatus('The live service catalog is unavailable. Orders cannot be created from preview data.', true);
                submitButton.disabled = true;
            } else if (!config.paymentEnabled) {
                setStatus('Paystack test checkout is not enabled on the server yet. No payment or order has been created.', true);
                submitButton.disabled = true;
            } else if (config.livePaymentsEnabled || config.realFulfillmentEnabled) {
                setStatus('Checkout configuration is not in the approved test-only mode. Contact X-Drive before continuing.', true);
                submitButton.disabled = true;
            } else {
                setStatus('Test-mode checkout is available. The server will revalidate the service price and quantity before redirecting.');
            }
        } catch (error) {
            setStatus(`Checkout could not load the live service and payment configuration: ${error.message}`, true);
            submitButton.disabled = true;
        }

        if (window.xdriveAPI.accessToken) {
            try {
                const current = await window.xdriveAPI.getCurrentCustomer();
                if (current.authenticated && current.customer) {
                    window.xdriveAPI.setSession({ accessToken: window.xdriveAPI.accessToken, customer: current.customer });
                    showAuthenticated(current.customer);
                } else {
                    window.xdriveAPI.clearSession();
                }
            } catch {
                window.xdriveAPI.clearSession();
            }
        }
    }

    modeButtons.login.addEventListener('click', () => {
        resetCheckoutAttempt();
        passwordInput.autocomplete = 'current-password';
        setAccountMode('login');
        passwordInput.focus();
    });
    modeButtons.register.addEventListener('click', () => {
        resetCheckoutAttempt();
        passwordInput.autocomplete = 'new-password';
        setAccountMode('register');
        passwordInput.focus();
    });
    modeButtons.guest.addEventListener('click', () => {
        resetCheckoutAttempt();
        emailInput.readOnly = false;
        emailInput.value = '';
        passwordInput.autocomplete = 'current-password';
        setAccountMode('guest');
    });
    signOutButton.addEventListener('click', async () => {
        try { await window.xdriveAPI.logout(); } catch { /* The client clears the local token even if the server cannot be reached. */ }
        resetCheckoutAttempt();
        emailInput.readOnly = false;
        emailInput.value = '';
        setAccountMode('guest');
        document.getElementById('account-state').textContent = 'Signed out. You can continue as a guest or use another account.';
    });

    qtyInput.addEventListener('input', () => {
        updateSummary();
        updateWalletPaymentOption();
    });
    [linkInput, emailInput, qtyInput].forEach((input) => input.addEventListener('input', resetCheckoutAttempt));

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!selectedService || !securityConfig?.paymentEnabled || submitButton.disabled) return;
        if (!form.reportValidity()) return;
        const quantity = Number(qtyInput.value);
        if (!Number.isSafeInteger(quantity) || quantity < selectedService.minimum || quantity > selectedService.maximum) {
            setStatus(`Quantity must be a whole number between ${selectedService.minimum.toLocaleString()} and ${selectedService.maximum.toLocaleString()}.`, true);
            return;
        }

        const useWallet = walletOrderPaymentsEnabled && walletUseBalance && walletUseBalance.checked;
        const totalMinor = getOrderTotalMinor();
        if (useWallet) {
            if (walletBalance < totalMinor) {
                setStatus('Your wallet balance is not enough for this order. Use Paystack or add more funds.', true);
                return;
            }
            setStatus('Paying from wallet balance…');
            submitButton.disabled = true;
            try {
                const orderData = {
                    serviceId: selectedService.id,
                    link: linkInput.value.trim(),
                    quantity,
                    customerEmail: emailInput.value.trim()
                };
                const idKey = idempotencyKey || (window.crypto.randomUUID ? window.crypto.randomUUID() : String(Date.now()));
                const result = await window.xdriveAPI.payOrderFromWallet(orderData, idKey);
                if (result.order) {
                    setStatus('Wallet payment successful. Your order is recorded and will be processed when fulfillment is enabled.');
                    submitButton.disabled = false;
                    submitButton.textContent = 'Order placed';
                    return;
                }
                throw new Error(result.error || 'Wallet payment could not be completed.');
            } catch (error) {
                setStatus(error.message || 'Wallet payment failed.', true);
                submitButton.disabled = false;
                return;
            }
        }

        submitButton.disabled = true;
        const originalText = submitButton.textContent;
        submitButton.textContent = 'Preparing secure checkout…';
        setStatus('Validating your order and requesting a Paystack test checkout link.');
        try {
            let email = emailInput.value.trim();
            if (!window.xdriveAPI.accessToken && accountMode !== 'guest') {
                const session = accountMode === 'register'
                    ? await window.xdriveAPI.register(email, passwordInput.value)
                    : await window.xdriveAPI.login(email, passwordInput.value);
                showAuthenticated(session.customer);
                email = session.customer.email;
            }

            if (!window.xdriveAPI.accessToken) {
                guestTrackingToken = guestTrackingToken || createOpaqueToken();
            }
            idempotencyKey = idempotencyKey || (window.crypto.randomUUID
                ? window.crypto.randomUUID()
                : createOpaqueToken());

            const result = await window.xdriveAPI.initializeOrderPayment({
                serviceId: selectedService.id,
                link: linkInput.value.trim(),
                quantity,
                customerEmail: email
            }, {
                trackingToken: window.xdriveAPI.accessToken ? null : guestTrackingToken,
                idempotencyKey
            });

            const destination = new URL(result.authorizationUrl);
            if (destination.protocol !== 'https:' || destination.hostname !== 'checkout.paystack.com') {
                throw new Error('The payment provider returned an unexpected checkout address. No redirect was made.');
            }
            window.sessionStorage.setItem('xdrive_payment_context', JSON.stringify({
                kind: 'order',
                orderId: result.orderId,
                reference: result.reference,
                trackingToken: result.trackingToken || null
            }));
            window.location.assign(destination.href);
        } catch (error) {
            setStatus(error.message || 'Checkout could not be started. No service has been submitted.', true);
            submitButton.disabled = false;
            submitButton.textContent = originalText;
        }
    });

    setAccountMode('guest');
    initialize();
    loadWalletStatus();
})();
