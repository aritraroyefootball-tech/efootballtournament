// Owner-only admin management: list, create, deactivate/reactivate, reset password.
const db = require('./_lib/db');
const { route, send, body, HttpError } = require('./_lib/http');
const { hashPassword } = require('./_lib/crypto');
const { check, normUsername, validUsername, validPassword, requireAdmin, revokeSessions, logAudit } = require('./_lib/auth');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function target(id, me) {
  if (!UUID.test(String(id || ''))) throw new HttpError(400, 'Invalid admin id');
  const t = check(await db().from('admins').select('id, username, role, active').eq('id', id).maybeSingle());
  if (!t) throw new HttpError(404, 'Admin not found');
  if (t.id === me.id || t.role === 'owner') throw new HttpError(400, 'Use Change password for your own account; the owner cannot be deactivated');
  return t;
}

module.exports = route({
  async GET(req, res) {
    await requireAdmin(req, { owner: true });
    const rows = check(await db().from('admins')
      .select('id, username, role, active, must_change_password, created_by, created_at, last_login_at')
      .order('created_at', { ascending: true })) || [];
    const byId = new Map(rows.map(r => [r.id, r.username]));
    return send(res, 200, {
      admins: rows.map(r => ({
        id: r.id, username: r.username, role: r.role, active: r.active,
        mustChangePassword: r.must_change_password,
        createdBy: byId.get(r.created_by) || null, createdAt: r.created_at, lastLoginAt: r.last_login_at,
      })),
    });
  },

  async POST(req, res) {
    const me = await requireAdmin(req, { owner: true });
    const b = body(req);

    if (b.action === 'reset_password') {
      const t = await target(b.id, me);
      if (!validPassword(b.newPassword)) throw new HttpError(400, 'Temporary password must be at least 8 characters');
      check(await db().from('admins').update({
        password_hash: await hashPassword(b.newPassword),
        must_change_password: true,
        password_changed_at: new Date().toISOString(),
      }).eq('id', t.id));
      await revokeSessions(t.id);
      await logAudit(me, 'admin_password_reset', `Password reset for ${t.username}`, { target_id: t.id, target_username: t.username });
      return send(res, 200, { ok: true });
    }

    const username = normUsername(b.username);
    if (!validUsername(username)) throw new HttpError(400, 'Username must be 3–20 characters: a-z, 0-9 or _');
    if (!validPassword(b.password)) throw new HttpError(400, 'Temporary password must be at least 8 characters');
    const { data: a, error } = await db().from('admins').insert({
      username, password_hash: await hashPassword(b.password), role: 'admin', must_change_password: true, created_by: me.id,
    }).select('id, username').single();
    if (error) {
      if (error.code === '23505') throw new HttpError(409, 'Username already taken');
      throw new Error(error.message);
    }
    await logAudit(me, 'admin_created', `Admin created: ${a.username}`, { target_id: a.id, target_username: a.username });
    return send(res, 201, { ok: true, id: a.id });
  },

  async PATCH(req, res) {
    const me = await requireAdmin(req, { owner: true });
    const b = body(req);
    if (typeof b.active !== 'boolean') throw new HttpError(400, 'active must be true or false');
    const t = await target(b.id, me);
    check(await db().from('admins').update({ active: b.active }).eq('id', t.id));
    if (!b.active) await revokeSessions(t.id);
    await logAudit(me, b.active ? 'admin_reactivated' : 'admin_deactivated',
      `${b.active ? 'Reactivated' : 'Deactivated'} ${t.username}`, { target_id: t.id, target_username: t.username });
    return send(res, 200, { ok: true });
  },
});
