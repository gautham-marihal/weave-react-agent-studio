// The Integrations page's way to test a connected API. Most APIs refuse calls from a web page on another address (CORS),
// so the browser asks this server with GET /api-pass, the address to call in the X-Api-Url header and the connection's
// headers in X-Api-Headers (JSON, URI-encoded), and this server makes the call. Only GET is passed on (a test reads,
// it never changes anything), only to the addresses listed in API_PASS_TARGETS (comma separated; an address may have a
// path, and anything under it is allowed), with only the connection's own headers: not an open door to anything else.
// Like /api and /llm it is a development convenience (see docs/PRODUCTION.md). The agents don't use it: they call the
// API from the Agent Builder server.

const MAX_ANSWER = 64 * 1024; // enough to show what a test answered
// a header's name as HTTP allows it; the ones that set up the call itself are this server's to send
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const OWN = new Set(['host', 'content-length', 'content-type', 'connection', 'transfer-encoding', 'cookie']);

// an address as it is compared: no spaces, no slashes at the end
const clean = (url) => {
  let text = String(url || '').trim();
  while (text.endsWith('/')) text = text.slice(0, -1);
  return text;
};

/** The addresses that may be called: API_PASS_TARGETS. */
export function passTargets(env) {
  const listed = String(env.API_PASS_TARGETS || '')
    .split(',')
    .map(clean)
    .filter(Boolean);
  return [...new Set(listed)];
}

/** Whether `url` is one of the targets or under one (same origin, and its path starts at a path boundary). */
export function allowedTarget(url, targets) {
  let asked;
  try {
    asked = new URL(url);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(asked.protocol)) return false;
  return targets.some((target) => {
    let base;
    try {
      base = new URL(target);
    } catch {
      return false;
    }
    const root = clean(base.pathname);
    return asked.origin === base.origin && (asked.pathname === root || asked.pathname.startsWith(`${root}/`) || root === '');
  });
}

// the connection's headers, from X-Api-Headers: only proper names with one-line text values, none of this server's own
export function passedHeaders(raw) {
  let parsed;
  try {
    parsed = raw ? JSON.parse(decodeURIComponent(String(raw))) : {};
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return Object.fromEntries(
    Object.entries(parsed).filter(([name, value]) => TOKEN.test(name) && !OWN.has(name.toLowerCase()) && typeof value === 'string' && !/[\r\n]/.test(value)),
  );
}

// a refusal of this server's own (not the API's answer), marked so the page can tell the two apart
function refuse(res, status, problem) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-api-pass-refused', '1');
  res.end(JSON.stringify({ problem }));
}

// connect-style (mounted with `server.middlewares.use('/api-pass', …)`); `fetchImpl` is injectable for tests
export function apiPassMiddleware(env, fetchImpl = fetch) {
  const targets = passTargets(env);
  return async (req, res) => {
    if (req.method !== 'GET') return refuse(res, 405, 'Only a GET is passed on: a test reads, it never changes anything.');
    const target = String(req.headers['x-api-url'] || '').trim();
    if (!allowedTarget(target, targets))
      return refuse(
        res,
        403,
        `This studio doesn’t pass calls to ${target || 'that address'}. Add its address to API_PASS_TARGETS in .env.local, then restart the studio.`,
      );
    const headers = passedHeaders(req.headers['x-api-headers']);
    if (!headers) return refuse(res, 400, 'The connection’s headers could not be read.');
    try {
      const upstream = await fetchImpl(target, { method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(15000) });
      const text = (await upstream.text()).slice(0, MAX_ANSWER);
      res.statusCode = upstream.status;
      res.setHeader('content-type', upstream.headers?.get?.('content-type') || 'text/plain');
      res.setHeader('cache-control', 'no-store');
      res.end(text);
    } catch (error) {
      return refuse(res, 502, `${target} did not answer (${error.message}).`);
    }
  };
}

// A Vite plugin: the same route on the dev server and on `vite preview`.
export function apiPassPlugin(env) {
  const handler = apiPassMiddleware(env);
  return {
    name: 'weave-api-pass',
    configureServer(server) {
      server.middlewares.use('/api-pass', handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api-pass', handler);
    },
  };
}
