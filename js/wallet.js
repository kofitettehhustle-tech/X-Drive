(() => {
    const accountForm = document.getElementById('wallet-account-form');
    const depositForm = document.getElementById('deposit-form');
    const content = document.getElementById('wallet-content');
    const accountStatus = document.getElementById('wallet-account-status');
    const walletState = document.getElementById('wallet-state');
    const depositStatus = document.getElementById('deposit-status');
    const emailInput = document.getElementById('wallet-email');
    const passwordInput = document.getElementById('wallet-password');
    const loginButton = document.getElementById('wallet-login');
    const registerButton = document.getElementById('wallet-register');
    const logoutButton = document.getElementById('wallet-logout');
    const depositButton = document.getElementById('deposit-button');
    const payFromWalletButton = document.getElementById('wallet-pay-now');
    const useWalletSection = document.getElementById('wallet-use-section');
    let limits = { minMinor: 100, maxMinor: 500000 };
    let paymentEnabled = false;
    let walletOrderPaymentsEnabled = false;

    function setStatus(node, text, error = false) {
        node.textContent = text;
        node.setAttribute('aria-invalid', String(error));
    }

    function formatMoney(minor, currency = 'USD') {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(minor || 0) / 100);
    }

    function parseMinorUnits(value) {
        const text = String(value).trim();
        if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
        const [whole, fractional = ''] = text.split('.');
        const minor = Number(whole) * 100 + Number((fractional + '00').slice(0, 2));
        return Number.isSafeInteger(minor) ? minor : null;
    }

    function setAccount(customer) {
        emailInput.value = customer.email;
        emailInput.readOnly = true;
        passwordInput.hidden = true;
        passwordInput.required = false;
        loginButton.hidden = true;
        registerButton.hidden = true;
        logoutButton.hidden = false;
        content.hidden = false;
        setStatus(accountStatus, `Signed in as ${customer.email}.`);
        refreshWallet();
    }

    function setSignedOut() {
        emailInput.readOnly = false;
        passwordInput.hidden = false;
        passwordInput.required = true;
        loginButton.hidden = false;
        registerButton.hidden = false;
        logoutButton.hidden = true;
        content.hidden = true;
    }

    async function refreshWallet() {
        try {
            const wallet = await window.xdriveAPI.getWallet();
            document.getElementById('wallet-balance').textContent = formatMoney(wallet.balanceMinor, wallet.currency || 'USD');
            limits = wallet.depositLimits || limits;
            walletOrderPaymentsEnabled = Boolean(wallet.walletOrderPaymentsEnabled);
            const amountInput = document.getElementById('deposit-amount');
            amountInput.min = (limits.minMinor / 100).toFixed(2);
            amountInput.max = (limits.maxMinor / 100).toFixed(2);
            setStatus(walletState, `Deposit limits: ${formatMoney(limits.minMinor, wallet.currency)} to ${formatMoney(limits.maxMinor, wallet.currency)}. Wallet-funded service orders are ${walletOrderPaymentsEnabled ? 'enabled' : 'disabled'}.`);
            const transactions = document.getElementById('wallet-transactions');
            transactions.replaceChildren();
            if (!wallet.transactions?.length) {
                transactions.textContent = 'No wallet activity yet.';
                return;
            }
            for (const entry of wallet.transactions) {
                const row = document.createElement('div');
                row.className = 'wallet-row';
                const label = document.createElement('span');
                label.textContent = `${entry.kind.replaceAll('_', ' ')} · ${new Date(entry.createdAt).toLocaleString()}`;
                const amount = document.createElement('strong');
                amount.textContent = formatMoney(entry.amountMinor, entry.currency);
                row.append(label, amount);
                transactions.appendChild(row);
            }
        } catch (error) {
            setStatus(walletState, error.message, true);
        }
    }

    async function login() {
        const result = await window.xdriveAPI.login(emailInput.value.trim(), passwordInput.value);
        passwordInput.value = '';
        setAccount(result.customer);
    }

    accountForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!accountForm.reportValidity()) return;
        loginButton.disabled = true;
        try { await login(); } catch (error) { setStatus(accountStatus, error.message, true); }
        finally { loginButton.disabled = false; }
    });

    registerButton.addEventListener('click', async () => {
        if (!emailInput.value.trim() || passwordInput.value.length < 12) {
            setStatus(accountStatus, 'Enter a valid email and a password of at least 12 characters.', true);
            return;
        }
        registerButton.disabled = true;
        try {
            const result = await window.xdriveAPI.register(emailInput.value.trim(), passwordInput.value);
            passwordInput.value = '';
            setAccount(result.customer);
        } catch (error) { setStatus(accountStatus, error.message, true); }
        finally { registerButton.disabled = false; }
    });

    logoutButton.addEventListener('click', async () => {
        await window.xdriveAPI.logout().catch(() => {});
        setSignedOut();
        setStatus(accountStatus, 'Signed out.');
    });

    depositForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!depositForm.reportValidity()) return;
        if (!paymentEnabled) {
            setStatus(depositStatus, 'Paystack test checkout is not enabled on the server. No deposit was created.', true);
            return;
        }
        const amountMinor = parseMinorUnits(document.getElementById('deposit-amount').value);
        if (amountMinor === null || amountMinor < limits.minMinor || amountMinor > limits.maxMinor) {
            setStatus(depositStatus, `Enter a deposit from ${formatMoney(limits.minMinor)} to ${formatMoney(limits.maxMinor)}.`, true);
            return;
        }
        depositButton.disabled = true;
        setStatus(depositStatus, 'Requesting a secure Paystack test checkout…');
        try {
            const key = window.crypto.randomUUID();
            const result = await window.xdriveAPI.initializeWalletDeposit(amountMinor, key);
            const destination = new URL(result.authorizationUrl);
            if (destination.protocol !== 'https:' || destination.hostname !== 'checkout.paystack.com') {
                throw new Error('The payment provider returned an unexpected checkout address. No redirect was made.');
            }
            window.sessionStorage.setItem('xdrive_payment_context', JSON.stringify({
                kind: 'wallet_deposit', reference: result.reference
            }));
            window.location.assign(destination.href);
        } catch (error) {
            setStatus(depositStatus, error.message || 'The deposit could not be started. No wallet funds were added.', true);
            depositButton.disabled = false;
        }
    });

    (async () => {
        try {
            const config = await window.xdriveAPI.getSecurityConfig();
            paymentEnabled = Boolean(config.paymentEnabled && !config.livePaymentsEnabled && !config.realFulfillmentEnabled);
            if (!paymentEnabled) {
                depositButton.disabled = true;
                setStatus(depositStatus, 'Paystack test checkout is not enabled on the server yet.');
            }
        } catch (error) {
            setStatus(depositStatus, `Payment configuration unavailable: ${error.message}`, true);
            depositButton.disabled = true;
        }
        await maybeLoadWalletUseState();
        if (window.xdriveAPI.accessToken) {
            try {
                const current = await window.xdriveAPI.getCurrentCustomer();
                if (current.authenticated && current.customer) {
                    window.xdriveAPI.setSession({ accessToken: window.xdriveAPI.accessToken, customer: current.customer });
                    setAccount(current.customer);
                } else {
                    window.xdriveAPI.clearSession();
                    setSignedOut();
                }
            } catch {
                window.xdriveAPI.clearSession();
                setSignedOut();
            }
        } else {
            setSignedOut();
        }
    })();
})();

async function maybeLoadWalletUseState() {
    if (!window.xdriveAPI.accessToken) return;
    try {
        const wallet = await window.xdriveAPI.getWallet();
        walletOrderPaymentsEnabled = Boolean(wallet.walletOrderPaymentsEnabled);
        if (walletOrderPaymentsEnabled && useWalletSection) {
            useWalletSection.hidden = false;
            useWalletSection.textContent = 'Wallet order payments are enabled. You can use your balance on checkout when available.';
        }
    } catch {
        walletOrderPaymentsEnabled = false;
    }
}
