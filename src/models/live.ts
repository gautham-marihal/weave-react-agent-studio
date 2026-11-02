// One call in progress as a Live board card, worked out from its records: who is talking, what was said last, which
// agent has it, how long it has run, and what needs a look. Pure, with the time passed in, so the board can redraw it
// every second and tests can play a call through.

import type { CallSummaryItem } from '../api/types';
import { fixMojibake } from './trace';

export const WAITING_S = 8; // a caller who has waited this long for an answer is waiting
export const QUIET_S = 45; // nothing written for this long, in a call that is going on
export const SLOW_ANSWER_S = 5; // an answer that took this long, earlier in the call
export const LONG_S = 10 * 60; // a call this long is worth knowing about
export const RECENT_MS = 10 * 60 * 1000; // how long a call that ended stays on the board

type Rec = Record<string, unknown>;
const list = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const isObj = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown): string => fixMojibake(String(v ?? '')).trim();

// ---- reading what callers say
/** A caller asking for a person, in the ways people say it. */
export const WANTS_A_PERSON =
  /\b(?:speak|talk|chat)\s+(?:to|with)\s+(?:a|an|the|someone|somebody|real|actual|human|person|agent|representative|operator|manager|staff)\b|\b(?:real|actual|live) (?:person|human|agent)\b|\b(?:human|operator|representative)\b|\btransfer me\b|\bput me through\b/i;
/** A tool that passes the caller to a person (or arranges for one to call back). */
export const HANDOFF_TOOL = /transfer|handoff|hand_off|escalat|human|callback/i;

const STOP = new Set(
  (
    'a an the and or but if of to in on at for with from by about as is are was were be been being am do does did doing done can could would should will shall may might must ' +
    'i me my mine you your yours we our us it its this that these those there here what whats which who whom whose when where why how hi hello hey please thanks thank ' +
    'just also really very so too any some much many more most get got have has had having need want like know tell let okay ok yes no not dont cant im ive id ' +
    'one take taken accept accepted available possible offer use using allow there anything something way able'
  ).split(' ')
);
const SAME: Record<string, string> = {
  shipping: 'deliver',
  ship: 'deliver',
  delivery: 'deliver',
  delivered: 'deliver',
  delivering: 'deliver',
  open: 'open',
  opening: 'open',
  hours: 'hour',
};
const stem = (word: string): string => {
  if (SAME[word]) return SAME[word];
  let w = word;
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  return SAME[w] || w;
};
/** The words that carry the meaning of a line, in a stable form. */
export const wordsOf = (line: unknown): string[] =>
  String(line || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w))
    .map(stem);

/** How alike two lines are, 0 to 1: the share of the smaller one's words the other has. */
export function closeness(a: string | string[], b: string | string[]): number {
  const x = new Set(Array.isArray(a) ? a : wordsOf(a));
  const y = new Set(Array.isArray(b) ? b : wordsOf(b));
  if (!x.size || !y.size) return 0;
  let shared = 0;
  x.forEach((w) => {
    if (y.has(w)) shared += 1;
  });
  // One word alone ("Where is my order?") matches only a short line, not "Can you ship my order to Malaysia?".
  const small = Math.min(x.size, y.size);
  return shared / (small === 1 && Math.max(x.size, y.size) > 2 ? 2 : small);
}

// ---- small words
/** A phone number with only its last digits showing: "+65 •••• 4471"; anything else (a web visitor's id) is hidden. */
export function maskCaller(caller: unknown): string {
  const raw = String(caller || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!raw || digits.length < 6) return '';
  // the country code when the number shows where it ends ("+44 20 …"), else a guess from the length
  const written = raw.match(/^\+(\d{1,3})[\s.-]/);
  const country = raw.startsWith('+') ? `+${written ? written[1] : digits.slice(0, Math.max(1, Math.min(3, digits.length - 8)))} ` : '';
  return `${country}•••• ${digits.slice(-4)}`;
}

export const isVoice = (channel: unknown): boolean => /voice|sip|phone|call/.test(String(isObj(channel) ? channel.type || '' : ''));

