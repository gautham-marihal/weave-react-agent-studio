import test from 'node:test';
import assert from 'node:assert/strict';
import { agentConnection, cleanHeaders, connectionParts, headerProblems, isWebAddress, plainHeaders } from '../src/studio/connectionParts.js';

// Every integration's connection, the same way: an address and the headers sent with every call, one of them perhaps a
// secret's name (src/studio/connectionParts.js).

const row = (name, value, secret = false) => ({ name, value, secret });

test('a saved connection is read as its address and headers; one saved the old way too', () => {
  assert.deepEqual(connectionParts({ url: ' https://a.test ', headers: [row(' Region ', ' EU '), row('', 'x')] }, 'crm'), {
    url: 'https://a.test',
    headers: [row('Region', 'EU')],
  });
  assert.deepEqual(connectionParts({ first: 'https://a.test', second: 'APAC' }, 'crm'), { url: 'https://a.test', headers: [row('Region', 'APAC')] });
  assert.deepEqual(connectionParts({ first: 'https://a.test', second: '' }, 'crm').headers, [row('Region', 'DB2')], 'the Region it was made with');
  assert.deepEqual(
    connectionParts({ first: 'https://a.test', second: 'a key' }, 'webhook'),
    { url: 'https://a.test', headers: [] },
    'an old key box is not a header',
  );
  assert.deepEqual(connectionParts(undefined, 'crm'), { url: '', headers: [] });
  assert.ok(isWebAddress('https://a.test') && isWebAddress('HTTP://a') && !isWebAddress('a.test') && !isWebAddress(''));
});

test('an agent gets the address, the plain headers, and the secret one as its sign-in', () => {
  const parts = { url: 'https://a.test', headers: [row('Region', 'EU'), row('X-Version', '2'), row('x-api-key', 'DB_KEY', true)] };
  assert.deepEqual(agentConnection(parts), {
    type: 'http',
    base_url: 'https://a.test',
    headers: { Region: 'EU', 'X-Version': '2' },
    auth: { type: 'api_key', header: 'x-api-key', key: { secret: 'DB_KEY' } },
    timeout_s: 10,
  });
  assert.deepEqual(
    agentConnection({ url: 'https://a.test', headers: [] }),
    { type: 'http', base_url: 'https://a.test', timeout_s: 10 },
    'nothing extra when there are none',
  );
  assert.deepEqual(plainHeaders(parts), { Region: 'EU', 'X-Version': '2' }, 'the secret one is never sent from the page');
});

test('header rows: proper names, each once, a value each, at most one secret, which names a secret', () => {
  assert.deepEqual(headerProblems([row('Region', 'EU'), row('', ''), row('x-api-key', 'DB_KEY', true)]), {}, 'an empty row is ignored');
  const problems = headerProblems([
    row('', 'EU'),
    row('Bad name', 'x'),
    row('Host', 'a.test'),
    row('Region', 'EU'),
    row('region', 'US'),
    row('X-Empty', ''),
    row('Authorization', 'Bearer abc', true),
    row('x-api-key', 'KEY', true),
  ]);
  assert.match(problems[0], /name/);
  assert.match(problems[1], /no spaces/);
  assert.match(problems[2], /set by the connection/);
  assert.equal(problems[3], undefined);
  assert.match(problems[4], /already sent/, 'names are the same whatever their case');
  assert.match(problems[5], /value/);
  assert.match(problems[6], /secret’s name/, 'a key typed in place of a secret’s name is caught');
  assert.match(problems[7], /One header can be secret/);
  assert.deepEqual(cleanHeaders([row(' A ', ' 1 '), row('', ''), { name: 'B' }]), [row('A', '1'), row('B', '')]);
});
