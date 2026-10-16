import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse, deltaOf, issuesOf, percentile, pct, seconds, MIN_FOR_ALERT } from '../src/studio/monitoring/monitorModel.js';

const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const H = 3600 * 1000;
let n = 0;
const call = (bot, hoursAgo, extra = {}) => { n += 1; return { id: `c${n}`, bot, started_at: new Date(NOW - hoursAgo * H).toISOString(), status: 'ended', duration_s: 60, caller_turns: 3, agent_turns: 3, handoffs: 0, version: '0.1.0', ref: 'production', ...extra }; };
const facts = (turns, extra = {}) => ({ turns: turns.map((t) => ({ say: t.say || 'hello there friend', said: ['ok'], tools: t.tools || [], waitMs: t.waitMs ?? 1200 })), errors: [], ...extra });
const bots = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }];

test('percentiles and formats', () => {
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9);
  assert.equal(percentile([], 50), null);
  assert.equal(pct(0.256), '26%'); assert.equal(pct(null), '—');
  assert.equal(seconds(1200), '1.2 s'); assert.equal(seconds(23000), '23 s'); assert.equal(seconds(undefined), '—');
  assert.equal(deltaOf(12, 10), '+2'); assert.equal(deltaOf(8, 10), '−2'); assert.equal(deltaOf(5, 5), 'no change'); assert.equal(deltaOf(5, 0), '');
});

test('totals count only the period, and compare with the one before', () => {
  const calls = [call('a', 2), call('a', 30), call('a', 24 * 8), call('a', 24 * 20)];
  const r = analyse({ calls, bots, nowMs: NOW, days: 7 });
  assert.equal(r.totals.calls, 2); assert.equal(r.previous.calls, 1);
  assert.equal(r.series.length, 7); assert.equal(r.series.reduce((s, d) => s + d.calls, 0), 2);
});

test('a day with no calls still has a bar', () => {
  const r = analyse({ calls: [call('a', 1)], bots, nowMs: NOW, days: 7 });
  assert.equal(r.series.filter((d) => d.calls === 0).length, 6);
});

test('rates: hand-overs and cut-offs are shares of calls, and unknown with no calls', () => {
  const calls = [call('a', 1, { handoffs: 1 }), call('a', 2), call('a', 3, { status: 'unfinished' }), call('a', 4)];
  const r = analyse({ calls, bots, nowMs: NOW, days: 7 });
  assert.equal(r.totals.handoffRate, 0.25); assert.equal(r.totals.cutOffRate, 0.25);
  const none = analyse({ calls: [], bots, nowMs: NOW, days: 7 });
  assert.equal(none.totals.handoffRate, null); assert.equal(none.totals.calls, 0); assert.deepEqual(none.attention, []);
});

test('answer times and tool failures come from the calls whose records were read', () => {
  const c1 = call('a', 1); const c2 = call('a', 2);
  const samples = {
    [`a/${c1.id}`]: facts([{ waitMs: 1000, tools: [{ tool: 'x', error: '' }] }, { waitMs: 3000, tools: [{ tool: 'x', error: 'HTTP 500' }] }]),
    [`a/${c2.id}`]: facts([{ waitMs: 9000 }]),
  };
  const r = analyse({ calls: [c1, c2], samples, bots, nowMs: NOW, days: 7 });
  assert.equal(r.totals.waitP50, 3000); assert.equal(r.totals.waitSamples, 3);
  assert.equal(r.totals.toolCalls, 2); assert.equal(r.totals.toolFailRate, 0.5);
  assert.equal(r.totals.sampled, 2);
});