/** How a duration reads on a card: "45 s", "2:05", "1:02:10". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

const times = (n: number) => (n === 2 ? 'twice' : `${n} times`);

export type FlagTone = 'bad' | 'warn' | 'info';
export interface LiveFlag {
  id: string;
  tone: FlagTone;
  label: string;
  detail: string;
}
export interface LiveLine {
  who: 'caller' | 'agent';
  text: string;
  at: number | null;
  seq: number;
  agent?: string;
}
export interface LiveCall {
  key: string;
  id: string;
  bot: string;
  room: string;
  channel: { id: string; type: string };
  voice: boolean;
  caller: string;
  startedAt: string | null;
  status: 'live' | 'ended' | 'cut_off';
  durationS: number;
  sinceHeardS: number;
  endedAtMs: number | null;
  agent: string;
  firstAgent: string;
  lines: LiveLine[];
  lastLine: LiveLine | null;
  /** The agent is working on an answer: the last thing said was the caller's. */
  thinking: boolean;
  tools: Array<{ tool: string; error: string; at: number | null }>;
  flags: LiveFlag[];
  attention: boolean;
  worst: FlagTone | '';
  callerTurns: number;
  loading?: boolean;
}

const TONE_RANK: Record<string, number> = { bad: 3, warn: 2, info: 1 };

/**
 *   summary: the call list row (id, bot, room, channel, caller, started_at, status, …)
 *   records: its records so far
 *   heardAtMs: when the board last got a record, on this clock, so durations don't rely on the server's clock agreeing
 *   nowMs: the time now, on this clock
 */
