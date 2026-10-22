// Username + password login with rate limiting and a generic error message.
const db = require('./_lib/db');
const { route, send, body, clientIp, HttpError } = require('./_lib/http');
const { verifyPassword, dummyHash } = require('./_lib/crypto');
const { check, normUsername, pub, createSession, logAudit } = require('./_lib/auth');

const WINDOW = 15 * 60e3, MAX_USER = 5, MAX_IP = 20;
const GENERIC = 'Invalid username or password';

async function failures(col, val, since) {
  const { count, error } = await db().from('login_attempts').select('id', { count: 'exact', head: true })
    .eq(col, val).eq('success', false).gte('at', since);
  if (error) throw new Error(error.message);
  return count || 0;
}

module.exports = route({
  async POST(req, res) {
    const b = body(req), ip = clientIp(req);
    const username = normUsername(b.username).slice(0, 64);
    const password = typeof b.password === 'string' && b.password.length <= 256 ? b.password : '';
    const since = new Date(Date.now() - WINDOW).toISOString();

    const [fu, fi] = await Promise.all([failures('username', username, since), failures('ip', ip, since)]);
    if (fu >= MAX_USER || fi >= MAX_IP) throw new HttpError(429, 'Too many attempts, try again later');

    const a = check(await db().from('admins')
      .select('id, username, password_hash, role, active, must_change_password')
      .eq('username', username).maybeSingle());
    // Always run scrypt, even for unknown users, so timing doesn't reveal which usernames exist.
    const match = await verifyPassword(password, a ? a.password_hash : await dummyHash());
    const ok = !!(a && a.active && match && password);

    check(await db().from('login_attempts').insert({ username, ip, success: ok }));
    if (Math.random() < 0.05) {
      check(await db().from('login_attempts').delete().lt('at', new Date(Date.now() - 864e5).toISOString()));
    }
    if (!ok) throw new HttpError(401, GENERIC);

    check(await db().from('admins').update({ last_login_at: new Date().toISOString() }).eq('id', a.id));
    check(await db().from('sessions').delete().eq('admin_id', a.id).lt('expires_at', new Date().toISOString()));
    await createSession(a.id, req, res);
    await logAudit(a, 'login', `${a.username} logged in`);
    return send(res, 200, pub(a));
  },
});
