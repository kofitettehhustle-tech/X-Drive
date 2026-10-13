const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
    toMinorUnits,
    validateReference,
    validateVerifiedTransaction,
    verifyWebhookSignature
} = require('./paystack-client');

test('converts positive major-unit amounts to integer minor units', () => {
    assert.equal(toMinorUnits(1.25, 2), 125);
    assert.equal(toMinorUnits(0.018, 2), 2);
    assert.throws(() => toMinorUnits(0, 2), /positive amount/);
    assert.throws(() => toMinorUnits(Number.NaN, 2), /positive amount/);
});

test('accepts only Paystack-compatible transaction reference characters', () => {
    assert.equal(validateReference('xd-abc_123.4=5'), true);
    assert.equal(validateReference('reference with spaces'), false);
    assert.equal(validateReference(''), false);
});

test('rejects pending, mismatched-reference, mismatched-amount, and mismatched-currency transaction records', () => {
    const expected = { reference: 'xd-unit-reference', amountMinor: 1250, currency: 'USD' };

    assert.throws(() => validateVerifiedTransaction({ status: 'pending' }, expected), /not been verified/);
    assert.throws(() => validateVerifiedTransaction({ status: 'success', reference: 'other', amount: 1250, currency: 'USD' }, expected), /reference/);
    assert.throws(() => validateVerifiedTransaction({ status: 'success', reference: expected.reference, amount: 1249, currency: 'USD' }, expected), /amount/);
    assert.throws(() => validateVerifiedTransaction({ status: 'success', reference: expected.reference, amount: 1250, currency: 'NGN' }, expected), /currency/);
});

test('validates Paystack webhook HMAC over the exact raw request body', () => {
    const secret = 'unit-test-only-secret';
    const rawBody = Buffer.from('{"event":"charge.pending"}', 'utf8');
    const signature = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');

    assert.equal(verifyWebhookSignature(rawBody, signature, secret), true);
    assert.equal(verifyWebhookSignature(Buffer.from('{"event":"charge.failed"}'), signature, secret), false);
    assert.equal(verifyWebhookSignature(rawBody, 'not-a-signature', secret), false);
    assert.equal(verifyWebhookSignature(rawBody, signature, ''), false);
});
