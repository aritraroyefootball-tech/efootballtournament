// Small HTTP helpers shared by the api/ routes.
const COOKIE = 'arena_sid';
const MAX_AGE = 7 * 24 * 3600;

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.body = { error: message, ...(extra || {}) };
  }
}

function send(res, status, obj) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(obj);
}

function body(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body || '{}'); } catch (e) { throw new HttpError(400, 'Invalid JSON'); }
  }
  return req.body && typeof req.body === 'object' ? req.body : {};
}

function query(req) {
  return req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
}

const first = v => String(v || '').split(',')[0].trim();

function clientIp(req) {
  return first(req.headers['x-forwarded-for']) || first(req.headers['x-real-ip']) || (req.socket && req.socket.remoteAddress) || '';
}

// CSRF: state-changing requests need our custom header AND a same-origin Origin.
function csrfOk(req) {
  if (req.headers['x-requested-with'] !== 'arena') return false;
  const origin = req.headers.origin, host = first(req.headers['x-forwarded-host'] || req.headers.host);
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch (e) { return false; }
}

function readCookie(req) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

const setCookie = (res, token) =>
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${MAX_AGE}`);
const clearCookie = res =>
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);

// Wraps a route: method dispatch, CSRF check, uniform error handling.
// Only e.message is logged, and handlers never put secrets in messages.
function route(handlers) {
  return async (req, res) => {
    try {
      const h = handlers[req.method];
      if (!h) return send(res, 405, { error: 'Method not allowed' });
      if (req.method !== 'GET' && !csrfOk(req)) return send(res, 403, { error: 'Forbidden' });
      await h(req, res);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, e.body);
      console.error('[api]', req.method, (req.url || '').split('?')[0], e && e.message);
      return send(res, 500, { error: 'Server error' });
    }
  };
}

module.exports = { HttpError, send, body, query, clientIp, csrfOk, readCookie, setCookie, clearCookie, route, MAX_AGE };
