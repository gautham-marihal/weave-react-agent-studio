// Call records for the Calls screens: status words, a time range to `since`, the filters to a query, merging several
// agents' pages (the API lists calls one agent at a time), and a call's records paged. Pure: no network, no DOM.

import type { CallSummaryItem } from '../api/types';
import type { CallOutcome } from '../types/studio';
import type { ChipTone } from '../components/ui/StatusChip';

// ended: finished and closed; in_progress: written to in the last two minutes;
// unfinished: the log stops with no ending (the worker died, or the call was cut off)
export const CALL_STATUS: Record<string, { label: string; tone: ChipTone; hint: string }> = {
  ended: { label: 'Ended', tone: 'success', hint: 'The call finished.' },
  in_progress: { label: 'In progress', tone: 'warning', hint: 'Something was written to this call in the last two minutes.' },
  unfinished: { label: 'Cut off', tone: 'danger', hint: 'The record stops without an ending: the worker stopped, or the call was cut off.' },
};
export const statusOf = (status: string | undefined) => CALL_STATUS[status ?? ''] ?? { label: status || 'Unknown', tone: 'neutral' as ChipTone, hint: '' };

/**
 * The API's `status` filter for an outcome. It calls resolved and handed-over calls both "ended", so the list splits
 * them by hand-overs afterwards.
 */
export const OUTCOME_STATUS: Record<CallOutcome, CallSummaryItem['status']> = {
  resolved: 'ended',
  handed_over: 'ended',
  cut_off: 'unfinished',
  in_progress: 'in_progress',
};

/** What an outcome means, in a sentence (a tooltip). */
export function outcomeHint(outcome: CallOutcome, handoffs = 0): string {
  if (outcome === 'handed_over') return handoffs > 1 ? `The agent handed the caller over ${handoffs} times.` : 'The agent handed the caller over to a person.';
  if (outcome === 'resolved') return 'The agent finished the call itself.';
  if (outcome === 'cut_off') return CALL_STATUS.unfinished.hint;
  return CALL_STATUS.in_progress.hint;
}

export type RangeId = '24h' | '7d' | '30d' | 'all';
export const RANGES: Array<{ id: RangeId; label: string; hours: number | null }> = [
  { id: '24h', label: 'Past 24 hours', hours: 24 },
  { id: '7d', label: 'Past 7 days', hours: 24 * 7 },
  { id: '30d', label: 'Past 30 days', hours: 24 * 30 },
  { id: 'all', label: 'All time', hours: null },
];
export const isRange = (v: string | null): v is RangeId => RANGES.some((r) => r.id === v);

export function sinceFor(rangeId: string, nowMs = Date.now()): string | undefined {
  const r = RANGES.find((x) => x.id === rangeId);
  return r?.hours ? new Date(nowMs - r.hours * 3600 * 1000).toISOString() : undefined;
}

export interface CallFilters {
  range?: string;
  caller?: string;
  channel?: string;
  status?: string;
}

export interface CallsQuery {
  limit: number;
  cursor?: string;
  since?: string;
  caller?: string;
  channel?: string;
  status?: string;
}

/** The filters of the screen → the query of GET /bots/{id}/calls, leaving out what is empty. */
export function queryFor(
  { range = '7d', caller = '', channel = '', status = '' }: CallFilters = {},
  { limit = 25, cursor, nowMs }: { limit?: number; cursor?: string; nowMs?: number } = {}
): CallsQuery {
  return {
    limit,
    cursor,
    since: sinceFor(range, nowMs),
    caller: String(caller || '').trim() || undefined,
    channel: channel || undefined,
    status: status || undefined,
  };
}

/** "30 s", "2 min 5 s", "1 h 5 min"; rounded first, so 119.6 s is 2 min (never "1 min 60 s"). */
export function formatSeconds(seconds: unknown): string {
  if (typeof seconds !== 'number' || Number.isNaN(seconds)) return '';
  const total = Math.round(seconds);
  if (total < 60) return `${total} s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min${s ? ` ${s} s` : ''}`;
}

