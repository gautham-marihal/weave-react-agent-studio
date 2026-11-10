import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStarter } from '../src/studio/starters.ts';
import { minimalConfig } from '../src/demo/minimalConfig.js';
import { baseReaders, setBaseMode, setBaseReaders } from '../src/studio/setup/setupKnowledge.js';
import { closingStarted } from '../src/studio/agent/blocks/afterCallModel.js';
import { guardNotRun } from '../src/studio/agent/blocks/guardrailModel.js';
import { quietStory } from '../src/studio/agent/detailed/conversationView/conversationWords.js';
import { withInput } from '../src/studio/pictures/pictureSteps.js';
import { notRunAt, plainFeature, splitUnsupported } from '../src/studio/preflight.ts';
import { validateDemo } from '../src/demo/demoValidate.js';

// What the real POST /validate answered on 2026-11-05 for a config using every feature section 8 lists as not run yet.
const SERVER_NOT_RUN = [
  { feature: 'playing recorded sounds', where: 'defaults.reliability.on_session_error.do[0]' },
  { feature: 'MCP server tools', where: 'tools[2]' },
  { feature: 'custom code tools', where: 'tools[3]' },
  { feature: 'thinking / ambient sounds', where: 'defaults.conversation.sounds' },
  { feature: 'noise cancellation', where: 'defaults.conversation.noise_cancellation' },
  {
    feature: 'scheduled knowledge refresh: nothing rebuilds the index on a timer; rebuild it with python -m agent_runtime.knowledge_index build',
    where: 'knowledge[0].refresh',
  },
  { feature: 'vision (camera frames / images)', where: 'agents.items[0].vision' },
  { feature: "guardrail 'field_firewall' (a code-enforced check)", where: 'guardrails.output[0]' },
  { feature: "guardrail 'pii_detect' (a code-enforced check)", where: 'guardrails.output[1]' },
  { feature: 'topic limits', where: 'guardrails.topics' },
  { feature: 'escalation rules', where: 'guardrails.escalation' },
  { feature: 'post-call summary', where: 'post_call.summary' },
  { feature: 'post-call analysis', where: 'post_call.analysis' },
];

// The studio checked against the agent config guide, section by section (agent-config-guide 2.md). Each case here broke
// a rule the guide states, which the server's check (POST /validate) also enforces.

const agent = () => applyStarter(minimalConfig('acme', 'Acme'), 'support');
const withBase = (mode, extra = {}) => {
  const config = agent();
  config.agents.items.push({ id: 'billing', name: 'Billing', instructions: { role: 'Bills.' } });
  config.knowledge = [{ id: 'faq', type: 'vector_store', ...(mode ? { mode } : {}), sources: [{ type: 'file', file_id: 'faq.md' }] }];
  return { ...config, ...extra };
};
const entryId = (config) => config.agents.items[0].id;
const agentById = (config, id) => config.agents.items.find((a) => a.id === id);
const searchTools = (config) => (config.tools || []).filter((t) => t.type === 'knowledge' && t.source === 'faq');

test('2.11: an "inject" base is read from the agent’s own list, and no knowledge tool searches it', () => {
  const config = setBaseReaders(withBase('inject'), 'faq', [entryId(withBase('inject')), 'billing']);
  assert.deepEqual(agentById(config, 'billing').knowledge, ['faq']);
  assert.deepEqual(searchTools(config), []);
  assert.deepEqual(baseReaders(config, 'faq').sort(), [entryId(config), 'billing'].sort());
  const fewer = setBaseReaders(config, 'faq', ['billing']);
  assert.equal(agentById(fewer, entryId(fewer)).knowledge, undefined, 'an emptied list goes');
  assert.deepEqual(baseReaders(fewer, 'faq'), ['billing']);
});

test('2.11: a "tool" base (the default) is searched through one knowledge tool, never from the agent’s own list', () => {
  for (const mode of ['tool', undefined]) {
    const start = withBase(mode);
    const config = setBaseReaders(start, 'faq', ['billing']);
    const [tool] = searchTools(config);
    assert.ok(tool, 'a knowledge tool is made for it');
    assert.match(tool.description, /Search faq/i);
    assert.ok(agentById(config, 'billing').tools.includes(tool.id));
    assert.equal(agentById(config, 'billing').knowledge, undefined);
    assert.deepEqual(baseReaders(config, 'faq'), ['billing']);
    // a second agent reuses the same tool
    const both = setBaseReaders(config, 'faq', ['billing', entryId(config)]);
    assert.equal(searchTools(both).length, 1);
    assert.ok(agentById(both, entryId(both)).tools.includes(tool.id));
    // unticking takes the tool off that agent only; the tool stays for the other
    const back = setBaseReaders(both, 'faq', [entryId(both)]);
    assert.equal(agentById(back, 'billing').tools.includes(tool.id), false);
    assert.equal(start.knowledge[0].mode, mode, 'the draft given is not changed');
  }
});

