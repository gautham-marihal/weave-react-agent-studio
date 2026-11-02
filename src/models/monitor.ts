// How the agents are doing, from their calls: counts, durations, hand-overs and cut-offs, answer speed, failing tools,
// repeats, and whether a newer version does worse. Rates over few calls are shown but never raised as an alert, and the
// screen says how many calls they rest on. Pure: no network, no DOM, no clock of its own.

import { isToolError, localDay, periodOf, similarity, type CallFacts } from './callData';

const list = <T>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : []);

/** Calls of a version (and of the one before it) before it can be called worse. */
export const MIN_FOR_ALERT = 5;
/** An answer slower than this is slow. */
export const SLOW_MS = 8000;
/** How much higher (as a share of calls) a rate must be to raise an alert. */
export const REGRESSION = { cutOff: 0.15, handoff: 0.2, toolFail: 0.15 };

/** What the Monitoring pages read of a call from its list: the agent it belongs to, when, and how it ended. */
export interface MonitorCall {
  bot: string;
  id: string;
  started_at: string;
  status: string;
  duration_s?: number;
  caller_turns?: number;
  handoffs?: number;
  version?: string;
  ref?: string;
}

/** The facts of the calls whose records were read, by 'bot/id'. */
export type Samples = Record<string, CallFacts | undefined>;

export interface MonitorBot {
  id: string;
  name?: string;
}

const rate = (n: number, of: number): number | null => (of > 0 ? n / of : null);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const avg = (xs: number[]): number | null => (xs.length ? sum(xs) / xs.length : null);

/** The value at a percentile (nearest rank); null with nothing to rank. */
export function percentile(values: unknown[] | null | undefined, p: number): number | null {
  const xs = list(values as number[])
    .filter((v) => typeof v === 'number' && !Number.isNaN(v))
    .sort((a, b) => a - b);
  if (!xs.length) return null;
  const i = Math.min(xs.length - 1, Math.max(0, Math.ceil((p / 100) * xs.length) - 1));
  return xs[i];
}

export type IssueKind = 'cut_off' | 'tool_failed' | 'error' | 'repeated' | 'slow';

/** What can be wrong with a call, how it is named, and how serious it is. */
export const ISSUE_KINDS: Record<IssueKind, { label: string; severity: number }> = {
  cut_off: { label: 'Calls that were cut off', severity: 3 },
  tool_failed: { label: 'A tool failed', severity: 3 },
  error: { label: 'An error was recorded', severity: 3 },
  repeated: { label: 'The caller had to repeat themselves', severity: 2 },
  slow: { label: 'The agent was slow to answer', severity: 1 },
};

export interface Issue {
  kind: IssueKind;
  text: string;
  severity: number;
}

/** What the caller waited for each answer: as the Speed page measures it (`waits`) when known, else the turns' gaps. */
export function waitsOf(facts: CallFacts | null | undefined): { ms: number; say: string }[] {
  if (Array.isArray(facts?.waits)) return facts.waits.filter((w) => typeof w?.ms === 'number');
  return list(facts?.turns)
    .filter((t) => typeof t.waitMs === 'number')
    .map((t) => ({ ms: t.waitMs as number, say: t.say }));
}

