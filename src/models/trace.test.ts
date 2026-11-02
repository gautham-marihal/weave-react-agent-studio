import { describe, expect, it } from 'vitest';
import {
  conversationOf,
  describeRecord,
  describeRecords,
  filterRows,
  finalStateOf,
  fixMojibake,
  formatElapsed,
  groupCounts,
  groupOf,
  rowFromTraceEvent,
  rowsAsText,
  rowsFromTraceEvents,
  summarizeRows,
  traceAsText,
  traceSummary,
  toolsUsedIn,
  withoutCallerWords,
} from './trace';

// the records of a real call (GET /bots/support-agent/calls/{id}), including the log's broken encoding
const REAL = [
  {
    t: '2026-10-14T04:02:33.987Z',
    seq: 1,
    elapsed_s: 0.052,
    event: 'call_started',
    bot: 'support-agent',
    ref: 'latest',
    version: '0.1.0',
    room: 'session-support-agent-406f2cbe',
    channel: { id: 'web-chat', type: 'web_chat' },
    caller: null,
    dialled: null,
    participant: { identity: 'Ashwin-wcj7', kind: 'standard' },
    attributes: {},
    not_supported_yet: [],
  },
  { t: '2026-10-14T04:02:34.010Z', seq: 2, elapsed_s: 0.075, event: 'agent_entered', agent: 'assistant', first: true },
  { t: '2026-10-14T04:02:34.147Z', seq: 3, elapsed_s: 0.212, event: 'agent_said', text: 'Hi, Iâ€™m Support Agent. How can I help you today?', interrupted: false },
  { t: '2026-10-14T04:02:45.887Z', seq: 4, elapsed_s: 11.952, event: 'model_request', agent: 'assistant', model: 'gpt-4.1-mini', messages: 3, tools: ['end_call'] },
  { t: '2026-10-14T04:02:45.902Z', seq: 5, elapsed_s: 11.967, event: 'user_said', text: 'What can you do?' },
  { t: '2026-10-14T04:02:48.285Z', seq: 6, elapsed_s: 14.35, event: 'agent_said', text: 'Iâ€™m here to help.', interrupted: false, timing: { llm_node_ttft: 2.106 } },
  { t: '2026-10-14T04:03:03.938Z', seq: 10, elapsed_s: 30.003, event: 'session_closed', reason: 'participant_disconnected', error: null },
  {
    t: '2026-10-14T04:03:04.032Z',
    seq: 11,
    elapsed_s: 30.097,
    event: 'call_ended',
    duration_s: 30,
    caller_turns: 2,
    agent_turns: 3,
    handoffs: 0,
    usage: [{ type: 'llm_usage', provider: 'api.openai.com', model: 'gpt-4.1-mini', input_tokens: 406, output_tokens: 66 }],
    state: { verified: true },
  },
];

describe('fixMojibake', () => {
  it('puts right the log’s wrongly encoded text, and never touches right text', () => {
    expect(fixMojibake('Hi, Iâ€™m Support Agent.')).toBe('Hi, I’m Support Agent.');
    expect(fixMojibake('â€œquotedâ€\u009d')).toBe('“quoted”');
    expect(fixMojibake('cafÃ©')).toBe('café');
    expect(fixMojibake('Hi, I’m fine, café, “quoted”, 日本語 😀')).toBe('Hi, I’m fine, café, “quoted”, 日本語 😀');
    expect(fixMojibake('plain ascii')).toBe('plain ascii');
    expect(fixMojibake('â alone is fine')).toBe('â alone is fine');
    expect(fixMojibake(undefined)).toBe(undefined);
    expect(fixMojibake(42)).toBe(42);
  });
});

