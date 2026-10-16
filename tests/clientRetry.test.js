import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/api/client.js';

// A read whose connection was dropped on the way (the dev proxy's ECONNRESET, a server closing an idle connection) is asked once more; a write never is.
const answer = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
const withFetch = async (script, run) => {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push(`${init?.method || 'GET'} ${url}`);
    const next = script.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = real;
  }
};

test('a read that lost its connection is asked once more, and then answers', async () => {
  await withFetch([new TypeError('fetch failed'), answer(200, [{ id: 'a' }])], async (calls) => {
    assert.deepEqual(await api.listBots(), [{ id: 'a' }]);
    assert.equal(calls.length, 2);
  });
});

test('a gateway answer with no detail (the API is down) is also tried once more', async () => {
  await withFetch([answer(502, {}), answer(200, [])], async (calls) => {
    assert.deepEqual(await api.listBots(), []);
    assert.equal(calls.length, 2);
  });
});

test('a read that fails twice says so, after exactly two tries', async () => {
  await withFetch([new TypeError('fetch failed'), new TypeError('fetch failed'), answer(200, [])], async (calls) => {
    await assert.rejects(
      () => api.listBots(),
      (error) => error.kind === 'network',
    );
    assert.equal(calls.length, 2, 'not a loop');
  });
});

test('a real answer, even a refusal, is never asked again', async () => {
  await withFetch([answer(404, { detail: 'No such agent.' }), answer(200, {})], async (calls) => {
    await assert.rejects(
      () => api.getBot('nope'),
      (error) => error.kind === 'not_found',
    );
    assert.equal(calls.length, 1);
  });
});

test('a write is never repeated', async () => {
  await withFetch([new TypeError('fetch failed'), answer(201, {})], async (calls) => {
    await assert.rejects(
      () => api.createBot({ id: 'x', name: 'X' }),
      (error) => error.kind === 'network',
    );
    assert.equal(calls.length, 1, 'a second create could make two');
  });
});