export function liveCall(
  summary: Partial<CallSummaryItem> | Rec | null | undefined,
  records: unknown,
  { nowMs, heardAtMs = null, endedAtMs = null }: { nowMs: number; heardAtMs?: number | null; endedAtMs?: number | null }
): LiveCall {
  const s: Rec = isObj(summary) ? summary : {};
  const recs = list(records)
    .filter(isObj)
    .sort((a, b) => (num(a.seq) ?? 0) - (num(b.seq) ?? 0));
  const last = recs[recs.length - 1] ?? null;
  const lastElapsed = num(last?.elapsed_s) ?? 0;
  // when the last record was written, on this clock: when it reached us, or its own time if that is not in our future
  const lastAt = Date.parse(String(last?.t ?? ''));
  const heard = Math.max(num(heardAtMs) ?? -Infinity, Number.isNaN(lastAt) ? -Infinity : Math.min(nowMs, lastAt));
  const heardMs = Number.isFinite(heard) ? heard : nowMs;
  const ended = recs.some((r) => r.event === 'call_ended' || r.event === 'session_closed') || s.status === 'ended';
  const cutOff = s.status === 'unfinished';
  const status: LiveCall['status'] = ended ? 'ended' : cutOff ? 'cut_off' : 'live';
  const going = status === 'live';
  const sinceHeardS = Math.max(0, (nowMs - heardMs) / 1000);
  const durationS = going
    ? lastElapsed + sinceHeardS
    : (num(recs.find((r) => r.event === 'call_ended')?.duration_s) ?? num(s.duration_s) ?? lastElapsed);

  // the conversation, and who has it now
  const lines: LiveLine[] = [];
  let agent = '';
  let firstAgent = '';
  const handovers: Array<{ to: string; at: number | null; tool?: string }> = [];
  const tools: LiveCall['tools'] = [];
  const errors: string[] = [];
  const guardrails: string[] = [];
  const limits: string[] = [];
  const answerWaits: number[] = [];
  let pendingSay: number | null = null; // the elapsed time of a caller line not yet answered
  recs.forEach((r) => {
    const seq = num(r.seq) ?? 0;
    switch (r.event) {
      case 'agent_entered':
        if (r.first || !agent) firstAgent = firstAgent || String(r.agent || '');
        else handovers.push({ to: String(r.agent || ''), at: num(r.elapsed_s) });
        agent = String(r.agent || agent);
        break;
      case 'user_said': {
        const said = text(r.text);
        if (!said) break;
        lines.push({ who: 'caller', text: said, at: num(r.elapsed_s), seq });
        if (pendingSay === null) pendingSay = num(r.elapsed_s);
        break;
      }
      case 'agent_said': {
        const said = text(r.text);
        if (!said) break;
        lines.push({ who: 'agent', text: said, at: num(r.elapsed_s), seq, agent });
        const at = num(r.elapsed_s);
        if (pendingSay !== null && at !== null) answerWaits.push(at - pendingSay);
        pendingSay = null;
        break;
      }
      case 'tool_called': {
        const error = r.error ?? r.err ?? null;
        const name = String(r.tool || r.name || 'a tool');
        tools.push({ tool: name, error: error ? String(error) : '', at: num(r.elapsed_s) });
        // a hand-over to another agent is the next agent_entered record; a tool passing the call to a person has none
        if (!error && !r.handoff && HANDOFF_TOOL.test(name)) handovers.push({ to: 'a person', at: num(r.elapsed_s), tool: name });
        break;
      }
      case 'error':
        errors.push(text(r.message ?? r.error ?? r.detail ?? 'Something went wrong'));
        break;
      case 'session_closed':
        if (r.error) errors.push(text(r.error));
        break;
      case 'guardrail_triggered':
        guardrails.push(String(r.rule || r.id || 'a rule'));
        break;
      case 'limit_reached':
        limits.push(String(r.limit || r.name || 'a limit').replace(/_/g, ' '));
        break;
      default:
    }
  });

  // what needs a look, the worst first
  const flags: LiveFlag[] = [];
  const flag = (id: string, tone: FlagTone, label: string, detail = '') => flags.push({ id, tone, label, detail });
  if (cutOff) flag('cut_off', 'bad', 'Cut off', 'The call stopped without an ending.');
  const failed = tools.filter((t) => t.error);
  if (failed.length) {
    const byTool = failed.reduce<Record<string, number>>((acc, t) => ({ ...acc, [t.tool]: (acc[t.tool] || 0) + 1 }), {});
    Object.entries(byTool).forEach(([tool, n]) =>
      flag(`tool:${tool}`, 'bad', `“${tool}” failed${n > 1 ? ` ${times(n)}` : ''}`, failed.find((t) => t.tool === tool)?.error ?? '')
    );
  }
  if (errors.length) flag('error', 'bad', 'Error', errors[errors.length - 1]);
  if (limits.length) flag('limit', 'bad', 'A call limit was reached', limits.join(', '));
  const waitingS = going && pendingSay !== null ? Math.max(0, durationS - pendingSay) : 0;
  if (going && waitingS >= WAITING_S) flag('waiting', 'bad', `Caller waiting ${Math.round(waitingS)} s`, 'The caller spoke and has not had an answer yet.');
  else if (going && sinceHeardS >= QUIET_S) flag('quiet', 'warn', `Nothing for ${Math.round(sinceHeardS)} s`, 'No one has said anything for a while.');
  const callerLines = lines.filter((l) => l.who === 'caller');
  const repeatedAt = callerLines.findIndex((l, i) => i > 0 && closeness(l.text, callerLines[i - 1].text) >= 0.85);
  if (repeatedAt > 0) flag('repeated', 'warn', 'Caller repeated themselves', `“${callerLines[repeatedAt].text}”`);
  const asked = callerLines.find((l) => WANTS_A_PERSON.test(l.text.replace(/[’‘]/g, "'")));
  const passedOn = handovers.some((h) => h.to === 'a person');
  if (asked && !passedOn) flag('asked_person', 'warn', 'Asked for a person', `“${asked.text}”`);
  if (guardrails.length) flag('guardrail', 'warn', `A safety rule stepped in${guardrails.length > 1 ? ` ${times(guardrails.length)}` : ''}`, guardrails.join(', '));
  const slowest = answerWaits.length ? Math.max(...answerWaits) : 0;
  if (slowest >= SLOW_ANSWER_S && !flags.some((f) => f.id === 'waiting')) flag('slow', 'warn', `Slow answer (${slowest.toFixed(1)} s)`, 'One answer took a long time.');
  if (handovers.length) {
    const lastTo = handovers[handovers.length - 1].to;
    flag('handed_over', 'info', lastTo === 'a person' ? 'Passed to a person' : `Passed to ${lastTo}`, '');
  }
  if (durationS >= LONG_S) flag('long', 'info', `Long call (${Math.floor(durationS / 60)} min)`, '');
  flags.sort((a, b) => TONE_RANK[b.tone] - TONE_RANK[a.tone]);
  const worst = flags.length ? flags[0].tone : '';

  const channel = isObj(s.channel) ? s.channel : { id: String(s.channel || ''), type: '' };
  return {
    key: `${String(s.bot || '')}/${String(s.id || '')}`,
    id: String(s.id || ''),
    bot: String(s.bot || ''),
    room: String(s.room || ''),
    channel: { id: String(channel.id || ''), type: String(channel.type || '') },
    voice: isVoice(s.channel),
    caller: maskCaller(s.caller),
    startedAt: typeof s.started_at === 'string' ? s.started_at : null,
    status,
    durationS,
    sinceHeardS,
    endedAtMs: endedAtMs ?? (going ? null : heardMs),
    agent: agent || firstAgent,
    firstAgent,
    lines,
    lastLine: lines[lines.length - 1] ?? null,
    thinking: going && pendingSay !== null && waitingS < WAITING_S,
    tools,
    flags,
    attention: worst === 'bad' || worst === 'warn',
    worst,
    callerTurns: callerLines.length,
  };
}

