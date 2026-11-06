import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/api/client.ts';

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

// an agent as GET /bots lists it (the client checks the answer's shape)
const bot = { id: 'a', name: 'A', draft_revision: 1, draft_saved_at: '2026-10-20T10:00:00Z', latest_version: null, deployed: {} };

test('a read that lost its connection is asked once more, and then answers', async () => {
  await withFetch([new TypeError('fetch failed'), answer(200, [bot])], async (calls) => {
    assert.deepEqual(await api.listBots(), [bot]);
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

// FRONTEND_GUIDE 10.3: the live trace's named `error` event ("no call appeared within wait") is final, and is told
// apart from a dropped connection, so the browser doesn't reconnect to it forever with nothing said
test('following a call: the server’s own error event stops the stream and says why; a lost connection says nothing more', async () => {
  const { followCall } = await import('../src/api/client.ts');
  const made = [];
  class FakeSource {
    static CLOSED = 2;
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.listeners = {};
      made.push(this);
    }
    addEventListener(name, fn) {
      (this.listeners[name] ||= []).push(fn);
    }
    close() {
      this.readyState = FakeSource.CLOSED;
    }
    fire(name, event) {
      (this.listeners[name] || []).forEach((fn) => fn(event));
    }
  }
  const real = globalThis.EventSource;
  globalThis.EventSource = FakeSource;
  try {
    const reasons = [];
    followCall('bot', 'room-1', { onRecord() {}, onError: (reason) => reasons.push(reason ?? '') });
    const source = made[0];
    assert.match(source.url, /\/bots\/bot\/calls\/room-1\/stream$/);
    // a dropped connection the browser will retry: not final, nothing reported
    source.fire('error', {});
    assert.deepEqual(reasons, []);
    // the server's named event: closed at once, with its words
    source.fire('error', { data: JSON.stringify({ detail: 'no call appeared within 30 s' }) });
    assert.equal(source.readyState, FakeSource.CLOSED);
    assert.deepEqual(reasons, ['no call appeared within 30 s']);
  } finally {
    globalThis.EventSource = real;
  }
});
