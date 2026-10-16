import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { llmMiddleware, llmSettings } from '../llmRoute.js';
import { TOOL, compactSchema, readAnswer, repairMessage, requestMessage, systemPrompt } from '../src/studio/assistant/prompt.js';
import { askAssistant, explainFailure, keepStudioNotes, loadStatus, postToModel, pruneStalePlaces } from '../src/studio/assistant/engine.js';
import { countChanges, diffConfigs, groupChanges } from '../src/studio/assistant/diffConfig.js';
import { minimalConfig } from '../src/demo/minimalConfig.js';

const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
const example = () => JSON.parse(readFileSync(new URL('./fixtures/agent-config.example.json', import.meta.url), 'utf8'));

// ---- the server's /llm route
function call(handler, method, url, body) {
  const req = new EventEmitter(); req.method = method; req.url = url; req.destroy = () => {};
  const res = { headers: {}, statusCode: 0, body: '', setHeader(k, v) { this.headers[k] = v; }, end(text) { this.body = text; this.done(); } };
  return new Promise((resolve) => {
    res.done = () => resolve({ status: res.statusCode, body: res.body ? JSON.parse(res.body) : null, headers: res.headers });
    handler(req, res, () => resolve({ status: 'next' }));
    if (body !== undefined) { req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))); }
    req.emit('end');
  });
}

test('/llm/status says whether an AI model is set up and which may be chosen, and never shows the key', async () => {
  const none = await call(llmMiddleware({}), 'GET', '/status');
  assert.deepEqual([none.body.configured, none.body.model], [false, 'claude-sonnet-5-5']);
  const set = await call(llmMiddleware({ ANTHROPIC_API_KEY: 'sk-secret', LLM_MODELS: 'a,b', LLM_MODEL: 'b' }), 'GET', '/status');
  assert.deepEqual([set.body.configured, set.body.model, set.body.models], [true, 'b', ['a', 'b']]);
  assert.ok(!JSON.stringify(set.body).includes('sk-secret'));
  assert.equal(llmSettings({ LLM_MODEL: 'nope' }).model, 'claude-sonnet-5-5', 'a model that is not on the list is not the default');
});

test('/llm/v1/messages adds the key itself, limits the model and the size, drops everything else the browser sent, and passes the answer back', async () => {
  const seen = [];
  const fakeFetch = async (url, init) => { seen.push({ url, init }); return { status: 200, text: async () => JSON.stringify({ content: [], ok: true }) }; };
  const handler = llmMiddleware({ ANTHROPIC_API_KEY: 'sk-secret', LLM_BASE_URL: 'https://llm.example/' }, fakeFetch);
  const out = await call(handler, 'POST', '/v1/messages', { model: 'gpt-evil', max_tokens: 999999, messages: [{ role: 'user', content: 'hi' }], system: 's', stream: true, metadata: { x: 1 }, 'anthropic-beta': 'x' });
  assert.equal(out.status, 200);
  assert.equal(seen[0].url, 'https://llm.example/v1/messages');
  assert.equal(seen[0].init.headers['x-api-key'], 'sk-secret');
  const sent = JSON.parse(seen[0].init.body);
  assert.equal(sent.model, 'claude-sonnet-5-5', 'a model the server does not allow is replaced');
  assert.equal(sent.max_tokens, 32000, 'and the size of an answer is capped');
  assert.deepEqual(Object.keys(sent).filter((k) => sent[k] !== undefined).sort(), ['max_tokens', 'messages', 'model', 'system']);
  assert.ok(!('stream' in sent) && !('metadata' in sent));
});

test('/llm refuses everything else, an unset key, bad bodies, and says when the service cannot be reached', async () => {
  const handler = llmMiddleware({ ANTHROPIC_API_KEY: 'k' }, async () => { throw new Error('boom'); });
  assert.equal((await call(handler, 'GET', '/v1/messages')).status, 404);
  assert.equal((await call(handler, 'POST', '/v1/complete', {})).status, 404);
  assert.equal((await call(handler, 'DELETE', '/anything')).status, 404);
  assert.equal((await call(handler, 'POST', '/v1/messages', 'not json')).status, 400);
  assert.equal((await call(handler, 'POST', '/v1/messages', { nope: 1 })).status, 400);
  const down = await call(handler, 'POST', '/v1/messages', { messages: [] });
  assert.equal(down.status, 502);
  assert.match(down.body.error, /could not be reached/);
  assert.equal((await call(llmMiddleware({}), 'POST', '/v1/messages', { messages: [] })).status, 503, 'with no key it says so rather than trying');
});