test('what went wrong in a call is named: cut off, tool failed, repeated, slow', () => {
  const kinds = (s, f) => issuesOf(s, f).map((i) => i.kind);
  assert.deepEqual(kinds({ status: 'unfinished' }, null), ['cut_off']);
  assert.deepEqual(kinds({ status: 'ended' }, facts([{ tools: [{ tool: 't', error: 'boom' }] }])), ['tool_failed']);
  assert.deepEqual(kinds({ status: 'ended' }, facts([{ say: 'where is my order please' }, { say: 'where is my order please' }])), ['repeated']);
  assert.deepEqual(kinds({ status: 'ended' }, facts([{ waitMs: 12000 }])), ['slow']);
  assert.deepEqual(kinds({ status: 'ended' }, facts([{}], { errors: ['The runtime stopped.'] })), ['error']);
  assert.deepEqual(kinds({ status: 'ended' }, facts([{ say: 'hi' }, { say: 'hi' }])), [], 'a short repeat like “hi” is not a problem');
  assert.deepEqual(kinds({ status: 'ended' }, facts([{}])), []);
});

test('calls needing attention are ordered by seriousness, then by how recent', () => {
  const cut = call('a', 5, { status: 'unfinished' }); const slow = call('b', 1); const bad = call('a', 3);
  const samples = { [`b/${slow.id}`]: facts([{ waitMs: 20000 }]), [`a/${bad.id}`]: facts([{ tools: [{ tool: 't', error: 'x' }] }]) };
  const r = analyse({ calls: [cut, slow, bad], samples, bots, nowMs: NOW, days: 7 });
  assert.deepEqual(r.attention.map((a) => a.callId), [bad.id, cut.id, slow.id]);
  assert.equal(r.attention[0].name, 'Alpha');
  assert.deepEqual(r.issues.map((i) => i.kind), ['cut_off', 'tool_failed', 'slow'].sort((x, y) => r.issues.findIndex((i) => i.kind === x) - r.issues.findIndex((i) => i.kind === y)));
  assert.equal(r.issues.find((i) => i.kind === 'cut_off').count, 1);
});

const manyOf = (bot, version, count, over, hoursFrom = 1) => Array.from({ length: count }, (_, i) => call(bot, hoursFrom + i * 3, { version, ...over(i) }));

test('a newer version doing clearly worse is raised, with what is worse and what to roll back to', () => {
  const was = manyOf('a', '0.1.0', 6, () => ({}), 100);
  const now = manyOf('a', '0.1.1', 6, (i) => (i < 3 ? { status: 'unfinished' } : {}), 1);
  const r = analyse({ calls: [...was, ...now], bots, nowMs: NOW, days: 14 });
  assert.equal(r.alerts.length, 1);
  assert.equal(r.alerts[0].version, '0.1.1'); assert.equal(r.alerts[0].previousVersion, '0.1.0');
  assert.match(r.alerts[0].details[0], /calls cut off: 50% against 0%/);
  assert.equal(r.versions[0].rows[0].version, '0.1.1', 'newest seen first');
});

test('too few calls never raise an alert', () => {
  const was = manyOf('a', '0.1.0', MIN_FOR_ALERT - 1, () => ({}), 100);
  const now = manyOf('a', '0.1.1', MIN_FOR_ALERT, () => ({ status: 'unfinished' }), 1);
  assert.deepEqual(analyse({ calls: [...was, ...now], bots, nowMs: NOW, days: 14 }).alerts, []);
});

test('a version that is not worse raises nothing, and the draft is not a version', () => {
  const was = manyOf('a', '0.1.0', 6, () => ({}), 100);
  const now = manyOf('a', '0.1.1', 6, () => ({}), 1);
  const drafts = manyOf('a', 'draft', 6, () => ({ status: 'unfinished' }), 2);
  const r = analyse({ calls: [...was, ...now, ...drafts], bots, nowMs: NOW, days: 14 });
  assert.deepEqual(r.alerts, []);
  assert.ok(!r.versions[0].rows.some((row) => row.version === 'draft'));
});

test('per-agent rows list every agent, busiest first, with the calls of the period before', () => {
  const calls = [call('b', 1), call('b', 2), call('a', 3), call('a', 24 * 9)];
  const r = analyse({ calls, bots: [...bots, { id: 'c', name: 'Gamma' }], nowMs: NOW, days: 7 });
  assert.deepEqual(r.perAgent.map((p) => p.bot), ['b', 'a', 'c']);
  assert.equal(r.perAgent[1].previousCalls, 1); assert.equal(r.perAgent[2].calls, 0);
});
