import test from 'node:test';
import assert from 'node:assert/strict';
import { POLICY_NOTE, buildChecklist, normalizePreflightKnowledge, verdict } from '../src/studio/release/checklist.js';
import { normalizeKnowledge } from '../src/studio/knowledge/model.js';

const ok = { valid: true, errors: [], warnings: [], secrets_required: [], unsupported: [] };
const withTests = { tests: [{ id: 'a', channel: 'web-chat', turns: [{ say: 'x' }], expect: [{ said_matches: '.' }] }] };
const ids = (items) => items.map((i) => i.id);
const by = (items, id) => items.find((i) => i.id === id);

test('a bot with nothing special gets the lines that apply to every bot and no others', () => {
  const items = buildChecklist({ config: {}, report: ok, version: { version: '0.1.0', checksum: 'a' }, runs: [] });
  assert.deepEqual(ids(items), ['valid', 'tests', 'data', 'records'], 'no knowledge line, no secrets line, no protections line; where it is processed and what is kept apply to every bot');
  assert.equal(by(items, 'valid').state, 'ok');
  assert.equal(by(items, 'tests').state, 'warn', 'none written is amber, never red');
  assert.equal(by(items, 'tests').text, 'None written');
  assert.doesNotMatch(JSON.stringify(by(items, 'tests')), /fail/i);
});

test('errors, protections that aren’t enforced, and parts the runtime can’t run each get their own line', () => {
  const items = buildChecklist({ config: withTests, report: { ...ok, valid: false, errors: [{ message: 'a' }, { message: 'b' }, { message: 'c' }, { message: 'd' }],
    unsupported: [{ feature: 'MCP server tools', where: 'tools[3]' }, { feature: 'Redaction', where: 'post_call', severity: 'security' }] }, version: { version: '1', checksum: 'x' }, runs: [] });
  assert.deepEqual(items.slice(0, 3).map((i) => [i.id, i.state]), [['valid', 'bad'], ['security', 'bad'], ['unsupported', 'warn']]);
  assert.equal(by(items, 'valid').detail.length, 3, 'the first few errors are named');
  assert.match(by(items, 'security').note, /looks protected and is not/);
  assert.match(by(items, 'unsupported').detail[0], /MCP server tools \(tools\[3\]\)/);
});

test('tests count for a version only when a run tested that exact version', () => {
  const version = { version: '0.2.0', checksum: 'bbb' };
  const run = (status, checksum, extra = {}) => ({ id: status + checksum, status, checksum, total: 3, passed: 3, failed: 0, errors: 0, ...extra });
  const passed = by(buildChecklist({ config: withTests, report: ok, version, runs: [run('passed', 'bbb')] }), 'tests');
  assert.deepEqual([passed.state, passed.text], ['ok', 'Passed on this exact version (3 scenarios)']);
  const failed = by(buildChecklist({ config: withTests, report: ok, version, runs: [run('failed', 'bbb', { failed: 2, passed: 1 })] }), 'tests');
  assert.deepEqual([failed.state, failed.text], ['bad', 'Failed on this exact version']);
  assert.match(failed.detail[0], /2 failed, 0 broke, of 3/);
  assert.equal(failed.action.tab, 'scenarios');
  const other = by(buildChecklist({ config: withTests, report: ok, version, runs: [run('passed', 'aaa')] }), 'tests');
  assert.deepEqual([other.state, other.text], ['warn', 'Not run on this exact version']);
  assert.match(other.detail[0], /different configuration/);
  const never = by(buildChecklist({ config: withTests, report: ok, version, runs: [] }), 'tests');
  assert.match(never.detail[0], /No scenario has been run yet/);
  const running = by(buildChecklist({ config: withTests, report: ok, version, runs: [run('running', 'bbb')] }), 'tests');
  assert.equal(running.state, 'warn', 'a run that is still going proves nothing');
});

test('for a draft, the latest finished run is shown, whatever it tested', () => {
  const draft = (runs) => by(buildChecklist({ config: withTests, report: ok, runs, target: 'draft' }), 'tests');
  assert.equal(draft([{ status: 'passed', passed: 2, total: 2 }]).state, 'ok');
  assert.equal(draft([{ status: 'failed', passed: 1, total: 2 }]).state, 'bad');
  assert.equal(draft([{ status: 'running' }]).state, 'warn');
  assert.equal(draft([]).text, 'Not run yet');
  assert.equal(draft([{ status: 'skipped' }]).state, 'warn');
  assert.equal(by(buildChecklist({ config: withTests, report: ok, runs: [], target: 'draft' }), 'valid').text, 'The draft passes the checks.');
});

