import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { authMiddleware, matches, parseCredentials } from '../authRoute.js';

// Signing in against credentials.txt (authRoute.js): the file's lines, and POST /auth/login answering yes or no.

const WORD = 'agentbuilderweave1234';
const FILE = '# a comment\n\n demo_weave@tetherfi.com  agentbuilderweave1234 \r\nsecond@example.com pass word\nbroken-line\n';

const post = (body, method = 'POST', url = '/login') => {
  const req = new EventEmitter();
  Object.assign(req, { method, url, headers: {} });
  setImmediate(() => {
    if (body !== undefined) req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
    req.emit('end');
  });
  return req;
};
const response = () => {
  const res = { headers: {}, setHeader: (k, v) => (res.headers[k] = v) };
  res.done = new Promise((resolve) => (res.end = (text) => resolve({ status: res.statusCode, body: JSON.parse(text) })));
  return res;
};
const ask = async (handler, req) => {
  const res = response();
  await handler(req, res);
  return res.done;
};

test('the file: one email and password per line, comments and broken lines skipped', () => {
  assert.deepEqual(parseCredentials(FILE), [
    { email: 'demo_weave@tetherfi.com', password: WORD },
    { email: 'second@example.com', password: ['pass', 'word'].join(' ') },
  ]);
  assert.deepEqual(parseCredentials(''), []);
});

test('a match needs the email (any case) and the exact password', () => {
  const list = parseCredentials(FILE);
  assert.equal(matches(list, ' Demo_Weave@Tetherfi.com ', 'agentbuilderweave1234'), true);
  assert.equal(matches(list, 'demo_weave@tetherfi.com', 'Agentbuilderweave1234'), false);
  assert.equal(matches(list, 'demo_weave@tetherfi.com', 'agentbuilderweave123'), false);
  assert.equal(matches(list, 'someone@tetherfi.com', 'agentbuilderweave1234'), false);
  assert.equal(matches(list, 'second@example.com', 'pass word'), true);
  assert.equal(matches(list, '', ''), false);
});

test('POST /login answers 200 for a line of the file and 401 otherwise', async () => {
  const handler = authMiddleware({ CREDENTIALS_FILE: 'x.txt' }, () => FILE);
  const yes = await ask(handler, post({ email: 'demo_weave@tetherfi.com', password: WORD }));
  assert.deepEqual(yes, { status: 200, body: { ok: true, email: 'demo_weave@tetherfi.com' } });
  const no = await ask(handler, post({ email: 'demo_weave@tetherfi.com', password: `${WORD}x` }));
  assert.equal(no.status, 401);
  assert.match(no.body.error, /don’t match/);
});

test('anything else is refused: other methods, other paths, bad bodies, no file', async () => {
  const handler = authMiddleware({}, () => FILE);
  assert.equal((await ask(handler, post(undefined, 'GET'))).status, 404);
  assert.equal((await ask(handler, post({}, 'POST', '/other'))).status, 404);
  assert.equal((await ask(handler, post('not json'))).status, 400);
  const missing = authMiddleware({}, () => {
    throw new Error('ENOENT');
  });
  assert.equal((await ask(missing, post({ email: 'a@b.co', password: WORD }))).status, 503);
});