// ---- the prompt and the answer
test('the schema sent to the model is shorter than the schema, without the studio-only hints, and the system prompt carries the rules', () => {
  const full = JSON.stringify(schema).length;
  const compact = compactSchema(schema);
  assert.ok(JSON.stringify(compact).length < full);
  assert.ok(!JSON.stringify(compact).includes('"x-ui"'));
  const prompt = systemPrompt(schema);
  assert.match(prompt, /submit_config/);
  assert.match(prompt, /NEVER invent secrets/);
  assert.ok(prompt.includes('"properties"'));
});

test('the request carries the current draft, the wish, and what was asked earlier; a repair message lists what the validator found', () => {
  const msg = requestMessage({ request: ' add a Spanish greeting ', config: { a: 1 }, earlier: ['one', 'two'] });
  assert.match(msg, /CURRENT DRAFT/); assert.match(msg, /REQUEST:\nadd a Spanish greeting$/); assert.match(msg, /1\. one/);
  const fix = repairMessage([{ path: ['agents', 'items', 0, 'tools'], message: 'must be a list' }, { path: [], message: 'bad' }]);
  assert.match(fix, /agents\.items\.0\.tools: must be a list/); assert.match(fix, /\(whole document\): bad/);
});

test('the answer is read from the tool call, and every way it can go wrong is a sentence a person can read', () => {
  const ok = readAnswer({ content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 't1', name: TOOL.name, input: { config: { x: 1 }, summary: ' Built. ', assumptions: ['a', '', 3], questions: 'nope' } }], usage: { input_tokens: 5 } });
  assert.deepEqual([ok.config, ok.summary, ok.assumptions, ok.questions, ok.toolUseId], [{ x: 1 }, 'Built.', ['a'], [], 't1']);
  assert.throws(() => readAnswer(null), /does not understand/);
  assert.throws(() => readAnswer({ content: [], stop_reason: 'max_tokens' }), /cut off/);
  assert.throws(() => readAnswer({ content: [{ type: 'text', text: 'I cannot' }] }), /instead of a configuration: “I cannot”/);
  assert.throws(() => readAnswer({ content: [{ type: 'tool_use', id: 'x', name: TOOL.name, input: { config: 5 } }] }), /not a configuration/);
});

// ---- asking, checking, repairing
const reply = (config, extra = {}) => ({ content: [{ type: 'tool_use', id: `t${Math.random()}`, name: TOOL.name, input: { config, summary: 'Done.', ...extra } }], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 7 } });

test('a good answer is checked once and returned with what it assumed and what is still open', async () => {
  const base = minimalConfig('x', 'X');
  const next = { ...base, persona: { name: 'X', tone: 'warm' } };
  const calls = []; const steps = [];
  const result = await askAssistant({ request: 'be warm', config: base, schema, model: 'm', onStep: (s) => steps.push(s), earlier: [],
    post: async (body) => { calls.push(body); return reply(next, { assumptions: ['Assumed English.'], questions: ['What is the opening time?'] }); },
    validate: async () => ({ errors: [], warnings: [{ message: 'w' }] }) });
  assert.deepEqual(result.config, next);
  assert.deepEqual([result.assumptions, result.questions, result.repairs, result.issues.errors.length, result.issues.warnings.length], [['Assumed English.'], ['What is the opening time?'], 0, 0, 1]);
  assert.deepEqual(result.usage, { input: 10, output: 5, cached: 7 });
  assert.deepEqual(steps, ['thinking', 'checking']);
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].model, calls[0].tool_choice, calls[0].tools[0].name], ['m', { type: 'tool', name: 'submit_config' }, 'submit_config']);
  assert.equal(calls[0].system[0].cache_control.type, 'ephemeral', 'the long, unchanging part is cached');
  assert.match(calls[0].messages[0].content, /be warm/);
});

