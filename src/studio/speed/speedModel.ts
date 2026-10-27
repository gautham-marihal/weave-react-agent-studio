// How fast an agent answers, from its calls' own records, and where each wait goes. A wait runs from the caller's words
// to the answer (or a voice call's recorded delay) and, when the records say so, splits into: making sure the caller
// had finished, the model starting, tools and business systems, and the voice starting. Pure: no React, no network.

import type { CallRecords, CallSummary } from '../../api/types.ts';
import { fixMojibake } from '../trace/records.js';
import { percentile } from '../monitoring/monitorModel.js';
import { humanize } from '../agent/rowNames.js';
import { localDay, periodOf } from '../format.js';

export type StageId = 'listen' | 'think' | 'systems' | 'reply' | 'other';
export type Stage = { id: StageId; label: string; about: string; voice?: boolean };
export type Stages = Partial<Record<StageId, number>>;
export type Answer = { ms: number; say: string; stages: Stages };
export type Sample = {
  bot: string;
  id: string;
  startedAt: string | null;
  channel: string;
  voice: boolean;
  answers: Answer[];
  waits: { ms: number; say: string }[];
  ttfts: number[];
  tools: { tool: string; ms: number; failed: boolean }[];
  requests: { name: string; ms: number; failed: boolean; retried: boolean }[];
};
// one call record: `event`, when, and its kind's fields (a reply's `timing`, a tool's `duration_ms`, a request's `ms`)
type Ev = { event?: string; seq?: number; elapsed_s?: unknown; timing?: Record<string, unknown>; [field: string]: unknown };

const list = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? v : []);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const secMs = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.round(n * 1000); // the records time a step in seconds
};
const VOICE = new Set(['sip_voice', 'web_voice']);
const mean = (values: number[]): number | null => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const pct = (values: number[], p: number): number | null => percentile(values, p);

// The parts of a wait, in the order they happen, as the page names them. `voice`: only a voice call has it.
export const STAGES: Stage[] = [
  { id: 'listen', label: 'Making sure the caller finished', voice: true, about: 'Waiting a moment of silence to be sure the caller has stopped speaking.' },
  { id: 'think', label: 'The model starting its answer', about: 'The language model reading the conversation and starting to answer.' },
  { id: 'systems', label: 'Looking things up', about: 'The agent’s tools and the requests it makes to your own systems.' },
  {
    id: 'reply',
    label: 'Getting the answer out',
    about: 'On a voice call, the voice turning the first words into sound; in a chat, the rest of the answer being written before it is shown.',
  },
  { id: 'other', label: 'Everything else', about: 'Time the call’s records do not put down to one of the steps above.' },
];

