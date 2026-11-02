import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../types/studio';
import { readCall, readTranscript, type CallFacts } from './replayFacts';
import { compareReplay, similarity } from './replayCompare';
import { configWithScenario, factsFromResult, replayResultOf, scenarioForReplay } from './replayRun';
import { addScenario, buildScenario, hasPersonalData, redact, suggestChecks, suggestTest, testProblems } from './replayTest';

const config: AgentConfig = {
  meta: { id: 'shop', name: 'Shop', version: '0.1.0' },
  channels: [{ id: 'web-chat', type: 'web_chat', enabled: true, greeting: { say: 'Hello, welcome to the shop.' } }],
  agents: {
    entry: 'assistant',
    items: [
      { id: 'assistant', name: 'Assistant', tools: ['lookup_order', 'end'], handoffs: [{ tool: 'to_billing', to: 'billing' }] },
      { id: 'billing', name: 'Billing', tools: [] },
    ],
  },
  tools: [
    { id: 'lookup_order', type: 'http', description: 'Look up an order by its number' },
    { id: 'end', type: 'builtin', builtin: 'end_call' },
  ],
  state: { variables: { order_status: { type: 'string', default: null } } },
};

interface Message {
  role: 'user' | 'assistant';
  text: string;
  tools?: { tool: string; args?: Record<string, unknown>; output?: unknown; error?: string; handoff?: string }[];
}

// A call's records as the runtime writes them: call_started, agent_entered, user_said / tool_called / agent_said, call_ended.
function call(messages: Message[], { state = {}, ended = true }: { state?: Record<string, unknown>; ended?: boolean } = {}) {
  const events: Record<string, unknown>[] = [];
  let seq = 0;
  let elapsed = 0;
  const add = (event: string, fields: Record<string, unknown> = {}, gap = 0.1) => {
    seq += 1;
    elapsed += gap;
    events.push({ seq, elapsed_s: Math.round(elapsed * 1000) / 1000, event, ...fields });
  };
  add('call_started', { channel: { id: 'web-chat', type: 'web_chat' } });
  add('agent_entered', { agent: 'assistant', first: true });
  messages.forEach((m) => {
    if (m.role === 'user') add('user_said', { text: m.text }, 4);
    else {
      (m.tools ?? []).forEach((t) => {
        add('tool_called', { tool: t.tool, args: t.args ?? {}, ...(t.error ? { error: t.error } : { result: t.output ?? null }) }, 0.3);
        if (t.handoff) add('agent_entered', { agent: t.handoff, first: false }, 0.05);
      });
      add('agent_said', { text: m.text }, 2);
    }
  });
  if (ended) add('call_ended', { state }, 0.1);
  return events;
}
const copy = (f: CallFacts): CallFacts => JSON.parse(JSON.stringify(f));

describe('reading a call', () => {
  it('reads an opening, turns, tools, hand-overs and an end', () => {
    const f = readCall(
      call(
        [
          { role: 'assistant', text: 'Hello, welcome to the shop.' },
          { role: 'user', text: 'Where is my order' },
          { role: 'assistant', text: 'Let me look.', tools: [{ tool: 'lookup_order', args: { n: '1' }, output: { status: 'shipped' } }] },
          { role: 'user', text: 'I have a billing question' },
          { role: 'assistant', text: 'Passing you to billing.', tools: [{ tool: 'to_billing', handoff: 'billing' }] },
        ],
        { state: { order_status: 'shipped' } },
      ),
    );
    expect(f.opening).toEqual(['Hello, welcome to the shop.']);
    expect(f.turns.map((t) => t.say)).toEqual(['Where is my order', 'I have a billing question']);
    expect(f.turns[0].tools[0].tool).toBe('lookup_order');
    expect(f.turns[1].tools[0].handoff).toBe('billing');
    expect([f.handoffs, f.finalAgent, f.finalState.order_status, f.ended, f.channelId]).toEqual([1, 'billing', 'shipped', true, 'web-chat']);
    expect(f.turns[0].waitMs).toBeGreaterThan(0);
  });

  it('notes a failing tool as a problem of the call', () => {
    const f = readCall(call([{ role: 'user', text: 'order 5' }, { role: 'assistant', text: 'Sorry.', tools: [{ tool: 'lookup_order', error: 'HTTP 500' }] }]));
    expect(f.errors).toHaveLength(1);
    expect(f.errors[0]).toMatch(/lookup_order/);
  });

  it('reads a transcript with no records to the same kind of facts', () => {
    const f = readTranscript({
      transcript: [
        { role: 'assistant', text: 'Hi' },
        { role: 'user', text: 'hello' },
        { role: 'assistant', text: 'How can I help?' },
      ],
      tools: [{ tool: 'lookup_order' }],
      finalAgent: 'assistant',
    });
    expect(f.opening).toEqual(['Hi']);
    expect(f.turns[0].said[0]).toBe('How can I help?');
    expect(f.turns[0].tools[0].tool).toBe('lookup_order');
  });
});

