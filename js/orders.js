(() => {
    const accountForm = document.getElementById('account-form');
    const guestForm = document.getElementById('guest-form');
    const accountOrdersNode = document.getElementById('account-orders');
    const guestOrderNode = document.getElementById('guest-order');
    const accountStatus = document.getElementById('account-status');
    const guestStatus = document.getElementById('guest-status');
    const emailInput = document.getElementById('account-email');
    const passwordInput = document.getElementById('account-password');
    const loginButton = document.getElementById('account-login');
    const registerButton = document.getElementById('account-register');
    const logoutButton = document.getElementById('account-logout');
    const loadOrdersButton = document.getElementById('load-account-orders');
    const walletShortcut = document.getElementById('wallet-shortcut');

    function setMessage(node, message, isError = false) {
        node.textContent = message;
        node.setAttribute('aria-invalid', String(isError));
    }

    function orderCard(order) {
        const article = document.createElement('article');
        article.className = 'order-card';
        const heading = document.createElement('h3');
        heading.textContent = `${order.serviceTitle || 'X-Drive service'} — ${order.status || 'Pending'}`;
        article.appendChild(heading);
        const grid = document.createElement('div');
        grid.className = 'order-grid';
        const displayCurrency = (window.XDRIVE_DISPLAY_CURRENCY || 'GHS').toUpperCase();
        const fields = [
            ['Order ID', order.id], ['Platform', order.platform], ['Quantity', Number(order.quantity || 0).toLocaleString()],
            ['Charge', new Intl.NumberFormat('en-US', { style: 'currency', currency: displayCurrency }).format(Number(order.charge || 0))],
            ['Payment', order.paymentStatus || 'pending'], ['Created', order.createdAt ? new Date(order.createdAt).toLocaleString() : '—'],
            ['Target', order.link || '—']
        ];
        for (const [label, value] of fields) {
            const item = document.createElement('div');
            const labelNode = document.createElement('span');
            labelNode.className = 'order-label';
            labelNode.textContent = label;
            const valueNode = document.createElement('span');
            valueNode.className = 'order-value';
            valueNode.textContent = String(value ?? '—');
            item.append(labelNode, valueNode);
            grid.appendChild(item);
        }
        article.appendChild(grid);
        const note = document.createElement('p');
        note.className = 'text-muted';
        note.textContent = 'Real supplier fulfillment is disabled. Payment confirmation does not send this order to a provider.';
        article.appendChild(note);
        return article;
    }

    function showAccount(customer) {
        accountStatus.textContent = `Signed in as ${customer.email}. Account orders are available below.`;
        emailInput.value = customer.email;
        emailInput.readOnly = true;
        passwordInput.hidden = true;
        passwordInput.required = false;
        loginButton.hidden = true;
        registerButton.hidden = true;
        logoutButton.hidden = false;
        loadOrdersButton.hidden = false;
        walletShortcut.hidden = false;
    }

    function showSignedOut() {
        emailInput.readOnly = false;
        passwordInput.hidden = false;
        passwordInput.required = true;
        loginButton.hidden = false;
        registerButton.hidden = false;
        logoutButton.hidden = true;
        loadOrdersButton.hidden = true;
        walletShortcut.hidden = true;
    }

    async function loadAccountOrders() {
        accountOrdersNode.replaceChildren();
        try {
            const result = await window.xdriveAPI.getMyOrders();
            if (!result.orders?.length) {
                accountOrdersNode.textContent = 'No account orders were found.';
                return;
            }
            result.orders.forEach((order) => accountOrdersNode.appendChild(orderCard(order)));
        } catch (error) {
            accountOrdersNode.textContent = error.message;
        }
    }

    async function trackGuestOrder(orderId, token) {
        setMessage(guestStatus, 'Checking the private tracking credentials…');
        guestOrderNode.replaceChildren();
        try {
            const result = await window.xdriveAPI.getOrderStatus(orderId, token);
            if (!result.order) throw new Error('Order not found. Check the ID and private tracking token.');
            guestOrderNode.appendChild(orderCard(result.order));
            setMessage(guestStatus, 'Order details loaded securely.');
        } catch (error) {
            setMessage(guestStatus, error.message, true);
        }
    }

    accountForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!accountForm.reportValidity()) return;
        loginButton.disabled = true;
        try {
            const session = await window.xdriveAPI.login(emailInput.value.trim(), passwordInput.value);
            showAccount(session.customer);
            passwordInput.value = '';
            await loadAccountOrders();
        } catch (error) {
            setMessage(accountStatus, error.message, true);
        } finally {
            loginButton.disabled = false;
        }
    });

    registerButton.addEventListener('click', async () => {
        if (!emailInput.value.trim() || !passwordInput.value) {
            setMessage(accountStatus, 'Enter your email and a password of at least 12 characters to create an account.', true);
            return;
        }
        registerButton.disabled = true;
        try {
            const session = await window.xdriveAPI.register(emailInput.value.trim(), passwordInput.value);
            showAccount(session.customer);
            passwordInput.value = '';
            await loadAccountOrders();
        } catch (error) {
            setMessage(accountStatus, error.message, true);
        } finally {
            registerButton.disabled = false;
        }
    });

    logoutButton.addEventListener('click', async () => {
        await window.xdriveAPI.logout().catch(() => {});
        accountOrdersNode.replaceChildren();
        showSignedOut();
        accountStatus.textContent = 'Signed out.';
    });
    loadOrdersButton.addEventListener('click', loadAccountOrders);

    guestForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!guestForm.reportValidity()) return;
        await trackGuestOrder(
            document.getElementById('guest-order-id').value.trim(),
            document.getElementById('guest-token').value.trim()
        );
    });

    (async () => {
        if (window.xdriveAPI.accessToken) {
            try {
                const current = await window.xdriveAPI.getCurrentCustomer();
                if (current.authenticated && current.customer) {
                    window.xdriveAPI.setSession({ accessToken: window.xdriveAPI.accessToken, customer: current.customer });
                    showAccount(current.customer);
                    await loadAccountOrders();
                } else {
                    window.xdriveAPI.clearSession();
                    showSignedOut();
                }
            } catch {
                window.xdriveAPI.clearSession();
                showSignedOut();
            }
        } else {
            showSignedOut();
        }

        const orderId = new URLSearchParams(window.location.search).get('orderId');
        if (!orderId) return;
        document.getElementById('guest-order-id').value = orderId;
        let context = null;
        try { context = JSON.parse(window.sessionStorage.getItem('xdrive_payment_context') || 'null'); } catch { context = null; }
        if (context?.orderId === orderId && context.trackingToken) {
            document.getElementById('guest-token').value = context.trackingToken;
            await trackGuestOrder(orderId, context.trackingToken);
        } else if (window.xdriveAPI.accessToken) {
            try {
                const result = await window.xdriveAPI.getOrderStatus(orderId);
                if (result.order) accountOrdersNode.prepend(orderCard(result.order));
            } catch {
                setMessage(guestStatus, 'Enter the private guest tracking token to view this order.', true);
            }
        }
    })();
})();
