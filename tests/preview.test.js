import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, fromApproximate, normalizePrompt, normalizeResultPreview, promptAdvice, promptRequest, sampleArgs, whatIfValue, whatIfVariables, withLocalOffset } from '../src/studio/form/serverPreview.js';
import { assemblePrompt } from '../src/studio/form/promptPreview.js';
import { createDemoApi } from '../src/demo/demoApi.js';
import { pyRepr } from '../src/demo/demoPreview.js';

test('the server’s prompt answer is read tolerantly: sections, tools, sizes, and what is missing is left out', () => {
  const p = normalizePrompt({
    instructions: 'You are Sam. Help.',
    sections: [{ kind: 'persona', label: 'Who', text: 'You are Sam.', active: true }, { kind: 'conditional', label: 'After hours', text: 'Closed.', active: false, when: 'the office is closed' }, { kind: 'x', text: 'no label' }],
    tools: [{ name: 'lookup', description: 'd', offered: true }, { name: 'code', offered: false, reason: 'can’t run' }, { name: 'plain' }],
    on_enter: 'say hi', stats: { words: 4, approx_tokens: 6, tools_offered: 2 },
  });
  assert.deepEqual(p.sections.map((s) => [s.kind, s.active, s.when]), [['persona', true, ''], ['conditional', false, 'the office is closed'], ['x', true, '']]);
  assert.equal(p.sections[2].label, 'x', 'a missing label falls back to the kind');
  assert.deepEqual(p.tools.map((t) => t.offered), [true, false, true]);
  assert.deepEqual(p.onEnter, ['say hi']);
  assert.deepEqual(p.stats, { words: 4, tokens: 6, toolsOffered: 2 });
  const empty = normalizePrompt(null);
  assert.deepEqual([empty.instructions, empty.sections, empty.tools, empty.stats.words], ['', [], [], 0]);
  assert.equal(normalizePrompt({ instructions: 'one two three' }).stats.words, 3, 'sizes are worked out when the server sends none');
});

test('advice on size is given only past the limits, and says what to do', () => {
  const base = { stats: { words: 300, tokens: 400, toolsOffered: 5 }, tools: [] };
  assert.deepEqual(promptAdvice(base), []);
  assert.deepEqual(promptAdvice(null), []);
  const long = promptAdvice({ ...base, stats: { words: LIMITS.words + 1, tokens: 2100, toolsOffered: 5 } });
  assert.equal(long[0].id, 'long');
  assert.match(long[0].text, /knowledge base or a condition/);
  const many = promptAdvice({ ...base, stats: { words: 300, tokens: 400, toolsOffered: LIMITS.tools + 1 } });
  assert.equal(many[0].id, 'tools');
  assert.match(many[0].text, /split the rest across agents/);
  const dropped = promptAdvice({ ...base, tools: [{ name: 'code', offered: false, reason: 'custom code can’t run yet' }, { name: 'ok', offered: true }] });
  assert.match(dropped[0].text, /1 tool will not be offered to the model: code \(custom code can’t run yet\)/);
});

test('“Preview as…” sends only what was changed, and a local time gets the browser’s zone', () => {
  assert.deepEqual(promptRequest({ config: { a: 1 }, agent: 'x' }), { config: { a: 1 }, agent: 'x' });
  assert.deepEqual(promptRequest({ config: {}, agent: 'x', channel: 'phone', state: { verified: true, plan: '', gone: undefined }, now: '2026-10-14T03:00:00+08:00', callerPhone: '+65' }),
    { config: {}, agent: 'x', channel: 'phone', state: { verified: true }, now: '2026-10-14T03:00:00+08:00', caller_phone: '+65' });
  assert.equal(withLocalOffset('2026-10-14T03:00', 480), '2026-10-14T03:00:00+08:00');
  assert.equal(withLocalOffset('2026-10-14T03:00', -330), '2026-10-14T03:00:00-05:30');
  assert.equal(withLocalOffset('2026-10-14T03:00:15', 0), '2026-10-14T03:00:15+00:00');
  assert.equal(withLocalOffset('tomorrow', 0), '');
  assert.equal(withLocalOffset('', 0), '');
});

