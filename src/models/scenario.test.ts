import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../types/studio';
import {
  EXPECT_KINDS,
  addMockTo,
  describeExpectation,
  describeTurn,
  freshScenarioId,
  isKeysTurn,
  isUnknownExpectation,
  kindOfExpectation,
  mockProblem,
  newExpectation,
  newScenario,
  nowProblem,
  outcomeNamesOf,
  parseImport,
  parseObject,
  parseValue,
  regexProblem,
  scenarioFromConversation,
  scenarioProblems,
  showValue,
  stubMock,
  toolChoices,
} from './scenario';

type Json = Record<string, unknown>;
const schema = JSON.parse(readFileSync(new URL('../test/fixtures/agent-config.schema.json', import.meta.url), 'utf8')) as Json;
const resolve = (node: unknown): Json => {
  const n = node as Json;
  if (n && typeof n.$ref === 'string')
    return resolve(
      n.$ref
        .split('/')
        .slice(1)
        .reduce<unknown>((o, k) => (o as Json)[k], schema),
    );
  return n;
};

// A plain agent: one web chat, the builtin end-call and person tools, one agent.
const support = (): AgentConfig => ({
  meta: { id: 'acme', name: 'Acme' },
  channels: [{ id: 'web-chat', type: 'web_chat', enabled: true }],
  agents: { entry: 'assistant', items: [{ id: 'assistant', name: 'Assistant', tools: ['end_call', 'escalate_to_human'] }] },
  tools: [
    { id: 'end_call', type: 'builtin', builtin: 'end_call' },
    { id: 'escalate_to_human', type: 'builtin', builtin: 'transfer_or_callback' },
  ],
});

// An agent with an HTTP tool, a hand-over, state variables and web chat.
function nimbus(): AgentConfig {
  return {
    meta: { id: 'nimbus', name: 'Nimbus' },
    channels: [{ id: 'web-chat', type: 'web_chat', enabled: true }],
    state: { variables: { verified: { type: 'boolean', default: false }, ticket_id: { type: 'string', nullable: true, default: null } } },
    connections: { api: { type: 'http', base_url: 'https://api.example.com' } },
    tools: [
      { id: 'find_order', type: 'http', description: 'Looks up an order', connection: 'api', request: { method: 'GET', path: '/orders/{{args.order_id}}' } },
      { id: 'open_ticket', type: 'http', description: 'Raises a ticket', connection: 'api', request: { method: 'POST', path: '/tickets' } },
      { id: 'end_call', type: 'builtin', builtin: 'end_call', description: 'Ends the conversation' },
    ],
    agents: {
      entry: 'front_desk',
      items: [
        { id: 'front_desk', name: 'Front desk', kind: 'router', tools: ['end_call'], handoffs: [{ tool: 'go_billing', to: 'billing' }] },
        { id: 'billing', name: 'Billing', kind: 'specialist', tools: ['find_order', 'open_ticket', 'end_call'] },
      ],
    },
  };
}

