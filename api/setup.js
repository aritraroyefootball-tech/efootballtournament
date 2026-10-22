// One-time owner creation. Works only while no owner exists.
const db = require('./_lib/db');
const { route, send, body, clientIp, HttpError } = require('./_lib/http');
const { safeEqual, hashPassword } = require('./_lib/crypto');
const { check, normUsername, validUsername, validPassword, pub, createSession, logAudit } = require('./_lib/auth');

async function ownerExists() {
  const { count, error } = await db().from('admins').select('id', { count: 'exact', head: true }).eq('role', 'owner');
  if (error) throw new Error(error.message);
  return count > 0;
}

module.exports = route({
  async GET(req, res) {
    return send(res, 200, { needsSetup: !(await ownerExists()) });
  },

  async POST(req, res) {
    if (await ownerExists()) throw new HttpError(403, 'Setup already completed');
    const ip = clientIp(req), since = new Date(Date.now() - 15 * 60e3).toISOString();
    const { count, error } = await db().from('login_attempts').select('id', { count: 'exact', head: true })
      .eq('username', '#setup').eq('ip', ip).eq('success', false).gte('at', since);
    if (error) throw new Error(error.message);
    if (count >= 20) throw new HttpError(429, 'Too many attempts, try again later');

    const b = body(req), token = process.env.SETUP_TOKEN;
    if (!token || !safeEqual(String(b.setupToken || ''), token)) {
      check(await db().from('login_attempts').insert({ username: '#setup', ip, success: false }));
      throw new HttpError(403, 'Invalid setup token');
    }
    const username = normUsername(b.username);
    if (!validUsername(username)) throw new HttpError(400, 'Username must be 3–20 characters: a-z, 0-9 or _');
    if (!validPassword(b.password)) throw new HttpError(400, 'Password must be at least 8 characters');

    const now = new Date().toISOString();
    const { data: owner, error: e2 } = await db().from('admins').insert({
      username, password_hash: await hashPassword(b.password), role: 'owner', password_changed_at: now, last_login_at: now,
    }).select('id, username, role, must_change_password').single();
    if (e2) {
      if (e2.code === '23505') throw new HttpError(403, 'Setup already completed');
      throw new Error(e2.message);
    }
    await logAudit(owner, 'owner_created', `Owner account created: ${username}`);
    await createSession(owner.id, req, res);
    return send(res, 200, pub(owner));
  },
});