// One call, as the numbers need it. summary: its row in the call list; page: GET /calls/{id} (its events).
//   answers: [{ ms, say, stages: { listen?, think?, systems?, reply?, other? } }]
//   waits (each answer's ms and the caller's words), ttfts, tools, requests: kept for the page's lists and for Home
export function sampleOf(summary: Partial<CallSummary> | null | undefined, page: Partial<CallRecords> | null | undefined): Sample {
  const events = (list<unknown>(page?.events).filter(isObj) as Ev[]).slice().sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const started = events.find((e) => e.event === 'call_started') as (Ev & { channel?: { type?: string } }) | undefined;
  const channel = summary?.channel?.type || started?.channel?.type || '';
  const voice = VOICE.has(channel);

  const answers: Answer[] = [];
  let turn: { say: string; at: number | null; listen: number | null; tools: number; requests: number; done: boolean } | null = null;
  events.forEach((e) => {
    if (e.event === 'user_said') {
      const say = fixMojibake(typeof e.text === 'string' ? e.text : '').trim();
      turn = { say, at: num(e.elapsed_s), listen: secMs(e.timing?.end_of_turn_delay), tools: 0, requests: 0, done: false };
      return;
    }
    const current = turn as typeof turn;
    if (!current || current.done) return;
    const duration = num(e.duration_ms);
    const requestMs = num(e.ms);
    if (e.event === 'tool_called' && duration !== null) current.tools += duration;
    else if (e.event === 'http_request' && requestMs !== null) current.requests += requestMs;
    else if (e.event === 'agent_said' && typeof e.text === 'string' && e.text.trim()) {
      current.done = true;
      const elapsed = num(e.elapsed_s);
      const gap = current.at !== null && elapsed !== null ? Math.max(0, Math.round((elapsed - current.at) * 1000)) : null;
      const e2e = secMs(e.timing?.e2e_latency);
      // the caller's wait: a voice call's recorded delay, else words to answer (on voice, plus checking they finished)
      const ms = e2e ?? (gap === null ? null : gap + (voice && current.listen !== null ? current.listen : 0));
      if (ms === null) return;
      const stages: Stages = {};
      if (voice && current.listen !== null) stages.listen = current.listen;
      const think = secMs(e.timing?.llm_node_ttft);
      if (think !== null) stages.think = think;
      // a tool's time already holds the requests it made
      const systems = current.tools || current.requests;
      if (systems) stages.systems = systems;
      const speak = secMs(e.timing?.tts_node_ttfb);
      if (voice && speak !== null) stages.reply = speak;
      const rest = ms - Object.values(stages).reduce((a, b) => a + (b ?? 0), 0);
      // time left after the model starts is the answer being written in a chat, and 'other' on a voice call (from a
      // tenth of a second: less is rounding in the records)
      if (rest >= 100 && (think !== null || systems)) stages[voice ? 'other' : 'reply'] = rest;
      answers.push({ ms, say: current.say, stages });
    }
  });
  return {
    bot: summary?.bot || '',
    id: summary?.id || '',
    startedAt: summary?.started_at || null,
    channel,
    voice,
    answers,
    waits: answers.map((a) => ({ ms: a.ms, say: a.say })),
    ttfts: events
      .map((e) => num(e.timing?.llm_node_ttft))
      .filter((v): v is number => v !== null)
      .map((s) => Math.round(s * 1000)),
    tools: events
      .filter((e) => e.event === 'tool_called' && num(e.duration_ms) !== null)
      .map((e) => ({ tool: String(e.tool || e.name || 'a tool'), ms: e.duration_ms as number, failed: !!e.error })),
    requests: events
      .filter((e) => e.event === 'http_request' && num(e.ms) !== null)
      .map((e) => {
        const status = num(e.status);
        const attempts = num(e.attempts);
        return {
          name: String(e.name || e.connection || e.tool || 'a request'),
          ms: e.ms as number,
          failed: !!e.error || (status !== null && status >= 400),
          retried: attempts !== null && attempts > 1,
        };
      }),
  };
}

const BUCKETS: [number, number, string][] = [
  [0, 1000, 'under 1 s'],
  [1000, 2000, '1–2 s'],
  [2000, 3000, '2–3 s'],
  [3000, 5000, '3–5 s'],
  [5000, 8000, '5–8 s'],
  [8000, Infinity, '8 s or more'],
];

// Which finished calls to read for timings when over `count`: round-robin across days, newest first, since a busy
// agent's newest calls could all be today's and the daily line must cover the whole period. Returned newest first.
export function spreadPick<C extends { started_at?: string | null }>(calls: C[], count: number): C[] {
  if (calls.length <= count) return calls;
  const byDay = new Map<string, C[]>();
  calls.forEach((c) => {
    const t = Date.parse(c?.started_at || '');
    const key = Number.isFinite(t) ? localDay(t) : '';
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(c);
  });
  const queues = [...byDay.values()];
  const picked = new Set<C>();
  // round after round, one more of each day, until `count` are taken (there are more than `count`, so it ends)
  let round = 0;
  while (picked.size < count) {
    queues.forEach((q) => {
      if (picked.size < count && q[round]) picked.add(q[round]);
    });
    round += 1;
  }
  return calls.filter((c) => picked.has(c));
}

export type Verdict = 'few' | 'good' | 'ok' | 'slow';

// How the calls did against the target: good (9 in 10 within it), ok (3 in 4), slow, or few (too few answers to say).
export function verdictOf(within: number | null, answers: number): Verdict {
  if (within === null || answers < 5) return 'few';
  if (within >= 0.9) return 'good';
  if (within >= 0.75) return 'ok';
  return 'slow';
}

type FullAnswer = Answer & { bot: string; callId: string; startedAt: string | null; channel: string; voice: boolean };
export type StageAverages = { answers: number; wait: number | null; avg: Partial<Record<StageId, { ms: number; n: number }>> };
export type StagesByKind = { voice?: StageAverages; chat?: StageAverages };

// The parts of a wait, averaged over the answers that recorded each, for voice calls and chats apart (voice has more).
function stagesOf(answers: FullAnswer[]): StagesByKind {
  const out: StagesByKind = {};
  for (const kind of ['voice', 'chat'] as const) {
    const these = answers.filter((a) => (kind === 'voice') === a.voice && Object.keys(a.stages).length);
    if (!these.length) continue;
    const avg: StageAverages['avg'] = {};
    STAGES.forEach((s) => {
      const values = these.map((a) => a.stages[s.id]).filter((v): v is number => typeof v === 'number');
      if (values.length) avg[s.id] = { ms: mean(values) as number, n: values.length };
    });
    out[kind] = { answers: these.length, wait: mean(these.map((a) => a.ms)), avg };
  }
  return out;
}

