class XDriveAPIClient {
    constructor(baseURL = '') {
        this.baseURL = baseURL;
    }

    async request(endpoint, options = {}) {
        try {
            const response = await fetch(`${this.baseURL}${endpoint}`, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || `Request failed with status ${response.status}`);
            }

            return data;
        } catch (error) {
            console.error('API request failed:', error);
            throw error;
        }
    }

    async getCatalog() {
        return this.request('/api/storefront/catalog');
    }

    async createOrder(orderData) {
        return this.request('/api/storefront/orders', {
            method: 'POST',
            body: JSON.stringify(orderData)
        });
    }

    async getOrderStatus(orderId) {
        return this.request(`/api/storefront/orders/${orderId}`);
    }

    async getOrders(email) {
        return this.request(`/api/storefront/orders?email=${encodeURIComponent(email)}`);
    }

    async getOrderHistory(orderId) {
        return this.request(`/api/storefront/orders/${orderId}/history`);
    }

    async requestRefill(orderId) {
        return this.request(`/api/storefront/orders/${orderId}/refill`, {
            method: 'POST'
        });
    }

    async cancelOrder(orderId) {
        return this.request(`/api/storefront/orders/${orderId}/cancel`, {
            method: 'POST'
        });
    }

    async getBalance() {
        return this.request('/api/admin/balance');
    }

    async syncServices() {
        return this.request('/api/admin/sync-services', {
            method: 'POST'
        });
    }
}

const xdriveAPI = new XDriveAPIClient();
