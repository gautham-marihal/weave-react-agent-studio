import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { $, $$, actions, byLabel, byText, setupDom, teardownDom, textOf } from './component/dom.js';
import { applyStarter } from '../src/studio/starters.js';
import { createDemoApi, minimalConfig } from '../src/demo/demoApi.js';

// Component tests of the screens that show what happened and what the agent knows: the trace, the call list and the knowledge screen.
// They run in demo mode, so the answers come from the imitation API in the shapes the real one uses. Nothing here reaches a network.
const { mountScreen, act } = await setupDom();
const a = actions(act);
after(() => teardownDom());

const demoStore = { load: () => JSON.parse(window.localStorage.getItem('weave_demo_state') || 'null'), save: (state) => window.localStorage.setItem('weave_demo_state', JSON.stringify(state)) };
async function seedDemo(config) {
  window.localStorage.clear();
  window.localStorage.setItem('weave_demo', '1');
  const api = createDemoApi({ seed: false, storage: demoStore });
  await api.handle('POST', '/bots', { id: 'x', name: 'X' });
  await api.handle('PUT', '/bots/x/draft', { config: { ...config, meta: { ...config.meta, id: 'x' } } });
  return api;
}
const until = async (app, check, tries = 80) => { for (let i = 0; i < tries && !check(); i += 1) await app.wait(60); return check(); };
const agent = () => applyStarter(minimalConfig('acme', 'Acme'), 'support');

// ---------------------------------------------------------------- the trace
const records = [
  { seq: 1, elapsed_s: 0.1, event: 'call_started', channel: { id: 'web-chat', type: 'web_chat' } },
  { seq: 2, elapsed_s: 0.2, event: 'agent_said', text: 'Hi, Iâ€™m Sam.' },
  { seq: 3, elapsed_s: 4, event: 'user_said', text: 'Where is my order?' },
  { seq: 4, elapsed_s: 5, event: 'tool_called', tool: 'find_order', args: { order_id: 'NB-1' }, error: 'HTTP 503' },
  { seq: 5, elapsed_s: 5.1, event: 'http_request', method: 'GET', path: '/orders/NB-1', status: 503 },
  { seq: 6, elapsed_s: 6, event: 'sentiment_scored', score: 0.2 },
];

test('Trace: every record has a row, what went wrong is marked, the text is repaired, and the chips narrow the list', async () => {
  window.localStorage.clear();
  const app = await mountScreen('trace', {}, { ready: '.trView', props: { records } });
  const rows = () => $$(app.container, '.trRow');
  assert.equal(rows().length, 6);
  assert.match(textOf($(app.container, '.trSummary')), /2 messages · 1 tool call · 1 API request · 2 problems/);
  assert.equal(rows()[1].querySelector('.trText').textContent, 'Hi, I’m Sam.', 'the log’s wrong encoding is put right');
  assert.equal($$(app.container, '.trRow.problem').length, 2, 'the failed tool call and the 503');
  assert.match(textOf(rows()[5]), /Sentiment scored/, 'a record nobody has heard of still gets a row');
  // chips
  const chips = $$(app.container, '.trChip').map((c) => textOf(c));
  assert.deepEqual(chips, ['Conversation 2', 'Tools 1', 'API requests 1', 'Call 1']);
  await a.click(byText(app.container, '.trChip', /^Tools/));
  assert.deepEqual(rows().map((r) => r.getAttribute('data-kind')), ['tool_called', 'sentiment_scored'], 'only that kind, and the unknown kind stays');
  await a.click(byText(app.container, '.trChip', /^Conversation/));
  assert.equal(rows().filter((r) => ['user_said', 'agent_said', 'tool_called'].includes(r.getAttribute('data-kind'))).length, 3);
  await a.click(byText(app.container, 'button', 'Show all'));
  assert.equal(rows().length, 6);
  // the raw record is one click away
  assert.match($(rows()[3], '.trRaw pre').textContent, /"order_id": "NB-1"/);
  await app.unmount();
});