test('2.11: an agent that already searches the base with a tool of its own keeps it', () => {
  const config = withBase('tool', {
    tools: [{ id: 'faq_lookup', type: 'knowledge', source: 'faq', description: 'Look up the FAQ.' }],
  });
  config.agents.items[1].tools = ['faq_lookup'];
  const next = setBaseReaders(config, 'faq', ['billing', entryId(config)]);
  assert.deepEqual(agentById(next, 'billing').tools, ['faq_lookup']);
  assert.ok(agentById(next, entryId(next)).tools.includes('faq_lookup'), 'the other agent is given the same tool');
  assert.equal(searchTools(next).length, 1);
});

test('2.11: changing how it searches keeps the same agents reading it, moved to the way the new mode allows', () => {
  const injected = setBaseReaders(withBase('inject'), 'faq', ['billing']);
  const asTool = setBaseMode(injected, 'faq', 'tool');
  assert.equal(asTool.knowledge[0].mode, 'tool');
  assert.deepEqual(baseReaders(asTool, 'faq'), ['billing']);
  assert.equal(agentById(asTool, 'billing').knowledge, undefined);
  assert.equal(searchTools(asTool).length, 1);
  const backAgain = setBaseMode(asTool, 'faq', 'inject');
  assert.deepEqual(agentById(backAgain, 'billing').knowledge, ['faq']);
  assert.deepEqual(searchTools(backAgain), [], 'a knowledge tool on an inject base is refused by the server, so it goes');
  assert.equal(
    (agentById(backAgain, 'billing').tools || []).some((t) => t.startsWith('search_faq')),
    false,
  );
  assert.deepEqual(baseReaders(backAgain, 'faq'), ['billing']);
});

test('2.8 and 3.23: a closing message runs only when a step starts it', () => {
  const config = agent();
  config.wrapups = [{ id: 'closing', wait_s: 10, on_silence: [{ type: 'end_call' }] }];
  assert.equal(closingStarted(config, 'closing'), false);
  config.forms = [{ id: 'callback', fields: [], on_submit: [{ type: 'wrapup', wrapup: 'closing' }] }];
  assert.equal(closingStarted(config, 'closing'), true);
  assert.equal(closingStarted(config, 'other'), false);
});

test('3.24 and 8: the guardrail parts the server keeps but does not run are read from its own report', () => {
  // exactly what POST /validate answered on 2026-11-05 for topics, an escalation rule and three output checks
  const unsupported = [
    { feature: "guardrail 'regex_block' (a code-enforced check)", where: 'guardrails.output[1]' },
    { feature: "guardrail 'field_firewall' (a code-enforced check)", where: 'guardrails.output[2]' },
    { feature: 'topic limits', where: 'guardrails.topics' },
    { feature: 'escalation rules', where: 'guardrails.escalation' },
  ];
  assert.deepEqual(guardNotRun(unsupported), { topics: true, escalation: true, output: [1, 2] });
  assert.deepEqual(guardNotRun([]), { topics: false, escalation: false, output: [] }, 'once the server runs them, nothing is marked');
  assert.deepEqual(guardNotRun(undefined), { topics: false, escalation: false, output: [] });
});

test('3.9: turning on pictures for a channel also marks the model as reading pictures, which the server requires', () => {
  const config = agent();
  const web = config.channels.find((c) => c.type === 'web_chat' || c.type === 'web_voice');
  assert.ok(web, 'the starter has a web channel');
  const next = withInput(config, 'image');
  assert.ok(next.channels.find((c) => c.id === web.id).modalities.input.includes('image'));
  assert.equal(next.defaults.models.llm.vision, true);
});

test('4, step 9: the silence settings are said as the timeline a silent caller meets', () => {
  const quiet = (inactivity) => quietStory({ defaults: { conversation: { inactivity } } });
  const end = { do: [{ type: 'end_call', say: 'Goodbye.' }] };
  // the guide's example: 12 s, two nudges, then the goodbye
  assert.match(
    quiet({ enabled: true, timeout_s: 12, max_nudges: 2, on_exhausted: end }),
    /check-in at 12 seconds and 24 seconds, and the call ends at 36 seconds/,
  );
  assert.match(quiet({ timeout_s: 120, max_nudges: 3 }), /check-in at 2 minutes, 4 minutes and 6 minutes, and “then” runs at 8 minutes/);
  assert.match(quiet({ timeout_s: 30, max_nudges: 0, on_exhausted: end }), /gets no check-in, and the call ends at 30 seconds/);
  assert.equal(quiet({ enabled: false, timeout_s: 12, max_nudges: 2 }), '', 'off: nothing to say');
  assert.equal(quiet({ max_nudges: 2 }), '', 'no wait set yet: nothing made up');
  assert.equal(quietStory({}), '');
});

test('2.1: every new agent starts with the guide’s size limits, and limits already set are kept', async () => {
  const { LINT_LIMITS, withLintLimits } = await import('../src/studio/starters.ts');
  const fresh = withLintLimits(agent());
  assert.deepEqual(fresh.builder.lint, { max_prompt_words_per_agent: 450, max_tools_per_agent: 8 });
  assert.deepEqual(LINT_LIMITS, { max_prompt_words_per_agent: 450, max_tools_per_agent: 8 });
  const own = withLintLimits({ ...agent(), builder: { lint: { max_tools_per_agent: 12, warn_on_monolith: true }, ui: { x: 1 } } });
  assert.deepEqual(own.builder, { lint: { max_tools_per_agent: 12, warn_on_monolith: true, max_prompt_words_per_agent: 450 }, ui: { x: 1 } });
  const done = withLintLimits(fresh);
  assert.equal(done, fresh, 'nothing to add: the same draft back');
});

