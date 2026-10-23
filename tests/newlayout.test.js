import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EXTRA_PAGE_IDS, PAGES, PAGE_GROUPS, PAGE_IDS, PAGE_SECTIONS, resolvePage, sectionsCovered } from '../src/studio/newlayout/pages.js';
import { TAB_IDS } from '../src/studio/journey.js';
import { SKIPPED_SECTIONS } from '../src/studio/form/layout.js';
import { readinessSteps, stepRoute } from '../src/studio/newlayout/readiness.js';
import { parseRoute, routeHref } from '../src/studio/route.js';
import { PATHS } from '../src/ui/iconPaths.js';

const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));

test('the menu is one level, in the order of the work (overview, build, test and launch, monitor, settings), each page once, with a picture that exists', () => {
  assert.deepEqual(
    PAGE_GROUPS.map((g) => g.label),
    ['Overview', 'Build', 'Test and launch', 'Monitor', 'Settings'],
  );
  assert.deepEqual(
    PAGE_GROUPS.filter((g) => g.bare).map((g) => g.id),
    ['overview', 'manage'],
    'the overview and the settings stand without a heading',
  );
  assert.equal(new Set(PAGE_IDS).size, PAGE_IDS.length);
  PAGES.forEach((p) => assert.ok(PATHS[p.icon], `${p.id} has an icon (${p.icon})`));
});

test('every page can be reached by address, and every old tab is shown by some page', () => {
  PAGE_IDS.forEach((id) => assert.ok(parseRoute(`#/bots/x/${id}`).tab === id || TAB_IDS.includes(id), `${id} is a route`));
  TAB_IDS.forEach((tab) => {
    const r = resolvePage(tab);
    assert.ok(PAGE_IDS.includes(r.page), `${tab} lands on a page (${r.page})`);
  });
  // an address only the new layout has is a page, or a part of one (Tests has a part called callers); the guided setup is a screen of its own, with an
  // address and outside the menu (its steps take the menu's place while it is open)
  EXTRA_PAGE_IDS.filter((id) => id !== 'setup').forEach((id) =>
    assert.ok(PAGE_IDS.includes(id) || PAGE_IDS.includes(resolvePage(id).page), `${id} is a page or a part of one`),
  );
  assert.ok(!PAGE_IDS.includes('setup'));
  assert.equal(parseRoute('#/bots/x/setup?step=voice').tab, 'setup');
  assert.deepEqual(resolvePage('setup'), { page: 'setup' });
});

test('an old address lands on the page that holds that tab, with the right part open', () => {
  assert.deepEqual(resolvePage('scenarios'), { page: 'tests', part: 'scenarios' });
  assert.deepEqual(resolvePage('checks'), { page: 'tests', part: 'checks' });
  assert.deepEqual(resolvePage('test'), { page: 'tests', part: 'try' });
  assert.deepEqual(resolvePage('deploy'), { page: 'releases', part: 'deploy' });
  assert.deepEqual(resolvePage('versions'), { page: 'releases', part: 'versions' });
  assert.deepEqual(resolvePage('config'), { page: 'agent' });
  assert.deepEqual(resolvePage('describe'), { page: 'agent', drawer: 'describe' });
  assert.deepEqual(resolvePage('calls'), { page: 'calls' });
  assert.deepEqual(resolvePage('config', { bare: true }), { page: 'home' }, 'an agent opened from a list opens its Home');
  assert.deepEqual(resolvePage('tools'), { page: 'tools' });
});

test('every top-level section of the configuration is edited somewhere', () => {
  const covered = sectionsCovered();
  const missing = Object.keys(schema.properties).filter((k) => !SKIPPED_SECTIONS.has(k) && !covered.has(k));
  assert.deepEqual(missing, [], `sections no page edits: ${missing.join(', ')}`);
  Object.values(PAGE_SECTIONS)
    .flat()
    .forEach((k) => assert.ok(k in schema.properties, `${k} is a section of the schema`));
});

test('a new-layout address names the page, and a bare one is the Home', () => {
  assert.equal(parseRoute('#/bots/x').bare, true);
  assert.equal(parseRoute('#/bots/x/tools').tab, 'tools');
  assert.equal(parseRoute('#/bots/x/tools').bare, false);
  assert.equal(routeHref('x', 'tools'), '#/bots/x/tools');
  assert.equal(routeHref('x'), '#/bots/x');
});

const config = (over = {}) => ({
  meta: { name: 'A' },
  channels: [{ id: 'web', type: 'web_chat', greeting: { say: 'Hello there' } }],
  agents: { entry: 'a', items: [{ id: 'a', instructions: { role: 'You help customers with their orders and refunds.' }, tools: [] }] },
  defaults: { language: { primary: 'en-US' }, models: { llm: { provider: 'openai', model: 'gpt-4.1-mini' }, tts: { provider: 'cartesia', voice_id: 'v1' } } },
  tools: [{ id: 'end_call', builtin: 'end_call' }],
  ...over,
});
const by = (r, id) => r.steps.find((s) => s.id === id);

