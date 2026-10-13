const crypto = require('node:crypto');

const PAYSTACK_API_BASE = 'https://api.paystack.co';
const PAYSTACK_CHECKOUT_HOST = 'checkout.paystack.com';
const REFERENCE_PATTERN = /^[A-Za-z0-9.=_-]{1,100}$/;

function validateReference(reference) {
    return typeof reference === 'string' && REFERENCE_PATTERN.test(reference);
}

function toMinorUnits(amount, fractionDigits = 2) {
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 4) {
        throw new TypeError('A positive amount and supported currency precision are required.');
    }

    const factor = 10 ** fractionDigits;
    const minorAmount = Math.round(amount * factor);
    if (!Number.isSafeInteger(minorAmount) || minorAmount <= 0) {
        throw new RangeError('The amount is outside the supported payment range.');
    }

    return minorAmount;
}

function isPaystackCheckoutUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.hostname === PAYSTACK_CHECKOUT_HOST;
    } catch {
        return false;
    }
}

function verifyWebhookSignature(rawBody, signature, secretKey) {
    if (!Buffer.isBuffer(rawBody) || typeof signature !== 'string' || !secretKey) return false;

    let supplied;
    try {
        supplied = Buffer.from(signature, 'hex');
    } catch {
        return false;
    }

    const expected = crypto.createHmac('sha512', secretKey).update(rawBody).digest();
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function validateVerifiedTransaction(transaction, expected) {
    if (!transaction || transaction.status !== 'success') {
        throw new Error('Payment has not been verified as successful.');
    }
    if (transaction.reference !== expected.reference) {
        throw new Error('Verified transaction reference does not match.');
    }
    if (transaction.amount !== expected.amountMinor) {
        throw new Error('Verified transaction amount does not match.');
    }
    if (String(transaction.currency || '').toUpperCase() !== expected.currency) {
        throw new Error('Verified transaction currency does not match.');
    }
    return true;
}

class PaystackClient {
    constructor(secretKey, options = {}) {
        this.secretKey = secretKey || '';
        this.fetchImpl = options.fetchImpl || globalThis.fetch;
        this.baseUrl = (options.baseUrl || PAYSTACK_API_BASE).replace(/\/+$/, '');
        this.timeoutMs = options.timeoutMs || 20000;
    }

    async request(endpoint, options = {}) {
        if (!this.secretKey) throw new Error('Paystack is not configured.');
        if (typeof this.fetchImpl !== 'function') throw new Error('This Node runtime does not provide fetch.');

        const response = await this.fetchImpl(`${this.baseUrl}${endpoint}`, {
            ...options,
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${this.secretKey}`,
                ...options.headers
            },
            signal: AbortSignal.timeout(this.timeoutMs)
        });

        let payload;
        try {
            payload = await response.json();
        } catch {
            throw new Error('Paystack returned an unreadable response.');
        }

        if (!response.ok || payload?.status !== true || !payload.data) {
            throw new Error('Paystack could not complete the request.');
        }

        return payload.data;
    }

    async initializeTransaction({ email, amountMinor, currency, reference, callbackUrl, metadata }) {
        if (!email || !Number.isSafeInteger(amountMinor) || amountMinor <= 0 || !currency || !validateReference(reference)) {
            throw new TypeError('Invalid transaction initialization parameters.');
        }

        const data = await this.request('/transaction/initialize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email,
                amount: String(amountMinor),
                currency,
                reference,
                callback_url: callbackUrl,
                metadata: metadata || {}
            })
        });

        if (data.reference !== reference || !isPaystackCheckoutUrl(data.authorization_url)) {
            throw new Error('Paystack returned an invalid checkout response.');
        }

        return {
            reference: data.reference,
            authorizationUrl: data.authorization_url,
            accessCode: typeof data.access_code === 'string' ? data.access_code : null
        };
    }

    async verifyTransaction(reference) {
        if (!validateReference(reference)) throw new TypeError('Invalid transaction reference.');
        return this.request(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' });
    }
}

module.exports = {
    PaystackClient,
    isPaystackCheckoutUrl,
    toMinorUnits,
    validateReference,
    validateVerifiedTransaction,
    verifyWebhookSignature
};