describe('the kinds of expectation', () => {
  it('are exactly the ones the schema allows (all thirteen), and the schema has the newer scenario fields', () => {
    const tests = resolve(schema.properties && (schema.properties as Json).tests);
    const item = resolve(tests.items);
    const props = item.properties as Json;
    const branches = (resolve(resolve(props.expect).items).oneOf as Json[]).map((b) => Object.keys(resolve(b).properties as Json)[0]).sort();
    expect(branches).toHaveLength(13);
    expect(EXPECT_KINDS.map((k) => k.key).sort()).toEqual(branches);
    ['description', 'now', 'state', 'http_mocks', 'model_script'].forEach((key) => expect(props).toHaveProperty(key));
  });

  it('a new one of every kind is filled in sensibly for this config', () => {
    const config = nimbus();
    expect(newExpectation('tool_called', config)).toEqual({ tool_called: 'find_order' });
    expect(newExpectation('tool_called_with', config)).toEqual({ tool_called_with: { tool: 'find_order', args: {} } });
    expect(newExpectation('state_equals', config)).toEqual({ state_equals: { state: 'verified', value: '' } });
    expect(newExpectation('agent_is', config)).toEqual({ agent_is: 'front_desk' });
    expect(newExpectation('http_called', config)).toEqual({ http_called: { method: 'GET', path: '' } });
    expect(newExpectation('http_not_called', config)).toEqual({ http_not_called: { method: 'POST', path: '' } });
    expect(EXPECT_KINDS.every((k) => Object.keys(newExpectation(k.key, config)).includes(k.key))).toBe(true);
  });

  it('read as sentences', () => {
    expect(describeExpectation({ tool_called: 'end_call' })).toBe('the tool “end_call” is used');
    expect(describeExpectation({ state_equals: { state: 'outcome', value: 'paid' } })).toBe('outcome ends up as "paid"');
    expect(describeExpectation({ said_matches: 'bill' })).toBe('the agent says something matching /bill/');
    expect(describeExpectation({ judge: 'it was polite' })).toBe('a reviewer agrees that it was polite');
    expect(describeExpectation({ agent_is: 'billing' })).toBe('the conversation ends with the agent “billing”');
    expect(describeExpectation({ tool_called_with: { tool: 'find_order', args: { order_id: 'x' } } })).toBe(
      'the tool “find_order” is used with {"order_id":"x"}',
    );
    expect(describeExpectation({ http_called: { method: 'GET', path: '/orders/*', times: 2 } })).toBe('the agent calls GET /orders/* 2 times');
    expect(describeExpectation({ http_not_called: { path: '/tickets' } })).toBe('the agent never calls /tickets');
    expect(parseValue('true')).toBe(true);
    expect(parseValue('3')).toBe(3);
    expect(parseValue('hello')).toBe('hello');
    expect(showValue(false)).toBe('false');
  });

  it('a kind the form does not know is kept and never an error (the schema grows)', () => {
    const config = nimbus();
    const future = { id: 'future', channel: 'web-chat', turns: [{ say: 'hi' }], expect: [{ tool_called: 'find_order' }, { sentiment_is: 'positive' }] };
    expect(scenarioProblems(future, config)).toEqual({});
    expect(isUnknownExpectation(future.expect[1])).toBe(true);
    expect(describeExpectation(future.expect[1])).toMatch(/something else is expected .*sentiment_is/);
  });

  it('a check with an odd value is still a sentence, never an error', () => {
    expect(() => describeExpectation({ limit_reached: null })).not.toThrow();
    expect(() => describeExpectation({ limit_reached: 42 })).not.toThrow();
    expect(() => describeExpectation({ guardrail_triggered: { rule: 'x', action: 7 } })).not.toThrow();
    expect(() => describeExpectation({ task_outcome: null })).not.toThrow();
  });
});