test('when the validator finds errors they are handed back to the model, up to twice, and the answer that finally validates is kept', async () => {
  const base = minimalConfig('x', 'X');
  const bad = { ...base, agents: { entry: 'nobody', items: base.agents.items } };
  let round = 0; const seen = [];
  const result = await askAssistant({ request: 'r', config: base, schema, model: 'm',
    post: async (body) => { seen.push(JSON.parse(JSON.stringify(body.messages))); round += 1; return reply(round < 3 ? bad : base); },
    validate: async (c) => ({ errors: c.agents.entry === 'nobody' ? [{ path: ['agents', 'entry'], message: 'unknown agent' }] : [], warnings: [] }) });
  assert.equal(round, 3);
  assert.equal(result.repairs, 2);
  assert.equal(result.issues.errors.length, 0);
  const last = seen[2];
  assert.deepEqual(last.map((m) => m.role), ['user', 'assistant', 'user', 'assistant', 'user'], 'the request, then each answer and what the validator found about it');
  assert.equal(last[4].content[0].type, 'tool_result');
  assert.equal(last[4].content[0].is_error, true);
  assert.match(last[4].content[0].content, /agents\.entry: unknown agent/);
});

test('after the last repair the problems that remain are reported, not hidden, and the studio’s own notes survive an answer that dropped them', async () => {
  const base = { ...minimalConfig('x', 'X'), builder: { ui: { graph_positions: { assistant: { x: 1, y: 2 } } } } };
  const dropped = minimalConfig('x', 'X');
  let n = 0;
  const result = await askAssistant({ request: 'r', config: base, schema, model: 'm', maxRepairs: 1,
    post: async () => { n += 1; return reply(dropped); }, validate: async () => ({ errors: [{ path: ['a'], message: 'still wrong' }], warnings: [] }) });
  assert.equal(n, 2);
  assert.equal(result.issues.errors.length, 1);
  assert.deepEqual(result.config.builder, base.builder);
  assert.equal(keepStudioNotes(base, { builder: { x: 1 } }).builder.x, 1, 'a builder section the model did write is left alone');
  await assert.rejects(() => askAssistant({ request: '  ', config: base, schema, model: 'm', post: async () => reply(base), validate: async () => ({}) }), /Say what you need/);
});

test('failures of the call are explained, a missing server is told apart, and the status never throws', async () => {
  assert.match(explainFailure(503, { error: 'x' }), /ANTHROPIC_API_KEY to \.env\.local/);
  assert.match(explainFailure(401, null), /did not accept the key/);
  assert.match(explainFailure(429, null), /busy/);
  assert.match(explainFailure(529, { error: { message: 'overloaded' } }), /overloaded/);
  assert.equal(explainFailure(400, { error: { message: 'bad thing' } }), 'bad thing');
  await assert.rejects(() => postToModel({}, undefined, async () => { throw new Error('down'); }), /could not reach/);
  await assert.rejects(() => postToModel({}, undefined, async () => ({ ok: false, status: 503, text: async () => '{"error":"No AI"}' })), /No AI model is set up/);
  await assert.rejects(() => postToModel({}, undefined, async () => ({ ok: true, status: 200, text: async () => 'html' })), /not JSON/);
  assert.deepEqual(await postToModel({}, undefined, async () => ({ ok: true, status: 200, text: async () => '{"a":1}' })), { a: 1 });
  assert.deepEqual(await loadStatus(async () => { throw new Error('x'); }), { configured: false });
  assert.deepEqual(await loadStatus(async () => ({ ok: true, json: async () => ({ configured: true, model: 'm' }) })), { configured: true, model: 'm' });
  assert.deepEqual(await loadStatus(async () => ({ ok: true, json: async () => '<html>' })), { configured: false });
});

