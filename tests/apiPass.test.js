import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedTarget, apiPassMiddleware, passTargets, passedHeaders } from '../apiPass.js';
import { testConnection, testOf, testUrl } from '../src/studio/integrations/apiTest.js';

// Testing a connected API from the Integrations page: the studio's pass-through (apiPass.js), which only passes a GET
// to the listed addresses, and the page's side of it (src/studio/integrations/apiTest.js).

const viaHeader = (headers) => encodeURIComponent(JSON.stringify(headers));
const request = (method, headers) => ({ method, url: '/', headers });
const response = () => {
  const res = { headers: {}, setHeader: (k, v) => (res.headers[k] = v) };
  res.done = new Promise((resolve) => (res.end = (text) => resolve({ status: res.statusCode, headers: res.headers, body: text })));
  return res;
};
const answer = (status, body = '{}', headers = {}) => ({
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  text: async () => body,
  json: async () => JSON.parse(body),
});

test('the listed addresses: comma separated, cleaned; anything under one is allowed', () => {
  assert.deepEqual(passTargets({}), [], 'none listed: nothing is passed on');
  assert.deepEqual(passTargets({ API_PASS_TARGETS: ' https://a.test/ , https://a.test, https://b.test/v1/' }), ['https://a.test', 'https://b.test/v1']);
  const targets = ['https://a.test', 'https://b.test/v1'];
  assert.ok(allowedTarget('https://a.test/health', targets));
  assert.ok(allowedTarget('https://b.test/v1', targets) && allowedTarget('https://b.test/v1/orders?x=1', targets));
  assert.ok(!allowedTarget('https://b.test/v10/orders', targets), 'a path matches at a boundary');
  assert.ok(!allowedTarget('https://b.test/v2', targets) && !allowedTarget('https://a.test.evil.test/', targets) && !allowedTarget('http://a.test/', targets));
  assert.ok(!allowedTarget('ftp://a.test/', ['ftp://a.test']) && !allowedTarget('not a url', targets));
});

test('the pass-through sends on only proper header names with one-line text values', () => {
  assert.deepEqual(passedHeaders(undefined), {});
  assert.deepEqual(passedHeaders(viaHeader({ Region: 'DB2', 'bad name': 'x', Cookie: 'a=b', Host: 'h', 'X-Two': 'a\r\nInjected: 1', 'X-N': 5 })), {
    Region: 'DB2',
  });
  assert.equal(passedHeaders(viaHeader(['Region'])), null);
  assert.equal(passedHeaders('%7Bnot json'), null);
});

test('the pass-through makes only a GET, only to a listed address, with the connection’s headers', async () => {
  let sent = null;
  const fetchImpl = async (url, init) => {
    sent = { url, init };
    return answer(200, '{"ok":true}', { 'content-type': 'application/json' });
  };
  const pass = apiPassMiddleware({ API_PASS_TARGETS: 'https://a.test' }, fetchImpl);
  let res = response();
  pass(request('GET', { 'x-api-url': 'https://a.test/health', 'x-api-headers': viaHeader({ Region: 'DB2', Host: 'elsewhere.test' }) }), res);
  let out = await res.done;
  assert.equal(out.status, 200);
  assert.equal(out.body, '{"ok":true}');
  assert.equal(out.headers['x-api-pass-refused'], undefined, 'the API’s own answer is not marked');
  assert.equal(sent.url, 'https://a.test/health');
  assert.equal(sent.init.method, 'GET');
  assert.deepEqual(sent.init.headers, { Region: 'DB2' });

  for (const [req, status] of [
    [request('POST', { 'x-api-url': 'https://a.test/health' }), 405],
    [request('GET', { 'x-api-url': 'http://169.254.169.254/latest' }), 403],
    [request('GET', { 'x-api-url': 'https://a.test/', 'x-api-headers': '%7Bnot json' }), 400],
  ]) {
    sent = null;
    res = response();
    pass(req, res);
    out = await res.done;
    assert.equal(out.status, status);
    assert.equal(out.headers['x-api-pass-refused'], '1');
    assert.equal(sent, null, `${status}: nothing is called`);
  }
  assert.match(
    JSON.parse(
      (
        await (async () => {
          const r = response();
          pass(request('GET', { 'x-api-url': 'https://z.test/' }), r);
          return r.done;
        })()
      ).body,
    ).problem,
    /API_PASS_TARGETS/,
  );
});

test('the page tests the address plus its test path, with the plain headers, and says how it went', async () => {
  assert.equal(testUrl('https://a.test/v1/', '/health'), 'https://a.test/v1/health');
  assert.equal(testUrl('https://a.test', 'status'), 'https://a.test/status');
  assert.equal(testUrl('https://a.test/', ''), 'https://a.test');
  assert.deepEqual(
    testOf(
      {
        url: 'https://a.test',
        testPath: '/health',
        headers: [
          { name: 'Region', value: 'EU' },
          { name: 'x-api-key', value: 'KEY', secret: true },
        ],
      },
      'crm',
    ),
    { url: 'https://a.test', path: '/health', headers: { Region: 'EU' }, secret: 'x-api-key' },
  );
  let seen;
  let clock = 1000;
  const now = () => (clock += 90);
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return answer(200);
  };
  const passed = await testConnection({ url: 'https://a.test', path: '/health', headers: { Region: 'EU' } }, { fetchImpl, pass: true, now });
  assert.deepEqual(passed, { ok: true, text: 'Test passed: GET /health answered 200 in 90 ms.' });
  assert.equal(seen.url, '/api-pass');
  assert.equal(seen.init.headers['X-Api-Url'], 'https://a.test/health');
  assert.deepEqual(JSON.parse(decodeURIComponent(seen.init.headers['X-Api-Headers'])), { Region: 'EU' });

  await testConnection({ url: 'https://a.test', headers: { Region: 'EU' } }, { fetchImpl, pass: false });
  assert.equal(seen.url, 'https://a.test');
  assert.deepEqual(seen.init.headers, { Region: 'EU' }, 'straight to the API outside a browser');

  const refused = await testConnection({ url: 'https://a.test', path: '/me', secret: 'x-api-key' }, { fetchImpl: async () => answer(401), pass: false });
  assert.equal(refused.ok, false);
  assert.match(refused.text, /GET \/me answered 401\. Tested without x-api-key/);
  const notListed = answer(403, JSON.stringify({ problem: 'Add its address to API_PASS_TARGETS' }), { 'x-api-pass-refused': '1' });
  assert.match((await testConnection({ url: 'https://a.test' }, { fetchImpl: async () => notListed, pass: true })).text, /API_PASS_TARGETS/);
  const offline = async () => {
    throw new TypeError('Failed to fetch');
  };
  assert.match((await testConnection({ url: 'https://a.test' }, { fetchImpl: offline, pass: true })).text, /studio’s server did not answer/);
  assert.match((await testConnection({ url: 'a.test' }, { fetchImpl })).text, /must start with http/);
});