describe('comparing a call and its replay', () => {
  it('similarity: the same words are 1, nothing in common is 0, partial is between', () => {
    expect(similarity('Hello there', 'hello, there!')).toBe(1);
    expect(similarity('apples', 'oranges')).toBe(0);
    const s = similarity('please wait while I check your order', 'please wait while I look at your order');
    expect(s > 0.5 && s < 1).toBe(true);
    expect(similarity('', '')).toBe(1);
  });

  it('an unchanged agent compares as the same', () => {
    const original = readCall(call([{ role: 'assistant', text: 'Hello, welcome to the shop.' }, { role: 'user', text: 'Where is my order' }, { role: 'assistant', text: 'ok', tools: [{ tool: 'lookup_order' }] }]));
    const cmp = compareReplay(original, copy(original));
    expect([cmp.verdict, cmp.lines, cmp.changed]).toEqual(['same', [], 0]);
  });

  it('a dropped tool, a changed hand-over and a changed end are each said in words', () => {
    const original = readCall(
      call(
        [
          { role: 'user', text: 'Where is my order' },
          { role: 'assistant', text: 'Looking.', tools: [{ tool: 'lookup_order' }] },
          { role: 'user', text: 'billing' },
          { role: 'assistant', text: 'To billing.', tools: [{ tool: 'to_billing', handoff: 'billing' }] },
        ],
        { state: { order_status: 'shipped' } },
      ),
    );
    const replay = copy(original);
    replay.turns[0].tools = [];
    replay.turns[1].tools = [];
    replay.finalAgent = 'assistant';
    replay.finalState = {};
    replay.ended = false;
    const cmp = compareReplay(original, replay);
    expect(cmp.verdict).toBe('different');
    const text = cmp.lines.join(' ');
    expect(text).toMatch(/no longer calls “lookup_order”/);
    expect(text).toMatch(/no longer hands over/);
    expect(text).toMatch(/ends with “assistant” in charge, not “billing”/);
    expect(text).toMatch(/Memory at the end differs/);
    expect(cmp.turns[0].changed && cmp.turns[1].changed).toBe(true);
  });

  it('turns after the replay ended are not reached, and said', () => {
    const original = readCall(call([{ role: 'user', text: 'bye' }, { role: 'assistant', text: 'x' }, { role: 'user', text: 'one more thing' }, { role: 'assistant', text: 'y' }]));
    const replay = copy(original);
    replay.turns = replay.turns.slice(0, 1);
    const cmp = compareReplay(original, replay);
    expect(cmp.notReached).toBe(1);
    expect(cmp.lines.some((l) => /not reached/.test(l))).toBe(true);
  });
});

describe('a replay on the runner', () => {
  it('builds a scenario that never clashes with a saved test, and leaves the draft as it was', () => {
    const original = readCall(call([{ role: 'user', text: 'hello' }, { role: 'assistant', text: 'hi' }]));
    const withTests: AgentConfig = { ...config, tests: [{ id: 'replay', channel: 'web-chat', turns: [{ say: 'x' }], expect: [{ said_matches: '.' }] }] };
    const s = scenarioForReplay(withTests, original);
    expect(s.id).not.toBe('replay');
    expect([s.channel, s.turns]).toEqual(['web-chat', [{ say: 'hello' }]]);
    expect(configWithScenario(withTests, s).tests).toHaveLength(2);
    expect(withTests.tests).toHaveLength(1);
  });

  it('reads a runner result into facts, from its records when it has them', () => {
    const events = call([{ role: 'assistant', text: 'Hi' }, { role: 'user', text: 'hello' }, { role: 'assistant', text: 'Hey', tools: [{ tool: 'lookup_order' }] }]);
    expect(factsFromResult({ id: 'r', status: 'passed', events, final_agent: 'assistant', final_state: {} })?.turns[0].tools[0].tool).toBe('lookup_order');
    const g = factsFromResult({ id: 'r', status: 'passed', transcript: [{ role: 'user', text: 'hello' }, { role: 'assistant', text: 'Hey' }], final_agent: 'billing' });
    expect([g?.finalAgent, g?.turns[0].said[0]]).toEqual(['billing', 'Hey']);
    expect(factsFromResult(null)).toBeNull();
  });

  it('finds the replay’s result in a finished run, or says why there is none', () => {
    expect(replayResultOf({ status: 'running', scenarios: [] }, 'replay')).toEqual({ result: null, problem: '' });
    expect(replayResultOf({ status: 'passed', scenarios: [{ id: 'replay', status: 'passed' }] }, 'replay').result?.id).toBe('replay');
    expect(replayResultOf({ status: 'error', scenarios: [{ id: 'replay', status: 'error', detail: 'No model key.' }] }, 'replay').problem).toBe('No model key.');
    expect(replayResultOf({ status: 'passed', scenarios: [] }, 'replay').problem).toMatch(/without playing/);
  });
});

