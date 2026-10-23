// Decides whether a Supabase key is safe to hand to the browser. Pure, so it can be unit-tested.
// Accepts the legacy anon JWT or a new-style publishable key; refuses anything that could be the service role.

function jwtRole(key) {
  const parts = String(key).split('.');
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role || null; } catch (e) { return null; }
}

function isPublicKey(key, serviceKey) {
  key = String(key || '').trim();
  if (!key || key === String(serviceKey || '').trim()) return false;
  if (key.startsWith('sb_publishable_')) return true;
  if (key.startsWith('sb_secret_')) return false;
  return jwtRole(key) === 'anon';
}

module.exports = { isPublicKey };
