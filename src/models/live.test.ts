import { describe, expect, it } from 'vitest';
import { createLiveBoard, type BoardSnapshot, type FollowHandlers } from './liveBoard';
import { RECENT_MS, boardOrder, boardSummary, changesToAnnounce, clock, hiddenWords, liveCall, maskCaller, type LiveCall } from './live';

const T0 = Date.parse('2026-10-20T10:00:00Z');
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
let seq = 0;
type Rec = Record<string, unknown>;
const rec = (elapsed: number, event: string, fields: Rec = {}): Rec => ({ t: at(elapsed), seq: ++seq, elapsed_s: elapsed, event, ...fields });
const summary = (fields: Rec = {}): Rec => ({
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
const ids = (call: LiveCall) => call.flags.map((f) => f.id);

describe('liveCall', () => {
  it('reads a call going on: what was said, who has it, how long (on this clock), and that the agent is answering', () => {
    // this clock is 30 s behind the server: the last record seems to be in the future, so it counts as just heard
    const call = liveCall(summary(), opening(), { nowMs: T0 + 12 * 1000 - 30000 + 2000, heardAtMs: null });
    expect(call.status).toBe('live');
    expect(call.agent).toBe('front');
    expect(call.lines.map((l) => [l.who, l.text])).toEqual([
      ['agent', 'Hello! How can I help?'],
      ['caller', 'Where is my order?'],
    ]);
    expect(Math.round(call.durationS)).toBe(12);
    expect(call.thinking).toBe(true);
    expect(call.flags).toEqual([]);
    expect(call.caller).toBe('+65 •••• 4471');
    expect(call.voice).toBe(true);
  });

  it('flags a caller left waiting, and a call where nothing happens; waiting counts from the caller’s words', () => {
    const records = opening();
    const heard = T0 + 12 * 1000;
    const waiting = liveCall(summary(), records, { nowMs: heard + 9000, heardAtMs: heard });
    expect(ids(waiting)).toEqual(['waiting']);
    expect(waiting.flags[0].label).toBe('Caller waiting 9 s');
    expect(waiting.thinking).toBe(false);
    expect(waiting.attention).toBe(true);
    records.push(rec(13.5, 'agent_said', { text: 'Let me check that for you.' }));
    const quiet = liveCall(summary(), records, { nowMs: heard + 1500 + 50000, heardAtMs: heard + 1500 });
    expect(ids(quiet)).toEqual(['quiet']);
    expect(quiet.flags[0].tone).toBe('warn');
  });

  it('flags a tool that failed, an error, a call limit and a safety rule, the worst first', () => {
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
    expect(ids(call)).toEqual(['tool:find_order', 'error', 'limit', 'guardrail']);
    expect(call.flags[0].label).toBe('“find_order” failed twice');
    expect(call.flags[0].detail).toBe('HTTP 503');
    expect(call.worst).toBe('bad');
  });

  it('says a hand-over to another agent once, and follows the agent that has the call', () => {
    const records = [
      ...opening(),
      rec(12.3, 'tool_called', { tool: 'to_specialist', args: {}, handoff: 'billing' }),
      rec(12.35, 'agent_entered', { agent: 'billing', first: false }),
      rec(13, 'agent_said', { text: 'Hi, billing here.' }),
    ];
    const call = liveCall(summary(), records, { nowMs: T0 + 14000, heardAtMs: T0 + 13000 });
    expect(call.agent).toBe('billing');
    expect(call.firstAgent).toBe('front');
    expect(ids(call)).toEqual(['handed_over']);
    expect(call.flags[0].label).toBe('Passed to billing');
    expect(call.attention).toBe(false);
  });

  it('flags a caller who asks for a person until passed to one, and a caller who repeats themselves', () => {
    const asks = [...opening(), rec(13, 'agent_said', { text: 'It is on its way.' }), rec(25, 'user_said', { text: 'I want to speak to a person.' })];
    expect(ids(liveCall(summary(), asks, { nowMs: T0 + 26000, heardAtMs: T0 + 25000 }))).toEqual(['asked_person']);
    const passed = [...asks, rec(26, 'tool_called', { tool: 'escalate_to_human', args: {}, result: { transferred: true } }), rec(26.2, 'agent_said', { text: 'Passing you on now.' })];
    expect(ids(liveCall(summary(), passed, { nowMs: T0 + 27000, heardAtMs: T0 + 26200 }))).toEqual(['handed_over']);
    const repeat = [...opening(), rec(13, 'agent_said', { text: 'One moment.' }), rec(30, 'user_said', { text: 'Where is my order?' })];
    expect(ids(liveCall(summary(), repeat, { nowMs: T0 + 31000, heardAtMs: T0 + 30000 }))).toEqual(['repeated']);
  });

  it('warns of a slow answer; a call cut off or ended is not live and keeps its length', () => {
    const slow = [...opening(), rec(19, 'agent_said', { text: 'Found it.' })];
    const call = liveCall(summary(), slow, { nowMs: T0 + 20000, heardAtMs: T0 + 19000 });
    expect(ids(call)).toEqual(['slow']);
    expect(call.flags[0].label).toBe('Slow answer (7.0 s)');
    const cut = liveCall(summary({ status: 'unfinished' }), opening(), { nowMs: T0 + 400000 });
    expect(cut.status).toBe('cut_off');
    expect(cut.flags[0].id).toBe('cut_off');
    expect(cut.durationS).toBe(12);
    const ended = liveCall(summary(), [...opening(), rec(14, 'agent_said', { text: 'Bye' }), rec(15, 'session_closed', {}), rec(15.1, 'call_ended', { duration_s: 15 })], {
      nowMs: T0 + 90000,
    });
    expect(ended.status).toBe('ended');
    expect(ended.durationS).toBe(15);
  });
});

describe('the board', () => {
  const card = (fields: Partial<LiveCall>): LiveCall => ({ ...liveCall(summary(), [], { nowMs: T0 }), flags: [], ...fields });
  const quietOne = card({ key: 'a/1', bot: 'a', status: 'live', attention: false, worst: '', durationS: 100 });
  const waiting = card({ key: 'a/2', bot: 'a', status: 'live', attention: true, worst: 'bad', durationS: 20, flags: [{ id: 'waiting', tone: 'bad', label: 'Caller waiting 9 s', detail: '' }] });
  const warn = card({ key: 'b/3', bot: 'b', status: 'live', attention: true, worst: 'warn', durationS: 50, flags: [{ id: 'repeated', tone: 'warn', label: 'Caller repeated themselves', detail: '' }] });
  const done = card({ key: 'b/4', bot: 'b', status: 'ended', attention: false, worst: '', durationS: 80 });

  it('puts what needs a look first, then the longest running, and sums it up', () => {
    expect([quietOne, warn, done, waiting].sort(boardOrder).map((c) => c.key)).toEqual(['a/2', 'b/3', 'a/1', 'b/4']);
    expect(boardSummary([quietOne, waiting, warn, done])).toEqual({
      live: 3,
      attention: 2,
      ended: 1,
      byAgent: { a: { live: 2, attention: 1 }, b: { live: 1, attention: 1 } },
    });
  });

  it('tells a screen reader what changed, most important first', () => {
    const before = { 'a/1': quietOne, 'b/4': { ...done, status: 'live' as const } };
    const after = { 'a/1': quietOne, 'a/2': waiting, 'b/4': done };
    expect(changesToAnnounce(before, after, { a: 'Acme', b: 'Bookings' })).toEqual(['A call on Bookings ended', 'New call on Acme']);
    const now = { ...after, 'a/1': { ...quietOne, attention: true, flags: [{ id: 'quiet', tone: 'warn' as const, label: 'Nothing for 50 s', detail: '' }] } };
    expect(changesToAnnounce(after, now, { a: 'Acme' })).toEqual(['Acme: Nothing for 50 s']);
    expect(changesToAnnounce({}, { 'a/2': { ...waiting, attention: false } }, { a: 'Acme' })).toEqual(['New call on Acme']);
  });

  it('has small words: a duration, a hidden line, a phone number by its last digits only', () => {
    expect(clock(45)).toBe('45 s');
    expect(clock(125)).toBe('2:05');
    expect(clock(3730)).toBe('1:02:10');
    expect(hiddenWords({ text: 'my card number is 4111' })).toBe('Caller spoke (5 words)');
    expect(maskCaller('+44 20 7946 0958')).toBe('+44 •••• 0958');
    expect(maskCaller('visitor-81ab')).toBe('');
    expect(maskCaller(null)).toBe('');
  });
});

// ---- the watcher, against a stand-in server

function standIn() {
  const calls: Record<string, { summary: Rec; events: Rec[] }> = {};
  const failing = new Set<string>();
  const asked: unknown[][] = [];
  const api = {
    listCalls: async (bot: string, filters: Rec) => {
      asked.push(['list', bot, filters]);
      if (failing.has(bot)) throw new Error('503 Service Unavailable');
      return { calls: Object.values(calls).filter((c) => c.summary.bot === bot).map((c) => c.summary) };
    },
    getCall: async (bot: string, id: string, query: Rec) => {
      asked.push(['get', bot, id, query.after]);
      const c = calls[`${bot}/${id}`];
      return { call: c.summary, events: c.events.filter((e) => (e.seq as number) > ((query.after as number) || 0)) };
    },
  };
  const streams: Array<{ bot: string; id: string; handlers: FollowHandlers; open: boolean }> = [];
  const follow = (bot: string, id: string, handlers: FollowHandlers) => {
    const s = { bot, id, handlers, open: true };
    streams.push(s);
    return () => {
      s.open = false;
    };
  };
  return { calls, failing, asked, api, streams, follow };
}

describe('createLiveBoard', () => {
  it('reads a new call once, then follows it; past the cap the others are read each round; an ending is noticed', async () => {
    const server = standIn();
    let clockMs = T0;
    const records = opening();
    server.calls['acme/c1'] = { summary: summary(), events: records.slice() };
    server.calls['acme/c2'] = { summary: summary({ id: 'c2', room: 'r2' }), events: records.slice(0, 3) };
    let last = {} as BoardSnapshot;
    const board = createLiveBoard({
      api: server.api,
      follow: server.follow,
      now: () => clockMs,
      every: () => 0,
      stopEvery: () => undefined,
      onChange: (s) => (last = s),
      maxFollowed: 1,
    });
    board.setBots([{ id: 'acme' }]);
    await board.start();
    expect(last.calls.length).toBe(2);
    expect(last.calls.find((c) => c.summary.id === 'c1')?.records.length).toBe(4);
    expect(server.streams.length).toBe(1);
    expect(last.following).toBe(1);
    const followed = server.streams[0];
    expect(followed.handlers.after).toBe(followed.id === 'c1' ? 4 : 3);

    // a record comes in on the stream, once
    clockMs += 2000;
    const next = { t: at(13), seq: 99, elapsed_s: 13, event: 'agent_said', text: 'One moment.' };
    followed.handlers.onRecord?.(next);
    const entry = last.calls.find((c) => c.summary.id === followed.id);
    expect(entry?.records.at(-1)?.seq).toBe(99);
    expect(entry?.heardAtMs).toBe(clockMs);
    followed.handlers.onRecord?.(next);
    expect(last.calls.find((c) => c.summary.id === followed.id)?.records.filter((r) => r.seq === 99).length).toBe(1);

    // the other one is read on the next round, from where it was
    const other = followed.id === 'c1' ? 'c2' : 'c1';
    server.calls[`acme/${other}`].events.push({ t: at(20), seq: 50, elapsed_s: 20, event: 'agent_said', text: 'Here it is.' });
    server.asked.length = 0;
    await board.refresh();
    expect(server.asked.some(([k, , id, after]) => k === 'get' && id === other && (after as number) > 0)).toBe(true);
    expect(last.calls.find((c) => c.summary.id === other)?.records.at(-1)?.seq).toBe(50);

    // the followed call ends
    followed.handlers.onEnd?.();
    expect(last.calls.find((c) => c.summary.id === followed.id)?.summary.status).toBe('ended');
    expect(followed.open).toBe(false);

    // the other one leaves the list: it is read once more, and the server says it was cut off
    server.calls[`acme/${other}`].summary = { ...server.calls[`acme/${other}`].summary, status: 'unfinished' };
    await board.refresh();
    expect(last.calls.find((c) => c.summary.id === other)?.summary.status).toBe('unfinished');

    // ten minutes on, both are gone from the board
    clockMs += RECENT_MS + 60000;
    await board.refresh();
    expect(last.calls.length).toBe(0);
    board.stop();
  });

  it('reports an agent whose calls can’t be read beside the others; a pause closes the streams and a restart picks up', async () => {
    const server = standIn();
    server.calls['acme/c1'] = { summary: summary(), events: opening() };
    server.calls['other/c9'] = { summary: summary({ id: 'c9', bot: 'other', status: 'ended' }), events: opening() };
    server.failing.add('broken');
    let last = {} as BoardSnapshot;
    const board = createLiveBoard({ api: server.api, follow: server.follow, now: () => T0, every: () => 0, stopEvery: () => undefined, onChange: (s) => (last = s) });
    board.setBots([{ id: 'acme' }, { id: 'broken' }, { id: 'other' }]);
    await board.start();
    expect(last.errors).toEqual([{ botId: 'broken', message: '503 Service Unavailable' }]);
    expect(last.calls.some((c) => c.summary.id === 'c1')).toBe(true);
    expect(last.calls.some((c) => c.summary.id === 'c9' && c.summary.status === 'ended')).toBe(true);
    expect(server.asked.some(([k, bot, f]) => k === 'list' && bot === 'acme' && (f as Rec).status === 'in_progress')).toBe(true);
    board.stop();
    expect(server.streams[0].open).toBe(false);
    server.failing.delete('broken');
    server.calls['acme/c1'].events.push({ t: at(14), seq: 77, elapsed_s: 14, event: 'agent_said', text: 'Back.' });
    await board.start();
    expect(last.errors).toEqual([]);
    expect(last.calls.find((c) => c.summary.id === 'c1')?.records.at(-1)?.seq).toBe(77);
    expect(server.streams.filter((s) => s.open).length).toBe(1);
    board.setBots([{ id: 'other' }]);
    expect(last.calls.some((c) => c.summary.bot === 'acme')).toBe(false);
    board.stop();
  });
});
