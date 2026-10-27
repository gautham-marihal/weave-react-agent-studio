// How the agents are doing, from their calls: counts, durations, hand-overs and cut-offs, answer speed, failing tools,
// repeats, and whether a newer version does worse. Rates over few calls are shown but never raised as an alert, and the
// screen says how many calls they rest on. Pure: no network, no DOM, no clock of its own.

import { similarity } from '../replay/compareReplay.js';
import { localDay, periodOf } from '../format.js';

const list = (v) => (Array.isArray(v) ? v : []);

export const MIN_FOR_ALERT = 5; // calls of a version (and of the one before it) before it can be called worse
export const SLOW_MS = 8000; // an answer slower than this is slow
export const REGRESSION = { cutOff: 0.15, handoff: 0.2, toolFail: 0.15 }; // how much higher (as a share of calls) a rate must be to raise an alert

const rate = (n, of) => (of > 0 ? n / of : null);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const avg = (xs) => (xs.length ? sum(xs) / xs.length : null);
export function percentile(values, p) {
  const xs = list(values)
    .filter((v) => typeof v === 'number' && !Number.isNaN(v))
    .sort((a, b) => a - b);
  if (!xs.length) return null;
  const i = Math.min(xs.length - 1, Math.max(0, Math.ceil((p / 100) * xs.length) - 1));
  return xs[i];
}

// What was wrong with one call, from its summary and (when its records were read) its facts: [{ kind, severity, text }]
export const ISSUE_KINDS = {
  cut_off: { label: 'Calls that were cut off', severity: 3 },
  tool_failed: { label: 'A tool failed', severity: 3 },
  error: { label: 'An error was recorded', severity: 3 },
  repeated: { label: 'The caller had to repeat themselves', severity: 2 },
  slow: { label: 'The agent was slow to answer', severity: 1 },
};
export function issuesOf(summary, facts) {
  const out = [];
  if (summary?.status === 'unfinished') out.push({ kind: 'cut_off', text: 'The call was cut off: its record stops without an ending.' });
  if (facts) {
    const toolFails = list(facts.turns).flatMap((t) => t.tools.filter((x) => x.error));
    if (toolFails.length)
      out.push({
        kind: 'tool_failed',
        text: `The tool “${toolFails[0].tool}” failed${toolFails[0].error ? ` (${toolFails[0].error})` : ''}${toolFails.length > 1 ? `, and ${toolFails.length - 1} more` : ''}.`,
      });
    const others = list(facts.errors).filter((e) => !/^The tool “/.test(e));
    if (others.length) out.push({ kind: 'error', text: others[0] });
    const said = list(facts.turns).map((t) => t.say);
    for (let i = 1; i < said.length; i += 1) {
      if (said[i].split(/\s+/).length >= 3 && similarity(said[i - 1], said[i]) >= 0.85) {
        out.push({ kind: 'repeated', text: `The caller said the same thing twice: “${said[i].slice(0, 70)}”.` });
        break;
      }
    }
    const slow = waitsOf(facts).find((w) => w.ms > SLOW_MS);
    if (slow) out.push({ kind: 'slow', text: `The agent took ${(slow.ms / 1000).toFixed(1)} s to answer “${String(slow.say || '').slice(0, 50)}”.` });
  }
  return out.map((i) => ({ ...i, severity: ISSUE_KINDS[i.kind].severity }));
}

const keyOf = (c) => `${c.bot}/${c.id}`;

// What the caller waited for each answer: [{ ms, say }], measured as the Speed page does (`waits`, when the records
// were read for that), else from the turns' gaps.
export function waitsOf(facts) {
  if (Array.isArray(facts?.waits)) return facts.waits.filter((w) => typeof w?.ms === 'number');
  return list(facts?.turns)
    .filter((t) => typeof t.waitMs === 'number')
    .map((t) => ({ ms: t.waitMs, say: t.say }));
}

// The numbers of a group of calls.
function totalsOf(calls, samples) {
  const facts = calls.map((c) => samples[keyOf(c)]).filter(Boolean);
  // each answer's wait as the Speed page measures it
  const waits = facts.flatMap((f) => waitsOf(f).map((w) => w.ms));
  const toolCalls = facts.flatMap((f) => list(f.turns).flatMap((t) => t.tools)).filter((t) => !t.handoff);
  return {
    calls: calls.length,
    ended: calls.filter((c) => c.status === 'ended').length,
    cutOff: calls.filter((c) => c.status === 'unfinished').length,
    cutOffRate: rate(calls.filter((c) => c.status === 'unfinished').length, calls.length),
    handoffRate: rate(calls.filter((c) => (c.handoffs || 0) > 0).length, calls.length),
    avgDurationS: avg(calls.map((c) => c.duration_s).filter((d) => typeof d === 'number')),
    avgTurns: avg(calls.map((c) => c.caller_turns).filter((d) => typeof d === 'number')),
    waitP50: percentile(waits, 50),
    waitP90: percentile(waits, 90),
    waitSamples: waits.length,
    toolCalls: toolCalls.length,
    toolFailRate: rate(toolCalls.filter((t) => t.error).length, toolCalls.length),
    sampled: facts.length,
  };
}

