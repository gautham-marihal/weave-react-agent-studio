import { describe, expect, it } from 'vitest';
import type { CallSummaryItem } from '../api/types';
import { callChannel, callEnvironment, callOutcome, summarizeCalls, toCallRecord } from './callRecords';

describe('callOutcome', () => {
  it('reads the end of a call', () => {
    expect(callOutcome('ended')).toBe('resolved');
    expect(callOutcome('ended', 1)).toBe('handed_over');
    expect(callOutcome('unfinished')).toBe('cut_off');
  });
  it('never calls a call that is still going "abandoned"', () => {
    expect(callOutcome('in_progress')).toBe('in_progress');
  });
});

describe('callChannel', () => {
  it('reads the channel type', () => {
    expect(callChannel({ id: 'web-chat', type: 'web_chat' })).toBe('web_chat');
    expect(callChannel({ id: 'phone', type: 'sip_voice' })).toBe('phone');
    expect(callChannel('web_voice')).toBe('web_voice');
  });
});

describe('callEnvironment', () => {
  it('maps the ref the call ran on', () => {
    expect(callEnvironment('draft')).toBe('test');
    expect(callEnvironment('production')).toBe('production');
    expect(callEnvironment('0.1.0')).toBe('other');
    expect(callEnvironment('latest')).toBe('other');
  });
});

describe('toCallRecord', () => {
  // Shaped like a real GET /bots/{id}/calls item.
  const item: CallSummaryItem = {
    id: 'test-nimbus-care-6f7d61aa_20261022T083409Z',
    room: 'test-nimbus-care-6f7d61aa',
    bot: 'nimbus-care',
    ref: 'draft',
    version: '0.1.1',
    channel: { id: 'web-chat', type: 'web_chat' },
    caller: 'preview-h0to',
    dialled: null,
    started_at: '2026-10-22T08:34:10.203Z',
    status: 'ended',
    duration_s: 361,
    caller_turns: 0,
    agent_turns: 4,
    handoffs: 0,
  };

  it('keeps what the server said and the agent it belongs to', () => {
    expect(toCallRecord(item, 'fallback')).toMatchObject({
      id: item.id,
      agentId: 'nimbus-care',
      channel: 'web_chat',
      environment: 'test',
      ref: 'draft',
      outcome: 'resolved',
      caller: 'preview-h0to',
      duration_s: 361,
    });
  });

  it('says who called when the call has no number: a web visitor, or a withheld number', () => {
    expect(toCallRecord({ ...item, caller: '' }, 'a').caller).toBe('Web visitor');
    expect(toCallRecord({ ...item, caller: '', channel: { id: 'phone', type: 'sip_voice' } }, 'a').caller).toBe('No number');
  });

  it('uses the listing agent when the record has no bot', () => {
    expect(toCallRecord({ ...item, bot: undefined }, 'fallback').agentId).toBe('fallback');
  });
});

describe('summarizeCalls', () => {
  const base = toCallRecord(
    { id: 'c', room: 'r', bot: 'a', ref: 'production', version: '1.0.0', channel: 'web_chat', caller: 'x', started_at: '2026-10-22T08:00:00Z', status: 'ended', duration_s: 10 },
    'a'
  );
  const call = (outcome: typeof base.outcome) => ({ ...base, outcome });

  it('works out shares over the calls that have ended', () => {
    expect(summarizeCalls([call('resolved'), call('handed_over'), call('cut_off'), call('resolved'), call('in_progress')])).toEqual({
      calls: 5,
      handoverRate: 0.25,
      cutoffRate: 0.25,
      inProgress: 1,
    });
  });

  it('has no rates, not zero rates, when no call has ended', () => {
    expect(summarizeCalls([])).toEqual({ calls: 0, handoverRate: null, cutoffRate: null, inProgress: 0 });
    expect(summarizeCalls([call('in_progress')]).handoverRate).toBeNull();
  });
});