test('a new agent has steps to do, the next one first', () => {
  const r = readinessSteps({ config: { meta: { name: 'A' } }, summary: {}, report: { errors: [] } });
  assert.equal(r.next.id, 'prompt');
  assert.equal(by(r, 'prompt').state, 'todo');
  assert.equal(by(r, 'model').state, 'todo');
  assert.equal(by(r, 'publish').state, 'todo');
  assert.equal(by(r, 'deploy').state, 'todo', 'putting it live is to do, after publishing');
  assert.match(by(r, 'deploy').text, /Publish first/);
});

test('the number of steps stays the same when a version is published', () => {
  const before = readinessSteps({ config: config(), summary: {}, report: { errors: [] } });
  const after = readinessSteps({ config: config(), summary: { latest_version: '0.1.0', deployed: {} }, report: { errors: [] } });
  assert.equal(before.total, after.total);
  assert.equal(after.done, before.done + 1);
  assert.equal(after.next.id, 'deploy');
});

test('a filled-in agent has the building steps done and publishing to do', () => {
  const r = readinessSteps({ config: config(), summary: {}, report: { errors: [] } });
  ['prompt', 'hello', 'voice', 'model', 'checks'].forEach((id) => assert.equal(by(r, id).state, 'done', id));
  assert.equal(by(r, 'abilities').state, 'optional');
  assert.equal(by(r, 'tests').state, 'optional');
  assert.equal(r.next.id, 'publish');
});

test('the tests step follows their latest run, as Releases does', () => {
  const base = { config: config({ tests: [{ id: 't1' }, { id: 't2' }] }), summary: {}, report: { errors: [] }, scenarioCount: 2 };
  assert.equal(by(readinessSteps(base), 'tests').state, 'done', 'a run that is not known: written tests count');
  const never = readinessSteps({ ...base, latestRun: null });
  assert.deepEqual([by(never, 'tests').state, by(never, 'tests').label], ['todo', 'Run the tests']);
  const passed = readinessSteps({ ...base, latestRun: { status: 'passed', passed: 2, total: 2 } });
  assert.equal(by(passed, 'tests').state, 'done');
  assert.match(by(passed, 'tests').text, /2 of 2/);
  const failed = readinessSteps({ ...base, latestRun: { status: 'failed', passed: 1, total: 2 } });
  assert.deepEqual([by(failed, 'tests').state, by(failed, 'tests').label], ['blocked', 'Fix the failing tests']);
  assert.equal(failed.next.id, 'tests', 'a failing run comes before publishing');
  const gated = readinessSteps({ ...base, latestRun: null, gate: { enabled: true, savedAt: '2026-10-20T10:00:00Z', dirty: false } });
  assert.deepEqual([by(gated, 'tests').state, by(gated, 'tests').label], ['blocked', 'Pass the tests']);
});

test('a step opens where it is done: the page, its part, and the panel on the Agent page', () => {
  const r = readinessSteps({ config: { meta: { name: 'A' } }, summary: {}, report: { errors: [{}] } });
  assert.deepEqual(stepRoute(by(r, 'voice')), { tab: 'agent', params: { open: 'language' } });
  assert.deepEqual(stepRoute(by(r, 'prompt')), { tab: 'agent', params: { focus: 'role' } });
  assert.deepEqual(stepRoute(by(r, 'checks')), { tab: 'agent', params: { show: 'problems' } });
  assert.deepEqual(stepRoute(by(r, 'publish')), { tab: 'versions', params: undefined });
  assert.deepEqual(stepRoute(by(r, 'deploy')), { tab: 'deploy', params: undefined });
  assert.deepEqual(stepRoute(by(r, 'abilities')), { tab: 'tools', params: undefined });
  assert.deepEqual(stepRoute({ id: 'tests', page: 'tests', part: 'callers' }), { tab: 'callers', params: undefined });
});

test('problems block, and come before everything else to do', () => {
  const r = readinessSteps({ config: config(), summary: {}, report: { errors: [{}, {}] } });
  assert.equal(by(r, 'checks').state, 'blocked');
  assert.match(by(r, 'checks').text, /2 problems/);
  assert.equal(r.next.id, 'checks');
});

test('a published, deployed agent with a test is all done', () => {
  const r = readinessSteps({
    config: config({ tools: [{ id: 'lookup', type: 'http' }] }),
    summary: { latest_version: '0.1.0', deployed: { staging: '0.1.0' } },
    report: { errors: [] },
    scenarioCount: 1,
  });
  assert.equal(r.next, null);
  assert.equal(r.done, r.total);
  assert.match(by(r, 'deploy').text, /staging/);
});

