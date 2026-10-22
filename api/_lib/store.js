// Tournament state read + atomic save (see save_state in supabase/migrations/001_init.sql).
const db = require('./db');
const { check } = require('./auth');

async function current() {
  const row = check(await db().from('tournament_state').select('data, rev').eq('id', 1).maybeSingle());
  return row ? { data: row.data, rev: Number(row.rev) } : { data: null, rev: 0 };
}

// Returns { ok, rev }. ok=false means someone else saved first (rev changed).
async function saveState({ baseRev, data, actor, action, summary, details, reason }) {
  const r = check(await db().rpc('save_state', {
    p_base_rev: baseRev,
    p_data: data,
    p_actor_id: actor.id,
    p_actor_username: actor.username,
    p_action: action,
    p_summary: String(summary || '').slice(0, 1000),
    p_details: details || null,
    p_reason: String(reason || '').slice(0, 300),
  }));
  return { ok: !!(r && r.ok), rev: Number(r && r.rev) || 0 };
}

module.exports = { current, saveState };
