import { describe, expect, it } from 'vitest';
import {
  alertAction,
  alertAsText,
  alertsByAgent,
  effectiveRules,
  evaluateAlerts,
  lookback,
  reconcile,
  RULES,
  sentenceParts,
  snoozeUntil,
  withStatus,
  type Alert,
} from './alerts';
import type { CallFacts } from './callData';
import type { MonitorCall } from './monitor';

// Ported from the alerts half of Weave React's tests/insights.test.js.
const NOW = '2026-10-20T12:00:00.000Z';
const nowMs = Date.parse(NOW);

const summary = (bot: string, id: string, minutesAgo: number, extra: Partial<MonitorCall> = {}): MonitorCall => ({
  bot,
  id,
  started_at: new Date(nowMs - minutesAgo * 60e3).toISOString(),
  status: 'ended',
  handoffs: 0,
  ...extra,
});
const factsWith = (turns: Partial<CallFacts['turns'][number]>[], errors: string[] = [], waits?: CallFacts['waits']): CallFacts => ({
  channelId: '',
  startAgent: '',
  finalAgent: '',
  finalState: {},
  ended: true,
  handoffs: 0,
  opening: [],
  turns: turns.map((t) => ({ say: 'x', at: undefined, said: [], tools: [], waitMs: null, ...t })),
  errors,
  ...(waits ? { waits } : {}),
});
const tool = (name: string, error = '') => ({ tool: name, args: {}, result: null, error, handoff: '' });
const alertOf = (extra: Partial<Alert> = {}): Alert => ({
  key: 'tool_failing|a|find_order',
  rule: 'tool_failing',
  severity: 'critical',
  bot: 'a',
  botName: 'Acme',
  subject: 'find_order',
  why: '',
  title: 'T',
  detail: 'D',
  count: 3,
  since: null,
  callIds: [],
  action: { kind: 'tool', tool: 'find_order' },
  ...extra,
});