test('a text agent needs no voice, and no report means no checks step', () => {
  const noVoice = config({ defaults: { language: { primary: 'en-US' }, models: { llm: { provider: 'openai', model: 'm' } } } });
  assert.equal(by(readinessSteps({ config: noVoice, report: null }), 'voice').state, 'done');
  // the language by name, as the Agent page says it, not its code
  assert.equal(by(readinessSteps({ config: noVoice, report: null }), 'voice').text, 'English (United States).');
  assert.equal(by(readinessSteps({ config: noVoice, report: null }), 'checks'), undefined);
});

test('a page and a part make an address, and the address of a part is the one it always had', async () => {
  const { tabFor } = await import('../src/studio/newlayout/pages.js');
  assert.equal(tabFor('tests', 'scenarios'), 'scenarios');
  assert.equal(tabFor('tests', 'try'), 'test');
  assert.equal(tabFor('releases', 'deploy'), 'deploy');
  assert.equal(tabFor('tools'), 'tools');
  assert.equal(tabFor('releases'), 'releases');
});

test('a place in the configuration is found on a page, and a row of the Agent page opens its panel', async () => {
  const { locate } = await import('../src/studio/newlayout/pages.js');
  assert.deepEqual(locate(['defaults', 'models', 'tts', 'voice_id']), { page: 'agent', drawer: 'voice' });
  assert.deepEqual(locate(['defaults', 'models', 'llm']), { page: 'agent', drawer: 'models' });
  assert.deepEqual(locate(['defaults', 'models']), { page: 'agent', drawer: 'models' }, '"Open Models" opens the AI models panel');
  assert.deepEqual(locate(['defaults', 'language', 'primary']), { page: 'agent', drawer: 'language' });
  assert.deepEqual(locate(['defaults', 'conversation']), { page: 'settings' });
  assert.deepEqual(locate(['defaults', 'models', 'llm', 'model']), { page: 'agent', drawer: 'models' });
  assert.deepEqual(locate(['defaults', 'models', 'llm', 'api_key']), { page: 'settings' }, 'the key of a model is not asked on the Agent page');
  assert.deepEqual(locate(['defaults', 'language', 'auto_detect']), { page: 'agent', drawer: 'language' }, 'asked in the Language panel');
  assert.deepEqual(locate(['tests', 0]), { page: 'tests', part: 'scenarios' });
  assert.deepEqual(locate(['persona', 'tone']), { page: 'agent', drawer: 'behaviour' }, 'its home, Tone and style (hidden in Personality and rules)');
  assert.deepEqual(locate(['meta', 'name']), { page: 'agent' });
  assert.deepEqual(locate(['meta', 'tags']), { page: 'settings' });
  assert.deepEqual(locate(['tools', 0, 'id']), { page: 'tools' });
  assert.deepEqual(locate(['channels', 1]), { page: 'channels' });
  assert.deepEqual(locate(['guardrails']), { page: 'guardrails' });
  assert.deepEqual(locate(['agents', 'items', 0]), { page: 'workflow' });
  assert.deepEqual(locate(['post_call', 'summary']), { page: 'aftercall' });
  assert.deepEqual(locate(['nonsense']), { page: 'settings' });
  assert.deepEqual(locate(), { page: 'settings' });
});

test('the schema of one item of a list is found by its path, and a list can be changed at a path', async () => {
  const { createEngine } = await import('../src/studio/form/engine.js');
  const { getAtPath, removeAtPath, schemaAtPath, setAtPath } = await import('../src/studio/newlayout/schemaPath.js');
  const engine = createEngine(schema);
  const tool = schemaAtPath(engine, schema, ['tools', 0]);
  assert.ok(tool, 'a tool has a schema');
  assert.ok(engine.branchesOf(tool).length > 1 || engine.flatten(tool).properties, 'it is the tool schema, with its kinds');
  assert.ok(schemaAtPath(engine, schema, ['guardrails', 'input', 0]), 'one check on what the caller says has a schema');
  assert.equal(schemaAtPath(engine, schema, ['nonsense', 0]), null);
  assert.equal(schemaAtPath(engine, schema, []), null);
  const config = { tools: [{ id: 'a' }, { id: 'b' }], guardrails: { input: [{ id: 'x' }] } };
  assert.deepEqual(getAtPath(config, ['tools', 1, 'id']), 'b');
  const next = setAtPath(config, ['tools', 1], { id: 'b2' });
  assert.deepEqual(next.tools, [{ id: 'a' }, { id: 'b2' }]);
  assert.equal(config.tools[1].id, 'b', 'the original is not changed');
  assert.deepEqual(removeAtPath(config, ['tools', 0]).tools, [{ id: 'b' }]);
  assert.deepEqual(removeAtPath(config, ['guardrails', 'input', 0]).guardrails.input, []);
  assert.equal(removeAtPath(config, ['nothing', 0]), config);
});

