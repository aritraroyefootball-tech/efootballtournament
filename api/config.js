// Public config for the browser's read-only Realtime subscription (see supabase/migrations/002_realtime.sql).
// Only the anon/publishable key is ever returned; the service role key never leaves the server.
// Without a usable SUPABASE_ANON_KEY the browser falls back to polling GET /api/state.
const { route, send } = require('./_lib/http');
const { isPublicKey } = require('./_lib/keys');

module.exports = route({
  async GET(req, res) {
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY;
    if (key && !isPublicKey(key, process.env.SUPABASE_SERVICE_ROLE_KEY)) console.error('[api] SUPABASE_ANON_KEY is not an anon/publishable key; Realtime disabled');
    const ok = url && isPublicKey(key, process.env.SUPABASE_SERVICE_ROLE_KEY);
    return send(res, 200, ok ? { supabaseUrl: url, anonKey: key.trim() } : { supabaseUrl: null, anonKey: null });
  },
});