describe('alert rules', () => {
  it('raises a tool failing on enough calls in the window, with the error and the calls it failed in', () => {
    const calls = [summary('a', '1', 5), summary('a', '2', 10), summary('a', '3', 20), summary('a', '4', 50)];
    const failed = factsWith([{ tools: [tool('find_order', 'HTTP 503')] }]);
    const facts = Object.fromEntries(calls.map((c) => [`a/${c.id}`, failed]));
    const alerts = evaluateAlerts({ calls, facts, bots: [{ id: 'a', name: 'Acme' }], nowMs });
    const found = alerts.find((a) => a.rule === 'tool_failing');
    expect(found?.title).toBe('“find_order” is failing');
    expect(found?.detail).toBe('It failed on 3 calls in the last 30 minutes (HTTP 503).');
    expect(found?.callIds).toEqual(['1', '2', '3']);
    expect(found?.severity).toBe('critical');
    expect(found?.action).toEqual({ kind: 'tool', tool: 'find_order' });
    expect(evaluateAlerts({ calls: calls.slice(0, 2), facts, bots: [{ id: 'a' }], nowMs }).filter((a) => a.rule === 'tool_failing')).toHaveLength(0);
    expect(evaluateAlerts({ calls, facts, nowMs, rules: effectiveRules({ tool_failing: { params: { count: 4 } } }) }).filter((a) => a.rule === 'tool_failing')).toHaveLength(0);
    expect(evaluateAlerts({ calls, facts, nowMs, rules: effectiveRules({ tool_failing: { enabled: false } }) }).filter((a) => a.rule === 'tool_failing')).toHaveLength(0);
  });

  it('raises a spike of cut-off calls only over enough calls and well above the agent’s usual', () => {
    const recent = [summary('a', 'r1', 5, { status: 'unfinished' }), summary('a', 'r2', 10, { status: 'unfinished' }), summary('a', 'r3', 15), summary('a', 'r4', 20)];
    const quietWeek = Array.from({ length: 20 }, (_, i) => summary('a', `w${i}`, 60 * 24 + i * 60));
    const cut = evaluateAlerts({ calls: [...recent, ...quietWeek], nowMs }).find((a) => a.rule === 'cut_off');
    expect(cut?.title).toBe('50% of calls were cut off');
    expect(cut?.detail).toBe('2 of 4 calls in the last hour; usually 0%.');
    const roughWeek = quietWeek.map((c, i) => (i % 2 ? { ...c, status: 'unfinished' } : c));
    expect(evaluateAlerts({ calls: [...recent, ...roughWeek], nowMs }).filter((a) => a.rule === 'cut_off')).toHaveLength(0);
    expect(evaluateAlerts({ calls: [...recent.slice(0, 3), ...quietWeek], nowMs }).filter((a) => a.rule === 'cut_off')).toHaveLength(0);
  });

  it('raises no calls for hours where there usually are some, and leaves an agent that rarely gets calls alone', () => {
    const busyWeek = Array.from({ length: 7 * 48 }, (_, i) => summary('a', `b${i}`, 60 * 4 + i * 30));
    const silent = evaluateAlerts({ calls: busyWeek, bots: [{ id: 'a', name: 'Acme' }], nowMs }).find((a) => a.rule === 'no_calls');
    expect(silent?.detail).toBe('No calls in the last 3 hours; it usually gets about 6 in that time.');
    const rare = busyWeek.filter((_, i) => i % 48 === 0);
    expect(evaluateAlerts({ calls: rare, bots: [{ id: 'a' }], nowMs }).filter((a) => a.rule === 'no_calls')).toHaveLength(0);
  });

  it('raises slow answers and recorded errors', () => {
    const calls = [summary('a', '1', 5), summary('a', '2', 15), summary('a', '3', 25)];
    const slow = factsWith([{ said: ['y'], waitMs: 12000 }], ['The model timed out']);
    const alerts = evaluateAlerts({ calls, facts: Object.fromEntries(calls.map((c) => [`a/${c.id}`, slow])), nowMs });
    expect(alerts.find((a) => a.rule === 'slow')?.detail).toMatch(/One answer in ten took 12\.0 s or more in the last hour \(over 3 answers\)/);
    expect(alerts.find((a) => a.rule === 'errors')?.detail).toMatch(/3 calls recorded an error in the last 30 minutes, for example: The model timed out/);
    // a voice call's wait as Speed measures it is the one that counts, not the bare gap between the words
    const voice = factsWith([{ said: ['y'], waitMs: 7000 }], [], [{ ms: 9500, say: 'x' }]);
    const heard = evaluateAlerts({ calls, facts: Object.fromEntries(calls.map((c) => [`a/${c.id}`, voice])), nowMs }).find((a) => a.rule === 'slow');
    expect(heard?.detail).toMatch(/took 9\.5 s or more/);
  });

  it('gives every rule words and sensible numbers, holds a change to its range, and looks back over the longest window', () => {
    RULES.forEach((r) => {
      expect(r.label && r.sentence && r.why).toBeTruthy();
      Object.keys(r.params).forEach((k) => expect(r.sentence).toContain(`{${k}}`));
    });
    const rules = effectiveRules({ tool_failing: { params: { count: 0, minutes: 99999 } } });
    expect(rules.find((r) => r.id === 'tool_failing')?.params).toEqual({ count: 1, minutes: 1440 });
    expect(lookback(rules).recordsMs).toBe(1440 * 60e3);
    expect(sentenceParts('Warn when {count} or more.')).toEqual([{ text: 'Warn when ' }, { field: 'count' }, { text: ' or more.' }]);
  });
});

