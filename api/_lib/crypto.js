// Password hashing (scrypt) and session-token helpers. Node built-ins only.
const crypto = require('crypto');

const N = 16384, R = 8, P = 1, KEYLEN = 64;

function scrypt(pw, salt, n, r, p, len) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(String(pw), salt, len, { N: n, r, p, maxmem: 256 * n * r * p }, (e, k) => (e ? reject(e) : resolve(k)))
  );
}

// Stored format: scrypt$N$r$p$<salt base64>$<hash base64>
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, N, R, P, KEYLEN);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

// Never throws: any malformed or tampered hash simply fails verification.
async function verifyPassword(pw, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const n = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
    // Bounds stop a tampered hash from requesting absurd CPU/memory.
    if (!Number.isInteger(n) || n < 1024 || n > 65536 || (n & (n - 1)) !== 0) return false;
    if (!Number.isInteger(r) || r < 1 || r > 16 || !Number.isInteger(p) || p < 1 || p > 4) return false;
    const salt = Buffer.from(parts[4], 'base64'), expected = Buffer.from(parts[5], 'base64');
    if (salt.length < 16 || expected.length < 32 || expected.length > 128) return false;
    const key = await scrypt(pw, salt, n, r, p, expected.length);
    return crypto.timingSafeEqual(key, expected);
  } catch (e) {
    return false;
  }
}

// Used when the username doesn't exist, so the response takes as long as a real check.
let dummy = null;
const dummyHash = () => dummy || (dummy = hashPassword(crypto.randomBytes(16).toString('hex')));

const newToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex');

// Constant-time string comparison (hashing first makes the lengths equal).
function safeEqual(a, b) {
  return crypto.timingSafeEqual(
    crypto.createHash('sha256').update(String(a)).digest(),
    crypto.createHash('sha256').update(String(b)).digest()
  );
}

module.exports = { hashPassword, verifyPassword, dummyHash, newToken, hashToken, safeEqual };