/** What was wrong with one call, from its list row and (when its records were read) its facts. */
export function issuesOf(summary: { status?: string } | null | undefined, facts: CallFacts | null | undefined): Issue[] {
  const out: Omit<Issue, 'severity'>[] = [];
  if (summary?.status === 'unfinished') out.push({ kind: 'cut_off', text: 'The call was cut off: its record stops without an ending.' });
  if (facts) {
    const toolFails = list(facts.turns).flatMap((t) => t.tools.filter((x) => x.error));
    if (toolFails.length)
      out.push({
        kind: 'tool_failed',
        text: `The tool “${toolFails[0].tool}” failed${toolFails[0].error ? ` (${toolFails[0].error})` : ''}${toolFails.length > 1 ? `, and ${toolFails.length - 1} more` : ''}.`,
      });
    const others = list(facts.errors).filter((e) => !isToolError(e));
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

const keyOf = (c: { bot: string; id: string }) => `${c.bot}/${c.id}`;

/** The numbers of a group of calls. */
export interface Totals {
  calls: number;
  ended: number;
  cutOff: number;
  cutOffRate: number | null;
  handoffRate: number | null;
  avgDurationS: number | null;
  avgTurns: number | null;
  waitP50: number | null;
  waitP90: number | null;
  waitSamples: number;
  toolCalls: number;
  toolFailRate: number | null;
  sampled: number;
}

function totalsOf(calls: MonitorCall[], samples: Samples): Totals {
  const facts = calls.map((c) => samples[keyOf(c)]).filter((f): f is CallFacts => !!f);
  const waits = facts.flatMap((f) => waitsOf(f).map((w) => w.ms));
  const toolCalls = facts.flatMap((f) => list(f.turns).flatMap((t) => t.tools)).filter((t) => !t.handoff);
  const unfinished = calls.filter((c) => c.status === 'unfinished').length;
  return {
    calls: calls.length,
    ended: calls.filter((c) => c.status === 'ended').length,
    cutOff: unfinished,
    cutOffRate: rate(unfinished, calls.length),
    handoffRate: rate(calls.filter((c) => (c.handoffs || 0) > 0).length, calls.length),
    avgDurationS: avg(calls.map((c) => c.duration_s).filter((d): d is number => typeof d === 'number')),
    avgTurns: avg(calls.map((c) => c.caller_turns).filter((d): d is number => typeof d === 'number')),
    waitP50: percentile(waits, 50),
    waitP90: percentile(waits, 90),
    waitSamples: waits.length,
    toolCalls: toolCalls.length,
    toolFailRate: rate(toolCalls.filter((t) => t.error).length, toolCalls.length),
    sampled: facts.length,
  };
}

export interface DayRow {
  day: string;
  calls: number;
  cutOff: number;
  handoffs: number;
}

export interface AttentionRow {
  bot: string;
  name: string;
  callId: string;
  startedAt: string;
  version?: string;
  reasons: Issue[];
  severity: number;
}

export interface IssueGroup {
  kind: IssueKind;
  label: string;
  severity: number;
  count: number;
  examples: { bot: string; name: string; callId: string; startedAt: string; detail: string }[];
}

export interface VersionRow extends Totals {
  version: string;
  lastSeen: string;
}

export interface VersionAlert {
  bot: string;
  name: string;
  version: string;
  previousVersion: string;
  calls: number;
  previousCalls: number;
  text: string;
  details: string[];
}

export interface Report {
  days: number;
  totals: Totals;
  previous: Totals;
  series: DayRow[];
  perAgent: (Totals & { bot: string; name: string; previousCalls: number })[];
  issues: IssueGroup[];
  attention: AttentionRow[];
  versions: { bot: string; name: string; rows: VersionRow[] }[];
  alerts: VersionAlert[];
  sampled: number;
}

/**
 * Everything the Monitoring pages show.
 *   calls: every call read (bot, id, started_at, status, duration_s, caller_turns, handoffs, version, ref)
 *   samples: { 'bot/id': facts }; bots: [{ id, name }]
 *   days: the period (see periodOf); the same length of time before it is read for comparison
 */
export function analyse({
  calls = [],
  samples = {},
  bots = [],
  nowMs = 0,
  days = 7,
}: { calls?: MonitorCall[]; samples?: Samples; bots?: MonitorBot[]; nowMs?: number; days?: number } = {}): Report {
  const period = periodOf(nowMs, days);
  const start = period.startMs;
  const priorStart = start - (nowMs - start);
  const at = (c: MonitorCall) => Date.parse(c.started_at);
  const current = list(calls).filter((c) => at(c) >= start && at(c) <= nowMs);
  const prior = list(calls).filter((c) => at(c) >= priorStart && at(c) < start);
  const totals = totalsOf(current, samples);
  const previous = totalsOf(prior, samples);

  // a bar for every day of the period, including days with nothing
  const byDay = new Map<string, DayRow>();
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

  const names: Record<string, string> = Object.fromEntries(list(bots).map((b) => [b.id, b.name || b.id]));
  const nameOf = (id: string) => names[id] || id;
  const botIds = [...new Set([...list(bots).map((b) => b.id), ...current.map((c) => c.bot)])];
  const perAgent = botIds
    .map((id) => {
      const mine = current.filter((c) => c.bot === id);
      const before = prior.filter((c) => c.bot === id);
      return { bot: id, name: nameOf(id), ...totalsOf(mine, samples), previousCalls: before.length };
    })
    .sort((a, b) => b.calls - a.calls);

  // what went wrong in which call
  const attention: AttentionRow[] = [];
  const issueCounts = new Map<IssueKind, IssueGroup>();
  current.forEach((c) => {
    const found = issuesOf(c, samples[keyOf(c)]);
    if (!found.length) return;
    attention.push({
      bot: c.bot,
      name: nameOf(c.bot),
      callId: c.id,
      startedAt: c.started_at,
      version: c.version,
      reasons: found,
      severity: Math.max(...found.map((f) => f.severity)),
    });
    found.forEach((f) => {
      const entry = issueCounts.get(f.kind) || { kind: f.kind, label: ISSUE_KINDS[f.kind].label, severity: f.severity, count: 0, examples: [] };
      entry.count += 1;
      if (entry.examples.length < 3) entry.examples.push({ bot: c.bot, name: nameOf(c.bot), callId: c.id, startedAt: c.started_at, detail: f.text });
      issueCounts.set(f.kind, entry);
    });
  });
  attention.sort((a, b) => b.severity - a.severity || Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const issues = [...issueCounts.values()].sort((a, b) => b.severity - a.severity || b.count - a.count);

  // each agent's versions, newest first as the calls were seen
  const versions = botIds
    .map((id) => {
      const all = list(calls).filter((c) => c.bot === id && c.version && c.version !== 'draft');
      const byVersion = new Map<string, { version: string; calls: MonitorCall[]; latest: number }>();
      all.forEach((c) => {
        const v = c.version as string;
        const row = byVersion.get(v) || { version: v, calls: [], latest: 0 };
        row.calls.push(c);
        row.latest = Math.max(row.latest, at(c));
        byVersion.set(v, row);
      });
      const rows = [...byVersion.values()]
        .sort((a, b) => b.latest - a.latest)
        .map((row) => ({ version: row.version, lastSeen: new Date(row.latest).toISOString(), ...totalsOf(row.calls, samples) }));
      return { bot: id, name: nameOf(id), rows };
    })
    .filter((v) => v.rows.length > 0);

  // a version doing clearly worse than the one before it, on enough calls to say so
  const alerts: VersionAlert[] = [];
  versions.forEach(({ bot, name, rows }) => {
    if (rows.length < 2) return;
    const [now, was] = rows;
    if (now.calls < MIN_FOR_ALERT || was.calls < MIN_FOR_ALERT) return;
    const found: string[] = [];
    if (now.cutOffRate !== null && was.cutOffRate !== null && now.cutOffRate - was.cutOffRate >= REGRESSION.cutOff)
      found.push(`calls cut off: ${pct(now.cutOffRate)} against ${pct(was.cutOffRate)}`);
    if (now.handoffRate !== null && was.handoffRate !== null && now.handoffRate - was.handoffRate >= REGRESSION.handoff)
      found.push(`handed over to someone else: ${pct(now.handoffRate)} against ${pct(was.handoffRate)}`);
    if (
      now.toolCalls >= MIN_FOR_ALERT &&
      was.toolCalls >= MIN_FOR_ALERT &&
      (now.toolFailRate ?? 0) - (was.toolFailRate ?? 0) >= REGRESSION.toolFail
    )
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

/** A share as a whole percentage; '—' when unknown. */
export const pct = (x: number | null | undefined): string => (x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`);

/** "+4" / "−2" / "no change" / "" (when there is nothing to compare with). */
export function deltaOf(now: unknown, before: unknown): string {
  if (typeof now !== 'number' || typeof before !== 'number' || before === 0) return '';
  const d = now - before;
  return d === 0 ? 'no change' : `${d > 0 ? '+' : '−'}${Math.abs(d)}`;
}

/**
 * A period's calls against the one before, in words ("Down from 12 the period before"), never a bare "−4", which reads
 * as minus four calls. '' when there is nothing to compare with.
 */
export function changeWords(now: unknown, before: unknown, period = 'the period before'): string {
  if (typeof now !== 'number' || typeof before !== 'number' || before === 0) return '';
  if (now === before) return `The same as ${period}`;
  return `${now > before ? 'Up' : 'Down'} from ${before} ${period}`;
}

/** Milliseconds as seconds, one decimal under ten; '—' when unknown. */
export const seconds = (ms: number | null | undefined): string =>
  typeof ms === 'number' ? (ms < 10000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`) : '—';

/** A call's length in words: "45 s", "3 min 5 s", "1 h 2 min" (rounded first, so 119.6 s is 2 min). '' when unknown. */
export function callLength(s: number | null | undefined): string {
  if (typeof s !== 'number' || !Number.isFinite(s)) return '';
  const total = Math.round(s);
  if (total < 60) return `${total} s`;
  const m = Math.floor(total / 60);
  const rest = total % 60;
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min${rest ? ` ${rest} s` : ''}`;
}