describe('describeRecord', () => {
  it('gives every record the runtime writes today a readable row, with the fields that matter', () => {
    const rows = describeRecords(REAL);
    expect(rows.map((r) => r.label)).toEqual(['Call', 'Agent', 'Agent', 'Model', 'Caller', 'Agent', 'Call', 'Call']);
    expect(rows[2].text).toBe('Hi, I’m Support Agent. How can I help you today?');
    expect(rows[2].tone).toBe('agent');
    expect(rows[4].tone).toBe('caller');
    expect(rows[5].facts).toEqual([['llm node ttft', '2106 ms']]);
    expect(rows[0].text).toBe('Started on web chat');
    expect(rows[1].text).toMatch(/assistant answers first/);
    expect(rows[3].text).toMatch(/gpt-4\.1-mini was asked as assistant/);
    expect(rows[3].facts).toEqual([
      ['messages', '3'],
      ['tools offered', 'end_call'],
    ]);
    expect(rows[6].text).toMatch(/Closed: participant disconnected/);
    expect(rows[7].text).toMatch(/Ended after 30 s/);
    expect(rows[7].facts).toEqual([
      ['caller turns', '2'],
      ['agent turns', '3'],
    ]);
    expect(rows[0].at).toBe('0:00.0');
    expect(rows[5].at).toBe('0:14.3');
    expect(rows.every((r) => !r.problem)).toBe(true);
  });

  it('shows tool calls, API requests, knowledge searches, state changes and errors, and marks what went wrong', () => {
    const ok = describeRecord({ seq: 1, elapsed_s: 5, event: 'tool_called', tool: 'find_order', args: { order_id: 'NB-1' }, result: { found: true }, duration_ms: 12 });
    expect(ok.text).toBe('find_order({"order_id":"NB-1"})');
    expect(ok.facts).toEqual([['returned', '{"found":true}']]);
    expect(ok.ms).toBe(12);
    expect(ok.problem).toBe(false);
    const failed = describeRecord({ seq: 2, event: 'tool_called', tool: 'find_order', args: {}, error: 'HTTP 503' });
    expect(failed.problem).toBe(true);
    expect(failed.tone).toBe('bad');
    expect(failed.facts).toEqual([['failed', 'HTTP 503']]);
    const http = describeRecord({ seq: 3, event: 'http_request', method: 'GET', path: '/orders/NB-1', status: 200, ms: 80 });
    expect(http.text).toBe('GET /orders/NB-1');
    expect(http.facts).toEqual([['status', '200']]);
    expect(http.ms).toBe(80);
    expect(describeRecord({ seq: 4, event: 'http_request', method: 'POST', path: '/tickets', status: 404, mocked: false }).problem).toBe(true);
    expect(describeRecord({ seq: 5, event: 'http_request', method: 'GET', path: '/x', status: 200, mocked: true }).facts).toEqual([
      ['status', '200'],
      ['answered by', 'a mock'],
    ]);
    const search = describeRecord({
      seq: 6,
      event: 'knowledge_search',
      base: 'faq',
      query: 'refund policy',
      hits: [
        { score: 0.71, source: 'policy.md' },
        { score: 0.4, source: 'faq.md' },
      ],
      ms: 35,
    });
    expect(search.text).toMatch(/“refund policy” in faq/);
    expect(search.facts[0]).toEqual(['found', '2 passages']);
    expect(search.facts[1]).toEqual(['score 0.71', 'policy.md']);
    const state = describeRecord({ seq: 7, event: 'state_changed', name: 'verified', value: true, old: false });
    expect(state.text).toBe('verified → true');
    expect(state.facts).toEqual([['was', 'false']]);
    const error = describeRecord({ seq: 8, event: 'error', message: 'the model timed out', where: 'llm' });
    expect(error.problem).toBe(true);
    expect(error.text).toBe('the model timed out');
    const closed = describeRecord({ seq: 9, event: 'session_closed', reason: 'error', error: 'boom' });
    expect(closed.problem).toBe(true);
    expect(closed.facts).toEqual([['error', 'boom']]);
  });

  it('still gives a record it doesn’t know a row (its name and fields), never dropping it', () => {
    const row = describeRecord({ seq: 3, elapsed_s: 2, event: 'sentiment_scored', score: 0.9, label: 'calm' });
    expect(row.label).toBe('Sentiment scored');
    expect(row.group).toBe('other');
    expect(row.facts).toEqual([
      ['score', '0.9'],
      ['label', 'calm'],
    ]);
    expect(describeRecord(null).label).toBe('Event');
    expect(groupOf('tool_called')).toBe('tools');
  });

  it('tells a task, a safety rule and a call limit in plain words', () => {
    const task = describeRecord({ event: 'task_started', seq: 1, task: 'verify' });
    expect(task.text).toBe('Started “verify”');
    expect(task.group).toBe('tasks');
    const step = describeRecord({ event: 'task_step', seq: 2, task: 'verify', step: 'ask_dob', passed: false, attempt: 2 });
    expect(step.tone).toBe('bad');
    expect(step.facts).toEqual([
      ['answer', 'not accepted'],
      ['attempt', '2'],
    ]);
    expect(describeRecord({ event: 'task_finished', task: 'verify', outcome: 'verified' }).tone).toBe('good');
    expect(describeRecord({ event: 'task_finished', task: 'verify', outcome: 'failed' }).text).toBe('Finished “verify” as failed');
    expect(describeRecord({ event: 'task_skipped', task: 'verify' }).text).toMatch(/already satisfied/);
    const rule = describeRecord({ event: 'guardrail_triggered', rule: 'no_injection', action: 'redact_in_logs' });
    expect(rule.text).toBe('“no_injection” caught what the caller said');
    expect(rule.group).toBe('safety');
    expect(rule.facts).toEqual([['it', 'redact in logs']]);
    const limit = describeRecord({ event: 'limit_reached', limit: 'max_tool_calls_per_call', value: 5 });
    expect(limit.problem).toBe(true);
    expect(limit.text).toBe('A call limit ended the call: max tool calls per call');
    expect(describeRecord({ event: 'something_new', x: 1 }).label).toBe('Something new');
  });
});

