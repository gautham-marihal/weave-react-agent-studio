// A stand-in for the Agent Builder API, for running the smoke test without a backend (E2E_MODE=mock). It is the same imitation API the
// app uses in demo mode (src/demo/demoApi.js), put behind Playwright's request interception, so the test exercises that code too. The one
// difference: the demo API refuses a test session (it has no LiveKit), and here the answer is a join token for the fake LiveKit in
// e2e/fakeLivekit.js, so the Test tab can have a conversation.
import fs from 'node:fs';
import { createDemoApi, memoryStorage } from '../src/demo/demoApi.js';

const SCHEMA = JSON.parse(fs.readFileSync(new URL('../tests/fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

export function createMockApi() {
  const demo = createDemoApi({ storage: memoryStorage(), loadSchema: async () => SCHEMA });
  const log = []; // every request the app made: "METHOD /path"

  async function handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    const path = `${url.pathname.replace(/^\/api/, '')}${url.search}`;
    const method = req.method();
    log.push(`${method} ${url.pathname.replace(/^\/api/, '')}`);
    let body;
    if (method !== 'GET') {
      try {
        body = req.postDataJSON() || {};
      } catch {
        body = {};
      }
    }
    const session = /^\/bots\/([^/]+)\/sessions$/.exec(url.pathname.replace(/^\/api/, ''));
    if (session && method === 'POST') {
      const exists = await demo.handle('GET', `/bots/${session[1]}`);
      if (exists.status !== 200) return route.fulfill(json(exists.body, exists.status));
      return route.fulfill(
        json(
          {
            livekit_url: 'wss://fake.example',
            token: 'fake-token-for-the-e2e-run',
            room: `test-${session[1]}-1`,
            identity: 'tester',
            expires_in_s: 900,
            bot: session[1],
            ref: body.ref || 'draft',
            version: 'draft',
            channel: { id: 'web-chat', type: 'web_chat', input: ['text'], output: ['text'] },
          },
          201,
        ),
      );
    }
    const answer = await demo.handle(method, path, body);
    return route.fulfill(json(answer.body, answer.status));
  }

  // what the fake holds, for assertions
  const bots = {
    get: async (id) => {
      const draft = await demo.handle('GET', `/bots/${id}/draft`);
      const summary = await demo.handle('GET', `/bots/${id}`);
      return draft.status === 200 ? { config: draft.body.config, deployed: summary.body.deployed, revision: draft.body.revision } : undefined;
    },
  };
  return { handle, bots, log };
}