type ChannelLike = CallSummaryItem['channel'] | null | undefined;
const channelObj = (channel: ChannelLike): { id?: string; type?: string } =>
  typeof channel === 'object' && channel !== null ? channel : { id: channel ?? undefined, type: undefined };
/** A label the call's channel carries itself (Sandbox keeps its test conversations as "Test: …"); '' when none. */
const ownLabel = (channel: ChannelLike): string => {
  const label = typeof channel === 'object' && channel !== null ? (channel as { label?: unknown }).label : undefined;
  return typeof label === 'string' ? label : '';
};

const CHANNEL_NAMES: Record<string, string> = { sip_voice: 'Phone', web_voice: 'Web voice', web_chat: 'Web chat', whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email' };
/** A channel by its kind ("Phone"), else its id. */
export function channelLabel(channel: ChannelLike): string {
  const { id, type } = channelObj(channel);
  return ownLabel(channel) || (type && CHANNEL_NAMES[type]) || id || type || '';
}

/** Who called, when the call has no number: a visitor of a web channel, else a number that was withheld. */
export function callerHint(channel: ChannelLike): string {
  const { id, type } = channelObj(channel);
  if (ownLabel(channel)) return ownLabel(channel);
  return /web|chat|widget/.test(`${type ?? ''} ${id ?? ''}`) ? 'Web visitor' : 'No number';
}

/** The distinct channels seen in some calls, for the channel filter. */
export function channelsIn(calls: Array<{ channel?: ChannelLike }>): Array<{ id: string; type?: string }> {
  const seen = new Map<string, { id: string; type?: string }>();
  calls.forEach((c) => {
    const { id, type } = channelObj(c?.channel);
    if (id && !seen.has(id)) seen.set(id, { id, type });
  });
  return [...seen.values()];
}

/** Pages from several agents → one list, newest first, with the same call never twice. */
export function mergeCalls(pages: Array<{ calls?: CallSummaryItem[] } | null | undefined>): CallSummaryItem[] {
  const seen = new Set<string>();
  const out: CallSummaryItem[] = [];
  pages
    .flatMap((p) => p?.calls ?? [])
    .sort((a, b) => Date.parse(b?.started_at || '0') - Date.parse(a?.started_at || '0'))
    .forEach((c) => {
      const key = `${c.bot}/${c.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(c);
      }
    });
  return out;
}

/** Asking every agent is one request each: past this many, the screen asks the user to choose one. */
export const ALL_AGENTS_LIMIT = 30;
export const PER_AGENT_PAGE = 25;

export interface AgentPage {
  id: string;
  calls: CallSummaryItem[];
  next: string | null;
  error: string | null;
}

/**
 * Several agents' calls, newest first, with no gap. An agent with more to send has sent only its newest, so below its
 * oldest, others' calls could show while its own are still to come. The list stops at the newest such point; older
 * calls come with "Load more".
 *   pages: every page so far; more: the ids of the agents with more to send
 */
export function callsWithoutGaps(pages: Array<{ id: string; calls: CallSummaryItem[] }>, more: string[]): CallSummaryItem[] {
  const all = mergeCalls(pages);
  let cutoff = -Infinity;
  more.forEach((id) => {
    const times = pages
      .filter((p) => p.id === id)
      .flatMap((p) => p.calls)
      .map((c) => Date.parse(c?.started_at || ''))
      .filter(Number.isFinite);
    if (times.length) cutoff = Math.max(cutoff, Math.min(...times));
  });
  return cutoff === -Infinity ? all : all.filter((c) => Date.parse(c?.started_at || '0') >= cutoff);
}

/** Each agent's newest page so far: its `next` says whether it has more, its error is the one shown. */
export function latestPages(rounds: Array<Record<string, AgentPage>>): Record<string, AgentPage> {
  const latest: Record<string, AgentPage> = {};
  rounds.forEach((round) => Object.values(round).forEach((page) => (latest[page.id] = page)));
  return latest;
}

// What a call's records were, in words: "12 records: 3 from the caller, 3 from the agent, 2 tool calls". `counts` is
// the server's tally per kind of record.
const COUNT_WORDS: Record<string, [string, string]> = {
  user_said: ['from the caller', 'from the caller'],
  agent_said: ['from the agent', 'from the agent'],
  tool_called: ['tool call', 'tool calls'],
  http_request: ['API request', 'API requests'],
  knowledge_search: ['knowledge search', 'knowledge searches'],
  state_changed: ['state change', 'state changes'],
  error: ['error', 'errors'],
};
export function countsLine(counts: unknown): string {
  const tally = counts && typeof counts === 'object' ? (counts as Record<string, unknown>) : {};
  const entries = Object.entries(tally).filter((e): e is [string, number] => typeof e[1] === 'number' && e[1] > 0);
  if (!entries.length) return '';
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  const known = Object.keys(COUNT_WORDS)
    .filter((kind) => entries.some(([k]) => k === kind))
    .map((kind) => {
      const n = tally[kind] as number;
      const [one, many] = COUNT_WORDS[kind];
      return `${n} ${n === 1 ? one : many}`;
    });
  return `${total} record${total === 1 ? '' : 's'}${known.length ? `: ${known.join(', ')}` : ''}`;
}

// ---- one call: GET /bots/{id}/calls/{call}?after&limit&kinds

export interface CallUsage {
  input_tokens?: number;
  output_tokens?: number;
  model?: string;
  provider?: string;
}

/** One page of a call's records. */
export interface CallRecordsPage {
  call: CallSummaryItem | null;
  events: Array<Record<string, unknown>>;
  nextAfter: number;
  more: boolean;
  complete: boolean;
  counts: Record<string, number>;
  finalState: Record<string, unknown> | null;
  usage: CallUsage[];
}

const asObj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The answer of GET .../calls/{id} read defensively: every field may be missing. */
export function readCallPage(answer: unknown, after = 0): CallRecordsPage {
  const a = asObj(answer);
  const events = (Array.isArray(a.events) ? a.events : []).filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null);
  const lastSeq = events.length ? Number(events[events.length - 1].seq) : NaN;
  const nextAfter = typeof a.next_after === 'number' ? a.next_after : Number.isFinite(lastSeq) ? lastSeq : after;
  const counts = Object.fromEntries(Object.entries(asObj(a.counts)).filter((e): e is [string, number] => typeof e[1] === 'number'));
  return {
    call: a.call && typeof a.call === 'object' ? (a.call as CallSummaryItem) : null,
    events,
    nextAfter,
    more: a.more === true,
    complete: a.complete === true,
    counts,
    finalState: a.final_state && typeof a.final_state === 'object' ? (a.final_state as Record<string, unknown>) : null,
    usage: Array.isArray(a.usage) ? (a.usage as CallUsage[]) : [],
  };
}

/** The query for one page of records: after a `seq`, at most `limit`, only some kinds. */
export function recordsQuery({ after = 0, limit = 500, kinds = [] as string[] } = {}): Record<string, string | number> {
  const query: Record<string, string | number> = { limit };
  if (after > 0) query.after = after;
  if (kinds.length) query.kinds = kinds.join(',');
  return query;
}

/** New records added to what is held: each `seq` once, in order. The same array when nothing is new. */
export function appendRecords<T extends Record<string, unknown>>(held: T[], incoming: T[]): T[] {
  const have = new Set(held.map((e) => e.seq));
  const fresh = incoming.filter((r) => typeof r.seq === 'number' && !have.has(r.seq));
  if (!fresh.length) return held;
  return [...held, ...fresh].sort((a, b) => Number(a.seq) - Number(b.seq));
}

/** Tokens the model used over a call, from its `usage`. */
export function tokensOf(usage: CallUsage[]): { input: number; output: number } {
  return usage.reduce((sum, u) => ({ input: sum.input + (u.input_tokens || 0), output: sum.output + (u.output_tokens || 0) }), { input: 0, output: 0 });
}