// ---- what it would change
test('the changes a new configuration makes are found by place, matching list items by id, and read in words without the studio notes', () => {
  const before = example();
  const after = JSON.parse(JSON.stringify(before));
  after.persona.tone = 'calm and clear';
  after.agents.items = [after.agents.items[2], ...after.agents.items.filter((a) => a.id !== 'safety_watch' && a.id !== 'tech_support'), { id: 'newbie', name: 'Newbie', kind: 'specialist', instructions: { role: 'x' }, tools: [] }];
  after.builder.ui.graph_positions.billing.x = 999;
  const changes = diffConfigs(before, after);
  const kinds = changes.map((c) => `${c.kind}:${JSON.stringify(c.path)}`);
  assert.ok(kinds.some((k) => k === 'added:["agents","items",{"id":"newbie"}]'));
  assert.ok(kinds.some((k) => k === 'removed:["agents","items",{"id":"safety_watch"}]'));
  assert.ok(!kinds.some((k) => k.includes('"greeter"') && k.startsWith('changed') && k.includes('"items"')), 'a reordered agent is not a change');
  const groups = groupChanges(changes);
  assert.ok(!groups.some((g) => g.section === 'Studio notes'), 'where blocks are drawn is not a change to the agent');
  const agents = groups.find((g) => g.section === 'Agents').items.map((i) => `${i.verb} ${i.where}`);
  assert.ok(agents.includes('Added Agents › “newbie”'));
  const persona = groups.find((g) => g.section === 'Personality').items[0];
  assert.deepEqual([persona.verb, persona.where], ['Changed', 'Personality › tone']);
  assert.match(persona.detail, /→ calm and clear/);
  assert.deepEqual(diffConfigs(before, JSON.parse(JSON.stringify(before))), []);
});

test('each change reads as a sentence for a person, and the counts add up', () => {
  const before = example();
  const after = JSON.parse(JSON.stringify(before));
  after.persona.tone = 'calm';
  after.agents.items[1].kind = 'router';
  after.agents.items.push({ id: 'newbie', name: 'Newbie', kind: 'specialist', instructions: { role: 'x' }, tools: [] });
  after.agents.items = after.agents.items.filter((a) => a.id !== 'safety_watch');
  const groups = groupChanges(diffConfigs(before, after));
  const lines = groups.flatMap((g) => g.items.map((i) => i.text));
  assert.ok(lines.includes('Changed “Tone of voice” from “warm, concise, plain language” to “calm”'));
  assert.ok(lines.includes('Changed “Kind of agent” of the agent “billing” from “specialist” to “router”'));
  assert.ok(lines.includes('Removed the agent “Live Safety Watch”'));
  assert.ok(lines.includes('Added the agent “Newbie”'));
  assert.deepEqual(countChanges(groups), { added: 1, changed: 2, removed: 1, total: 4 });
});

test('after the AI changes the agents, saved places for blocks that are gone are dropped, so the Workflow is drawn from what the agent is now', () => {
  const before = example();
  before.builder.ui.graph_positions = { start: { x: 1, y: 1 }, greeter: { x: 2, y: 2 }, safety_watch: { x: 3, y: 3 }, 'greeter::tool::end_call': { x: 4, y: 4 }, 'greeter::tool::gone': { x: 5, y: 5 }, 'greeter::enter::0': { x: 6, y: 6 }, 'billing::enter::0': { x: 7, y: 7 } };
  const after = JSON.parse(JSON.stringify(before));
  after.agents.items = after.agents.items.filter((a) => a.id !== 'safety_watch');
  after.agents.items[0].on_enter = undefined; delete after.agents.items[0].on_enter;
  const kept = keepStudioNotes(before, after);
  assert.deepEqual(Object.keys(kept.builder.ui.graph_positions).sort(), ['greeter', 'greeter::tool::end_call', 'start']);
  assert.ok(before.builder.ui.graph_positions.safety_watch, 'the configuration it was given is left as it was');
  const only = JSON.parse(JSON.stringify(after)); only.builder = { ui: { graph_positions: { nobody: { x: 1, y: 1 } } } };
  assert.equal(pruneStalePlaces(only).builder, undefined, 'and an emptied builder section goes');
  const clean = keepStudioNotes(before, after);
  assert.equal(pruneStalePlaces(clean), clean, 'nothing to drop leaves it as it is');
});
