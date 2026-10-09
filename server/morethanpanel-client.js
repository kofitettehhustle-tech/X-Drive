const crypto = require('node:crypto');

class MoreThanPanelClient {
    constructor(apiKey, endpoint = 'https://morethanpanel.com/api/v2') {
        this.apiKey = apiKey;
        this.endpoint = endpoint;
    }

    async request(action, params = {}) {
        const body = new URLSearchParams({
            key: this.apiKey,
            action,
            ...params
        });

        const response = await fetch(this.endpoint, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body,
            signal: AbortSignal.timeout(30000)
        });

        if (!response.ok) {
            throw new Error(`Morethanpanel API request failed: ${response.status}`);
        }

        const data = await response.json();
        
        if (data.error) {
            throw new Error(`Morethanpanel API error: ${data.error}`);
        }

        return data;
    }

    async getServices() {
        return this.request('services');
    }

    async createOrder({ service, link, quantity, runs = null, interval = null }) {
        const params = { service, link, quantity };
        
        if (runs !== null) params.runs = runs;
        if (interval !== null) params.interval = interval;
        
        return this.request('add', params);
    }

    async getOrderStatus(orderId) {
        return this.request('status', { order: orderId });
    }

    async getMultipleOrderStatus(orderIds) {
        return this.request('status', { orders: orderIds.join(',') });
    }

    async getBalance() {
        return this.request('balance');
    }

    async refillOrder(orderId) {
        return this.request('refill', { order: orderId });
    }

    async getRefillStatus(refillId) {
        return this.request('refill_status', { refill: refillId });
    }

    async cancelOrder(orderId) {
        return this.request('cancel', { order: orderId });
    }

    async createSubscription({ service, username, min, max, posts = null, old_posts = null, delay = null, expiry = null }) {
        const params = { service, username, min, max };
        
        if (posts !== null) params.posts = posts;
        if (old_posts !== null) params.old_posts = old_posts;
        if (delay !== null) params.delay = delay;
        if (expiry !== null) params.expiry = expiry;
        
        return this.request('add', params);
    }

    async getSubscriptionStatus(subscriptionId) {
        return this.request('status', { order: subscriptionId });
    }

    async getUserOrders() {
        return this.request('orders');
    }
}

module.exports = { MoreThanPanelClient };
