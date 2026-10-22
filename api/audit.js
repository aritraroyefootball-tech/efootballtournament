// Read-only, paginated audit log for admins.
const db = require('./_lib/db');
const { route, send, query } = require('./_lib/http');
const { check, requireAdmin } = require('./_lib/auth');

module.exports = route({
  async GET(req, res) {
    await requireAdmin(req);
    const q = query(req);
    const limit = Math.min(200, Math.max(1, parseInt(q.limit, 10) || 50));
    let sel = db().from('audit_log').select('id, at, actor_username, action, summary')
      .order('id', { ascending: false }).limit(limit + 1);
    const before = parseInt(q.before, 10);
    if (Number.isFinite(before)) sel = sel.lt('id', before);
    if (q.username) sel = sel.eq('actor_username', String(q.username).trim().toLowerCase());
    if (q.action) sel = sel.eq('action', String(q.action));
    const rows = check(await sel) || [];
    const more = rows.length > limit;
    if (more) rows.length = limit;
    return send(res, 200, { rows, next: more ? rows[rows.length - 1].id : null });
  },
});
