// Sign-in against credentials.txt: POST /auth/login { email, password } answers 200 { ok, email } when that email
// and password are a line of the file, 401 otherwise. The file stays on the server (the browser never gets it), one
// person per line: `email password` (# starts a comment). It is read at every sign-in, so edits apply at once.
// CREDENTIALS_FILE points at another file. Served by the Vite dev server (vite.config.js) and by server/prod.mjs.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';

const MAX_BODY = 4096;

/** The logins in a credentials file's text, as [{ email (lower case), password }]. */
export function parseCredentials(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const space = line.search(/\s/);
      return space < 0 ? null : { email: line.slice(0, space).toLowerCase(), password: line.slice(space).trim() };
    })
    .filter((entry) => entry && entry.email && entry.password);
}

// the same length and every byte the same, in a time that doesn't say how much of it matched
const same = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Whether `email` and `password` are a login of the list. */
export function matches(list, email, password) {
  const wanted = String(email || '')
    .trim()
    .toLowerCase();
  return list.some((entry) => entry.email === wanted && same(entry.password, password || ''));
}

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((ok, fail) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY) fail(Object.assign(new Error('too large'), { status: 413 }));
    });
    req.on('end', () => ok(raw));
    req.on('error', fail);
  });

// connect-style (mounted at /auth); `readText` is injectable for tests
export function authMiddleware(env = process.env, readText = (file) => readFileSync(file, 'utf8')) {
  const file = resolve(env.CREDENTIALS_FILE || 'credentials.txt');
  return async (req, res) => {
    const path = (req.url || '').split('?')[0];
    if (!(req.method === 'POST' && (path === '/login' || path === '/login/'))) return send(res, 404, { error: 'Not found.' });
    let list;
    try {
      list = parseCredentials(readText(file));
    } catch {
      return send(res, 503, { error: 'Sign-in isn’t set up on this server (no credentials file).' });
    }
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (error) {
      return send(res, error.status || 400, { error: 'The request is not valid.' });
    }
    if (!matches(list, payload?.email, payload?.password)) {
      // a short wait on a wrong guess, so guessing many is slow
      await new Promise((ok) => setTimeout(ok, 400));
      return send(res, 401, { error: 'That email and password don’t match.' });
    }
    return send(res, 200, { ok: true, email: String(payload.email).trim() });
  };
}

// A Vite plugin: the same route on the dev server and on `vite preview`.
export function authPlugin(env) {
  const handler = authMiddleware(env);
  return {
    name: 'weave-auth',
    configureServer(server) {
      server.middlewares.use('/auth', handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/auth', handler);
    },
  };
}
