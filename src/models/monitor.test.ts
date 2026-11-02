import { describe, expect, it } from 'vitest';
import { analyse, callLength, changeWords, deltaOf, issuesOf, MIN_FOR_ALERT, pct, percentile, seconds, type MonitorCall } from './monitor';
import { fewAtATime, type CallFacts } from './callData';

// Ported from Weave React's tests/monitor.test.js: Monitoring's numbers from calls.
const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const H = 3600 * 1000;
let n = 0;
const call = (bot: string, hoursAgo: number, extra: Partial<MonitorCall> = {}): MonitorCall => {
  n += 1;
  return {
    id: `c${n}`,
    bot,
    started_at: new Date(NOW - hoursAgo * H).toISOString(),
    status: 'ended',
    duration_s: 60,
    caller_turns: 3,
    handoffs: 0,
    version: '0.1.0',
    ref: 'production',
    ...extra,
  };
};
type TurnIn = { say?: string; tools?: { tool: string; error?: string }[]; waitMs?: number };
const facts = (turns: TurnIn[], extra: Partial<CallFacts> = {}): CallFacts => ({
  channelId: '',
  startAgent: '',
  finalAgent: '',
  finalState: {},
  ended: true,
  handoffs: 0,
  opening: [],
  turns: turns.map((t) => ({
    say: t.say || 'hello there friend',
    at: undefined,
    said: ['ok'],
    tools: (t.tools || []).map((x) => ({ tool: x.tool, args: {}, result: null, error: x.error || '', handoff: '' })),
    waitMs: t.waitMs ?? 1200,
  })),
  errors: [],
  ...extra,
});
const bots = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Beta' },
];

