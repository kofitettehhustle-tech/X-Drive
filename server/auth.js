const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const PASSWORD_HASH_BYTES = 64;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function normalizeEmail(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isValidEmail(value) {
    const email = normalizeEmail(value);
    return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(value) {
    if (typeof value !== 'string' || value.length < 12 || value.length > 128) {
        return { valid: false, message: 'Use a password between 12 and 128 characters.' };
    }
    return { valid: true };
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const derived = await scrypt(password, salt, PASSWORD_HASH_BYTES, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    return { salt, hash: Buffer.from(derived).toString('hex') };
}

async function verifyPassword(password, salt, storedHash) {
    if (typeof password !== 'string' || typeof salt !== 'string' || typeof storedHash !== 'string' || !/^[a-f0-9]{128}$/i.test(storedHash)) {
        return false;
    }
    const derived = Buffer.from(await scrypt(password, salt, PASSWORD_HASH_BYTES, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }));
    const expected = Buffer.from(storedHash, 'hex');
    return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

function hashOpaqueToken(token) {
    if (typeof token !== 'string' || token.length < 32 || token.length > 256) return null;
    return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function safeEqualStrings(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string') return false;
    const leftBuffer = Buffer.from(left, 'utf8');
    const rightBuffer = Buffer.from(right, 'utf8');
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createSessionTokens() {
    const sessionToken = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    return {
        sessionToken,
        sessionTokenHash: hashOpaqueToken(sessionToken),
        expiresAt
    };
}

module.exports = {
    createSessionTokens,
    hashOpaqueToken,
    hashPassword,
    isValidEmail,
    normalizeEmail,
    safeEqualStrings,
    validatePassword,
    verifyPassword
};