type Orderable = Pick<LiveCall, 'attention' | 'worst' | 'durationS'>;
/** Board order: what needs a look first (worst, then longest running), then the rest, longest running first. */
export function boardOrder(a: Orderable, b: Orderable): number {
  const rank = (c: Orderable) => (c.attention ? TONE_RANK[c.worst] ?? 0 : 0);
  return rank(b) - rank(a) || b.durationS - a.durationS;
}

export interface BoardSummary {
  live: number;
  attention: number;
  ended: number;
  byAgent: Record<string, { live: number; attention: number }>;
}
/** The tiles atop the board: calls now, how many need a look, how many ended in the last minutes, and per agent. */
export function boardSummary(calls: Array<Pick<LiveCall, 'status' | 'bot' | 'attention'>>): BoardSummary {
  const live = calls.filter((c) => c.status === 'live');
  const byAgent: BoardSummary['byAgent'] = {};
  live.forEach((c) => {
    byAgent[c.bot] = byAgent[c.bot] || { live: 0, attention: 0 };
    byAgent[c.bot].live += 1;
    if (c.attention) byAgent[c.bot].attention += 1;
  });
  return { live: live.length, attention: live.filter((c) => c.attention).length, ended: calls.length - live.length, byAgent };
}

/** A caller's words, hidden: what a screen others can see shows instead of what a caller said. */
export function hiddenWords(line: { text?: string } | null | undefined): string {
  const n = String(line?.text || '')
    .split(/\s+/)
    .filter(Boolean).length;
  return `Caller spoke (${n} word${n === 1 ? '' : 's'})`;
}

type Announceable = Pick<LiveCall, 'key' | 'bot' | 'status' | 'attention' | 'flags'>;
/**
 * What a screen reader hears when the board changes: a new call, one now needing a look, one that ended.
 * before/after: cards by key; names: agent names by id. At most `max` messages, most important first.
 */
export function changesToAnnounce(before: Record<string, Announceable>, after: Record<string, Announceable>, names: Record<string, string> = {}, max = 3): string[] {
  const out: Array<{ rank: number; text: string }> = [];
  const name = (c: Announceable) => names[c.bot] || c.bot;
  Object.values(after).forEach((c) => {
    const was = before[c.key];
    if (!was && c.status === 'live') out.push({ rank: 1, text: `New call on ${name(c)}` });
    else if (was && c.attention && (!was.attention || was.flags[0]?.id !== c.flags[0]?.id)) out.push({ rank: 3, text: `${name(c)}: ${c.flags[0].label}` });
    else if (was && was.status === 'live' && c.status !== 'live') out.push({ rank: 2, text: `A call on ${name(c)} ${c.status === 'cut_off' ? 'was cut off' : 'ended'}` });
  });
  return out
    .sort((a, b) => b.rank - a.rank)
    .slice(0, max)
    .map((m) => m.text);
}