test('the what-if choices are a few simple state variables, never a sensitive one, and typed values mean what they say', () => {
  const config = { state: { variables: { verified: { type: 'boolean', default: false }, plan: { type: 'string', default: 'basic' }, pin: { type: 'string', sensitive: true }, tries: { type: 'integer', default: 0 }, a: {}, b: {}, c: {}, d: {} } } };
  const vars = whatIfVariables(config);
  assert.deepEqual(vars.map((v) => v.name), ['verified', 'plan', 'tries', 'a', 'b', 'c'], 'at most six, without the sensitive one');
  assert.equal(whatIfValue('boolean', 'true'), true);
  assert.equal(whatIfValue('boolean', 'false'), false);
  assert.equal(whatIfValue('boolean', ''), undefined);
  assert.equal(whatIfValue('integer', '3'), 3);
  assert.equal(whatIfValue('number', 'abc'), undefined);
  assert.equal(whatIfValue('string', 'pro'), 'pro');
  assert.deepEqual(whatIfVariables({}), []);
});

test('the tool preview answer is read from `result` or from the top, and a question with no sample answer has no answer part', () => {
  const nested = normalizeResultPreview({ request: { method: 'GET', url: 'https://x/orders/1', query: { a: '1' }, auth: { type: 'bearer', secrets: ['KEY'] } }, preconditions: { holds: false, message: 'Verify first' }, args_problems: ['order_id is required', { message: 'extra' }],
    result: { model_sees: { found: true }, model_sees_text: "{'found': True}", stored_in_state: { ticket: 'T1' }, kept_from_the_model: ['link'], effects: ['says a line', { text: 'sets verified' }] } });
  assert.equal(nested.request.url, 'https://x/orders/1');
  assert.deepEqual(nested.request.auth, { type: 'bearer', secrets: ['KEY'] });
  assert.deepEqual(nested.preconditions, { holds: false, message: 'Verify first' });
  assert.deepEqual(nested.argsProblems, ['order_id is required', 'extra']);
  assert.equal(nested.hasAnswer, true);
  assert.equal(nested.modelSeesText, "{'found': True}");
  assert.deepEqual(nested.storedInState, { ticket: 'T1' });
  assert.deepEqual(nested.effects, ['says a line', 'sets verified']);
  const top = normalizeResultPreview({ model_sees_text: 'x', stored_in_state: { a: 1 } });
  assert.equal(top.hasAnswer, true);
  assert.deepEqual(top.storedInState, { a: 1 });
  const onlyRequest = normalizeResultPreview({ request: { method: 'POST', url: 'u' } });
  assert.equal(onlyRequest.hasAnswer, false);
  assert.equal(onlyRequest.modelSeesText, '');
  assert.equal(normalizeResultPreview(null).request, null);
});

test('sample arguments are made from the parameters: an example, a default, the first choice, or something typed by kind', () => {
  assert.deepEqual(sampleArgs({ properties: { order_id: { type: 'string', examples: ['NB-1003'] }, qty: { type: 'integer' }, express: { type: 'boolean' }, size: { enum: ['s', 'm'] }, note: { type: 'string' }, tags: { type: 'array' }, mode: { type: 'string', default: 'fast' } } }),
    { order_id: 'NB-1003', qty: 1, express: true, size: 's', note: 'a note', tags: [], mode: 'fast' });
  assert.deepEqual(sampleArgs(undefined), {});
});

test('when the server can’t be asked, the studio’s own approximate prompt is shown in the server’s shape', () => {
  const config = { persona: { name: 'Sam' }, tools: [{ id: 'lookup', description: 'Looks up' }], agents: { entry: 'a', items: [{ id: 'a', instructions: { role: 'Help.', opening: 'Say hi.', conditional: [{ when: { state: 'verified', equals: true }, append: 'Be fast.' }] }, tools: ['lookup', 'ghost'], handoffs: [{ tool: 'go_b', to: 'b', description: 'Billing' }] }] } };
  const p = fromApproximate(assemblePrompt(config, 'a', {}), config);
  assert.deepEqual(p.sections.map((s) => [s.kind, s.active]), [['persona', true], ['role', true], ['opening', true], ['conditional-0', false]]);
  assert.match(p.instructions, /Your name is Sam/);
  assert.doesNotMatch(p.instructions, /Be fast/, 'a conditional block is not in the base text');
  assert.deepEqual(p.tools.map((t) => [t.name, t.offered]), [['lookup', true], ['ghost', false], ['go_b', true]]);
  assert.equal(p.stats.toolsOffered, 2);
  assert.equal(p.opening, 'Say hi.');
});

