const test = require('node:test');
const assert = require('node:assert');
const { hashPassword, verifyPassword, newToken, hashToken, safeEqual } = require('../api/_lib/crypto');

test('hash + verify: correct password', async () => {
  const h = await hashPassword('correct horse');
  assert.match(h, /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.equal(await verifyPassword('correct horse', h), true);
});

test('hash + verify: wrong password', async () => {
  const h = await hashPassword('correct horse');
  assert.equal(await verifyPassword('correct hors', h), false);
  assert.equal(await verifyPassword('', h), false);
});

test('same password hashes differently (random salt)', async () => {
  assert.notEqual(await hashPassword('samesame'), await hashPassword('samesame'));
});

test('tampered hash fails', async () => {
  const h = await hashPassword('correct horse');
  const p = h.split('$');
  const flip = s => { const b = Buffer.from(s, 'base64'); b[0] ^= 1; return b.toString('base64'); };
  assert.equal(await verifyPassword('correct horse', [...p.slice(0, 5), flip(p[5])].join('$')), false, 'hash bytes');
  assert.equal(await verifyPassword('correct horse', [...p.slice(0, 4), flip(p[4]), p[5]].join('$')), false, 'salt');
  assert.equal(await verifyPassword('correct horse', ['scrypt', '8192', ...p.slice(2)].join('$')), false, 'N');
  assert.equal(await verifyPassword('correct horse', ['bcrypt', ...p.slice(1)].join('$')), false, 'algo');
});

test('malformed hashes return false instead of throwing', async () => {
  for (const bad of [null, undefined, '', 'scrypt', 'scrypt$1$2$3$4$5', 'scrypt$16384$8$1$$', 'scrypt$9999999$8$1$AAAA$AAAA', 'x$y']) {
    assert.equal(await verifyPassword('whatever1', bad), false, String(bad));
  }
});

test('session token hashing', () => {
  const t = newToken();
  assert.equal(Buffer.from(t, 'base64url').length, 32);
  assert.match(hashToken(t), /^[0-9a-f]{64}$/);
  assert.equal(hashToken(t), hashToken(t));
  assert.notEqual(hashToken(t), hashToken(newToken()));
  assert.notEqual(hashToken(t), t);
});

test('safeEqual', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
});
