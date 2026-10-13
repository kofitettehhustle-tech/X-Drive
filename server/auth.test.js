const assert = require('node:assert/strict');
const test = require('node:test');
const {
    createSessionTokens,
    hashOpaqueToken,
    hashPassword,
    isValidEmail,
    normalizeEmail,
    safeEqualStrings,
    validatePassword,
    verifyPassword
} = require('./auth');

test('normalizes and validates customer email addresses', () => {
    assert.equal(normalizeEmail('  Customer@Example.com '), 'customer@example.com');
    assert.equal(isValidEmail('Customer@example.com'), true);
    assert.equal(isValidEmail('not-an-email'), false);
});

test('enforces password length and verifies salted scrypt hashes', async () => {
    assert.equal(validatePassword('short').valid, false);
    assert.equal(validatePassword('a-strong-password-2026').valid, true);

    const hashed = await hashPassword('a-strong-password-2026', 'test-salt-for-auth-unit-test');
    assert.equal(await verifyPassword('a-strong-password-2026', hashed.salt, hashed.hash), true);
    assert.equal(await verifyPassword('wrong-password', hashed.salt, hashed.hash), false);
});

test('creates a random opaque session token and stores only its one-way hash', () => {
    const tokens = createSessionTokens();
    assert.ok(tokens.sessionToken.length >= 40);
    assert.equal(tokens.sessionTokenHash, hashOpaqueToken(tokens.sessionToken));
    assert.notEqual(tokens.sessionTokenHash, tokens.sessionToken);
    assert.ok(Date.parse(tokens.expiresAt) > Date.now());
});

test('hashes only sufficiently long opaque tokens and compares tokens safely', () => {
    assert.equal(hashOpaqueToken('too-short'), null);
    assert.match(hashOpaqueToken('this-is-a-long-test-token-value-123456'), /^[a-f0-9]{64}$/);
    assert.equal(safeEqualStrings('same-value', 'same-value'), true);
    assert.equal(safeEqualStrings('different', 'same-value'), false);
});
