class XDriveAPIClient {
    constructor(baseURL = window.XDRIVE_API_BASE_URL || '') {
        this.baseURL = baseURL.replace(/\/+$/, '');
        this.accessToken = '';
        this.customer = null;
        this.supabaseClient = null;
        try {
            this.accessToken = window.sessionStorage.getItem('xdrive_access_token') || '';
            this.customer = JSON.parse(window.sessionStorage.getItem('xdrive_customer') || 'null');
        } catch {
            this.accessToken = '';
            this.customer = null;
        }

        if (window.XDRIVE_SUPABASE_URL && window.XDRIVE_SUPABASE_ANON_KEY && !window.XDRIVE_SUPABASE_URL.includes('YOUR_PROJECT_ID')) {
            try {
                const { createClient } = window.supabase || {};
                if (createClient) {
                    this.supabaseClient = createClient(window.XDRIVE_SUPABASE_URL, window.XDRIVE_SUPABASE_ANON_KEY, {
                        auth: { persistSession: true, autoRefreshToken: true }
                    });
                }
            } catch {
                this.supabaseClient = null;
            }
        }
    }

    async signInWithSupabase(email, password) {
        if (!this.supabaseClient) {
            throw new Error('Supabase Auth is not configured in the browser.');
        }

        const { data, error } = await this.supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message || 'Supabase sign in failed.');
        if (!data?.session?.access_token) throw new Error('No Supabase session was returned.');

        this.setSession({
            accessToken: data.session.access_token,
            customer: {
                id: data.user?.id || 'supabase-user',
                email: data.user?.email || email
            }
        });
        return { customer: this.customer, accessToken: this.accessToken, expiresAt: data.session.expires_at };
    }

    async signUpWithSupabase(email, password) {
        if (!this.supabaseClient) {
            throw new Error('Supabase Auth is not configured in the browser.');
        }

        const { data, error } = await this.supabaseClient.auth.signUp({ email, password });
        if (error) throw new Error(error.message || 'Supabase account creation failed.');

        const session = data?.session;
        if (session?.access_token) {
            this.setSession({
                accessToken: session.access_token,
                customer: {
                    id: data.user?.id || 'supabase-user',
                    email: data.user?.email || email
                }
            });
            return { customer: this.customer, accessToken: this.accessToken, expiresAt: session.expires_at };
        }

        if (data?.user) {
            this.setSession({
                accessToken: '',
                customer: { id: data.user.id, email: data.user.email || email }
            });
            return { customer: this.customer, accessToken: '', expiresAt: null };
        }

        throw new Error('Supabase did not return a usable account result.');
    }

    async register(email, password) {
        if (this.supabaseClient) {
            return this.signUpWithSupabase(email, password);
        }

        const session = await this.request('/api/auth/register', {
            method: 'POST',
            unauthenticated: true,
            body: JSON.stringify({ email, password })
        });
        this.setSession(session);
        return session;
    }

    async login(email, password) {
        if (this.supabaseClient) {
            return this.signInWithSupabase(email, password);
        }

        const session = await this.request('/api/auth/login', {
            method: 'POST',
            unauthenticated: true,
            body: JSON.stringify({ email, password })
        });
        this.setSession(session);
        return session;
    }

    async logout() {
        try {
            if (this.supabaseClient) {
                await this.supabaseClient.auth.signOut();
            }
        } catch {
            // Ignore Supabase sign-out failures and still clear local state.
        }
        try {
            await this.request('/api/auth/logout', { method: 'POST' });
        } finally {
            this.clearSession();
        }
    }

    getCurrentCustomer() {
        return this.request('/api/auth/me');
    }

    initializeOrderPayment(orderData, { trackingToken = null, idempotencyKey } = {}) {
        return this.request('/api/payments/orders', {
            method: 'POST',
            idempotencyKey,
            body: JSON.stringify({ ...orderData, ...(trackingToken ? { trackingToken } : {}) })
        });
    }

    initializeWalletDeposit(amountMinor, idempotencyKey) {
        return this.request('/api/wallet/deposits', {
            method: 'POST',
            idempotencyKey,
            body: JSON.stringify({ amountMinor })
        });
    }

    verifyPayment(reference, trackingToken = null) {
        return this.request('/api/payments/verify', {
            method: 'POST',
            body: JSON.stringify({ reference, ...(trackingToken ? { trackingToken } : {}) })
        });
    }

    getWallet() {
        return this.request('/api/wallet');
    }

    payOrderFromWallet(orderData, idempotencyKey) {
        return this.request('/api/wallet/orders', {
            method: 'POST',
            idempotencyKey,
            body: JSON.stringify(orderData)
        });
    }

    getMyOrders() {
        return this.request('/api/storefront/orders');
    }

    getOrderStatus(orderId, trackingToken = null) {
        return this.request(`/api/storefront/orders/${encodeURIComponent(orderId)}`, { orderToken: trackingToken });
    }

    getOrderHistory(orderId, trackingToken = null) {
        return this.request(`/api/storefront/orders/${encodeURIComponent(orderId)}/history`, { orderToken: trackingToken });
    }

    requestRefill(orderId, trackingToken = null) {
        return this.request(`/api/storefront/orders/${encodeURIComponent(orderId)}/refill`, {
            method: 'POST',
            orderToken: trackingToken
        });
    }

    cancelOrder(orderId, trackingToken = null) {
        return this.request(`/api/storefront/orders/${encodeURIComponent(orderId)}/cancel`, {
            method: 'POST',
            orderToken: trackingToken
        });
    }

    getBalance() {
        return this.request('/api/admin/balance');
    }

    syncServices() {
        return this.request('/api/admin/sync-services', { method: 'POST' });
    }
}

const xdriveAPI = new XDriveAPIClient();
window.xdriveAPI = xdriveAPI;
