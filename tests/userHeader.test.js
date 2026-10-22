import test from 'node:test';
import assert from 'node:assert/strict';
import { api, headerSafe, setApiUser } from '../src/api/client.js';

// FRONTEND_GUIDE 4 (section 10.5): "Always send the signed-in person in the X-User header", so saves, publishes, deploys and phone-number changes say who
// made them. A header carries printable Latin-1 only, so a name it can't carry falls back to the email, or to nothing.
const sent = async (run) => {
  const real = globalThis.fetch;
  let headers = null;
  globalThis.fetch = async (url, init) => {
    headers = init?.headers || {};
    return { ok: true, status: 200, text: async () => '[]' };
  };
  try {
    await run();
    return headers;
  } finally {
    globalThis.fetch = real;
    setApiUser('');
  }
};

test('the signed-in person goes with every request, reads and writes alike', async () => {
  setApiUser('Alex Morgan', 'alex@example.com');
  assert.equal((await sent(() => api.listBots()))['X-User'], 'Alex Morgan');
  setApiUser('Alex Morgan', 'alex@example.com');
  assert.equal((await sent(() => api.listNumbers()))['X-User'], 'Alex Morgan');
});

test('a name a header cannot carry falls back to the email, and with neither nothing is sent', async () => {
  setApiUser('王小明', 'xiaoming@example.com');
  assert.equal((await sent(() => api.listBots()))['X-User'], 'xiaoming@example.com');
  setApiUser('', '');
  assert.equal('X-User' in (await sent(() => api.listBots())), false);
  assert.equal(headerSafe('José  Núñez\n'), 'José Núñez', 'accents are Latin-1; spaces and line breaks are tidied');
  assert.equal(headerSafe('a’b'), '', 'a curly apostrophe is not Latin-1');
  assert.equal(headerSafe('x'.repeat(201)), '', 'too long to be a name');
});