//   calls: every call summary read (bot, id, started_at, status, duration_s, caller_turns, handoffs, version, ref)
//   samples: { 'bot/id': facts }; bots: [{ id, name, deployed }]
//   days: the period (see periodOf); the same length of time before it is read for comparison
export function analyse({ calls = [], samples = {}, bots = [], nowMs = 0, days = 7 } = {}) {
  const period = periodOf(nowMs, days);
  const start = period.startMs;
  const priorStart = start - (nowMs - start);
  const at = (c) => Date.parse(c.started_at);
  const current = list(calls).filter((c) => at(c) >= start && at(c) <= nowMs);
  const prior = list(calls).filter((c) => at(c) >= priorStart && at(c) < start);
  const totals = totalsOf(current, samples);
  const previous = totalsOf(prior, samples);

  // a bar for every day of the period, including days with nothing
  const byDay = new Map();
  period.days.forEach((day) => byDay.set(day, { day, calls: 0, cutOff: 0, handoffs: 0 }));
  current.forEach((c) => {
    const row = byDay.get(localDay(at(c)));
    if (row) {
      row.calls += 1;
      if (c.status === 'unfinished') row.cutOff += 1;
      if ((c.handoffs || 0) > 0) row.handoffs += 1;
    }
  });
  const series = [...byDay.values()];

  const names = Object.fromEntries(list(bots).map((b) => [b.id, b.name || b.id]));
  const botIds = [...new Set([...list(bots).map((b) => b.id), ...current.map((c) => c.bot)])];
  const perAgent = botIds
    .map((id) => {
      const mine = current.filter((c) => c.bot === id);
      const before = prior.filter((c) => c.bot === id);
      return { bot: id, name: names[id] || id, ...totalsOf(mine, samples), previousCalls: before.length };
    })
    .sort((a, b) => b.calls - a.calls);

  // what went wrong in which call
  const attention = [];
  const issueCounts = new Map();
  current.forEach((c) => {
    const found = issuesOf(c, samples[keyOf(c)]);
    if (!found.length) return;
    attention.push({
      bot: c.bot,
      name: names[c.bot] || c.bot,
      callId: c.id,
      startedAt: c.started_at,
      version: c.version,
      reasons: found,
      severity: Math.max(...found.map((f) => f.severity)),
    });
    found.forEach((f) => {
      const entry = issueCounts.get(f.kind) || { kind: f.kind, label: ISSUE_KINDS[f.kind].label, severity: f.severity, count: 0, examples: [] };
      entry.count += 1;
      if (entry.examples.length < 3) entry.examples.push({ bot: c.bot, name: names[c.bot] || c.bot, callId: c.id, startedAt: c.started_at, detail: f.text });
      issueCounts.set(f.kind, entry);
    });
  });
  attention.sort((a, b) => b.severity - a.severity || Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const issues = [...issueCounts.values()].sort((a, b) => b.severity - a.severity || b.count - a.count);

  // each agent's versions, newest first as the calls were seen
  const versions = botIds
    .map((id) => {
      const all = list(calls).filter((c) => c.bot === id && c.version && c.version !== 'draft');
      const byVersion = new Map();
      all.forEach((c) => {
        const row = byVersion.get(c.version) || { version: c.version, calls: [], latest: 0 };
        row.calls.push(c);
        row.latest = Math.max(row.latest, at(c));
        byVersion.set(c.version, row);
      });
      const rows = [...byVersion.values()]
        .sort((a, b) => b.latest - a.latest)
        .map((row) => ({ version: row.version, lastSeen: new Date(row.latest).toISOString(), ...totalsOf(row.calls, samples) }));
      return { bot: id, name: names[id] || id, rows };
    })
    .filter((v) => v.rows.length > 0);

  // a version doing clearly worse than the one before it, on enough calls to say so
  const alerts = [];
  versions.forEach(({ bot, name, rows }) => {
    if (rows.length < 2) return;
    const [now, was] = rows;
    if (now.calls < MIN_FOR_ALERT || was.calls < MIN_FOR_ALERT) return;
    const found = [];
    if (now.cutOffRate !== null && was.cutOffRate !== null && now.cutOffRate - was.cutOffRate >= REGRESSION.cutOff)
      found.push(`calls cut off: ${pct(now.cutOffRate)} against ${pct(was.cutOffRate)}`);
    if (now.handoffRate !== null && was.handoffRate !== null && now.handoffRate - was.handoffRate >= REGRESSION.handoff)
      found.push(`handed over to someone else: ${pct(now.handoffRate)} against ${pct(was.handoffRate)}`);
    if (now.toolCalls >= MIN_FOR_ALERT && was.toolCalls >= MIN_FOR_ALERT && now.toolFailRate - was.toolFailRate >= REGRESSION.toolFail)
      found.push(`tool calls that failed: ${pct(now.toolFailRate)} against ${pct(was.toolFailRate)}`);
    if (found.length)
      alerts.push({
        bot,
        name,
        version: now.version,
        previousVersion: was.version,
        calls: now.calls,
        previousCalls: was.calls,
        text: `${name} v${now.version} is doing worse than v${was.version}`,
        details: found,
      });
  });

  return { days, totals, previous, series, perAgent, issues, attention, versions, alerts, sampled: totals.sampled };
}

export const pct = (x) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`);
// "+4" / "−2" / "no change" / "" (when there is nothing to compare with)
export function deltaOf(now, before) {
  if (typeof now !== 'number' || typeof before !== 'number' || before === 0) return '';
  const d = now - before;
  return d === 0 ? 'no change' : `${d > 0 ? '+' : '−'}${Math.abs(d)}`;
}
// A period's calls against the one before, in words ("Down from 12 the period before"), never a bare "−4", which reads
// as minus four calls. '' when there is nothing to compare with.
export function changeWords(now, before, period = 'the period before') {
  if (typeof now !== 'number' || typeof before !== 'number' || before === 0) return '';
  if (now === before) return `The same as ${period}`;
  return `${now > before ? 'Up' : 'Down'} from ${before} ${period}`;
}
export const seconds = (ms) => (typeof ms === 'number' ? (ms < 10000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`) : '—');