describe('keeping a call as a test', () => {
  const facts = () =>
    readCall(
      call(
        [
          { role: 'assistant', text: 'Hello, welcome to the shop.' },
          { role: 'user', text: 'Where is order 77?' },
          { role: 'assistant', text: 'Your order has shipped and is on its way.', tools: [{ tool: 'lookup_order', args: { n: '77' }, output: {} }] },
          { role: 'user', text: 'I need billing help, call +65 9123 4567' },
          { role: 'assistant', text: 'Passing you to billing now.', tools: [{ tool: 'to_billing', handoff: 'billing' }] },
        ],
        { state: { order_status: 'shipped' } },
      ),
    );

  it('hides numbers and addresses and leaves other words alone', () => {
    expect(redact('call me on +65 9123 4567 or mail jo@example.com')).toBe('call me on [number] or mail [email]');
    expect(redact('I want 2 apples')).toBe('I want 2 apples');
    expect(redact('on 2026-10-10 at 10:30')).toBe('on 2026-10-10 at 10:30');
    expect([hasPersonalData('my order is 12345678'), hasPersonalData('hello')]).toEqual([true, false]);
  });

  it('suggests a test from what the agent did, with the plain facts ticked', () => {
    const s = suggestTest(facts(), config, { callId: 'r1_2026', startedAt: '2026-10-10T10:00:00.000Z' });
    expect(s.channel).toBe('web-chat');
    expect(s.id).toMatch(/^[a-z][a-z0-9_-]*$/);
    expect(s.turns).toHaveLength(2);
    expect(s.turns[1]).toMatch(/\[number\]/);
    expect(s.warnings.some((w) => /number or an address/.test(w))).toBe(true);
    const ids = s.checks.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['tool:lookup_order', 'agent', 'state:order_status', 'said']));
    expect(s.checks.find((c) => c.id === 'tool:lookup_order')?.checked).toBe(true);
    expect(s.checks.find((c) => c.id === 'said')?.checked).toBe(false);
  });

  it('offers a tool that failed unticked, with why', () => {
    const f = readCall(call([{ role: 'user', text: 'order 5' }, { role: 'assistant', text: 'Sorry.', tools: [{ tool: 'lookup_order', error: 'HTTP 500' }] }]));
    const c = suggestChecks(f, config).find((x) => x.id === 'failed:lookup_order');
    expect(c?.checked).toBe(false);
    expect(c?.why).toMatch(/HTTP 500/);
  });

  it('replaces a channel the draft no longer has, and says so', () => {
    const s = suggestTest({ ...facts(), channelId: 'old-channel' }, config);
    expect(s.channel).toBe('web-chat');
    expect(s.warnings.some((w) => /old-channel/.test(w))).toBe(true);
  });

  it('builds the scenario from the ticked checks, what should have happened, and tools that must not run', () => {
    const s = suggestTest(facts(), config);
    const built = buildScenario({ ...s, expectedText: 'The agent offers a refund', toolsNeverCalled: ['end'] });
    expect(built.turns.map((t) => Object.keys(t))).toEqual([['say'], ['say']]);
    expect(built.expect).toEqual(expect.arrayContaining([{ tool_called: 'lookup_order' }, { judge: 'The agent offers a refund' }, { tool_not_called: 'end' }]));
    expect(built.expect.some((e) => 'said_matches' in e)).toBe(false);
  });

  it('says what is wrong with a test, and a good one has no problems', () => {
    const s = suggestTest(facts(), config);
    expect(testProblems(s, config)).toEqual([]);
    expect(testProblems({ ...s, id: 'Bad Id' }, config)[0]).toMatch(/must start with a letter/);
    expect(testProblems({ ...s, turns: ['  '] }, config).some((p) => /at least one thing/.test(p))).toBe(true);
    expect(testProblems({ ...s, checks: s.checks.map((c) => ({ ...c, checked: false })) }, config).some((p) => /at least one check/.test(p))).toBe(true);
    expect(testProblems(s, addScenario(config, buildScenario(s))).some((p) => /already has a test/.test(p))).toBe(true);
  });

  it('adding a test leaves the rest of the draft as it was', () => {
    const next = addScenario(config, buildScenario(suggestTest(facts(), config)));
    expect([next.tests.length, next.meta?.name, config.tests]).toEqual([1, 'Shop', undefined]);
  });

  it('a call with no caller words warns and cannot be kept', () => {
    const s = suggestTest(readCall(call([{ role: 'assistant', text: 'Hello' }])), config);
    expect(s.warnings.some((w) => /nothing to replay/.test(w))).toBe(true);
    expect(testProblems(s, config).some((p) => /at least one thing/.test(p))).toBe(true);
  });
});