export type SystemRow = { kind: 'tool' | 'request'; name: string; label: string; n: number; p50: number; max: number; failed: number; retried: number };

// The tools and the business's own systems the answers waited on: how often, how long (typically and at worst), how
// often they failed or had to retry.
function systemsOf(samples: Sample[]): SystemRow[] {
  type Row = Omit<SystemRow, 'n' | 'p50' | 'max'> & { times: number[] };
  const rows = new Map<string, Row>();
  const add = (kind: SystemRow['kind'], name: string, ms: number, failed: boolean, retried: boolean) => {
    const key = `${kind}:${name}`;
    const row = rows.get(key) || { kind, name, label: humanize(name) || name, times: [], failed: 0, retried: 0 };
    row.times.push(ms);
    if (failed) row.failed += 1;
    if (retried) row.retried += 1;
    rows.set(key, row);
  };
  samples.forEach((s) => {
    list<Sample['tools'][number]>(s.tools).forEach((t) => add('tool', t.tool, t.ms, t.failed, false));
    list<Sample['requests'][number]>(s.requests).forEach((r) => add('request', r.name, r.ms, r.failed, r.retried));
  });
  return [...rows.values()]
    .map(({ times, ...r }) => ({ ...r, n: times.length, p50: pct(times, 50) as number, max: Math.max(...times) }))
    .sort((a, b) => b.p50 - a.p50);
}

export type Advice = {
  id: string;
  ms: number;
  title: string;
  lead: string;
  tail: string;
  why: string;
  whyAll?: string;
  action: string;
  path: string[];
};

// What would make answers sooner, biggest first; nothing is suggested without the numbers for it.
//   { id, ms, title, lead, tail, why, whyAll?, action, path }; path: the setting to open (as the agent's pages take it)
// a suggestion's title and its halves around the time, so one for several agents can be said once with their range
const titled = (lead: string, ms: number, tail: string) => ({ title: `${lead} ${seconds(ms)}${tail}`, lead, tail });
export const ADVICE_AT = { listen: 1000, think: 1000, speak: 600, write: 2500, system: 700 }; // ms
function adviceOf(stages: StagesByKind, systems: SystemRow[]): Advice[] {
  const out: Advice[] = [];
  const voice = stages.voice?.avg || {};
  const chat = stages.chat?.avg || {};
  const both = (id: StageId) => {
    const parts = [voice[id], chat[id]].filter((p): p is { ms: number; n: number } => !!p);
    const n = parts.reduce((a, p) => a + p.n, 0);
    return n ? { ms: parts.reduce((a, p) => a + p.ms * p.n, 0) / n, n } : null;
  };
  const listen = voice.listen;
  if (listen && listen.n >= 3 && listen.ms >= ADVICE_AT.listen)
    out.push({
      id: 'listen',
      ms: listen.ms,
      ...titled('The agent waits', listen.ms, ' to be sure the caller has finished speaking'),
      why: 'On voice calls this comes before every answer. A shorter wait answers sooner; too short and it may speak over a caller who only paused.',
      action: 'Shorten the wait at the end of a turn',
      path: ['defaults', 'conversation', 'turn_handling', 'endpointing'],
    });
  const think = both('think');
  if (think && think.n >= 3 && think.ms >= ADVICE_AT.think)
    out.push({
      id: 'think',
      ms: think.ms,
      ...titled('The AI model takes', think.ms, ' to start answering'),
      why: 'A faster language model starts sooner, and so do shorter instructions: the model reads all of them before every answer.',
      action: 'Choose a faster model',
      path: ['defaults', 'models', 'llm'],
    });
  const speak = voice.reply;
  if (speak && speak.n >= 3 && speak.ms >= ADVICE_AT.speak)
    out.push({
      id: 'speak',
      ms: speak.ms,
      ...titled('The voice takes', speak.ms, ' to start speaking'),
      why: 'Some text-to-speech models are made to start quickly (a “flash” or “turbo” model, for example).',
      action: 'Choose a faster voice model',
      path: ['defaults', 'models', 'tts'],
    });
  const write = chat.reply;
  if (write && write.n >= 3 && write.ms >= ADVICE_AT.write)
    out.push({
      id: 'write',
      ms: write.ms,
      ...titled('Chat answers take', write.ms, ' longer to be written in full'),
      why: 'A chat answer is shown once it is written in full, so long answers keep people waiting. Asking for shorter answers helps.',
      action: 'Ask for shorter answers',
      path: ['persona', 'style_rules'],
    });
  systems
    .filter((s) => s.n >= 2 && s.p50 >= ADVICE_AT.system)
    .slice(0, 2)
    .forEach((s) =>
      out.push({
        id: `system:${s.kind}:${s.name}`,
        ms: s.p50,
        ...titled(`${s.label} usually takes`, s.p50, ''),
        why: `Callers wait while it answers (used ${s.n} times; the longest took ${seconds(s.max)}). Look at it on your side, or have the agent say it is checking while it waits.`,
        whyAll: 'Callers wait while it answers. Look at it on your side, or have the agent say it is checking while it waits.',
        action: s.kind === 'request' ? 'Open its connection' : 'Open the tool',
        path: [s.kind === 'request' ? 'connections' : 'tools'],
      }),
    );
  return out.sort((a, b) => b.ms - a.ms);
}

