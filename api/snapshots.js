// Owner-only: list state snapshots and roll back to one.
const db = require('./_lib/db');
const { route, send, body, HttpError } = require('./_lib/http');
const { check, requireAdmin } = require('./_lib/auth');
const { current, saveState } = require('./_lib/store');
const { diffState } = require('./_lib/diff');

module.exports = route({
  async GET(req, res) {
    await requireAdmin(req, { owner: true });
    const rows = check(await db().from('state_snapshots')
      .select('id, at, actor_username, reason').order('id', { ascending: false }).limit(20)) || [];
    return send(res, 200, { snapshots: rows });
  },

  async POST(req, res) {
    const me = await requireAdmin(req, { owner: true });
    const id = parseInt(body(req).id, 10);
    if (!Number.isFinite(id)) throw new HttpError(400, 'Invalid snapshot id');
    const snap = check(await db().from('state_snapshots').select('id, at, data').eq('id', id).maybeSingle());
    if (!snap) throw new HttpError(404, 'Snapshot not found');

    const cur = await current();
    let changes = [];
    try { changes = diffState(cur.data, snap.data).changes; } catch (e) {}
    const when = new Date(snap.at).toISOString().slice(0, 16).replace('T', ' ');
    const r = await saveState({
      baseRev: cur.rev, data: snap.data, actor: me,
      action: 'rollback', summary: `Restored snapshot #${id} (saved ${when} UTC)`,
      details: { snapshot_id: id, changes },
      reason: `Before rollback to snapshot #${id}`,
    });
    if (!r.ok) throw new HttpError(409, 'The state changed meanwhile, please try again');
    return send(res, 200, { ok: true, rev: r.rev });
  },
});
