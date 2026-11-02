// A local stand-in for the Agent Builder API, for the browser tests only: in memory, seeded with sample agents and calls,
// never connected to anything. `node e2e/support/standInServer.mjs <port>`; Studio's dev server points AGENT_BUILDER_URL here.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createDemoApi, memoryStorage } from './agentBuilderStandIn.mjs';

const port = Number(process.argv[2] || 8400);
const schema = JSON.parse(readFileSync(new URL('../../src/test/fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
const api = createDemoApi({ storage: memoryStorage(), loadSchema: async () => schema, history: true });

http
  .createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body = {};
    if (raw && /json/.test(req.headers['content-type'] || '')) body = JSON.parse(raw);
    else if (raw) body = { __file: raw };
    // A followed call answers as server-sent events: `open` (the call), one message per record, then `end`.
    const stream = req.method === 'GET' && /^\/bots\/([^/]+)\/calls\/([^/?]+)\/stream(?:\?after=(\d+))?$/.exec(req.url);
    if (stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const send = (event, data) => res.write(`${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data ?? {})}\n\n`);
      const stop = api.follow(decodeURIComponent(stream[1]), decodeURIComponent(stream[2]), {
        after: Number(stream[3]) || 0,
        onOpen: (call) => send('open', call),
        onRecord: (record) => send('', record),
        onEnd: () => {
          send('end', {});
          res.end();
        },
      });
      req.on('close', () => stop());
      return;
    }
    try {
      const answer = await api.handle(req.method, req.url, body);
      res.writeHead(answer.status, { 'Content-Type': 'application/json' });
      res.end(answer.body === undefined ? '' : JSON.stringify(answer.body));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ detail: `stand-in failed: ${String(error?.message || error)}` }));
    }
  })
  .listen(port, '127.0.0.1', () => console.log(`stand-in Agent Builder API on http://127.0.0.1:${port}`));
