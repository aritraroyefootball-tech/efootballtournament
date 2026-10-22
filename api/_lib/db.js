// Server-side Supabase client (service role). Never import this from the browser.
let client = null;

module.exports = function db() {
  if (client) return client;
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Database env vars missing');
  const { createClient } = require('@supabase/supabase-js');
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return client;
};
