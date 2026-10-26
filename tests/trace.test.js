import test from 'node:test';
import assert from 'node:assert/strict';
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
  traceAsText,
  traceSummary,
  toolsUsedIn,
} from '../src/studio/trace/records.js';
import {
  CALL_STATUS,
  channelLabel,
  channelsIn,
  formatSeconds,
  mergeCalls,
  ndjson,
  queryFor,
  rowOf,
  sinceFor,
  statusOf,
} from '../src/studio/calls/callModel.js';
import { createDemoApi, memoryStorage } from '../src/demo/demoApi.js';
import { followCallOf } from '../src/demo/demoCalls.js';

// the records of a real call (copied from the running API: GET /bots/support-agent/calls/{id}), including its mojibake
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
  {
    t: '2026-10-14T04:02:34.147Z',
    seq: 3,
    elapsed_s: 0.212,
    event: 'agent_said',
    text: 'Hi, Iâ€™m Support Agent. How can I help you today?',
    interrupted: false,
  },
  {
    t: '2026-10-14T04:02:45.887Z',
    seq: 4,
    elapsed_s: 11.952,
    event: 'model_request',
    agent: 'assistant',
    model: 'gpt-4.1-mini',
    messages: 3,
    tools: ['end_call'],
  },
  { t: '2026-10-14T04:02:45.902Z', seq: 5, elapsed_s: 11.967, event: 'user_said', text: 'What can you do?' },
  {
    t: '2026-10-14T04:02:48.285Z',
    seq: 6,
    elapsed_s: 14.35,
    event: 'agent_said',
    text: 'Iâ€™m here to help.',
    interrupted: false,
    timing: { llm_node_ttft: 2.106 },
  },
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

test('the log’s text, which the API writes with the wrong encoding, is put right, and right text is never touched', () => {
  assert.equal(fixMojibake('Hi, Iâ€™m Support Agent.'), 'Hi, I’m Support Agent.');
  assert.equal(fixMojibake('â€œquotedâ€\u009d'), '“quoted”');
  assert.equal(fixMojibake('cafÃ©'), 'café');
  assert.equal(fixMojibake('Hi, I’m fine, café, “quoted”, 日本語 😀'), 'Hi, I’m fine, café, “quoted”, 日本語 😀');
  assert.equal(fixMojibake('plain ascii'), 'plain ascii');
  assert.equal(fixMojibake('â alone is fine'), 'â alone is fine', 'a lone accented letter is not damage');
  assert.equal(fixMojibake(undefined), undefined);
  assert.equal(fixMojibake(42), 42);
});

test('every record the runtime writes today gets a readable row, with the fields that matter', () => {
  const rows = describeRecords(REAL);
  assert.deepEqual(
    rows.map((r) => r.label),
    ['Call', 'Agent', 'Agent', 'Model', 'Caller', 'Agent', 'Call', 'Call'],
  );
  assert.equal(rows[2].text, 'Hi, I’m Support Agent. How can I help you today?', 'the text is repaired');
  assert.equal(rows[2].tone, 'agent');
  assert.equal(rows[4].tone, 'caller');
  assert.deepEqual(rows[5].facts, [['llm node ttft', '2106 ms']]);
  assert.equal(rows[0].text, 'Started on web chat', 'the channel in words, not its type');
  assert.match(rows[1].text, /assistant answers first/);
  assert.match(rows[3].text, /gpt-4\.1-mini was asked as assistant/);
  assert.deepEqual(rows[3].facts, [
    ['messages', '3'],
    ['tools offered', 'end_call'],
  ]);
  assert.match(rows[6].text, /Closed: participant disconnected/);
  assert.match(rows[7].text, /Ended after 30 s/);
  assert.deepEqual(rows[7].facts, [
    ['caller turns', '2'],
    ['agent turns', '3'],
  ]);
  assert.equal(rows[0].at, '0:00.0');
  assert.equal(rows[5].at, '0:14.3');
  assert.ok(rows.every((r) => !r.problem));
});