test('Trace: an empty trace says so, and a live one says it is following', async () => {
  window.localStorage.clear();
  const empty = await mountScreen('trace', {}, { ready: '.trView', props: { records: [] } });
  assert.match(textOf($(empty.container, '.trEmpty')), /Nothing has been recorded yet/);
  assert.equal(byText(empty.container, 'button', 'Copy as text').disabled, true);
  await empty.unmount();
  const live = await mountScreen('trace', {}, { ready: '.trView', props: { records, live: true } });
  assert.match(textOf($(live.container, '.trLive')), /Following live/);
  await live.unmount();
});

// ---------------------------------------------------------------- calls
test('Calls: the calls of an agent, newest first, filters that narrow them, and a call opens as a trace', async () => {
  await seedDemo(agent());
  const app = await mountScreen('calls', {}, { ready: '.clView', props: { fixedBotId: 'x' } });
  assert.equal(await until(app, () => $$(app.container, '.clRow').length === 3), true);
  assert.match(textOf($(app.container, '.clPrivacy')), /These records contain what callers said/);
  assert.match(textOf($(app.container, '.demoNote')), /made-up examples/);
  const times = $$(app.container, '.clRow').map((r) => r.querySelector('td').textContent);
  assert.equal(times.length, 3);
  // a status filter with nothing in it says so
  await a.choose($$(app.container, '.clFilters select')[1], 'unfinished');
  assert.equal(await until(app, () => $$(app.container, '.clRow').length === 0 && !!$(app.container, '.clEmpty strong')), true);
  assert.match(textOf($(app.container, '.clEmpty')), /No calls found/);
  await a.choose($$(app.container, '.clFilters select')[1], 'ended');
  assert.equal(await until(app, () => $$(app.container, '.clRow').length === 3), true);
  // open one
  await a.click($$(app.container, '.clRow')[0]);
  assert.equal(await until(app, () => !!$(app.container, '.clDetail .trView')), true);
  const detail = $(app.container, '.clDetail');
  assert.match(textOf($(detail, '.clFacts')), /Status.*Ended/);
  assert.match(textOf($(detail, '.clFacts')), /Channel.*Web chat/);
  assert.ok($$(detail, '.trRow').length > 5, 'the records of the call');
  assert.ok($(detail, '.trRow[data-kind="user_said"]'));
  assert.equal(textOf(byText(detail, 'button', 'Download the log')), 'Download the log');
  // what the records were, and the call read as a conversation only (GET .../transcript)
  assert.match(textOf($(detail, '.clCounts')), /^\d+ records?: \d+ from the caller, \d+ from the agent/);
  assert.equal(byText(detail, '.clViews button', 'What happened').getAttribute('aria-pressed'), 'true');
  await a.click(byText(detail, '.clViews button', 'Conversation only'));
  assert.equal(await until(app, () => $$(detail, '.clTurn').length > 0), true, 'the turns arrive');
  assert.equal($(detail, '.trView'), null, 'the trace gives way to the conversation');
  assert.ok($$(detail, '.clTurn.caller').length >= 1 && $$(detail, '.clTurn.agent').length >= 1, 'caller and agent turns are told apart');
  assert.match(textOf($(detail, '.clTurn.caller strong')), /^Caller$/);
  assert.match(textOf($(detail, '.clTurn.agent strong')), /^Agent$/);
  await a.click(byText(detail, '.clViews button', 'What happened'));
  assert.ok($(detail, '.trView'), 'and back');
  await a.click(byText(detail, 'button', 'Close'));
  assert.equal($(app.container, '.clDetail'), null);
  await app.unmount();
});

test('Calls: more than a page is loaded a page at a time, and “All agents” asks each agent', async () => {
  const api = await seedDemo(agent());
  await api.handle('POST', '/bots', { id: 'y', name: 'Y' });
  for (let i = 0; i < 30; i += 1) api.recordConversation('x', { startedAt: new Date(Date.now() - i * 1000).toISOString(), channel: { id: 'web-chat', type: 'web_chat' }, messages: [{ role: 'assistant', text: 'Hi' }, { role: 'user', text: `n${i}` }] });
  const app = await mountScreen('calls', {}, { ready: '.clView', props: { bots: [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }] } });
  assert.equal(await until(app, () => $$(app.container, '.clRow').length >= 25), true);
  assert.ok($$(app.container, 'th').some((th) => textOf(th) === 'Agent'), 'a column for the agent when several are shown');
  assert.ok($(app.container, '.clMore button'), 'there is more');
  const first = $$(app.container, '.clRow').length;
  await a.click($(app.container, '.clMore button'));
  assert.equal(await until(app, () => $$(app.container, '.clRow').length > first), true);
  assert.ok($$(app.container, '.clRow').length >= 33, 'both agents’ calls are merged: 33 of x and 3 of y');
  await app.unmount();
});