describe('a scenario', () => {
  it('starts valid on the first enabled channel, and ids stay unique', () => {
    const config = support();
    const s = newScenario(config);
    expect(s.channel).toBe('web-chat');
    expect(scenarioProblems(s, config)).toEqual({});
    expect(freshScenarioId([{ id: 'scenario' }, { id: 'scenario_2' }])).toBe('scenario_3');
    expect(newScenario({ ...config, tests: [s] }).id).toBe('scenario_2');
  });

  it('says what is wrong where it is', () => {
    const config = support();
    const bad = {
      id: 'Bad Id',
      channel: 'ghost',
      turns: [{ say: '' }],
      expect: [{ tool_called: 'nope' }, { said_matches: '(' }, { state_equals: { state: 'nope', value: 1 } }, { judge: ' ' }, { agent_is: 'nobody' }],
    };
    const p = scenarioProblems(bad, config);
    expect(p.id).toMatch(/lowercase/);
    expect(p.channel).toMatch(/no channel “ghost”/);
    expect(p.turns).toMatch(/Every turn needs some words/);
    expect(p.expect).toHaveLength(5);
    expect(p.expect?.[0]).toMatch(/no tool “nope”/);
    expect(p.expect?.[1]).toMatch(/not a valid pattern/);
    expect(p.expect?.[2]).toMatch(/no state variable/);
    expect(p.expect?.[4]).toMatch(/no agent “nobody”/);
    expect(scenarioProblems({ ...newScenario(config), turns: [] }, config).turns).toMatch(/at least one/);
    expect(scenarioProblems({ ...newScenario(config), expect: [] }, config).expect?.[0]).toMatch(/at least one/);
    expect(scenarioProblems({ ...newScenario(config), model_script: [] }, config).script?.[0]).toMatch(/model script is empty/);
    expect(scenarioProblems({ ...newScenario(config), model_script: 'hi' }, config).script?.[0]).toMatch(/must be a list/);
    const a = { id: 'a', channel: 'web-chat', turns: [{ say: 'x' }], expect: [{ said_matches: '.' }] };
    expect(scenarioProblems(a, config, [{ id: 'a' }, { id: 'a' }]).id).toMatch(/Another scenario/);
    expect(regexProblem('^ok$')).toBe('');
    expect(regexProblem('[')).not.toBe('');
  });

  it('with the newer expectations, mocks, a clock and a script is valid, and nothing about it blocks Save', () => {
    const config = nimbus();
    const scenario = {
      id: 'a_billing_question_opens_a_ticket',
      description: 'A caller with a billing question reaches billing and a ticket is raised.',
      channel: 'web-chat',
      now: '2026-10-14T03:00:00+08:00',
      state: { verified: true },
      http_mocks: [{ connection: 'api', method: 'GET', path: '/orders/*', status: 200, json: { found: true }, times: 1 }],
      model_script: [{ tool: 'go_billing' }, 'Let me check that.', { tool: 'find_order', args: { order_id: 'NB-1003' } }, 'It shipped.'],
      turns: [{ say: 'Where is my order NB-1003?' }],
      expect: [
        { tool_called_with: { tool: 'find_order', args: { order_id: 'NB-1003' } } },
        { agent_is: 'billing' },
        { http_called: { method: 'GET', path: '/orders/*', times: 1 } },
        { http_not_called: { method: 'POST', path: '/tickets' } },
        { state_equals: { state: 'ticket_id', value: 'TK-5001' } },
        { tool_called: 'find_order' },
      ],
    };
    expect(scenarioProblems(scenario, config)).toEqual({});
    scenario.expect.forEach((e) => expect(isUnknownExpectation(e)).toBe(false));
  });

  it('checks the newer fields only for what is positively wrong', () => {
    const config = nimbus();
    const base = { id: 's', channel: 'web-chat', turns: [{ say: 'x' }], expect: [{ said_matches: '.' }] };
    expect(scenarioProblems({ ...base, now: '2026-10-14T03:00:00Z' }, config)).toEqual({});
    expect(scenarioProblems({ ...base, now: 'tomorrow' }, config).now).toMatch(/time zone/);
    expect(nowProblem('')).toBe('');
    expect(scenarioProblems({ ...base, state: [] }, config).state).toMatch(/object/);
    expect(scenarioProblems({ ...base, http_mocks: [{ status: 200 }] }, config).mocks?.[0]).toMatch(/request path/);
    expect(mockProblem({ path: '/x', status: 700 }, 0)).toMatch(/100 to 599/);
    expect(mockProblem({ path: '/x', method: 'FETCH' }, 0)).toMatch(/method/);
    expect(mockProblem({ path: '/x', times: 0 }, 0)).toMatch(/times/);
    expect(mockProblem({ path: '/x', method: 'GET', status: 404, text: 'nope', times: 2, query: { a: '1' }, body_contains: { b: 1 } }, 0)).toBe('');
    expect(scenarioProblems({ ...base, model_script: ['', { tool: 'x' }] }, config).script?.[0]).toMatch(/write what the model says/);
    expect(scenarioProblems({ ...base, model_script: [{ args: {} }] }, config).script?.[0]).toMatch(/choose the tool/);
    expect(scenarioProblems({ ...base, expect: [{ http_called: { path: '' } }] }, config).expect?.[0]).toMatch(/request path/);
    expect(scenarioProblems({ ...base, expect: [{ http_called: { path: '/x', times: 0 } }] }, config).expect?.[0]).toMatch(/times/);
    expect(scenarioProblems({ ...base, expect: [{ tool_called_with: { tool: 'nope', args: {} } }] }, config).expect?.[0]).toMatch(/no tool/);
    expect(parseObject('')).toEqual({ value: undefined });
    expect(parseObject('{"a":1}')).toEqual({ value: { a: 1 } });
    expect(parseObject('[1]').error).toMatch(/object/);
    expect(parseObject('{').error).toMatch(/Not valid JSON/);
  });

  it('offers each tool name once, saying which tools a shared name stands for', () => {
    const config = {
      ...nimbus(),
      tools: [
        { id: 'look_voice', name: 'look', type: 'http' },
        { id: 'look_chat', name: 'look', type: 'http' },
        { id: 'end_call', type: 'builtin' },
      ],
    } as AgentConfig;
    expect(toolChoices(config)).toEqual([
      { value: 'look', label: 'look', description: 'the tools look_voice and look_chat' },
      { value: 'end_call', label: 'end_call' },
      { value: 'go_billing', label: 'go_billing' },
    ]);
  });
});