// ---------------------------------------------------------------- the demo API's previews
test('Python’s printing is imitated: the model is shown a dict’s repr, not JSON', () => {
  assert.equal(pyRepr({ found: true, summary: 'Order NB-1003, shipped', n: null, list: [1, 'a'] }), "{'found': True, 'summary': 'Order NB-1003, shipped', 'n': None, 'list': [1, 'a']}");
  assert.equal(pyRepr("it's"), '"it\'s"');
  assert.equal(pyRepr(false), 'False');
  assert.equal(pyRepr(undefined), 'None');
});

test('POST /preview/result (demo) shows the request, what the model reads, what is stored, and the review’s bare names work', async () => {
  const api = createDemoApi({});
  const config = (await api.handle('GET', '/bots/acme-support/draft')).body.config;
  config.connections = { api: { type: 'http', base_url: 'https://api.example.com/', auth: { type: 'bearer', token: { secret: 'API_TOKEN' } } } };
  config.state = { variables: { ticket: { type: 'string', default: null } } };
  config.tools = [{ id: 'find_order', type: 'http', description: 'Looks up an order', connection: 'api', request: { method: 'GET', path: '/orders/{{args.order_id}}', query: { v: '2' } }, parameters: { type: 'object', required: ['order_id'], properties: { order_id: { type: 'string' } } },
    result: { to_llm: ['found', 'summary'], to_state: { ticket: '$.ticket' }, out_of_band: { fields: ['link'] } }, effects: [{ do: [{ type: 'say', text: 'Found it' }] }] }];
  const asked = await api.handle('POST', '/preview/result', { config, tool: 'find_order', args: { order_id: 'NB-1003' }, response: { found: true, summary: 'Order NB-1003, shipped', ticket: 'TK-1', link: 'x', secret_field: 'hide' } });
  assert.equal(asked.status, 200);
  const view = normalizeResultPreview(asked.body);
  assert.equal(view.request.url, 'https://api.example.com/orders/NB-1003');
  assert.deepEqual(view.request.query, { v: '2' });
  assert.deepEqual(view.request.auth, { type: 'bearer', secrets: ['API_TOKEN'] });
  assert.equal(view.modelSeesText, "{'found': True, 'summary': 'Order NB-1003, shipped'}", 'the review’s own example: bare names pick fields');
  assert.deepEqual(view.storedInState, { ticket: 'TK-1' });
  assert.deepEqual(view.keptFromModel, ['link']);
  assert.deepEqual(view.effects, ['says a line']);
  assert.match(asked.body.note, /imitation/);
  assert.deepEqual(normalizeResultPreview((await api.handle('POST', '/preview/result', { config, tool: 'find_order', args: {} })).body).argsProblems, ['the argument “order_id” is required']);
  assert.equal(normalizeResultPreview((await api.handle('POST', '/preview/result', { config, tool: 'find_order', args: { order_id: 'x' } })).body).hasAnswer, false, 'no sample answer, no answer part');
  assert.equal(normalizeResultPreview((await api.handle('POST', '/preview/result', { config, tool: 'find_order', args: { order_id: 'x' }, response: null })).body).hasAnswer, true, 'a null answer is still an answer');
  assert.equal((await api.handle('POST', '/preview/result', { config, tool: 'nope' })).status, 404);
  assert.equal((await api.handle('POST', '/preview/result', {})).status, 422);
  assert.equal((await api.handle('POST', '/preview/result', { bot: 'ghost', tool: 'x' })).status, 404);
});

test('POST /preview/prompt (demo) gives sections, tools, state and sizes in the server’s shape, for a config or a saved agent', async () => {
  const api = createDemoApi({});
  const named = await api.handle('POST', '/preview/prompt', { bot: 'acme-support' });
  assert.equal(named.status, 200);
  const p = normalizePrompt(named.body);
  assert.ok(p.sections.length >= 2 && p.instructions.length > 20);
  assert.ok(p.stats.words > 10);
  assert.match(named.body.note, /imitation/);
  assert.equal((await api.handle('POST', '/preview/prompt', { bot: 'acme-support', agent: 'ghost' })).status, 404);
  const config = (await api.handle('GET', '/bots/acme-support/draft')).body.config;
  const what = await api.handle('POST', '/preview/prompt', { config, state: { verified: true } });
  assert.equal(what.body.state.verified, true);
});
