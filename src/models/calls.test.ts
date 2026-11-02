import { describe, expect, it } from 'vitest';
import type { CallSummaryItem } from '../api/types';
import {
  CALL_STATUS,
  OUTCOME_STATUS,
  appendRecords,
  callerHint,
  callsWithoutGaps,
  channelLabel,
  channelsIn,
  countsLine,
  formatSeconds,
  latestPages,
  mergeCalls,
  outcomeHint,
  queryFor,
  readCallPage,
  recordsQuery,
  sinceFor,
  statusOf,
  tokensOf,
} from './calls';

const call = (fields: Partial<CallSummaryItem>): CallSummaryItem => ({
  id: 'c',
  room: 'r',
  bot: 'a',
  channel: 'web_chat',
  caller: '',
  started_at: '2026-10-14T10:00:00Z',
  status: 'ended',
  duration_s: 0,
  version: '0.1.0',
  ...fields,
});

describe('call outcomes and status', () => {
  it('filters the API on a status it knows for every outcome', () => {
    expect(Object.values(OUTCOME_STATUS)).toEqual(['ended', 'ended', 'unfinished', 'in_progress']);
  });

  it('says what an outcome means, naming repeated hand-overs', () => {
    expect(outcomeHint('handed_over', 3)).toMatch(/3 times/);
    expect(outcomeHint('handed_over', 1)).toMatch(/to a person/);
    expect(outcomeHint('cut_off')).toBe(CALL_STATUS.unfinished.hint);
  });

  it('words a status for people, and a status the studio does not know as it is', () => {
    expect(statusOf('ended').label).toBe('Ended');
    expect(statusOf('in_progress').tone).toBe('warning');
    expect(CALL_STATUS.unfinished.hint).toMatch(/worker stopped|cut off/);
    expect(statusOf('weird').label).toBe('weird');
  });

  it('names channels and callers in words', () => {
    expect(channelLabel({ type: 'sip_voice' })).toBe('Phone');
    expect(channelLabel({ id: 'web-chat', type: 'web_chat' })).toBe('Web chat');
    expect(channelLabel({ id: 'kiosk', type: 'kiosk' })).toBe('kiosk');
    expect(callerHint({ id: 'web-chat', type: 'web_chat' })).toBe('Web visitor');
    expect(callerHint({ id: 'phone', type: 'sip_voice' })).toBe('No number');
  });

  it('formats seconds, rounding before it splits (never "1 min 60 s")', () => {
    expect(formatSeconds(30)).toBe('30 s');
    expect(formatSeconds(125)).toBe('2 min 5 s');
    expect(formatSeconds(3900)).toBe('1 h 5 min');
    expect(formatSeconds(undefined)).toBe('');
    expect([59.7, 119.6, 3599.7].map(formatSeconds)).toEqual(['1 min', '2 min', '1 h 0 min']);
  });
});

describe('the filters become the API’s query', () => {
  it('leaves out what is empty', () => {
    const now = Date.parse('2026-10-14T12:00:00Z');
    expect(sinceFor('24h', now)).toBe('2026-10-13T12:00:00.000Z');
    expect(sinceFor('all', now)).toBeUndefined();
    expect(queryFor({ range: '7d', caller: ' +65 ', channel: 'web-chat', status: 'ended' }, { limit: 10, cursor: '10', nowMs: now })).toEqual({
      limit: 10,
      cursor: '10',
      since: '2026-10-07T12:00:00.000Z',
      caller: '+65',
      channel: 'web-chat',
      status: 'ended',
    });
    expect(queryFor({ range: 'all' }, { nowMs: now })).toEqual({ limit: 25, cursor: undefined, since: undefined, caller: undefined, channel: undefined, status: undefined });
  });
});