test('tool calls, API requests, knowledge searches, state changes and errors are shown, and what went wrong is marked', () => {
  const ok = describeRecord({
    seq: 1,
    elapsed_s: 5,
    event: 'tool_called',
    tool: 'find_order',
    args: { order_id: 'NB-1' },
    result: { found: true },
    duration_ms: 12,
  });
  assert.equal(ok.text, 'find_order({"order_id":"NB-1"})');
  assert.deepEqual(ok.facts, [['returned', '{"found":true}']]);
  assert.equal(ok.ms, 12);
  assert.equal(ok.problem, false);
  const failed = describeRecord({ seq: 2, event: 'tool_called', tool: 'find_order', args: {}, error: 'HTTP 503' });
  assert.equal(failed.problem, true);
  assert.equal(failed.tone, 'bad');
  assert.deepEqual(failed.facts, [['failed', 'HTTP 503']]);
  const http = describeRecord({ seq: 3, event: 'http_request', method: 'GET', path: '/orders/NB-1', status: 200, ms: 80 });
  assert.equal(http.text, 'GET /orders/NB-1');
  assert.deepEqual(http.facts, [['status', '200']]);
  assert.equal(http.ms, 80);
  const bad = describeRecord({ seq: 4, event: 'http_request', method: 'POST', path: '/tickets', status: 404, mocked: false });
  assert.equal(bad.problem, true);
  const mocked = describeRecord({ seq: 5, event: 'http_request', method: 'GET', path: '/x', status: 200, mocked: true });
  assert.deepEqual(mocked.facts, [
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
  assert.match(search.text, /“refund policy” in faq/);
  assert.deepEqual(search.facts[0], ['found', '2 passages']);
  assert.deepEqual(search.facts[1], ['score 0.71', 'policy.md']);
  const state = describeRecord({ seq: 7, event: 'state_changed', name: 'verified', value: true, old: false });
  assert.equal(state.text, 'verified → true');
  assert.deepEqual(state.facts, [['was', 'false']]);
  const error = describeRecord({ seq: 8, event: 'error', message: 'the model timed out', where: 'llm' });
  assert.equal(error.problem, true);
  assert.equal(error.text, 'the model timed out');
  const closed = describeRecord({ seq: 9, event: 'session_closed', reason: 'error', error: 'boom' });
  assert.equal(closed.problem, true);
  assert.deepEqual(closed.facts, [['error', 'boom']]);
});

test('a record this file doesn’t know still gets a row (its name and fields), never dropped', () => {
  const row = describeRecord({ seq: 3, elapsed_s: 2, event: 'sentiment_scored', score: 0.9, label: 'calm' });
  assert.equal(row.label, 'Sentiment scored');
  assert.equal(row.group, 'other');
  assert.deepEqual(row.facts, [
    ['score', '0.9'],
    ['label', 'calm'],
  ]);
  assert.equal(describeRecord(null).label, 'Event');
  assert.equal(groupOf('tool_called'), 'tools');
});

test('the filter chips count by kind, narrow the list, and records of an unknown kind always stay', () => {
  const records = [
    ...REAL,
    { seq: 12, event: 'tool_called', tool: 't', args: {} },
    { seq: 13, event: 'http_request', method: 'GET', path: '/x', status: 500 },
    { seq: 14, event: 'sentiment_scored' },
  ];
  const rows = describeRecords(records);
  const counts = groupCounts(rows);
  assert.equal(counts.conversation, 3);
  assert.equal(counts.tools, 1);
  assert.equal(counts.api, 1);
  assert.equal(counts.lifecycle, 4);
  assert.equal(counts.other, 1);
  assert.equal(filterRows(rows, []).length, rows.length, 'nothing chosen shows everything');
  assert.deepEqual(
    filterRows(rows, ['tools']).map((r) => r.kind),
    ['tool_called', 'sentiment_scored'],
  );
  assert.equal(filterRows(rows, ['conversation', 'api']).filter((r) => r.group !== 'other').length, 4);
});

test('a trace tells at a glance: messages, tools, requests, problems, seconds; it reads as plain text; the conversation can be lifted out', () => {
  const records = [...REAL, { seq: 12, elapsed_s: 31, event: 'tool_called', tool: 'find_order', args: {}, error: 'HTTP 503' }];
  const summary = traceSummary(records);
  assert.deepEqual([summary.said, summary.tools, summary.requests, summary.errors], [3, 1, 0, 1]);
  assert.equal(summary.seconds, 31);
  const text = traceAsText(REAL.slice(0, 3));
  assert.match(text, /^ 0:00\.0 {2}Call/);
  assert.match(text.split('\n')[2], /Agent {5}Hi, I’m Support Agent/);
  assert.deepEqual(
    conversationOf(REAL).map((m) => m.role),
    ['agent', 'caller', 'agent'],
  );
  assert.equal(formatElapsed(75.26), '1:15.2');
  assert.equal(formatElapsed(undefined), '');
});

test('the final state and the tools a conversation used are read from its records', () => {
  assert.deepEqual(finalStateOf(REAL), { verified: true }, 'call_ended carries it');
  assert.deepEqual(
    finalStateOf([
      { event: 'state_changed', name: 'a', value: 1 },
      { event: 'state_changed', name: 'a', value: 2 },
      { event: 'state_changed', variable: 'b', value: true },
    ]),
    { a: 2, b: true },
  );
  assert.deepEqual(finalStateOf([]), {});
  assert.deepEqual(
    toolsUsedIn([{ event: 'tool_called', tool: 'a' }, { event: 'tool_called', tool: 'b' }, { event: 'tool_called', tool: 'a' }, { event: 'agent_said' }]),
    ['a', 'b'],
  );
});

// ---------------------------------------------------------------- the calls list
test('a call’s status is worded for people, and a cut-off call says what that means', () => {
  assert.equal(statusOf('ended').label, 'Ended');
  assert.equal(statusOf('in_progress').tone, 'warn');
  assert.match(CALL_STATUS.unfinished.hint, /worker stopped|cut off/);
  assert.equal(statusOf('weird').label, 'weird');
  assert.equal(channelLabel({ type: 'sip_voice' }), 'Phone');
  assert.equal(channelLabel({ id: 'web-chat', type: 'web_chat' }), 'Web chat');
  assert.equal(channelLabel({ id: 'kiosk', type: 'kiosk' }), 'kiosk');
  assert.equal(formatSeconds(30), '30 s');
  assert.equal(formatSeconds(125), '2 min 5 s');
  assert.equal(formatSeconds(3900), '1 h 5 min');
  assert.equal(formatSeconds(undefined), '');
});

test('the filters become the API’s query, leaving out what is empty', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  assert.equal(sinceFor('24h', now), '2026-10-13T12:00:00.000Z');
  assert.equal(sinceFor('all', now), undefined);
  assert.deepEqual(queryFor({ range: '7d', caller: ' +65 ', channel: 'web-chat', status: 'ended' }, { limit: 10, cursor: '10', nowMs: now }), {
    limit: 10,
    cursor: '10',
    since: '2026-10-07T12:00:00.000Z',
    caller: '+65',
    channel: 'web-chat',
    status: 'ended',
  });
  assert.deepEqual(queryFor({ range: 'all' }, { nowMs: now }), {
    limit: 25,
    cursor: undefined,
    since: undefined,
    caller: undefined,
    channel: undefined,
    status: undefined,
  });
});

test('calls of several agents are merged newest first, the same call never twice, and a row is made for the table', () => {
  const a = {
    calls: [
      { id: 'a1', bot: 'a', started_at: '2026-10-14T10:00:00Z' },
      { id: 'a2', bot: 'a', started_at: '2026-10-12T10:00:00Z' },
    ],
  };
  const b = {
    calls: [
      { id: 'b1', bot: 'b', started_at: '2026-10-13T10:00:00Z' },
      { id: 'a1', bot: 'a', started_at: '2026-10-14T10:00:00Z' },
    ],
  };
  assert.deepEqual(
    mergeCalls([a, b, null]).map((c) => c.id),
    ['a1', 'b1', 'a2'],
  );
  assert.deepEqual(
    mergeCalls([
      {
        calls: [
          { id: 'x', bot: 'a', started_at: '2026-10-14T10:00:00Z' },
          { id: 'x', bot: 'b', started_at: '2026-10-14T10:00:00Z' },
        ],
      },
    ]).length,
    2,
    'the same id on two agents is two calls',
  );
  const row = rowOf(
    {
      id: 'c',
      bot: 'a',
      started_at: '2026-10-14T10:00:00Z',
      status: 'unfinished',
      duration_s: 90,
      caller_turns: 2,
      agent_turns: 3,
      handoffs: 1,
      channel: { id: 'phone', type: 'sip_voice' },
      caller: '+6591234567',
      version: '0.1.0',
      ref: 'production',
    },
    'Acme',
  );
  assert.deepEqual([row.botName, row.statusLabel, row.tone, row.duration, row.turns, row.channel], ['Acme', 'Cut off', 'bad', '1 min 30 s', '2 / 3', 'Phone']);
  assert.deepEqual(
    channelsIn([
      { channel: { id: 'web-chat', type: 'web_chat' } },
      { channel: { id: 'web-chat', type: 'web_chat' } },
      { channel: { id: 'phone', type: 'sip_voice' } },
      {},
    ]).map((c) => c.id),
    ['web-chat', 'phone'],
  );
  assert.equal(ndjson([{ a: 1 }, { b: 2 }]), '{"a":1}\n{"b":2}\n');
});

// ---------------------------------------------------------------- the demo API's calls
test('GET /calls lists calls newest first with filters and paging; one call has its records, counts and transcript', async () => {
  const api = createDemoApi({ storage: memoryStorage(), history: false });
  const all = (await api.handle('GET', '/bots/acme-support/calls')).body;
  assert.equal(all.calls.length, 3);
  assert.equal(all.next, null);
  assert.ok(
    all.calls.every((c, i, l) => i === 0 || Date.parse(l[i - 1].started_at) >= Date.parse(c.started_at)),
    'newest first',
  );
  const page1 = (await api.handle('GET', '/bots/acme-support/calls?limit=2')).body;
  assert.equal(page1.calls.length, 2);
  assert.equal(page1.next, '2');
  const page2 = (await api.handle('GET', `/bots/acme-support/calls?limit=2&cursor=${page1.next}`)).body;
  assert.deepEqual(
    [...page1.calls, ...page2.calls].map((c) => c.id),
    all.calls.map((c) => c.id),
  );
  assert.equal((await api.handle('GET', '/bots/acme-support/calls?status=unfinished')).body.calls.length, 0);
  assert.equal((await api.handle('GET', '/bots/acme-support/calls?channel=web-chat')).body.calls.length, 3);
  assert.equal((await api.handle('GET', '/bots/acme-support/calls?channel=phone')).body.calls.length, 0);
  assert.equal(
    (await api.handle('GET', `/bots/acme-support/calls?since=${encodeURIComponent(new Date(Date.now() + 86400000).toISOString())}`)).body.calls.length,
    0,
  );

  const first = all.calls[0];
  const call = (await api.handle('GET', `/bots/acme-support/calls/${first.id}`)).body;
  assert.equal(call.call.id, first.id);
  assert.ok(call.events.length > 5);
  assert.equal(call.events[0].event, 'call_started');
  assert.equal(call.counts.user_said, first.caller_turns);
  assert.equal(call.complete, true);
  assert.ok(Array.isArray(call.usage));
  const tail = (await api.handle('GET', `/bots/acme-support/calls/${first.id}?after=${call.events[2].seq}&limit=2`)).body;
  assert.deepEqual(
    tail.events.map((e) => e.seq),
    [call.events[3].seq, call.events[4].seq],
  );
  assert.equal(tail.more, true);
  assert.equal(tail.next_after, call.events[4].seq);
  const onlySaid = (await api.handle('GET', `/bots/acme-support/calls/${first.id}?kinds=user_said,agent_said`)).body;
  assert.ok(onlySaid.events.every((e) => ['user_said', 'agent_said'].includes(e.event)));
  assert.equal((await api.handle('GET', `/bots/acme-support/calls/${first.room}`)).body.call.id, first.id, 'a room name means its newest call');
  const transcript = (await api.handle('GET', `/bots/acme-support/calls/${first.id}/transcript`)).body;
  assert.ok(transcript.turns.length >= 2 && transcript.turns[0].role === 'agent');
  assert.equal((await api.handle('GET', '/bots/acme-support/calls/nope')).status, 404);
  assert.equal((await api.handle('GET', '/bots/ghost/calls')).status, 404);
});

test('a conversation had in the simulated preview is kept as a call, newest first, with its tools', async () => {
  const api = createDemoApi({ storage: memoryStorage(), history: false });
  const id = api.recordConversation('acme-support', {
    startedAt: new Date().toISOString(),
    channel: { id: 'web-chat', type: 'web_chat' },
    state: { verified: true },
    tools: [{ tool: 'end_call', args: {} }],
    messages: [
      { role: 'assistant', text: 'Hello' },
      { role: 'user', text: 'bye' },
      { role: 'assistant', text: 'Goodbye' },
    ],
  });
  const list = (await api.handle('GET', '/bots/acme-support/calls')).body.calls;
  assert.equal(list[0].id, id);
  assert.equal(list.length, 4);
  const call = (await api.handle('GET', `/bots/acme-support/calls/${id}`)).body;
  assert.ok(call.events.some((e) => e.event === 'tool_called' && e.tool === 'end_call'));
  assert.ok(
    call.events.filter((e) => e.event === 'agent_said').every((e) => e.simulated === true),
    'marked as made by the simulation',
  );
  assert.deepEqual(call.final_state, { verified: true });
  assert.equal(api.recordConversation('ghost', {}), null);
});

test('following a call replays its records one at a time, then says it ended, and can be stopped', () => {
  const call = { summary: { id: 'c', status: 'ended' }, events: [{ seq: 1 }, { seq: 2 }, { seq: 3 }] };
  const queue = [];
  const schedule = (fn) => {
    queue.push(fn);
    return queue.length;
  };
  const seen = [];
  let opened = null;
  let ended = false;
  const stop = followCallOf(
    call,
    {
      onOpen: (c) => {
        opened = c.id;
      },
      onRecord: (r) => seen.push(r.seq),
      onEnd: () => {
        ended = true;
      },
    },
    { schedule, cancel: () => {} },
  );
  assert.equal(opened, 'c');
  while (queue.length) queue.shift()();
  assert.deepEqual(seen, [1, 2, 3]);
  assert.equal(ended, true);
  // stopping halts it
  const seen2 = [];
  const queue2 = [];
  const stop2 = followCallOf(
    call,
    { onRecord: (r) => seen2.push(r.seq) },
    {
      schedule: (fn) => {
        queue2.push(fn);
        return 1;
      },
      cancel: () => {},
    },
  );
  queue2.shift()();
  stop2();
  while (queue2.length) queue2.shift()();
  assert.deepEqual(seen2, [1]);
  void stop;
  // a call still in progress doesn't announce an end
  let endedEarly = false;
  const q3 = [];
  followCallOf(
    { summary: { status: 'in_progress' }, events: [{ seq: 1 }] },
    {
      onRecord: () => {},
      onEnd: () => {
        endedEarly = true;
      },
    },
    {
      schedule: (fn) => {
        q3.push(fn);
        return 1;
      },
      cancel: () => {},
    },
  );
  while (q3.length) q3.shift()();
  assert.equal(endedEarly, false);
});

// FRONTEND_GUIDE 2.md: tasks, safety rules and call limits write records of their own. Each gets a row in plain words, its own filter, and a bad one is a problem.
test('a task, a safety rule and a call limit are told in plain words, and a record this file has not met still gets a row', () => {
  const task = describeRecord({ event: 'task_started', seq: 1, task: 'verify' });
  assert.equal(task.text, 'Started “verify”');
  assert.equal(task.group, 'tasks');
  const step = describeRecord({ event: 'task_step', seq: 2, task: 'verify', step: 'ask_dob', passed: false, attempt: 2 });
  assert.equal(step.tone, 'bad');
  assert.deepEqual(step.facts, [
    ['answer', 'not accepted'],
    ['attempt', '2'],
  ]);
  assert.equal(describeRecord({ event: 'task_finished', task: 'verify', outcome: 'verified' }).tone, 'good');
  assert.equal(describeRecord({ event: 'task_finished', task: 'verify', outcome: 'failed' }).text, 'Finished “verify” as failed');
  assert.match(describeRecord({ event: 'task_skipped', task: 'verify' }).text, /already satisfied/);
  const rule = describeRecord({ event: 'guardrail_triggered', rule: 'no_injection', action: 'redact_in_logs' });
  assert.equal(rule.text, '“no_injection” caught what the caller said');
  assert.equal(rule.group, 'safety');
  assert.deepEqual(rule.facts, [['it', 'redact in logs']]);
  const limit = describeRecord({ event: 'limit_reached', limit: 'max_tool_calls_per_call', value: 5 });
  assert.equal(limit.problem, true);
  assert.equal(limit.text, 'A call limit ended the call: max tool calls per call');
  assert.equal(describeRecord({ event: 'something_new', x: 1 }).label, 'Something new', 'an unknown kind is still a row');
});