// ---------------------------------------------------------------- knowledge
const FAQ = 'Refunds are paid back within five working days to the original card. To get a refund, ask the support team and give your order number.\n\nOur opening hours are nine to five on weekdays.\n\nDelivery usually takes three days.';
const withKnowledge = () => ({ ...agent(), knowledge: [{ id: 'faq', type: 'vector_store', mode: 'tool', retrieval: { min_score: 0.5 }, sources: [{ type: 'file', file_id: 'faq.md' }] }] });
const kw = async (config = withKnowledge()) => { await seedDemo(config); return mountScreen('knowledge', config, { ready: '.kwTab', props: { pollMs: 40 } }); };
const pickFile = async (app, name, text) => {
  const input = $(app.container, 'input[type=file]');
  const file = new window.File([text], name);
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new window.Event('change', { bubbles: true })); });
};

test('Knowledge: a base that isn’t built says what to do, a file is uploaded, the index is built with progress, and it is ready', async () => {
  const app = await kw();
  assert.equal(await until(app, () => !!$(app.container, '.kwBase')), true);
  const base = () => $(app.container, '[data-base=faq]');
  assert.match(textOf($(base(), '.kwState')), /Not built/);
  assert.match(textOf($(base(), '.kwProblems')), /The file faq\.md is not uploaded/);
  assert.match(textOf($(base(), '.kwUsed')), /No agent or tool uses this base/);
  assert.match(textOf($(app.container, '.demoNote')), /no embedding model/);
  assert.equal(byText(base(), 'button', 'Test a search').disabled, true, 'nothing to search until it is built');
  await pickFile(app, 'faq.md', FAQ);
  assert.equal(await until(app, () => !!$(app.container, '.kwTable') && /uploaded/.test(textOf($(base(), '.kwSources')))), true);
  assert.match(textOf($(app.container, '.kwTable')), /faq\.md.*faq/, 'the file is read by the base');
  await a.click(byText(base(), 'button', 'Build the index'));
  assert.equal(await until(app, () => /Ready/.test(textOf($(base(), '.kwState')))), true);
  assert.match(textOf($(base(), '.kwIndex')), /Index built .*\d+ passages? with demo word-index/);
  assert.match(textOf($(base(), '.kwLog summary')), /Progress of the build \(\d+ lines\)/, 'the whole progress log is there, not only its last line');
  assert.match(textOf($(app.container, '.kwSummary')), /1 base: 1 ready/);
  await app.unmount();
});

test('Knowledge: a search shows scores in words, what min_score would drop, and what the model is shown', async () => {
  const config = withKnowledge();
  const app = await kw(config);
  await until(app, () => !!$(app.container, '.kwBase'));
  await pickFile(app, 'faq.md', FAQ);
  await until(app, () => /uploaded/.test(textOf($(app.container, '[data-base=faq] .kwSources'))));
  await a.click(byText($(app.container, '[data-base=faq]'), 'button', 'Build the index'));
  await until(app, () => /Ready/.test(textOf($(app.container, '[data-base=faq] .kwState'))));
  await a.click(byText($(app.container, '[data-base=faq]'), 'button', 'Test a search'));
  await a.type(byLabel(app.container, 'Search text'), 'how do I get a refund');
  await a.click(byText($(app.container, '.kwSearch'), 'button', 'Search'));
  assert.equal(await until(app, () => !!$(app.container, '.kwResults')), true);
  const results = $(app.container, '.kwResults');
  assert.match(textOf(results), /this base drops anything scoring under 0\.5/);
  assert.match(textOf($(results, '.kwHits li')), /related/);
  assert.match(textOf($(results, '.kwHits li')), /Refunds are paid back/);
  assert.match(textOf($(results, '.kwShown summary')), /What the model is shown/);
  assert.match(textOf(results), /choose .*min_score/);
  // nothing matches: it says so
  await a.type(byLabel(app.container, 'Search text'), 'zzzz qqqq');
  await a.click(byText($(app.container, '.kwSearch'), 'button', 'Search'));
  assert.equal(await until(app, () => /Nothing matched/.test(textOf($(app.container, '.kwResults')))), true);
  await app.unmount();
});

