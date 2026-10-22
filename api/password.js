// Change your own password. Allowed while must_change_password is set.
const db = require('./_lib/db');
const { route, send, body, HttpError } = require('./_lib/http');
const { hashPassword, verifyPassword } = require('./_lib/crypto');
const { check, validPassword, pub, requireAdmin, revokeSessions, logAudit } = require('./_lib/auth');

module.exports = route({
  async POST(req, res) {
    const me = await requireAdmin(req, { allowMustChange: true });
    const b = body(req);
    if (!validPassword(b.newPassword)) throw new HttpError(400, 'New password must be at least 8 characters');
    const a = check(await db().from('admins').select('password_hash').eq('id', me.id).single());
    if (!(await verifyPassword(String(b.currentPassword || ''), a.password_hash))) throw new HttpError(400, 'Current password is incorrect');
    if (b.newPassword === b.currentPassword) throw new HttpError(400, 'Choose a different password');

    check(await db().from('admins').update({
      password_hash: await hashPassword(b.newPassword),
      must_change_password: false,
      password_changed_at: new Date().toISOString(),
    }).eq('id', me.id));
    await revokeSessions(me.id, me.sid);
    await logAudit(me, 'password_changed', `${me.username} changed their password`);
    return send(res, 200, pub({ ...me, mustChange: false }));
  },
});
