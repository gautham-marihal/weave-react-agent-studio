import test from 'node:test';
import assert from 'node:assert/strict';
import { CREATABLE, createAndPoint, createProblems, getAt, setAt } from '../src/studio/form/inlineCreate.js';

test('getAt and setAt read and write at a path without touching the original', () => {
  const root = { a: { b: [{ c: 1 }, { c: 2 }] }, z: 1 };
  assert.equal(getAt(root, ['a', 'b', 1, 'c']), 2);
  assert.equal(getAt(root, ['a', 'nope', 'x']), undefined);
  const next = setAt(root, ['a', 'b', 0, 'c'], 9);
  assert.equal(next.a.b[0].c, 9);
  assert.equal(root.a.b[0].c, 1);
  assert.equal(next.a.b[1], root.a.b[1]); // untouched parts are shared
  assert.equal(setAt({}, ['x', 'y'], 1).x.y, 1);
  assert.deepEqual(setAt({ a: 1 }, [], 5), 5);
});

test('a new message is added with an id from its first words, and the field points at it', () => {
  const config = { messages: [{ id: 'goodbye', text: 'Bye' }], tools: [{ id: 'end_call', params: {} }] };
  const { config: next, id } = createAndPoint(config, 'messages', { text: 'Thanks for calling, take care' }, ['tools', 0, 'params', 'say', 'message']);
  assert.equal(id, 'thanks_for_calling');
  assert.deepEqual(next.messages.at(-1), { id: 'thanks_for_calling', text: 'Thanks for calling, take care' });
  assert.equal(next.tools[0].params.say.message, 'thanks_for_calling');
  assert.equal(config.messages.length, 1); // the original is untouched
  assert.equal(createAndPoint({}, 'messages', { text: '!!!' }).id, 'message');
  assert.equal(createAndPoint({ messages: [{ id: 'goodbye' }] }, 'messages', { text: 'Goodbye' }).id, 'goodbye_2');
});

test('a new state variable is typed for what it holds, and a counter starts at zero', () => {
  const text = createAndPoint({}, 'state_vars', { name: 'verified_name', kind: 'string' });
  assert.deepEqual(text.config.state.variables.verified_name, { type: 'string', nullable: true, default: null });
  const counter = createAndPoint({ state: { variables: { a: { type: 'string' } } } }, 'state_vars', { name: 'attempts', kind: 'integer' }, [
    'tools',
    0,
    'limits',
    'count_attempts_in',
  ]);
  assert.deepEqual(counter.config.state.variables.attempts, { type: 'integer', default: 0 });
  assert.ok('a' in counter.config.state.variables); // existing variables stay
  assert.equal(counter.config.tools[0].limits.count_attempts_in, 'attempts');
  assert.deepEqual(createAndPoint({}, 'state_vars', { name: 'flag', kind: 'boolean' }).config.state.variables.flag, { type: 'boolean', default: false });
});

test('a new HTTP connection is added with its base URL', () => {
  const { config, id } = createAndPoint({ tools: [{ id: 't' }] }, 'http_connections', { name: 'billing', base_url: ' https://api.example.com ' }, [
    'tools',
    0,
    'connection',
  ]);
  assert.equal(id, 'billing');
  assert.deepEqual(config.connections.billing, { type: 'http', base_url: 'https://api.example.com' });
  assert.equal(config.tools[0].connection, 'billing');
});

test('what is typed is checked before anything is created', () => {
  assert.deepEqual(createProblems('state_vars', { name: '', kind: 'string' }, {}), { name: 'Required.' });
  assert.match(createProblems('state_vars', { name: 'Bad-Name', kind: 'string' }, {}).name, /lowercase letters/);
  assert.equal(createProblems('state_vars', { name: 'taken', kind: 'string' }, { state: { variables: { taken: {} } } }).name, 'That variable already exists.');
  assert.match(createProblems('http_connections', { name: 'ok', base_url: 'ftp://x' }, {}).base_url, /Use e\.g\. https/);
  assert.equal(createProblems('http_connections', { name: 'ok', base_url: 'https://x.io' }, {}).name, undefined);
  assert.equal(
    createProblems('http_connections', { name: 'dup', base_url: 'https://x.io' }, { connections: { dup: {} } }).name,
    'That connection already exists.',
  );
  assert.deepEqual(createProblems('messages', { text: '  ' }, {}), { text: 'Required.' });
  assert.deepEqual(createProblems('unknown', {}, {}), {});
  assert.ok(CREATABLE.messages && CREATABLE.state_vars && CREATABLE.http_connections);
});

test('an unknown collection creates nothing', () => {
  const config = { a: 1 };
  assert.deepEqual(createAndPoint(config, 'agents', { name: 'x' }, ['a']), { config, id: undefined });
});