test('Knowledge: a file that is wrong is refused with a reason, and “Use in a new base” makes one', async () => {
  const config = agent();
  const app = await kw(config);
  await until(app, () => !!$(app.container, '.kwFiles'));
  assert.match(textOf($(app.container, '.kwEmpty')), /no knowledge bases yet/);
  await pickFile(app, 'photo.png', 'x');
  assert.equal(await until(app, () => !!$(app.container, '.kwProblemsList')), true);
  assert.match(textOf($(app.container, '.kwProblemsList')), /isn’t a kind of file knowledge can read/);
  await pickFile(app, 'Return policy.md', 'Returns are accepted within thirty days if the item is unused.');
  assert.equal(await until(app, () => !!$(app.container, '.kwTable')), true);
  // a new base from the file goes into the draft
  await a.choose(byLabel(app.container, 'Use Return policy.md in a base'), '__new');
  assert.deepEqual(app.config.knowledge.map((b) => [b.id, b.type, b.sources]), [['return-policy', 'vector_store', [{ type: 'file', file_id: 'Return policy.md' }]]]);
  assert.match(textOf($(app.container, '.kwDone')), /Made the base “return-policy”/);
  assert.match(textOf($(app.container, '.stNotice')), /Knowledge works from the saved draft/);
  await app.unmount();
});

// ---------------------------------------------------------------- the checks panel
test('Checks: a valid agent with parts that will not run is not called ready, and the folded line still says what is hidden', async () => {
  window.localStorage.clear();
  const report = { valid: true, errors: [], warnings: [{ path: ['a'], message: 'w' }], secrets_required: ['OPENAI_API_KEY', 'CRM_TOKEN'], unsupported: [{ feature: 'MCP server tools', where: 'tools[3]' }, { feature: 'Custom code tools', where: 'tools[4]' }] };
  const open = await mountScreen('validation', agent(), { ready: '.stValidation', report, props: { folded: false } });
  assert.match(textOf($(open.container, '.stValidationHead strong')), /^Valid, with 2 parts that will not run$/);
  assert.doesNotMatch(textOf($(open.container, '.stValidationHead')), /Ready to publish/);
  assert.match($(open.container, '.stValidationHead').className, /warn/);
  await open.unmount();
  const folded = await mountScreen('validation', agent(), { ready: '.stValidation', report, props: { folded: true } });
  assert.equal(folded.container.querySelector('.stValidation').classList.contains('folded'), true);
  assert.match(textOf($(folded.container, '.stValidationSummary')), /^1 warning · 2 secrets needed$/);
  assert.match(textOf($(folded.container, '.stValidationHead strong')), /2 parts that will not run/, 'the verdict itself carries it');
  await folded.unmount();
  const clean = await mountScreen('validation', agent(), { ready: '.stValidation', report: { valid: true, errors: [], warnings: [], secrets_required: [], unsupported: [] }, props: { folded: true } });
  assert.match(textOf($(clean.container, '.stValidationHead strong')), /^Valid\. Ready to publish$/);
  assert.equal($(clean.container, '.stValidationSummary'), null, 'nothing to add');
  await clean.unmount();
  const security = await mountScreen('validation', agent(), { ready: '.stValidation', report: { valid: true, errors: [], warnings: [], secrets_required: [], unsupported: [{ feature: 'Redaction', where: 'post_call', severity: 'security' }] }, props: { folded: true } });
  assert.match(textOf($(security.container, '.stSecurity')), /declared but not enforced/, 'a security item is never folded away');
  assert.match(textOf($(security.container, '.stValidationSummary')), /1 not enforced/);
  await security.unmount();
});