test('8: a row is told when the server does not run what it sets, in the server’s words without an operator’s command', () => {
  assert.equal(notRunAt(SERVER_NOT_RUN, ['defaults', 'conversation', 'sounds']), 'thinking / ambient sounds');
  assert.equal(notRunAt(SERVER_NOT_RUN, ['defaults', 'reliability', 'on_session_error']), 'playing recorded sounds', 'a step inside the row');
  assert.equal(notRunAt(SERVER_NOT_RUN, ['agents', 'items', 0, 'vision']), 'vision (camera frames / images)');
  assert.equal(notRunAt(SERVER_NOT_RUN, ['knowledge', 0, 'refresh']), 'scheduled knowledge refresh: nothing rebuilds the index on a timer');
  assert.equal(notRunAt(SERVER_NOT_RUN, ['defaults', 'conversation', 'sounds', 'thinking']), '', 'a place below the reported one is not marked');
  assert.equal(notRunAt(SERVER_NOT_RUN, ['agents', 'items', 1, 'vision']), '', 'another agent is not marked');
  assert.equal(notRunAt([], ['post_call', 'summary']), '', 'once the server runs it, nothing is said');
  assert.equal(plainFeature('topic limits'), 'topic limits');
  assert.doesNotMatch(JSON.stringify(splitUnsupported(SERVER_NOT_RUN)), /python -m/, 'no command line reaches the screen');
});

test('8: the demo’s check reports the same places the real server does, for the same config', () => {
  const c = agent();
  const a = c.agents.items[0];
  c.defaults.models.llm.vision = true;
  c.channels[0].modalities = { input: ['text', 'image', 'video'], output: ['text'] };
  c.connections = { ...(c.connections || {}), crm: { type: 'mcp', transport: 'streamable_http', url: 'https://crm.example.com/mcp' } };
  c.tools.push({ id: 'crm_tools', type: 'mcp', description: 'CRM.', server: 'crm', allow: ['status'] });
  c.tools.push({ id: 'calc', type: 'code', description: 'Calc.', handler: 'tools.calc:run', parameters: { type: 'object', properties: {} } });
  a.tools.push('crm_tools', 'calc');
  c.knowledge = [{ id: 'faq', type: 'vector_store', mode: 'inject', refresh: 'daily', sources: [{ type: 'file', file_id: 'faq.md' }] }];
  a.knowledge = ['faq'];
  c.guardrails = {
    ...(c.guardrails || {}),
    output: [
      { id: 'fw', type: 'field_firewall', fields: ['token'], enforcement: 'code' },
      { id: 'pii_out', type: 'pii_detect', entities: ['email'], enforcement: 'code', on_trigger: { action: 'rewrite' } },
    ],
    topics: { blocked: ['legal advice'], on_off_topic: { say: 'No.', max_strikes: 2, then: 'end_call' } },
    escalation: [{ id: 'abuse', when: { sentiment: 'abusive', consecutive_turns: 2 }, action: 'end_call', say: 'Bye.' }],
  };
  c.post_call = { ...(c.post_call || {}), summary: { enabled: true }, analysis: [{ id: 'resolved', question: 'Was it solved?', type: 'boolean' }] };
  c.defaults.conversation = {
    ...(c.defaults.conversation || {}),
    sounds: { thinking: { enabled: true, clips: [{ source: 'keyboard_typing' }] } },
    noise_cancellation: { enabled: true, model: 'auto' },
  };
  c.defaults.reliability = { ...(c.defaults.reliability || {}), on_session_error: { do: [{ type: 'play_sound', sound: { file: 'sounds/sorry.wav' } }] } };
  a.vision = { mode: 'turn_attach', max_dimension: 1024 };
  const demo = validateDemo(c, 'acme');
  assert.equal(demo.valid, true, JSON.stringify(demo.errors));
  assert.deepEqual(demo.unsupported.map((u) => u.where).sort(), SERVER_NOT_RUN.map((u) => u.where).sort());
});

test('FRONTEND_GUIDE 10.1: the kinds of detail to hide come from the server’s list, with the studio’s plain labels', async () => {
  const { sensitiveChoices } = await import('../src/studio/agent/blocks/afterCallModel.js');
  const server = [
    { kind: 'card_number', how: 'Luhn' },
    { kind: 'email', how: '@' },
    { kind: 'passport_number', how: 'new' },
  ];
  assert.deepEqual(sensitiveChoices(server), [
    { value: 'card_number', label: 'Card numbers' },
    { value: 'email', label: 'Email addresses' },
    { value: 'passport_number', label: 'Passport number' },
  ]);
  assert.equal(sensitiveChoices(null).length, 8, 'before the server answers: the studio’s own list');
  assert.equal(sensitiveChoices([])[0].value, 'card_number');
});