describe('the record of alerts (kept in this browser)', () => {
  it('keeps an alert still open however old it is and however many others came and went, so it never fires again as new', () => {
    const long = alertOf({ key: 'tool_failing|a|x' });
    let { state } = reconcile({ history: [], acks: {} }, [long], nowMs);
    let fired: Alert[];
    state = { ...state, acks: { [long.key]: { at: NOW, by: 'Sam' } } };
    for (let i = 0; i < 250; i += 1) {
      const t = nowMs + (i + 1) * 4 * 3600e3;
      const flap = { ...long, key: `flap|${i}`, rule: 'slow' as const };
      ({ state } = reconcile(state, [long, flap], t));
      ({ state, fired } = reconcile(state, [long], t + 60e3));
      expect(fired).toHaveLength(0);
    }
    expect(state.history.some((h) => h.key === long.key && !h.clearedAt)).toBe(true);
    expect(state.acks[long.key]).toBeTruthy();
    expect(state.history.length).toBeLessThanOrEqual(200);
  });

  it('leaves the alerts of agents a check did not look at as they were (not cleared, still acknowledged)', () => {
    const theirs = alertOf();
    let { state } = reconcile({ history: [], acks: {} }, [theirs], nowMs, new Set(['a']));
    state = { ...state, acks: { [theirs.key]: { at: NOW, by: 'Sam' } } };
    ({ state } = reconcile(state, [], nowMs + 60e3, new Set(['b'])));
    expect(state.history[0].clearedAt).toBeNull();
    expect(state.acks[theirs.key]).toBeTruthy();
    ({ state } = reconcile(state, [], nowMs + 120e3, new Set()));
    expect(state.history[0].clearedAt).toBeNull();
    ({ state } = reconcile(state, [], nowMs + 180e3, new Set(['a'])));
    expect(state.history[0].clearedAt).toBeTruthy();
  });

  it('fires a new alert once; “I’m on it” holds until it clears, and a snooze runs out', () => {
    const alert = alertOf();
    let { state, fired } = reconcile({ history: [], acks: {} }, [alert], nowMs);
    expect(fired).toHaveLength(1);
    expect(state.history[0].clearedAt).toBeNull();
    ({ state, fired } = reconcile(state, [{ ...alert, count: 5, detail: 'D5' }], nowMs + 60e3));
    expect(fired).toHaveLength(0);
    expect(state.history[0].detail).toBe('D5');
    state = { ...state, acks: { [alert.key]: { at: NOW, by: 'Sam' } } };
    expect(withStatus([alert], state.acks, nowMs)[0].status).toBe('seen');
    ({ state } = reconcile(state, [], nowMs + 120e3));
    expect(state.history[0].clearedAt).toBeTruthy();
    expect(state.acks).toEqual({});
    ({ state, fired } = reconcile(state, [alert], nowMs + 180e3));
    expect(fired).toHaveLength(1);
    const snoozed = { ...state, acks: { [alert.key]: { until: new Date(nowMs + 3600e3).toISOString() } } };
    expect(withStatus([alert], snoozed.acks, nowMs)[0].status).toBe('snoozed');
    expect(withStatus([alert], snoozed.acks, nowMs + 2 * 3600e3)[0].status).toBe('new');
    expect(reconcile(snoozed, [alert], nowMs + 2 * 3600e3).state.acks[alert.key]).toBeUndefined();
    expect(alertAsText(alert, 'https://x')).toMatch(/^\[Critical\] Acme: T\nD\nhttps:\/\/x$/);
  });

  it('counts each agent’s alerts that are not snoozed, and the critical ones', () => {
    const list = withStatus(
      [alertOf(), alertOf({ key: 'slow|a|', rule: 'slow', severity: 'warning' }), alertOf({ key: 'x|b|', bot: 'b' })],
      { 'x|b|': { until: new Date(nowMs + 3600e3).toISOString() } },
      nowMs,
    );
    expect(alertsByAgent(list)).toEqual({ a: { count: 2, critical: 1 } });
  });

  it('snoozes for an hour, four hours, or until 9:00 tomorrow on the reader’s clock', () => {
    expect(Date.parse(snoozeUntil('hour', nowMs)) - nowMs).toBe(3600e3);
    expect(Date.parse(snoozeUntil('four', nowMs)) - nowMs).toBe(4 * 3600e3);
    const tomorrow = new Date(snoozeUntil('tomorrow', nowMs));
    expect(tomorrow.getHours()).toBe(9);
    expect(tomorrow.getTime()).toBeGreaterThan(nowMs);
  });
});

describe('what an alert asks for', () => {
  it('opens the tool, the channels, the calls or the release to go back to', () => {
    expect(alertAction(alertOf())).toEqual({ label: 'Open “find_order”', to: '/agents/a/build/tools' });
    expect(alertAction(alertOf({ action: { kind: 'channels' } })).to).toBe('/agents/a/build/channels');
    expect(alertAction(alertOf({ action: { kind: 'calls', status: 'unfinished' } })).to).toBe('/calls?agent=a&outcome=cut_off');
    expect(alertAction(alertOf({ action: { kind: 'rollback', version: '0.1.0' } }))).toEqual({ label: 'Put v0.1.0 back…', to: '/agents/a/release?deploy=0.1.0' });
  });
});
