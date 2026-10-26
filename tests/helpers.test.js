import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lineOf, locatePath } from '../src/studio/jsonPath.js';
import { formatDiffPath, formatPath, freeBotId, nextVersion, slugify } from '../src/studio/format.js';
import { parseRoute, routeHref } from '../src/studio/route.js';
import { classify, groupIssues } from '../src/api/client.ts';

const example = JSON.parse(readFileSync(new URL('./fixtures/agent-config.example.json', import.meta.url), 'utf8'));
const text = JSON.stringify(example, null, 2);
const at = (obj, path) => path.reduce((o, k) => o[k], obj);
const valueAt = (path) => {
  const span = locatePath(text, path);
  return span && JSON.parse(text.slice(span[0], span[1]));
};

test('locatePath finds the value an error path points at', () => {
  const paths = [
    ['meta', 'id'],
    ['agents', 'items', 0, 'tools', 1],
    ['agents', 'items', 0, 'handoffs'],
    ['channels', 1, 'overrides', 'models'],
    ['defaults', 'models', 'realtime'],
    ['guardrails', 'limits'],
    ['schedules', 'support_hours', 'weekly', 1, 'days'],
    ['tools', example.tools.findIndex((t) => t.id === 'report_hazard'), 'request', 'body'],
  ];
  for (const path of paths) assert.deepEqual(valueAt(path), at(example, path), formatPath(path));
});

test('locatePath falls back to the nearest ancestor', () => {
  assert.deepEqual(valueAt(['meta', 'nope']), example.meta);
  assert.deepEqual(valueAt(['agents', 'items', 99, 'x']), example.agents.items);
  assert.deepEqual(valueAt([]), example);
});

test('locatePath copes with escapes, odd whitespace and minified JSON', () => {
  const tricky = '{"a\\"b":{"x":"}{,\\"]"},  "c" :\n [ 1 , {"d": [true,null]} ] }';
  const get = (p) => {
    const r = locatePath(tricky, p);
    return r && JSON.parse(tricky.slice(r[0], r[1]));
  };
  assert.equal(get(['a"b', 'x']), '}{,"]');
  assert.deepEqual(get(['c', 1, 'd']), [true, null]);
  assert.equal(get(['c', 0]), 1);
  assert.equal(locatePath('{"a": ', ['a']) === null || true, true); // truncated text must not throw
  assert.equal(lineOf('a\nb\nc', 4), 3);
});

test('paths are formatted for people', () => {
  assert.equal(formatPath(['agents', 'items', 0, 'tools', 2]), 'agents.items[0].tools[2]');
  assert.equal(formatDiffPath(['agents', 'items', 'id=billing', 'tools']), 'agents.items[billing].tools');
  assert.equal(formatDiffPath([]), '(whole config)');
});

test('versions and ids', () => {
  assert.equal(nextVersion('0.2.0', 'patch'), '0.2.1');
  assert.equal(nextVersion('0.2.1', 'minor'), '0.3.0');
  assert.equal(nextVersion('1.4.9', 'major'), '2.0.0');
  assert.equal(slugify('  3rd Floor Bot!! '), 'rd-floor-bot');
  assert.equal(slugify('Acme Support'), 'acme-support');
});

test('hash routes', () => {
  assert.deepEqual(parseRoute('#/bots?new=1'), { view: 'list', params: { new: '1' } });
  assert.deepEqual(parseRoute('#/bots/acme/versions'), { view: 'bot', botId: 'acme', tab: 'versions', bare: false, params: {} });
  assert.equal(parseRoute('#/bots/acme/zzz').tab, 'config');
  assert.equal(parseRoute('').view, 'list');
  assert.equal(routeHref('acme', 'deploy', { version: '0.1.0' }), '#/bots/acme/deploy?version=0.1.0');
  assert.equal(routeHref(), '#/bots');
  assert.equal(routeHref('acme', 'config'), '#/bots/acme/config');
});

test('API errors are told apart', () => {
  assert.equal(classify(500, null).kind, 'network'); // the dev proxy answers this when the API is down
  assert.equal(classify(502, '<html>').kind, 'network');
  assert.equal(classify(500, { detail: 'boom' }).kind, 'server');
  assert.equal(classify(401, { detail: 'x' }).kind, 'auth');
  assert.equal(classify(404, { detail: 'x' }).kind, 'not_found');
  assert.equal(classify(409, { detail: 'x' }).kind, 'conflict');
  assert.equal(classify(503, { detail: 'x' }).kind, 'unavailable');
  const invalid = classify(422, { detail: 'bad', errors: [{ path: ['a'], message: 'm' }] });
  assert.equal(invalid.kind, 'invalid');
  assert.equal(invalid.errors.length, 1);
  assert.equal(classify(422, { detail: [{ loc: ['body'], msg: 'nope', type: 'x' }] }).kind, 'client_bug');
});

test('validation reports become one flat list; empty and null paths mean "general"', () => {
  const issues = groupIssues({
    errors: [
      { path: [], message: 'a' },
      { path: ['x', 0], message: 'b' },
    ],
    warnings: [{ path: null, message: 'c' }],
  });
  assert.deepEqual(
    issues.map((i) => [i.severity, i.path]),
    [
      ['error', null],
      ['error', ['x', 0]],
      ['warning', null],
    ],
  );
});

import { botIdProblem } from '../src/studio/format.js';

test('an id for a new agent: pattern, the ids the runtime reserves, and ids already taken', () => {
  assert.equal(botIdProblem(''), '');
  assert.equal(botIdProblem('acme-support', ['other']), '');
  assert.match(botIdProblem('Acme'), /Start with a lowercase letter/);
  assert.match(botIdProblem('1abc'), /Start with a lowercase letter/);
  for (const id of ['transcripts', 'metrics', 'logs', 'sessions', 'tmp']) assert.match(botIdProblem(id), /reserved/, id);
  assert.equal(botIdProblem('logs-2'), '');
  assert.match(botIdProblem('taken', ['taken']), /already exists/);
});

test('a new agent’s id is made from its name, and is always free: a person only gives a name', () => {
  assert.equal(freeBotId('Front Desk', []), 'front-desk');
  assert.equal(freeBotId('Front Desk', ['front-desk']), 'front-desk-2');
  assert.equal(freeBotId('Front Desk', ['front-desk', 'front-desk-2']), 'front-desk-3');
  assert.equal(freeBotId('Logs', []), 'logs-2', 'a reserved id is not given');
  assert.equal(freeBotId('歯科クリニック', []), 'agent', 'a name in another script still makes an id');
  assert.equal(freeBotId('歯科クリニック', ['agent']), 'agent-2');
  const long = 'x'.repeat(80);
  const id = freeBotId(long, [long.slice(0, 64)]);
  assert.equal(id.length, 64);
  assert.ok(id.endsWith('-2'));
  [freeBotId('Front Desk', ['front-desk']), freeBotId('Logs'), freeBotId('!!!'), id].forEach((made) => assert.equal(botIdProblem(made, ['front-desk']), ''));
});