describe('Monitoring numbers', () => {
  it('percentiles and formats', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(percentile([], 50)).toBeNull();
    expect(pct(0.256)).toBe('26%');
    expect(pct(null)).toBe('—');
    expect(seconds(1200)).toBe('1.2 s');
    expect(seconds(23000)).toBe('23 s');
    expect(seconds(undefined)).toBe('—');
    expect(deltaOf(12, 10)).toBe('+2');
    expect(deltaOf(8, 10)).toBe('−2');
    expect(deltaOf(5, 5)).toBe('no change');
    expect(deltaOf(5, 0)).toBe('');
    expect(callLength(45)).toBe('45 s');
    expect(callLength(119.6)).toBe('2 min');
    expect(callLength(185)).toBe('3 min 5 s');
    expect(callLength(undefined)).toBe('');
  });

  it('says a change in calls in words, never as a bare minus that reads as minus calls', () => {
    expect(changeWords(8, 12, 'the week before')).toBe('Down from 12 the week before');
    expect(changeWords(12, 8)).toBe('Up from 8 the period before');
    expect(changeWords(5, 5, 'the week before')).toBe('The same as the week before');
    expect(changeWords(5, 0)).toBe('');
    expect(changeWords(undefined, 3)).toBe('');
    expect(changeWords(8, 12)).not.toMatch(/[-−]\s*\d/);
  });

  it('counts only the period, and compares with the one before', () => {
    const calls = [call('a', 2), call('a', 30), call('a', 24 * 8), call('a', 24 * 20)];
    const r = analyse({ calls, bots, nowMs: NOW, days: 7 });
    expect(r.totals.calls).toBe(2);
    expect(r.previous.calls).toBe(1);
    expect(r.series).toHaveLength(7);
    expect(r.series.reduce((s, d) => s + d.calls, 0)).toBe(2);
  });

  it('gives a day with no calls a bar still', () => {
    const r = analyse({ calls: [call('a', 1)], bots, nowMs: NOW, days: 7 });
    expect(r.series.filter((d) => d.calls === 0)).toHaveLength(6);
  });

  it('works out hand-overs and cut-offs as shares of calls, unknown with no calls', () => {
    const calls = [call('a', 1, { handoffs: 1 }), call('a', 2), call('a', 3, { status: 'unfinished' }), call('a', 4)];
    const r = analyse({ calls, bots, nowMs: NOW, days: 7 });
    expect(r.totals.handoffRate).toBe(0.25);
    expect(r.totals.cutOffRate).toBe(0.25);
    const none = analyse({ calls: [], bots, nowMs: NOW, days: 7 });
    expect(none.totals.handoffRate).toBeNull();
    expect(none.totals.calls).toBe(0);
    expect(none.attention).toEqual([]);
  });

  it('takes answer times and tool failures from the calls whose records were read', () => {
    const c1 = call('a', 1);
    const c2 = call('a', 2);
    const samples = {
      [`a/${c1.id}`]: facts([
        { waitMs: 1000, tools: [{ tool: 'x' }] },
        { waitMs: 3000, tools: [{ tool: 'x', error: 'HTTP 500' }] },
      ]),
      [`a/${c2.id}`]: facts([{ waitMs: 9000 }]),
    };
    const r = analyse({ calls: [c1, c2], samples, bots, nowMs: NOW, days: 7 });
    expect(r.totals.waitP50).toBe(3000);
    expect(r.totals.waitSamples).toBe(3);
    expect(r.totals.toolCalls).toBe(2);
    expect(r.totals.toolFailRate).toBe(0.5);
    expect(r.totals.sampled).toBe(2);
  });

  it('names what went wrong in a call: cut off, tool failed, repeated, slow', () => {
    const kinds = (s: { status: string }, f: CallFacts | null) => issuesOf(s, f).map((i) => i.kind);
    expect(kinds({ status: 'unfinished' }, null)).toEqual(['cut_off']);
    expect(kinds({ status: 'ended' }, facts([{ tools: [{ tool: 't', error: 'boom' }] }]))).toEqual(['tool_failed']);
    expect(kinds({ status: 'ended' }, facts([{ say: 'where is my order please' }, { say: 'where is my order please' }]))).toEqual(['repeated']);
    expect(kinds({ status: 'ended' }, facts([{ waitMs: 12000 }]))).toEqual(['slow']);
    expect(kinds({ status: 'ended' }, facts([{}], { errors: ['The runtime stopped.'] }))).toEqual(['error']);
    expect(kinds({ status: 'ended' }, facts([{ say: 'hi' }, { say: 'hi' }]))).toEqual([]);
    expect(kinds({ status: 'ended' }, facts([{}]))).toEqual([]);
  });

  it('orders calls needing attention by seriousness, then by how recent', () => {
    const cut = call('a', 5, { status: 'unfinished' });
    const slow = call('b', 1);
    const bad = call('a', 3);
    const samples = { [`b/${slow.id}`]: facts([{ waitMs: 20000 }]), [`a/${bad.id}`]: facts([{ tools: [{ tool: 't', error: 'x' }] }]) };
    const r = analyse({ calls: [cut, slow, bad], samples, bots, nowMs: NOW, days: 7 });
    expect(r.attention.map((a) => a.callId)).toEqual([bad.id, cut.id, slow.id]);
    expect(r.attention[0].name).toBe('Alpha');
    expect(r.issues.at(-1)?.kind).toBe('slow');
    expect(r.issues.find((i) => i.kind === 'cut_off')?.count).toBe(1);
  });

  const manyOf = (bot: string, version: string, count: number, over: (i: number) => Partial<MonitorCall>, hoursFrom = 1) =>
    Array.from({ length: count }, (_, i) => call(bot, hoursFrom + i * 3, { version, ...over(i) }));

  it('raises a newer version doing clearly worse, with what is worse and what to roll back to', () => {
    const was = manyOf('a', '0.1.0', 6, () => ({}), 100);
    const now = manyOf('a', '0.1.1', 6, (i) => (i < 3 ? { status: 'unfinished' } : {}), 1);
    const r = analyse({ calls: [...was, ...now], bots, nowMs: NOW, days: 14 });
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0].version).toBe('0.1.1');
    expect(r.alerts[0].previousVersion).toBe('0.1.0');
    expect(r.alerts[0].details[0]).toMatch(/calls cut off: 50% against 0%/);
    expect(r.versions[0].rows[0].version).toBe('0.1.1');
  });

  it('never raises an alert on too few calls', () => {
    const was = manyOf('a', '0.1.0', MIN_FOR_ALERT - 1, () => ({}), 100);
    const now = manyOf('a', '0.1.1', MIN_FOR_ALERT, () => ({ status: 'unfinished' }), 1);
    expect(analyse({ calls: [...was, ...now], bots, nowMs: NOW, days: 14 }).alerts).toEqual([]);
  });

  it('raises nothing for a version that is not worse, and the draft is not a version', () => {
    const was = manyOf('a', '0.1.0', 6, () => ({}), 100);
    const now = manyOf('a', '0.1.1', 6, () => ({}), 1);
    const drafts = manyOf('a', 'draft', 6, () => ({ status: 'unfinished' }), 2);
    const r = analyse({ calls: [...was, ...now, ...drafts], bots, nowMs: NOW, days: 14 });
    expect(r.alerts).toEqual([]);
    expect(r.versions[0].rows.some((row) => row.version === 'draft')).toBe(false);
  });

  it('lists every agent, busiest first, with the calls of the period before', () => {
    const calls = [call('b', 1), call('b', 2), call('a', 3), call('a', 24 * 9)];
    const r = analyse({ calls, bots: [...bots, { id: 'c', name: 'Gamma' }], nowMs: NOW, days: 7 });
    expect(r.perAgent.map((p) => p.bot)).toEqual(['b', 'a', 'c']);
    expect(r.perAgent[1].previousCalls).toBe(1);
    expect(r.perAgent[2].calls).toBe(0);
  });

  it('uses the reader’s own days: a late-evening call is on that day’s bar, and the calls counted are the calls charted', () => {
    const now = new Date(2026, 9, 25, 10, 0).getTime();
    const at = (d: number, h: number, m = 0) => ({ ...call('a', 0), started_at: new Date(2026, 9, d, h, m).toISOString() });
    const calls = [at(20, 23, 30), at(25, 0, 15), at(18, 12), at(13, 9), at(12, 9)];
    const r = analyse({ calls, bots, nowMs: now, days: 7 });
    expect(r.series.map((d) => d.day)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
    expect(r.series.find((d) => d.day === '2026-10-20')?.calls).toBe(1);
    expect(r.series.at(-1)?.calls).toBe(1);
    expect(r.totals.calls).toBe(r.series.reduce((sum, d) => sum + d.calls, 0));
    expect(r.previous.calls).toBe(2);
  });
});

describe('reading calls a few at a time', () => {
  it('never runs more at once, a slow one holds up only its own place, and the answers keep their order', async () => {
    let running = 0;
    let most = 0;
    const started: number[] = [];
    const answers = await fewAtATime([300, 10, 10, 10, 10, 10], 2, async (ms) => {
      started.push(ms);
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, ms));
      running -= 1;
      return ms * 2;
    });
    expect(answers).toEqual([600, 20, 20, 20, 20, 20]);
    expect(most).toBe(2);
    expect(started).toHaveLength(6);
    expect(await fewAtATime([], 4, async () => 1)).toEqual([]);
  });

  it('lets the others finish while a slow one is still out', async () => {
    const done: string[] = [];
    await fewAtATime(['slow', 'a', 'b', 'c'], 2, async (id) => {
      await new Promise((resolve) => setTimeout(resolve, id === 'slow' ? 200 : 10));
      done.push(id);
    });
    expect(done).toEqual(['a', 'b', 'c', 'slow']);
  });
});
