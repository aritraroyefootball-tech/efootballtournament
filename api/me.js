// Who am I? Identity comes only from the session cookie.
const { route, send } = require('./_lib/http');
const { getSession, pub } = require('./_lib/auth');

module.exports = route({
  async GET(req, res) {
    const me = await getSession(req);
    if (!me) return send(res, 401, { error: 'Not logged in' });
    return send(res, 200, pub(me));
  },
});
