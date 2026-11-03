// The Studio's production server (the Docker image runs it): the built app from dist/, and the three routes the Vite dev
// server provides in development, with the same rules:
//   /api      → AGENT_BUILDER_URL, with Authorization: Bearer AGENT_BUILDER_API_KEY added here (the key never reaches the
//               browser) and X-User replaced by AGENT_BUILDER_USER when that is set (as vite.config.js does)
//   /api-pass → Integrations › Test connection (apiPass.js: GET only, only to API_PASS_TARGETS)
//   /llm      → the Describe assistant's AI model (llmRoute.js, ANTHROPIC_API_KEY)
//   /auth     → sign-in against credentials.txt (authRoute.js)
// Like the dev server, anyone who can open it can use the key through it: keep it on a private network, or put real
// sign-in in front of it (docs/PRODUCTION.md). Settings come from the environment; PORT (default 8080), HOST (0.0.0.0).
import http from 'node:http';
import https from 'node:https';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiPassMiddleware } from '../apiPass.js';
import { llmMiddleware } from '../llmRoute.js';
import { authMiddleware } from '../authRoute.js';

const env = process.env;
const ROOT = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const PORT = Number(env.PORT || 8080);
const HOST = env.HOST || '0.0.0.0';
const target = new URL(env.AGENT_BUILDER_URL || 'http://localhost:8100');
const apiKey = env.AGENT_BUILDER_API_KEY || '';
const trustedUser = env.AGENT_BUILDER_USER || '';
const pass = apiPassMiddleware(env);
const llm = llmMiddleware(env);
// credentials.txt next to the app (/app in the image; docker-compose.yml mounts the project's copy)
const auth = authMiddleware({ ...env, CREDENTIALS_FILE: env.CREDENTIALS_FILE || fileURLToPath(new URL('../credentials.txt', import.meta.url)) });

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

// /api/… → the Agent Builder API, streamed both ways
function forward(req, res) {
  const path = req.url.replace(/^\/api/, '') || '/';
  const headers = { ...req.headers, host: target.host };
  delete headers.authorization;
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  if (trustedUser) headers['x-user'] = trustedUser;
  const base = target.pathname.replace(/\/+$/, '');
  const client = target.protocol === 'https:' ? https : http;
  const upstream = client.request(
    { protocol: target.protocol, hostname: target.hostname, port: target.port, method: req.method, path: `${base}${path}`, headers },
    (answer) => {
      res.writeHead(answer.statusCode || 502, answer.headers);
      answer.pipe(res);
    },
  );
  upstream.on('error', (error) => {
    if (res.headersSent) return res.destroy();
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ detail: `The Agent Builder API did not answer (${error.message}).` }));
  });
  req.pipe(upstream);
}

// the built app: a file from dist/, else index.html (the app's own pages are #/ addresses, so this is only for safety)
function serveFile(req, res) {
  let clean;
  try {
    clean = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    // a broken %-escape: answered, not thrown (a throw here would stop the whole server)
    res.writeHead(400).end();
    return;
  }
  let file = normalize(join(ROOT, clean));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) {
    res.writeHead(400).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(ROOT, 'index.html');
  const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
  // hashed files under assets/ never change; index.html is always asked again so a new build is picked up
  const cache = file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'content-type': type, 'cache-control': cache, 'x-content-type-options': 'nosniff' });
  createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res);
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  if (url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (url.startsWith('/auth/')) {
    req.url = url.slice('/auth'.length);
    return auth(req, res);
  }
  if (url === '/api' || url.startsWith('/api/')) return forward(req, res);
  if (url === '/api-pass' || url.startsWith('/api-pass?') || url.startsWith('/api-pass/')) return pass(req, res);
  if (url === '/llm' || url.startsWith('/llm/') || url.startsWith('/llm?')) {
    // mounted at /llm, as on the dev server: the route sees the rest of the address
    req.url = url.slice('/llm'.length) || '/';
    return llm(req, res, () => {
      res.writeHead(404).end();
    });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  return serveFile(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(
    `Weave Studio on http://${HOST}:${PORT} · API ${target.origin}${target.pathname === '/' ? '' : target.pathname} · key ${apiKey ? 'set' : 'not set'}`,
  );
});
