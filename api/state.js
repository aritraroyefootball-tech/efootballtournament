// Vercel Serverless Function: tournament state in Supabase Postgres.
// GET is public; POST needs a logged-in admin session (see api/_lib/auth.js).
const { route, send, body, HttpError } = require('./_lib/http');
const { requireAdmin } = require('./_lib/auth');
const { current, saveState } = require('./_lib/store');
const { diffState } = require('./_lib/diff');

module.exports = route({
  async GET(req, res) {
    return send(res, 200, await current());
  },

  async POST(req, res) {
    const me = await requireAdmin(req);
    const b = body(req), d = b.data;
    if (!d || d.v !== 1 || !Array.isArray(d.players)) throw new HttpError(400, 'Invalid data');
    if (JSON.stringify(d).length > 1e6) throw new HttpError(413, 'State too large');
    const baseRev = Number(b.baseRev);
    if (!Number.isFinite(baseRev) || baseRev < 0) throw new HttpError(400, 'Invalid baseRev');

    const cur = await current();
    if (cur.rev !== baseRev) return send(res, 409, { error: 'Conflict', ...cur });

    let df;
    try {
      df = cur.data ? diffState(cur.data, d, b.action) : { action: 'state_init', summary: 'Initial tournament state saved', changes: [] };
    } catch (e) {
      df = { action: 'state_update', summary: 'State updated (diff unavailable)', changes: [] };
    }
    const r = await saveState({
      baseRev, data: d, actor: me,
      action: df.action, summary: df.summary, details: { changes: df.changes, counts: df.counts, removedPlayers: df.removedPlayers },
      reason: `Before ${df.action}: ${df.summary}`,
    });
    if (!r.ok) return send(res, 409, { error: 'Conflict', ...(await current()) });
    return send(res, 200, { ok: true, rev: r.rev });
  },
});
