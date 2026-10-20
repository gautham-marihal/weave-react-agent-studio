import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoApi, memoryStorage } from '../src/demo/demoApi.js';
import { followLive, liveCallsFor } from '../src/demo/demoLive.js';
import { createLiveBoard } from '../src/studio/live/liveBoard.js';
import { RECENT_MS, boardOrder, boardSummary, changesToAnnounce, clock, hiddenWords, liveCall, maskCaller } from '../src/studio/live/liveModel.js';

const T0 = Date.parse('2026-10-20T10:00:00Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
let seq = 0;
const rec = (elapsed, event, fields = {}) => ({ t: at(elapsed), seq: ++seq, elapsed_s: elapsed, event, ...fields });
const summary = (fields = {}) => ({
  id: 'c1',
  bot: 'acme',
  room: 'r1',
  channel: { id: 'phone', type: 'sip_voice' },
  caller: '+6581234471',
  started_at: at(0),
  status: 'in_progress',
  ...fields,
});
const opening = () => {
  seq = 0;
  return [
    rec(0.05, 'call_started'),
    rec(0.1, 'agent_entered', { agent: 'front', first: true }),
    rec(0.3, 'agent_said', { text: 'Hello! How can I help?' }),
    rec(12, 'user_said', { text: 'Where is my order?' }),
  ];
};
const ids = (call) => call.flags.map((f) => f.id);

test('a call going on: what was said, who has it, how long it has run (on this clock, not the server’s), and that the agent is answering', () => {
  const records = opening();
  // this clock is 30 s behind the server: the last record seems to be in the future, so it counts as just heard
  const call = liveCall(summary(), records, { nowMs: T0 + 12 * 1000 - 30000 + 2000, heardAtMs: null });
  assert.equal(call.status, 'live');
  assert.equal(call.agent, 'front');
  assert.deepEqual(
    call.lines.map((l) => [l.who, l.text]),
    [
      ['agent', 'Hello! How can I help?'],
      ['caller', 'Where is my order?'],
    ],
  );
  assert.equal(Math.round(call.durationS), 12, 'the duration is the last record’s time plus the time since it was heard');
  assert.equal(call.thinking, true, 'the caller spoke and the answer is on its way');
  assert.deepEqual(call.flags, []);
  assert.equal(call.caller, '+65 •••• 4471', 'only the last digits of the number');
  assert.equal(call.voice, true);
});

test('a caller left waiting, and a call where nothing happens, need a look; the waiting is counted from the caller’s words', () => {
  const records = opening();
  const heard = T0 + 12 * 1000;
  const waiting = liveCall(summary(), records, { nowMs: heard + 9000, heardAtMs: heard });
  assert.deepEqual(ids(waiting), ['waiting']);
  assert.equal(waiting.flags[0].label, 'Caller waiting 9 s');
  assert.equal(waiting.thinking, false);
  assert.equal(waiting.attention, true);
  records.push(rec(13.5, 'agent_said', { text: 'Let me check that for you.' }));
  const quiet = liveCall(summary(), records, { nowMs: heard + 1500 + 50000, heardAtMs: heard + 1500 });
  assert.deepEqual(ids(quiet), ['quiet']);
  assert.equal(quiet.flags[0].tone, 'warn');
});

test('a tool that failed, an error, a call limit and a safety rule are flagged, the worst first', () => {
  const records = [
    ...opening(),
    rec(12.4, 'tool_called', { tool: 'find_order', args: {}, error: 'HTTP 503' }),
    rec(13, 'tool_called', { tool: 'find_order', args: {}, error: 'HTTP 503' }),
    rec(13.2, 'agent_said', { text: 'Sorry, I can’t reach the system.' }),
    rec(14, 'guardrail_triggered', { rule: 'no_card_numbers' }),
    rec(15, 'error', { message: 'TTS timed out' }),
    rec(16, 'limit_reached', { limit: 'max_tool_calls' }),
  ];
  const call = liveCall(summary(), records, { nowMs: T0 + 17000, heardAtMs: T0 + 16000 });
  assert.deepEqual(ids(call), ['tool:find_order', 'error', 'limit', 'guardrail']);
  assert.equal(call.flags[0].label, '“find_order” failed twice');
  assert.equal(call.flags[0].detail, 'HTTP 503');
  assert.equal(call.worst, 'bad');
});

test('a hand-over to another agent is said once, and the card follows the agent that has the call', () => {
  const records = [
    ...opening(),
    rec(12.3, 'tool_called', { tool: 'to_specialist', args: {}, handoff: 'billing' }),
    rec(12.35, 'agent_entered', { agent: 'billing', first: false }),
    rec(13, 'agent_said', { text: 'Hi, billing here.' }),
  ];
  const call = liveCall(summary(), records, { nowMs: T0 + 14000, heardAtMs: T0 + 13000 });
  assert.equal(call.agent, 'billing');
  assert.equal(call.firstAgent, 'front');
  assert.deepEqual(ids(call), ['handed_over']);
  assert.equal(call.flags[0].label, 'Passed to billing');
  assert.equal(call.attention, false, 'a hand-over is worth knowing, not a problem');
});

test('a caller who asks for a person needs a look, until the call is passed to one; a caller who repeats themselves too', () => {
  const asks = [...opening(), rec(13, 'agent_said', { text: 'It is on its way.' }), rec(25, 'user_said', { text: 'I want to speak to a person.' })];
  const call = liveCall(summary(), asks, { nowMs: T0 + 26000, heardAtMs: T0 + 25000 });
  assert.deepEqual(ids(call), ['asked_person']);
  const passed = [
    ...asks,
    rec(26, 'tool_called', { tool: 'escalate_to_human', args: {}, result: { transferred: true } }),
    rec(26.2, 'agent_said', { text: 'Passing you on now.' }),
  ];
  assert.deepEqual(ids(liveCall(summary(), passed, { nowMs: T0 + 27000, heardAtMs: T0 + 26200 })), ['handed_over']);
  const repeat = [...opening(), rec(13, 'agent_said', { text: 'One moment.' }), rec(30, 'user_said', { text: 'Where is my order?' })];
  assert.deepEqual(ids(liveCall(summary(), repeat, { nowMs: T0 + 31000, heardAtMs: T0 + 30000 })), ['repeated']);
});

test('a slow answer earlier in the call is a warning; a call that was cut off or ended is not live, and keeps its length', () => {
  const slow = [...opening(), rec(19, 'agent_said', { text: 'Found it.' })];
  const call = liveCall(summary(), slow, { nowMs: T0 + 20000, heardAtMs: T0 + 19000 });
  assert.deepEqual(ids(call), ['slow']);
  assert.equal(call.flags[0].label, 'Slow answer (7.0 s)');
  const cut = liveCall(summary({ status: 'unfinished' }), opening(), { nowMs: T0 + 400000 });
  assert.equal(cut.status, 'cut_off');
  assert.equal(cut.flags[0].id, 'cut_off');
  assert.equal(cut.durationS, 12, 'not counting up any more');
  const ended = liveCall(
    summary(),
    [...opening(), rec(14, 'agent_said', { text: 'Bye' }), rec(15, 'session_closed', {}), rec(15.1, 'call_ended', { duration_s: 15 })],
    {
      nowMs: T0 + 90000,
    },
  );
  assert.equal(ended.status, 'ended');
  assert.equal(ended.durationS, 15);
});

test('the board: what needs a look first, then the longest running; a summary; and what a screen reader is told', () => {
  const quietOne = { key: 'a/1', bot: 'a', status: 'live', attention: false, worst: '', durationS: 100, flags: [] };
  const waiting = {
    key: 'a/2',
    bot: 'a',
    status: 'live',
    attention: true,
    worst: 'bad',
    durationS: 20,
    flags: [{ id: 'waiting', label: 'Caller waiting 9 s' }],
  };
  const warn = {
    key: 'b/3',
    bot: 'b',
    status: 'live',
    attention: true,
    worst: 'warn',
    durationS: 50,
    flags: [{ id: 'repeated', label: 'Caller repeated themselves' }],
  };
  const done = { key: 'b/4', bot: 'b', status: 'ended', attention: false, worst: '', durationS: 80, flags: [] };
  assert.deepEqual(
    [quietOne, warn, done, waiting].sort(boardOrder).map((c) => c.key),
    ['a/2', 'b/3', 'a/1', 'b/4'],
  );
  assert.deepEqual(boardSummary([quietOne, waiting, warn, done]), {
    live: 3,
    attention: 2,
    ended: 1,
    byAgent: { a: { live: 2, attention: 1 }, b: { live: 1, attention: 1 } },
  });
  const before = { 'a/1': quietOne, 'b/4': { ...done, status: 'live' } };
  const after = { 'a/1': quietOne, 'a/2': waiting, 'b/4': done };
  assert.deepEqual(changesToAnnounce(before, after, { a: 'Acme', b: 'Bookings' }), ['A call on Bookings ended', 'New call on Acme']);
  const now = { ...after, 'a/1': { ...quietOne, attention: true, flags: [{ id: 'quiet', label: 'Nothing for 50 s' }] } };
  assert.deepEqual(changesToAnnounce(after, now, { a: 'Acme' }), ['Acme: Nothing for 50 s']);
  assert.deepEqual(changesToAnnounce({}, { 'a/2': { ...waiting, attention: false } }, { a: 'Acme' }), ['New call on Acme']);
});

test('small words: a duration, a hidden line, a phone number shown by its last digits only', () => {
  assert.equal(clock(45), '45 s');
  assert.equal(clock(125), '2:05');
  assert.equal(clock(3730), '1:02:10');
  assert.equal(hiddenWords({ text: 'my card number is 4111' }), 'Caller spoke (5 words)');
  assert.equal(maskCaller('+44 20 7946 0958'), '+44 •••• 0958');
  assert.equal(maskCaller('visitor-81ab'), '', 'not a number: nothing shown');
  assert.equal(maskCaller(null), '');
});

// ---- the watcher ---------------------------------------------------------------------------------------------------------------------------------------

function fakeServer() {
  const calls = {}; // key → { summary, events }
  const failing = new Set();
  const asked = [];
  const api = {
    listCalls: async (bot, filters) => {
      asked.push(['list', bot, filters]);
      if (failing.has(bot)) throw new Error('503 Service Unavailable');
      return {
        calls: Object.values(calls)
          .filter((c) => c.summary.bot === bot)
          .map((c) => c.summary),
      };
    },
    getCall: async (bot, id, query) => {
      asked.push(['get', bot, id, query.after]);
      const c = calls[`${bot}/${id}`];
      return { call: c.summary, events: c.events.filter((e) => e.seq > (query.after || 0)) };
    },
  };
  const streams = [];
  const follow = (bot, id, handlers) => {
    const s = { bot, id, handlers, open: true };
    streams.push(s);
    return () => {
      s.open = false;
    };
  };
  return { calls, failing, asked, api, streams, follow };
}

test('the watcher reads a new call once, then follows it; past the cap the others are read on each round; an ending is noticed', async () => {
  const server = fakeServer();
  let clockMs = T0;
  const records = opening();
  server.calls['acme/c1'] = { summary: summary(), events: records.slice() };
  server.calls['acme/c2'] = { summary: summary({ id: 'c2', room: 'r2' }), events: records.slice(0, 3) };
  let last = null;
  const board = createLiveBoard({
    api: server.api,
    follow: server.follow,
    now: () => clockMs,
    every: () => 0,
    stopEvery: () => {},
    onChange: (s) => (last = s),
    maxFollowed: 1,
  });
  board.setBots([{ id: 'acme' }]);
  await board.start();
  assert.equal(last.calls.length, 2);
  assert.equal(last.calls.find((c) => c.summary.id === 'c1').records.length, 4);
  assert.equal(server.streams.length, 1, 'one call followed (the cap), the other read on each round');
  assert.equal(last.following, 1);
  const followed = server.streams[0];
  assert.equal(followed.handlers.after, followed.id === 'c1' ? 4 : 3, 'the stream starts after what was read');

  // a record comes in on the stream
  clockMs += 2000;
  const next = { t: at(13), seq: 99, elapsed_s: 13, event: 'agent_said', text: 'One moment.' };
  followed.handlers.onRecord(next);
  const entry = last.calls.find((c) => c.summary.id === followed.id);
  assert.equal(entry.records[entry.records.length - 1].seq, 99);
  assert.equal(entry.heardAtMs, clockMs);
  // the record that is already there is not added twice
  followed.handlers.onRecord(next);
  assert.equal(last.calls.find((c) => c.summary.id === followed.id).records.filter((r) => r.seq === 99).length, 1);

  // the other one is read on the next round, from where it was
  const other = followed.id === 'c1' ? 'c2' : 'c1';
  server.calls[`acme/${other}`].events.push({ t: at(20), seq: 50, elapsed_s: 20, event: 'agent_said', text: 'Here it is.' });
  server.asked.length = 0;
  await board.refresh();
  assert.ok(
    server.asked.some(([k, , id, after]) => k === 'get' && id === other && after > 0),
    JSON.stringify(server.asked),
  );
  assert.equal(last.calls.find((c) => c.summary.id === other).records.at(-1).seq, 50);

  // the followed call ends
  followed.handlers.onEnd();
  assert.equal(last.calls.find((c) => c.summary.id === followed.id).summary.status, 'ended');
  assert.equal(followed.open, false);

  // the other one leaves the list: it is read once more, and the server says it was cut off
  server.calls[`acme/${other}`].summary = { ...server.calls[`acme/${other}`].summary, status: 'unfinished' };
  await board.refresh();
  assert.equal(last.calls.find((c) => c.summary.id === other).summary.status, 'unfinished');

  // ten minutes on, both are gone from the board
  clockMs += RECENT_MS + 60000;
  await board.refresh();
  assert.equal(last.calls.length, 0);
  board.stop();
});

test('the watcher: an agent whose calls can’t be read is reported and the others still show; a pause closes the streams and a restart picks up', async () => {
  const server = fakeServer();
  const clockMs = T0;
  server.calls['acme/c1'] = { summary: summary(), events: opening() };
  server.calls['other/c9'] = { summary: summary({ id: 'c9', bot: 'other', status: 'ended' }), events: opening() };
  server.failing.add('broken');
  let last = null;
  const board = createLiveBoard({
    api: server.api,
    follow: server.follow,
    now: () => clockMs,
    every: () => 0,
    stopEvery: () => {},
    onChange: (s) => (last = s),
  });
  board.setBots([{ id: 'acme' }, { id: 'broken' }, { id: 'other' }]);
  await board.start();
  assert.deepEqual(last.errors, [{ botId: 'broken', message: '503 Service Unavailable' }]);
  assert.ok(
    last.calls.some((c) => c.summary.id === 'c1'),
    'the others still show',
  );
  assert.ok(
    last.calls.some((c) => c.summary.id === 'c9' && c.summary.status === 'ended'),
    'a call that ended in the last minutes is listed, a server that ignores the status filter changes nothing',
  );
  assert.ok(
    server.asked.some(([k, bot, f]) => k === 'list' && bot === 'acme' && f.status === 'in_progress'),
    'it asks for the calls in progress',
  );
  board.stop();
  assert.equal(server.streams[0].open, false, 'pausing closes the stream');
  server.failing.delete('broken');
  server.calls['acme/c1'].events.push({ t: at(14), seq: 77, elapsed_s: 14, event: 'agent_said', text: 'Back.' });
  await board.start();
  assert.deepEqual(last.errors, []);
  assert.equal(last.calls.find((c) => c.summary.id === 'c1').records.at(-1).seq, 77, 'what was missed while paused is read');
  assert.equal(server.streams.filter((s) => s.open).length, 1, 'and it is followed again');
  board.setBots([{ id: 'other' }]);
  assert.ok(!last.calls.some((c) => c.summary.bot === 'acme'), 'an agent no longer watched leaves the board');
  board.stop();
});

// ---- the demo's live calls -------------------------------------------------------------------------------------------------------------------------

async function demoBots() {
  const api = createDemoApi({ storage: memoryStorage(), loadSchema: async () => ({}), now: () => new Date(T0).toISOString() });
  const out = [];
  for (const id of ['acme-support', 'front-desk', 'bookings']) out.push({ id, config: (await api.handle('GET', `/bots/${id}/draft`)).body.config });
  return out;
}

test('demo: there are always a few calls going on, they last a couple of minutes, and answers take a second or two (one kind is slow)', async () => {
  const bots = await demoBots();
  const counts = [];
  const waits = [];
  const durations = new Set();
  for (let minute = 0; minute < 60; minute += 1) {
    const nowMs = T0 + minute * 60000;
    const calls = bots.flatMap((b) => liveCallsFor(b, nowMs));
    counts.push(calls.filter((c) => c.summary.status === 'in_progress').length);
    calls
      .filter((c) => c.summary.status === 'ended')
      .forEach((c) => {
        durations.add(c.summary.duration_s);
        const facts = liveCall({ ...c.summary }, c.events, { nowMs });
        waits.push(...facts.lines.filter((l) => l.who === 'agent').map(() => 0));
        let asked = null;
        c.events.forEach((e) => {
          if (e.event === 'user_said') asked = e.elapsed_s;
          if (e.event === 'agent_said' && asked !== null) {
            waits.push(e.elapsed_s - asked);
            asked = null;
          }
        });
      });
  }
  assert.ok(Math.min(...counts) >= 2, `always some calls: ${counts.join(' ')}`);
  assert.ok(counts.reduce((a, b) => a + b, 0) / counts.length >= 5, 'about half a dozen at a time');
  const lengths = [...durations];
  assert.ok(Math.min(...lengths) >= 40 && Math.max(...lengths) <= 300, lengths.join(' '));
  const real = waits.filter((w) => w > 0).sort((a, b) => a - b);
  assert.ok(real[Math.floor(real.length / 2)] < 3, 'most answers come in under 3 s');
  assert.ok(
    real.some((w) => w >= 8),
    'and the slow kind is slow',
  );
  const ended = bots.flatMap((b) => liveCallsFor(b, T0)).find((c) => c.summary.status === 'ended');
  const usage = ended.events.find((e) => e.event === 'call_ended').usage;
  assert.equal(usage[0].model, bots[0].config.defaults.models.llm.model, 'their usage names the agent’s model, so it can be priced');
  assert.ok(usage[0].input_tokens > 1000);
});

test('demo: following a live call gives its records in order as the clock moves, and then the end', async () => {
  const [bot] = await demoBots();
  const call = liveCallsFor(bot, T0).find((c) => c.summary.status === 'in_progress');
  let clockMs = T0;
  const got = [];
  let ended = false;
  const queue = [];
  const stop = followLive(
    bot,
    call.summary.id,
    { onRecord: (r) => got.push(r.seq), onEnd: () => (ended = true) },
    { read: () => clockMs, every: 1000, schedule: (fn) => queue.push(fn), cancel: () => {} },
  );
  for (let i = 0; i < 400 && !ended; i += 1) {
    clockMs += 1000;
    const fn = queue.shift();
    if (fn) fn();
  }
  stop();
  assert.ok(got.length > 5);
  assert.deepEqual(
    got,
    [...got].sort((a, b) => a - b),
  );
  assert.equal(new Set(got).size, got.length, 'each record once');
  assert.ok(ended || call.summary.id.includes('live'), 'it ends (or was a call that gets cut off)');
});