test('knowledge shows only when the agent has some, and says what needs building', () => {
  const kn = (bases) => normalizeKnowledge({ bases, files: [] });
  const line = (bases) => by(buildChecklist({ config: { knowledge: bases.map((b) => ({ id: b.id })) }, report: ok, knowledge: kn(bases), version: { version: '1' } }), 'knowledge');
  assert.equal(by(buildChecklist({ config: {}, report: ok }), 'knowledge'), undefined);
  assert.deepEqual([line([{ id: 'a', type: 'vector_store', index: { passages: 5 } }]).state, line([{ id: 'a', type: 'vector_store', index: { passages: 5 } }]).text], ['ok', '1 base ready']);
  const notBuilt = line([{ id: 'a', type: 'vector_store', problems: [{ problem: 'No index has been built for this base.' }] }, { id: 'b', type: 'vector_store', index: { passages: 1 } }]);
  assert.equal(notBuilt.state, 'bad');
  assert.match(notBuilt.text, /1 base without a current index/);
  assert.match(notBuilt.detail[0], /a: No index has been built/);
  assert.equal(notBuilt.action.tab, 'knowledge');
  const stale = line([{ id: 'a', type: 'vector_store', index: { passages: 1 }, problems: [{ problem: 'The file x.md changed after the index was built.' }] }]);
  assert.equal(stale.state, 'warn');
  const building = line([{ id: 'a', type: 'vector_store', build: { status: 'running' } }]);
  assert.deepEqual([building.state, building.text], ['warn', 'An index is still building']);
  assert.equal(line([{ id: 'live', type: 'rag_api' }]).state, 'ok', 'an external search service has nothing to build');
});

test('secrets: only names, a provider’s usual key that the server says is missing is amber, the rest is information', () => {
  const providers = [{ name: 'openai', default_secret: 'OPENAI_API_KEY', key_available: false }, { name: 'elevenlabs', default_secret: 'ELEVEN_API_KEY', key_available: true }];
  const missing = by(buildChecklist({ config: {}, report: { ...ok, secrets_required: ['OPENAI_API_KEY', 'ELEVEN_API_KEY', 'MY_CRM_TOKEN'] }, providers }), 'secrets');
  assert.deepEqual([missing.state, missing.text, missing.detail], ['warn', '1 secret not set on the server', ['OPENAI_API_KEY']]);
  assert.match(missing.note, /can’t be set from here yet/);
  const unknown = by(buildChecklist({ config: {}, report: { ...ok, secrets_required: ['ELEVEN_API_KEY', 'MY_CRM_TOKEN'] }, providers }), 'secrets');
  assert.deepEqual([unknown.state, unknown.text], ['info', '2 secrets needed']);
  assert.match(unknown.note, /Names only/);
});

test('the verdict never says it is fine while anything is amber or red, and the list says it is only advice', () => {
  assert.deepEqual(verdict([{ state: 'ok' }, { state: 'info' }]), { state: 'ok', text: 'Everything checked looks fine' });
  assert.deepEqual(verdict([{ state: 'ok' }, { state: 'warn' }]), { state: 'warn', text: 'Nothing blocks it, but 1 thing to look at' });
  assert.deepEqual(verdict([{ state: 'bad' }, { state: 'warn' }, { state: 'warn' }]), { state: 'bad', text: '1 thing to fix before going live, and 2 to look at' });
  assert.match(POLICY_NOTE, /advice/);
  assert.match(POLICY_NOTE, /doesn’t enforce a release policy/);
});

test('preflight.knowledge is read whatever shape the list has', () => {
  assert.deepEqual(normalizePreflightKnowledge([{ base: 'faq', problems: [{ problem: 'No index has been built.', fix: 'Build it.' }] }]), [{ base: 'faq', problem: 'No index has been built.', fix: 'Build it.' }]);
  assert.deepEqual(normalizePreflightKnowledge({ faq: [{ problem: 'p' }, 'q'] }), [{ base: 'faq', problem: 'p', fix: '' }, { base: 'faq', problem: 'q', fix: '' }]);
  assert.deepEqual(normalizePreflightKnowledge([{ problem: 'flat', fix: 'f' }]), [{ base: '', problem: 'flat', fix: 'f' }]);
  assert.deepEqual(normalizePreflightKnowledge(undefined), []);
  assert.deepEqual(normalizePreflightKnowledge([]), []);
});

test('the release page says where conversations are processed and what is kept, and warns about a missing recording notice', () => {
  const config = { defaults: { models: { llm: { provider: 'openai', model: 'gpt-4.1-mini' }, stt: { provider: 'deepgram' }, tts: { provider: 'elevenlabs' } } }, channels: [{ id: 'phone', type: 'sip_voice' }] };
  const items = buildChecklist({ config, report: ok, version: { version: '0.1.0', checksum: 'a' }, runs: [] });
  assert.match(by(items, 'data').text, /Conversations are processed by .*OpenAI/);
  assert.match(by(items, 'data').text, /Deepgram/);
  assert.equal(by(items, 'data').state, 'info');
  assert.match(by(items, 'records').detail.join(' '), /A log of each call is kept/);
  assert.equal(by(items, 'notice').state, 'warn', 'a voice channel with a log and no notice');
  const told = buildChecklist({ config: { ...config, persona: { name: 'X', disclosures: { recording_notice: 'This call may be recorded.' } } }, report: ok, version: { version: '0.1.0', checksum: 'a' }, runs: [] });
  assert.equal(by(told, 'notice'), undefined);
  const chat = buildChecklist({ config: { ...config, channels: [{ id: 'c', type: 'web_chat' }] }, report: ok, version: { version: '0.1.0', checksum: 'a' }, runs: [] });
  assert.equal(by(chat, 'notice'), undefined, 'chat is not a recorded call');
});
