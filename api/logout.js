// Ends the current session and clears the cookie.
const db = require('./_lib/db');
const { route, send, clearCookie } = require('./_lib/http');
const { check, getSession, logAudit } = require('./_lib/auth');

module.exports = route({
  async POST(req, res) {
    const me = await getSession(req);
    if (me) {
      check(await db().from('sessions').delete().eq('id', me.sid));
      await logAudit(me, 'logout', `${me.username} logged out`);
    }
    clearCookie(res);
    return send(res, 200, { ok: true });
  },
});
