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

// ---- the agent's pages: where a setting is shown, in its own words, and the agent's pages and actions
test('everyday words find a part by what people call it: opening hours, documents, hand over', async () => {
  assert.equal(find('opening hours')[0]?.trail.join('.'), 'schedules');
  assert.ok(find('documents').some((e) => e.trail.join('.') === 'knowledge'));
  assert.ok(find('hand over').some((e) => e.trail.join('.').startsWith('telephony.transfers') || e.label === 'Hand over to a person'));
});

test('agent pages: a setting opens on the page and panel that hold it, and says so in the page’s words', async () => {
  const { searchTarget, settingWhere } = await import('../src/studio/agent/pages.js');
  const entry = (trail) => index.find((e) => e.trail.join('.') === trail);
  const hours = entry('schedules');
  assert.deepEqual(searchTarget(hours), { page: 'channels', path: ['schedules'] });
  assert.match(settingWhere(hours), /^Channels/);
  // what it says first and what it should do are fields of the Agent page
  const greeting = index.find((e) => e.trail[0] === 'channels' && e.trail.includes('greeting'));
  assert.deepEqual(searchTarget(greeting), { page: 'agent', focus: 'greeting', path: ['channels'] });
  assert.equal(settingWhere(greeting), 'Agent › What it says first');
  // a panel of the Agent page is named as the page names it, and nothing deeper
  const voice = entry('defaults.models.tts.voice_id');
  assert.equal(searchTarget(voice).drawer, 'voice');
  assert.equal(settingWhere(voice), 'Agent › Voice');
  const recording = entry('post_call.recording');
  assert.equal(searchTarget(recording).page, 'aftercall');
  assert.match(settingWhere(recording), /^After the call › /);
  // nothing found by the search is placed on a page the agent does not have
  const { PAGE_IDS } = await import('../src/studio/agent/pages.js');
  const lost = index.filter((e) => !PAGE_IDS.includes(searchTarget(e).page)).map((e) => e.trail.join('.'));
  assert.deepEqual(lost, []);
  assert.ok(
    index.every((e) => !/How it behaves|Where it is available|Quality and records/.test(settingWhere(e))),
    'no classic section names',
  );
});

test('agent pages: a setting found under one name in many places is listed twice at most, so other settings still fit', async () => {
  const { capSameLabel } = await import('../src/studio/agent/pages.js');
  const found = find('hours', 24);
  const count = (list) => list.filter((e) => e.label === 'Business hours').length;
  assert.ok(count(found) > 2, 'the search finds business hours in many places');
  const capped = capSameLabel(found, 2);
  assert.equal(count(capped), 2);
  assert.equal(capped[0], found[0], 'the best match stays first');
  assert.ok(capped.length > 2 && capped.some((e) => e.label !== 'Business hours'), 'other settings it found are kept');
  assert.deepEqual(capSameLabel(found, Infinity), found);
});

test('agent pages: the agent’s pages and the things people come to do are found by the words they use, the best match first', async () => {
  const { searchAgent } = await import('../src/studio/agent/pages.js');
  const ids = (q) => searchAgent(q).map((i) => i.id);
  assert.equal(searchAgent('').length, 16, 'with nothing typed, the pages');
  assert.ok(ids('bank').includes('page-banking'), 'the Banking page is found by what it is about');
  assert.equal(ids('deploy')[0], 'deploy');
  assert.equal(ids('roll back')[0], 'rollback');
  assert.equal(ids('publish')[0], 'publish');
  assert.ok(ids('phone number').includes('number'));
  assert.ok(ids('documents').includes('page-knowledge'));
  assert.ok(ids('wizard').includes('setup'));
  assert.ok(!ids('voice').includes('page-settings'), 'Settings says the voice is NOT there; it is not offered for it');
  assert.ok(ids('voice').includes('page-agent'));
  assert.deepEqual(ids('zzz'), []);
});

test('agent pages: an agent’s own instructions open on the Agent page only when there is one agent to have them', async () => {
  const { searchTarget } = await import('../src/studio/agent/pages.js');
  const role = index.find((e) => e.trail[0] === 'agents' && e.trail.at(-1) === 'role');
  assert.ok(role, 'the instructions are in the index');
  const one = { agents: { items: [{ id: 'assistant' }] } };
  const two = { agents: { items: [{ id: 'assistant' }, { id: 'billing' }] } };
  assert.equal(searchTarget(role, one).focus, 'role');
  assert.equal(searchTarget(role).focus, 'role', 'not knowing the draft, as on one agent');
  const several = searchTarget(role, two);
  assert.equal(several.focus, undefined);
  assert.equal(several.page, 'workflow', 'with several, the Workflow’s settings, where each agent is');
});