// A phone agent with tasks and safety rules: keys turns and the four newer kinds of check.
const phone = (): AgentConfig => ({
  meta: { id: 'bot', name: 'Bot' },
  channels: [
    { id: 'phone', type: 'sip_voice', enabled: true },
    { id: 'web-chat', type: 'web_chat', enabled: true },
  ],
  agents: { entry: 'main', items: [{ id: 'main', name: 'Main' }] },
  tasks: [{ id: 'verify', on_success: { outcome: 'identity_checked' } }, { id: 'activate' }],
  guardrails: {
    input: [
      { id: 'no_injection', type: 'prompt_injection', enforcement: 'code', on_trigger: { action: 'deflect' } },
      { id: 'no_cards', type: 'pii_detect', entities: ['card_number'], enforcement: 'code', on_trigger: { action: 'redact_in_logs' } },
    ],
  },
});
const onPhone = (turns: unknown[], expectations: unknown[], extra: Record<string, unknown> = {}) => ({
  id: 's',
  channel: 'phone',
  turns,
  expect: expectations,
  ...extra,
});

describe('keys pressed on the keypad, and the four newer kinds of check', () => {
  it('a turn of keys is a turn: read, described and validated, never mistaken for words', () => {
    expect(isKeysTurn({ keys: '4821#' })).toBe(true);
    expect(isKeysTurn({ say: 'hello' })).toBe(false);
    expect(describeTurn({ keys: '4821#' })).toBe('presses keys on the keypad');
    expect(describeTurn({ say: 'hello' })).toBe('“hello”');
    expect(scenarioProblems(onPhone([{ say: 'My PIN is next' }, { keys: '4821#' }], [{ said_matches: '.' }]), phone())).toEqual({});
    expect(scenarioProblems(onPhone([{ keys: '48x' }], [{ said_matches: '.' }]), phone()).turns).toMatch(/keys/);
    expect(scenarioProblems(onPhone([{ keys: '' }], [{ said_matches: '.' }]), phone()).turns).toMatch(/keys/);
  });

  it('keys can only be pressed on a phone line', () => {
    const onChat = onPhone([{ keys: '4821#' }], [{ said_matches: '.' }], { channel: 'web-chat' });
    expect(scenarioProblems(onChat, phone()).turns).toMatch(/phone line/);
    expect(scenarioProblems({ ...onChat, channel: 'phone' }, phone())).toEqual({});
    const noChannel = scenarioProblems({ ...onChat, channel: 'nowhere' }, phone());
    expect(noChannel.channel).toBeTruthy();
    expect(noChannel.turns).toBeUndefined();
  });

  it('the four newer kinds are known, written as sentences, and filled in from this agent', () => {
    const found = ['task_outcome', 'guardrail_triggered', 'guardrail_not_triggered', 'limit_reached'].map((kind) => newExpectation(kind, phone()));
    expect(found).toEqual([
      { task_outcome: { task: 'verify' } },
      { guardrail_triggered: { rule: 'no_injection' } },
      { guardrail_not_triggered: 'no_injection' },
      { limit_reached: 'max_tool_calls_per_call' },
    ]);
    found.forEach((e) => expect(kindOfExpectation(e)).toBeTruthy());
    expect(describeExpectation({ task_outcome: { task: 'verify', outcome: 'verified' } })).toBe('the task “verify” ends as “verified”');
    expect(describeExpectation({ task_outcome: { task: 'verify' } })).toBe('the task “verify” ends in any way');
    expect(describeExpectation({ guardrail_triggered: { rule: 'no_injection', action: 'deflect' } })).toMatch(
      /“no_injection” catches what the caller says \(declined/,
    );
    expect(describeExpectation({ guardrail_not_triggered: 'no_cards' })).toBe('the safety rule “no_cards” does not match');
    expect(describeExpectation({ limit_reached: 'max_handoffs_per_call' })).toMatch(/too many hand-overs/);
  });

  it('they are valid when they name something real, and say what is wrong when they do not', () => {
    const ok = [
      { task_outcome: { task: 'verify', outcome: 'identity_checked' } },
      { guardrail_triggered: { rule: 'no_cards', action: 'redact_in_logs' } },
      { guardrail_not_triggered: 'no_injection' },
      { limit_reached: 'max_silence_s' },
    ];
    expect(scenarioProblems(onPhone([{ say: 'hi' }], ok), phone())).toEqual({});
    const bad = scenarioProblems(
      onPhone(
        [{ say: 'hi' }],
        [
          { task_outcome: { task: 'nope' } },
          { guardrail_triggered: { rule: 'nope' } },
          { guardrail_triggered: { rule: 'no_cards', action: 'explode' } },
          { guardrail_not_triggered: 'nope' },
          { limit_reached: 'max_nothing' },
        ],
      ),
      phone(),
    );
    expect(bad.expect).toHaveLength(5);
    expect(bad.expect?.[0]).toMatch(/there is no task “nope”/);
    expect(bad.expect?.[1]).toMatch(/there is no check on what the caller says called “nope”/);
    expect(bad.expect?.[2]).toMatch(/not something a safety rule does/);
    expect(bad.expect?.[3]).toMatch(/called “nope”/);
    expect(bad.expect?.[4]).toMatch(/choose which limit/);
  });

  it('a task offers verified, failed, declined and the names its own endings give', () => {
    expect(outcomeNamesOf(phone(), 'verify')).toEqual(['verified', 'failed', 'declined', 'identity_checked']);
    expect(outcomeNamesOf(phone(), 'activate')).toEqual(['verified', 'failed', 'declined']);
    expect(outcomeNamesOf(phone(), 'missing')).toEqual(['verified', 'failed', 'declined']);
  });
});

describe('mocks, conversations and pasted scenarios', () => {
  it('an unanswered request becomes a starting mock in the scenario, never twice', () => {
    const mock = stubMock({ method: 'get', path: '/orders/NB-1', connection: 'api', query: { a: '1' } });
    expect(mock).toEqual({ path: '/orders/NB-1', status: 200, json: {}, method: 'GET', connection: 'api', query: { a: '1' } });
    const scenario = { id: 's', http_mocks: [] };
    const once = addMockTo(scenario, { method: 'GET', path: '/x' });
    expect(once.http_mocks).toHaveLength(1);
    expect(addMockTo(once, { method: 'GET', path: '/x' })).toBe(once);
    expect(scenario.http_mocks).toHaveLength(0);
  });

  it('a finished test conversation becomes a starting scenario made only of what it showed', () => {
    const config = nimbus();
    const made = scenarioFromConversation(config, {
      channel: 'web-chat',
      messages: [
        { from: 'agent', text: 'Hi' },
        { from: 'user', text: 'Where is NB-1003?' },
        { from: 'agent', text: 'Shipped' },
        { role: 'user', text: ' Thanks ' },
      ],
      tools: ['find_order', 'find_order', 'end_call'],
      finalState: { verified: true, ticket_id: null, ghost: 1 },
    });
    expect(made.turns).toEqual([{ say: 'Where is NB-1003?' }, { say: 'Thanks' }]);
    expect(made.expect).toEqual([{ tool_called: 'find_order' }, { tool_called: 'end_call' }, { state_equals: { state: 'verified', value: true } }]);
    expect(scenarioProblems(made, config)).toEqual({});
    expect(made.channel).toBe('web-chat');
    expect(scenarioProblems(scenarioFromConversation(config, { messages: [] }), config)).toEqual({});
  });

  it('pasted scenarios are checked, clashing ids renamed, and bad ones reported', () => {
    const config = { ...support(), tests: [{ id: 'one', channel: 'web-chat', turns: [{ say: 'x' }], expect: [{ said_matches: '.' }] }] };
    const text = JSON.stringify([
      { id: 'one', channel: 'web-chat', turns: [{ say: 'a' }], expect: [{ said_matches: 'a' }] },
      { id: 'broken', channel: 'nope', turns: [], expect: [] },
      'x',
    ]);
    const { scenarios, problems } = parseImport(text, config);
    expect(scenarios.map((s) => s.id)).toEqual(['one_2']);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/broken: .*no channel “nope”/);
    const again = parseImport(text, { ...config, tests: [...config.tests, ...scenarios] });
    expect((parseImport(text, config).rejected ?? []).map((r) => (r as { id?: string })?.id ?? r)).toEqual(['broken', 'x']);
    expect(parseImport(JSON.stringify(config.tests), config)).toEqual({ scenarios: [], problems: [], rejected: [], already: ['one'] });
    expect([again.scenarios.length, again.already]).toEqual([0, ['one']]);
    expect(parseImport('not json', config).problems[0]).toMatch(/isn’t valid JSON/);
    expect(parseImport(JSON.stringify({ tests: [newScenario(support(), 'fresh')] }), support()).scenarios).toHaveLength(1);
    expect(parseImport('42', config).problems[0]).toMatch(/Paste a list/);
    const rich = {
      id: 'rich',
      channel: 'web-chat',
      now: '2026-10-14T03:00Z',
      http_mocks: [{ path: '/x' }],
      turns: [{ say: 'a' }],
      expect: [{ http_called: { path: '/x' } }],
    };
    expect(parseImport(JSON.stringify([rich]), support()).scenarios[0]).toEqual(rich);
  });
});
