import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSettingsIndex, searchSettings } from '../src/studio/settingsSearch.js';

// "Find a setting by name": the index covers every setting the schema has, says where each one lives, and the search finds it by what it is called,
// what it is for, or the technical name.
const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
const index = buildSettingsIndex(schema);
const find = (query, limit = 5) => searchSettings(index, query, limit);

test('the index has every setting the schema has (but what the platform sets up), each with a plain label and a place', () => {
  assert.ok(index.length > 1500, `a large index (${index.length})`);
  const names = new Set(index.map((e) => e.name));
  ['timeout_s', 'top_k', 'voice_id', 'recording_notice', 'session_log', 'retention_days', 'http_port', 'dispatch_name'].forEach((name) =>
    assert.ok(names.has(name), name),
  );
  const bad = index.filter((e) => !e.label || /_/.test(e.label) || !e.screen || !e.where);
  assert.deepEqual(
    bad.map((e) => e.trail.join('.')),
    [],
    'every entry has a plain label and a screen of its own',
  );
});

test('a setting is found by what a customer would call it', () => {
  assert.ok(
    find('silent').some((e) => e.label === 'Nudge a silent caller'),
    'among the first few',
  );
  assert.equal(find('nudge')[0].trail.join('.'), 'defaults.conversation.inactivity.enabled');
  assert.match(find('interrupt')[0].where, /How it talks/);
  assert.ok(
    find('recording').some((e) => e.label === 'Recording notice' && /About this agent/.test(e.where)),
    'the recording notice and where it is',
  );
  assert.ok(find('retention').some((e) => /Keep for|Delete/i.test(e.label) || /retention_days/.test(e.name)));
});

test('and by the technical name a developer knows', () => {
  assert.equal(find('timeout_s')[0].name, 'timeout_s');
  assert.ok(find('top_k').some((e) => e.label === 'How many results'));
  assert.ok(find('dnis').some((e) => e.label === 'Phone number it answers' && e.trail.join('.') === 'telephony.pbx.dnis'));
});

test('what the platform sets up is not offered as a setting: a phone channel’s number, trunk and routing rule (FRONTEND_GUIDE 4, section 8)', () => {
  const trails = index.map((e) => e.trail.join('.'));
  for (const key of ['dnis', 'sip_trunk', 'dispatch_rule']) assert.ok(!trails.includes(`channels.[].entry.${key}`), key);
  assert.deepEqual(find('sip_trunk'), []);
  assert.deepEqual(find('dispatch_rule'), []);
  assert.ok(trails.includes('channels.[].entry.widget_id'), 'a web chat’s widget id is still a setting');
});

test('every word typed has to match, results say where they are, and an expert setting comes after an everyday one', () => {
  assert.deepEqual(find('qqqq zzzz'), []);
  assert.deepEqual(find(''), []);
  assert.deepEqual(find('a'), [], 'a single letter is not a search');
  const both = find('silent caller');
  assert.ok(both.length && both.every((e) => /silent|quiet|caller/i.test(`${e.label} ${e.purpose} ${e.where}`)));
  const timeouts = find('wait', 30);
  const firstExpert = timeouts.findIndex((e) => e.level === 'expert');
  const lastGuided = timeouts.map((e) => e.level).lastIndexOf('guided');
  assert.ok(firstExpert === -1 || lastGuided < firstExpert || timeouts.slice(0, firstExpert).every((e) => e.level !== 'expert'), 'expert settings sort after');
  find('time').forEach((e) => assert.ok(e.where.includes('›') || e.where.length > 0));
});

test('a setting inside a list or a map can be opened up to the list or map', () => {
  const tool = index.find((e) => e.trail.join('.') === 'tools.[].timeout_s');
  assert.deepEqual(tool.jump, ['tools']);
  assert.equal(tool.screen.id, 'tools');
  const variable = index.find((e) => e.trail.join('.') === 'state.variables.{}.sensitive');
  assert.deepEqual(variable.jump, ['state', 'variables']);
  assert.equal(find('sensitive').length > 0, true);
  const wait = index.find((e) => e.trail.join('.') === 'defaults.conversation.inactivity.timeout_s');
  assert.deepEqual(wait.jump, ['defaults', 'conversation', 'inactivity', 'timeout_s']);
  assert.equal(wait.screen.id, 'defaults.conversation');
  assert.equal(wait.group.label, 'How it talks');
});

test('settings that sit in the engine group say so, so nobody mistakes them for everyday ones', () => {
  const worker = find('worker', 10).find((e) => e.name === 'http_port' || e.name === 'worker');
  assert.ok(worker);
  assert.equal(worker.group.advanced, true);
  assert.match(worker.where, /Engine and operator settings/);
});
