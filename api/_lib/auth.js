// Sessions, authorization and audit helpers.
const db = require('./db');
const { newToken, hashToken } = require('./crypto');
const { HttpError, readCookie, setCookie, MAX_AGE } = require('./http');

const check = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

const normUsername = u => String(u || '').trim().toLowerCase();
const validUsername = u => /^[a-z0-9_]{3,20}$/.test(u);
const validPassword = p => typeof p === 'string' && p.length >= 8 && p.length <= 256;

const pub = a => ({ username: a.username, role: a.role, mustChangePassword: !!(a.mustChange ?? a.must_change_password) });

// Returns the logged-in admin (from the session cookie only) or null.
async function getSession(req) {
  const token = readCookie(req);
  if (!token || token.length > 100) return null;
  const tokenHash = hashToken(token);
  const s = check(await db().from('sessions')
    .select('id, expires_at, last_seen_at, admins (id, username, role, active, must_change_password)')
    .eq('token_hash', tokenHash).maybeSingle());
  const a = s && s.admins;
  if (!a || !a.active || new Date(s.expires_at) <= new Date()) return null;
  if (Date.now() - new Date(s.last_seen_at).getTime() > 5 * 60e3) {
    check(await db().from('sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', s.id));
  }
  return { sid: s.id, id: a.id, username: a.username, role: a.role, mustChange: a.must_change_password };
}

// 401 when not logged in; 403 when not the owner (opts.owner) or a password change is pending.
async function requireAdmin(req, opts = {}) {
  const me = await getSession(req);
  if (!me) throw new HttpError(401, 'Not logged in');
  if (me.mustChange && !opts.allowMustChange) throw new HttpError(403, 'Password change required', { mustChangePassword: true });
  if (opts.owner && me.role !== 'owner') throw new HttpError(403, 'Owner only');
  return me;
}

async function createSession(adminId, req, res) {
  const token = newToken();
  check(await db().from('sessions').insert({
    admin_id: adminId,
    token_hash: hashToken(token),
    expires_at: new Date(Date.now() + MAX_AGE * 1000).toISOString(),
    user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
  }));
  setCookie(res, token);
}

// Deletes all sessions of an admin, optionally keeping one (self password change).
async function revokeSessions(adminId, exceptSid) {
  let q = db().from('sessions').delete().eq('admin_id', adminId);
  if (exceptSid) q = q.neq('id', exceptSid);
  check(await q);
}

async function logAudit(actor, action, summary, details) {
  check(await db().from('audit_log').insert({
    actor_id: actor ? actor.id : null,
    actor_username: actor ? actor.username : null,
    action,
    summary,
    details: details || null,
  }));
}

module.exports = { check, normUsername, validUsername, validPassword, pub, getSession, requireAdmin, createSession, revokeSessions, logAudit };