describe('several agents’ calls in one list', () => {
  it('merges newest first, the same call never twice, and lists the channels seen', () => {
    const a = { calls: [call({ id: 'a1', started_at: '2026-10-14T10:00:00Z' }), call({ id: 'a2', started_at: '2026-10-12T10:00:00Z' })] };
    const b = { calls: [call({ id: 'b1', bot: 'b', started_at: '2026-10-13T10:00:00Z' }), call({ id: 'a1', started_at: '2026-10-14T10:00:00Z' })] };
    expect(mergeCalls([a, b, null]).map((c) => c.id)).toEqual(['a1', 'b1', 'a2']);
    expect(mergeCalls([{ calls: [call({ id: 'x' }), call({ id: 'x', bot: 'b' })] }]).length).toBe(2);
    expect(
      channelsIn([{ channel: { id: 'web-chat', type: 'web_chat' } }, { channel: { id: 'web-chat', type: 'web_chat' } }, { channel: { id: 'phone', type: 'sip_voice' } }, {}]).map((c) => c.id)
    ).toEqual(['web-chat', 'phone']);
  });

  it('shows no gap: the list stops where an agent with more to send has sent nothing older yet', () => {
    const at = (h: number) => new Date(Date.UTC(2026, 9, 25, 12) - h * 3600e3).toISOString();
    const a = { id: 'a', calls: [0, 2, 4, 6].map((h) => call({ bot: 'a', id: `a${h}`, started_at: at(h) })), next: 'more', error: null };
    const b = { id: 'b', calls: [1, 10, 30, 70].map((h) => call({ bot: 'b', id: `b${h}`, started_at: at(h) })), next: null, error: null };
    expect(callsWithoutGaps([a, b], ['a']).map((c) => c.id)).toEqual(['a0', 'b1', 'a2', 'a4', 'a6']);
    expect(callsWithoutGaps([a, b], []).length).toBe(8);
    const later = { ...a, calls: [call({ bot: 'a', id: 'a9', started_at: at(9) })], next: null };
    expect(latestPages([{ a, b }, { a: later }]).a.next).toBeNull();
  });
});

describe('countsLine', () => {
  it('tallies a call’s records in words, naming the kinds it knows, and says nothing when there are none', () => {
    expect(countsLine(undefined)).toBe('');
    expect(countsLine({})).toBe('');
    expect(countsLine({ user_said: 0 })).toBe('');
    expect(countsLine({ user_said: 3, agent_said: 4, tool_called: 1, http_request: 2, error: 1 })).toBe(
      '11 records: 3 from the caller, 4 from the agent, 1 tool call, 2 API requests, 1 error'
    );
    expect(countsLine({ call_started: 1 })).toBe('1 record');
    expect(countsLine({ user_said: 1, sentiment_scored: 2 })).toBe('3 records: 1 from the caller');
  });
});

describe('a call’s records, paged', () => {
  it('asks for a page after a seq, of some kinds only', () => {
    expect(recordsQuery()).toEqual({ limit: 500 });
    expect(recordsQuery({ after: 12, limit: 50, kinds: ['user_said', 'agent_said'] })).toEqual({ after: 12, limit: 50, kinds: 'user_said,agent_said' });
  });

  it('reads a page defensively, and carries on from the last seq when the server does not say', () => {
    const page = readCallPage({ call: call({ id: 'c1' }), events: [{ seq: 4 }, { seq: 5 }], more: true, counts: { user_said: 2, odd: 'x' }, usage: [{ input_tokens: 10, output_tokens: 3 }] }, 3);
    expect(page).toMatchObject({ nextAfter: 5, more: true, complete: false, counts: { user_said: 2 }, finalState: null });
    expect(page.call?.id).toBe('c1');
    expect(tokensOf(page.usage)).toEqual({ input: 10, output: 3 });
    expect(readCallPage(null, 7)).toMatchObject({ call: null, events: [], nextAfter: 7, more: false });
    expect(readCallPage({ events: [], next_after: 9 }).nextAfter).toBe(9);
  });

  it('adds new records once each, in order, and keeps the same list when nothing is new', () => {
    const held = [{ seq: 1 }, { seq: 3 }];
    expect(appendRecords(held, [{ seq: 2 }, { seq: 3 }]).map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(appendRecords(held, [{ seq: 1 }])).toBe(held);
  });
});
