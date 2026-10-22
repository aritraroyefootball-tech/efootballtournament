// Vercel Serverless Function: stores the tournament state in Upstash Redis
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = 'efootball:state';

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!URL_ || !TOKEN) return res.status(500).json({ error: 'Database env vars missing' });

    if (req.method === 'GET') {
      const v = await redis(['GET', KEY]);
      if (!v) return res.status(200).json({ data: null, rev: 0 });
      return res.status(200).json(JSON.parse(v));
    }

    if (req.method === 'POST') {
      const pw = req.headers['x-admin-password'];
      if (!process.env.ADMIN_PASSWORD || pw !== process.env.ADMIN_PASSWORD)
        return res.status(401).json({ error: 'Wrong password' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      if (body.check) return res.status(200).json({ ok: true });
      const d = body.data;
      if (!d || d.v !== 1 || !Array.isArray(d.players))
        return res.status(400).json({ error: 'Invalid data' });
      const rev = Date.now();
      await redis(['SET', KEY, JSON.stringify({ data: d, rev })]);
      return res.status(200).json({ ok: true, rev });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
