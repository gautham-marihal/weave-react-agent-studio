// The mock bank services: `npm run mock` (from the project) or `npm start` (from mock-api/) on this machine; Vercel
// finds this file and runs it the same way (https://weave-mock-api.vercel.app). PORT (default 4400) and MOCK_API_KEY
// (optional: then calls need the header x-api-key) come from the environment.
import http from 'node:http';
import { handle } from './src/app.mjs';

const PORT = Number(process.env.PORT || 4400);

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const url = new URL(req.url, 'http://localhost');
    let answer;
    try {
      // a route that reads a store answers later (a promise); the others at once
      answer = await handle({
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        body: Buffer.concat(chunks).toString('utf8'),
        headers: req.headers,
      });
    } catch (err) {
      console.error(err);
      answer = { status: 503, body: { ok: false, reason: 'The service is not available just now. Try again shortly.' } };
    }
    res.writeHead(answer.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(answer.body));
  });
});

server.listen(PORT, () => {
  console.log(`Mock bank services on http://localhost:${PORT}  (GET /routes lists them${process.env.MOCK_API_KEY ? '; x-api-key required' : ''})`);
});