test('a step about the Agent page says what to open there: a panel, or the field to put the cursor in', () => {
  const empty = readinessSteps({ config: { meta: { id: 'a', name: 'A' }, agents: [{ id: 'main' }], channels: [] } });
  const byId = Object.fromEntries(empty.steps.map((s) => [s.id, s]));
  assert.deepEqual(byId.prompt.target, { focus: 'role' });
  assert.deepEqual(byId.hello.target, { focus: 'greeting' });
  assert.deepEqual(byId.voice.target, { open: 'language' });
  assert.deepEqual(byId.model.target, { open: 'models' });
  assert.equal(byId.abilities.target, undefined, 'a step on another page has no target');
});

// ---- the language, voice and model pickers
import {
  extraLanguageOptions,
  filterVoices,
  languageBadge,
  mainLanguageOptions,
  modelRows,
  providerChips,
  spokenChips,
  voiceInUse,
} from '../src/studio/newlayout/pickers/pickerLogic.js';
import { FALLBACK_PROVIDERS } from '../src/studio/models/catalog.js';

test('languages: a search narrows by name or code, and the ones left to add are never the main or an already spoken one', () => {
  assert.equal(languageBadge('en-US'), 'EN');
  assert.deepEqual(
    mainLanguageOptions('portu').map((o) => o.value),
    ['pt-BR', 'pt-PT'],
  );
  assert.deepEqual(
    mainLanguageOptions('ja-jp').map((o) => o.value),
    ['ja-JP'],
  );
  const left = extraLanguageOptions({ primary: 'en-US', speaks: ['en', 'fr'] }).map((o) => o.value);
  assert.ok(!left.includes('en') && !left.includes('fr') && left.includes('es'));
  assert.deepEqual(
    extraLanguageOptions({ primary: 'en-US', speaks: ['en'], query: 'ger' }).map((o) => o.label),
    ['German'],
  );
});

test('the chips of the languages spoken: the main one first and marked, none twice', () => {
  const chips = spokenChips({ primary: 'es-MX', speaks: ['en', 'es', 'fr'] });
  assert.deepEqual(
    chips.map((c) => [c.code, c.main]),
    [
      ['es', true],
      ['en', false],
      ['fr', false],
    ],
  );
  assert.deepEqual(spokenChips({ primary: '', speaks: [] }), []);
});

test('voices: search, gender, engine and language narrow the list; the one in use comes first', () => {
  const all = filterVoices();
  assert.ok(all.length >= 20);
  assert.ok(filterVoices({ gender: 'Female' }).every((v) => v.gender === 'Female'));
  assert.ok(filterVoices({ engine: 'cartesia' }).every((v) => v.engine === 'cartesia'));
  assert.deepEqual(
    filterVoices({ query: 'sarah' }).map((v) => v.name),
    ['Sarah'],
  );
  assert.deepEqual(filterVoices({ query: 'zzzz-nothing' }), []);
  const sarah = voiceInUse({ provider: 'elevenlabs', voiceId: 'EXAVITQu4vr4xnSDxMaL' });
  assert.equal(sarah.name, 'Sarah');
  assert.equal(filterVoices({ current: { provider: 'elevenlabs', voiceId: 'EXAVITQu4vr4xnSDxMaL' } })[0].name, 'Sarah');
  assert.equal(voiceInUse({ provider: 'elevenlabs', voiceId: 'not-in-the-catalogue' }), null);
});

test('models: every provider the server can run for a part of the call is offered, narrowed by a search or a provider, the one in use first', () => {
  const rows = modelRows({ stage: 'llm', providers: FALLBACK_PROVIDERS });
  assert.ok(rows.length > 5 && new Set(rows.map((r) => r.provider)).size >= 2);
  assert.ok(modelRows({ stage: 'llm', providers: FALLBACK_PROVIDERS, provider: 'anthropic' }).every((r) => r.provider === 'anthropic'));
  assert.ok(modelRows({ stage: 'llm', providers: FALLBACK_PROVIDERS, query: 'mini' }).every((r) => /mini/i.test(`${r.label} ${r.id} ${r.note}`)));
  const first = modelRows({ stage: 'llm', providers: FALLBACK_PROVIDERS, current: { provider: 'openai', model: 'gpt-4.1' } })[0];
  assert.deepEqual([first.provider, first.id, first.selected], ['openai', 'gpt-4.1', true]);
  assert.ok(providerChips({ stage: 'stt', providers: FALLBACK_PROVIDERS }).every((c) => c.count > 0));
  assert.deepEqual(modelRows({ stage: 'llm', providers: FALLBACK_PROVIDERS, query: 'qqqq-none' }), []);
});