// The part of an answer's wait that took longest, for the list of the slowest.
const causeOf = (stages: Stages): Stage | null => {
  const [id] = Object.entries(stages).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0] || [];
  return id ? STAGES.find((s) => s.id === id) || null : null;
};

export type DayPoint = { day: string; n: number; p50: number | null; p90: number | null };
export type SlowAnswer = { ms: number; say: string; bot: string; callId: string; channel: string; voice: boolean; cause: Stage | null };
export type Summary = {
  sampled: number;
  totalCalls: number;
  verdict: Verdict;
  speed: {
    answers: number;
    p50: number | null;
    p90: number | null;
    max: number | null;
    ttftP50: number | null;
    within: number | null;
    buckets: { label: string; n: number; slow: boolean }[];
    slowest: SlowAnswer[];
    tools: { tool: string; n: number; p50: number; maxMs: number; failed: number }[];
  };
  stages: StagesByKind;
  systems: SystemRow[];
  days: DayPoint[];
  advice: Advice[];
};

// Everything the page shows, from the calls read (`samples`) and the period's call count (`totalCalls`).
//   targetMs: the "answered within" target; days, nowMs: the period, for the day-by-day line (left out without them)
export function summarize({
  samples = [],
  totalCalls = null,
  targetMs = 2000,
  days = 0,
  nowMs = 0,
}: { samples?: Sample[]; totalCalls?: number | null; targetMs?: number; days?: number; nowMs?: number } = {}): Summary {
  const answers: FullAnswer[] = samples.flatMap((s) =>
    list<Answer>(s.answers).map((a) => ({ ...a, bot: s.bot, callId: s.id, startedAt: s.startedAt, channel: s.channel, voice: s.voice })),
  );
  const ms = answers.map((a) => a.ms);
  const ttfts = samples.flatMap((s) => s.ttfts);
  const within = ms.length ? ms.filter((v) => v <= targetMs).length / ms.length : null;
  const systems = systemsOf(samples);
  const stages = stagesOf(answers);

  // a point for every day of the period, a day with no answers left empty
  const byDay: { day: string; times: number[] }[] = [];
  if (days > 0 && nowMs) {
    periodOf(nowMs, days).days.forEach((day) => byDay.push({ day, times: [] }));
    const index = new Map(byDay.map((d) => [d.day, d]));
    answers.forEach((a) => {
      const t = Date.parse(a.startedAt || '');
      if (Number.isFinite(t)) index.get(localDay(t))?.times.push(a.ms);
    });
  }

  return {
    sampled: samples.length,
    totalCalls: totalCalls ?? samples.length,
    verdict: verdictOf(within, ms.length),
    speed: {
      answers: ms.length,
      p50: pct(ms, 50),
      p90: pct(ms, 90),
      max: ms.length ? Math.max(...ms) : null,
      ttftP50: pct(ttfts, 50),
      within,
      buckets: BUCKETS.map(([from, to, label]) => ({ label, n: ms.filter((v) => v >= from && v < to).length, slow: from >= 3000 })),
      slowest: [...answers]
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 5)
        .map((a) => ({ ms: a.ms, say: a.say, bot: a.bot, callId: a.callId, channel: a.channel, voice: a.voice, cause: causeOf(a.stages) })),
      tools: systems.filter((s) => s.kind === 'tool').map((s) => ({ tool: s.name, n: s.n, p50: s.p50, maxMs: s.max, failed: s.failed })),
    },
    stages,
    systems,
    days: byDay.map((d) => ({ day: d.day, n: d.times.length, p50: pct(d.times, 50), p90: pct(d.times, 90) })),
    advice: adviceOf(stages, systems),
  };
}

export const seconds = (ms: number | null | undefined): string =>
  ms === null || ms === undefined ? '–' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