describe('the trace view’s helpers', () => {
  it('counts by kind for the filter chips, narrows the list, and always keeps records of an unknown kind', () => {
    const records = [
      ...REAL,
      { seq: 12, event: 'tool_called', tool: 't', args: {} },
      { seq: 13, event: 'http_request', method: 'GET', path: '/x', status: 500 },
      { seq: 14, event: 'sentiment_scored' },
    ];
    const rows = describeRecords(records);
    const counts = groupCounts(rows);
    expect(counts.conversation).toBe(3);
    expect(counts.tools).toBe(1);
    expect(counts.api).toBe(1);
    expect(counts.lifecycle).toBe(4);
    expect(counts.other).toBe(1);
    expect(filterRows(rows, []).length).toBe(rows.length);
    expect(filterRows(rows, ['tools']).map((r) => r.kind)).toEqual(['tool_called', 'sentiment_scored']);
    expect(filterRows(rows, ['conversation', 'api']).filter((r) => r.group !== 'other').length).toBe(4);
  });

  it('tells at a glance: messages, tools, requests, problems, seconds; reads as plain text; lifts the conversation out', () => {
    const records = [...REAL, { seq: 12, elapsed_s: 31, event: 'tool_called', tool: 'find_order', args: {}, error: 'HTTP 503' }];
    const summary = traceSummary(records);
    expect([summary.said, summary.tools, summary.requests, summary.errors]).toEqual([3, 1, 0, 1]);
    expect(summary.seconds).toBe(31);
    const text = traceAsText(REAL.slice(0, 3));
    expect(text).toMatch(/^ 0:00\.0 {2}Call/);
    expect(text.split('\n')[2]).toMatch(/Agent {5}Hi, I’m Support Agent/);
    expect(conversationOf(REAL).map((m) => m.role)).toEqual(['agent', 'caller', 'agent']);
    expect(conversationOf(REAL)[1]).toMatchObject({ text: 'What can you do?', atS: 11.967, seq: 5 });
    expect(formatElapsed(75.26)).toBe('1:15.2');
    expect(formatElapsed(undefined)).toBe('');
  });

  it('reads the final state and the tools a conversation used', () => {
    expect(finalStateOf(REAL)).toEqual({ verified: true });
    expect(
      finalStateOf([
        { event: 'state_changed', name: 'a', value: 1 },
        { event: 'state_changed', name: 'a', value: 2 },
        { event: 'state_changed', variable: 'b', value: true },
      ])
    ).toEqual({ a: 2, b: true });
    expect(finalStateOf([])).toEqual({});
    expect(toolsUsedIn([{ event: 'tool_called', tool: 'a' }, { event: 'tool_called', tool: 'b' }, { event: 'tool_called', tool: 'a' }, { event: 'agent_said' }])).toEqual(['a', 'b']);
  });
});

describe('the Test stage’s trace as rows of the same view', () => {
  it('reads a streamed record like a call’s, at the time the conversation saw it', () => {
    const row = rowFromTraceEvent({ id: 't_1', at_ms: 4200, kind: 'tool', label: 'find_order', status: 'error', raw: { seq: 9, event: 'tool_called', tool: 'find_order', args: {}, error: 'HTTP 503' } });
    expect(row).toMatchObject({ id: 't_1', at: '0:04.2', label: 'Tool', group: 'tools', problem: true });
  });

  it('keeps the banking gateway’s timeline in the trace, under its own filter', () => {
    const row = rowFromTraceEvent({ id: 'gw_3', at_ms: 1000, kind: 'tool', label: 'Gateway · get_balance', detail: 'ok · 12 ms', status: 'ok' });
    expect(row).toMatchObject({ group: 'gateway', label: 'Gateway', text: 'get_balance', tone: 'good', facts: [['', 'ok · 12 ms']] });
    expect(rowFromTraceEvent({ id: 'gw_note_1', at_ms: 0, kind: 'session', label: 'Gateway · no session for this conversation', status: 'error' })).toMatchObject({
      group: 'gateway',
      problem: true,
    });
  });

  it('shows the test conversation’s own notes, with what went wrong marked', () => {
    const rows = rowsFromTraceEvents([
      { id: 't_1', at_ms: 0, kind: 'session', label: 'Session created', detail: 'Room r1', status: 'ok' },
      { id: 't_2', at_ms: 1500, kind: 'session', label: 'Microphone unavailable', status: 'error' },
    ]);
    expect(rows.map((r) => [r.group, r.label, r.problem])).toEqual([
      ['session', 'Test', false],
      ['errors', 'Test', true],
    ]);
    expect(summarizeRows(rows).errors).toBe(1);
    expect(rowsAsText(rows).split('\n')[0]).toBe(' 0:00.0  Test      Session created  [Room r1]');
  });
});

describe('withoutCallerWords', () => {
  it('hides what callers said, in the text and the raw fields, and leaves the rest', () => {
    const rows = withoutCallerWords(describeRecords(REAL));
    expect(rows[4].text).toBe('Caller spoke (4 words)');
    expect((rows[4].raw as Record<string, unknown>).text).toBe('(hidden)');
    expect(rows[2].text).toMatch(/Support Agent/);
    const withNumber = withoutCallerWords(describeRecords([{ seq: 1, event: 'call_started', caller: '+6581234471' }]))[0];
    expect(withNumber.facts).toEqual([]);
    expect(JSON.stringify(withNumber.raw)).not.toMatch(/4471/);
  });
});
