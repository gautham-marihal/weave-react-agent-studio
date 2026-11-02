// A call's records read as facts the insight pages need (the caller's turns, the agent's answers, tools, hand-overs,
// errors), plus the small helpers they share: local days, "the last N days", word overlap, readable names.
// Monitoring, Speed, alerts and Home all read calls through this, so they say the same about a call. Pure: no network,
// no DOM.

import type { CallSummaryItem } from '../api/types';

const list = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A call as an agent's call list gives it, with the agent it belongs to. */
export type ListedCall = CallSummaryItem & { bot: string };

/** One tool use in a turn. `handoff`: the agent it passed the caller to, when it did. */
export interface FactTool {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  error: string;
  handoff: string;
}

/** One caller turn: what they said, what the agent said back, the tools it used, and how long the answer took. */
export interface FactTurn {
  say: string;
  at: number | undefined;
  said: string[];
  tools: FactTool[];
  waitMs: number | null;
}

/** What one call's records say. `waits`: each answer's wait as Speed measures it, when that was worked out. */
export interface CallFacts {
  channelId: string;
  startAgent: string;
  finalAgent: string;
  finalState: Record<string, unknown>;
  ended: boolean;
  handoffs: number;
  opening: string[];
  turns: FactTurn[];
  errors: string[];
  waits?: { ms: number; say: string }[];
}

// ---- text
// The API's call log can hold UTF-8 read back as Windows-1252 ("Iâ€™m" for "I’m"). This repairs a string only when it
// has that unmistakable pattern, so correct text is never touched.
const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};
const LOOKS_BROKEN = /[ÂÃâ][\u0080-¿ŒœŠšŸŽžƒˆ˜–-›€™]/;

export function fixMojibake(text: string): string {
  if (typeof text !== 'string' || !LOOKS_BROKEN.test(text)) return text;
  try {
    const bytes = Uint8Array.from(
      Array.from(text, (ch) => {
        const code = ch.codePointAt(0) ?? 0;
        const b = code < 0x100 ? code : CP1252[code];
        if (b === undefined) throw new Error('not cp1252');
        return b;
      }),
    );
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return text;
  }
}

const clean = (text: unknown): string =>
  fixMojibake(typeof text === 'string' ? text : text === null || text === undefined ? '' : JSON.stringify(text));

/** "escalate_to_human" → "Escalate to human", "lookupOrder" → "Lookup order". */
export function humanize(id: unknown): string {
  const words = String(id || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.\s]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : '';
}

const tokens = (text: unknown) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** The share of words two texts have in common, 0 to 1. */
export function similarity(a: unknown, b: unknown): number {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.length && !y.length) return 1;
  if (!x.length || !y.length) return 0;
  const count = new Map<string, number>();
  x.forEach((w) => count.set(w, (count.get(w) || 0) + 1));
  let shared = 0;
  y.forEach((w) => {
    const left = count.get(w) || 0;
    if (left > 0) {
      shared += 1;
      count.set(w, left - 1);
    }
  });
  return (2 * shared) / (x.length + y.length);
}

// ---- days

/** A moment's day on the reader's own clock: 'YYYY-MM-DD'. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * "The last N days" as the charts draw them, from the first day's midnight, so a page's counts match its chart. Stepped
 * by calendar so a clock change can't skip or repeat a day.
 */
export function periodOf(nowMs: number, days: number): { startMs: number; days: string[] } {
  const now = new Date(nowMs);
  const dayAt = (back: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
  const count = Math.max(1, days);
  return {
    startMs: dayAt(count - 1).getTime(),
    days: Array.from({ length: count }, (_, i) => localDay(dayAt(count - 1 - i).getTime())),
  };
}

/** Calls, newest first. */
export const newestFirst = <C extends { started_at?: string | null }>(calls: C[]): C[] =>
  [...calls].sort((a, b) => Date.parse(b.started_at || '') - Date.parse(a.started_at || ''));

// ---- one call's records

type Ev = Record<string, unknown> & { event?: string; seq?: number; elapsed_s?: unknown };

/** A call's records (GET /calls/{id} `events`) read as facts. */
export function readCall(records: unknown): CallFacts {
  const events = (list<unknown>(records).filter(isObj) as Ev[]).slice().sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const facts: CallFacts = {
    channelId: '',
    startAgent: '',
    finalAgent: '',
    finalState: {},
    ended: false,
    handoffs: 0,
    opening: [],
    turns: [],
    errors: [],
  };
  let turn: FactTurn | null = null;
  let lastTool: FactTool | null = null;
  let calledAt: unknown = null;
  events.forEach((e) => {
    switch (e.event) {
      case 'call_started': {
        const channel = isObj(e.channel) ? e.channel : {};
        facts.channelId = typeof channel.id === 'string' ? channel.id : '';
        break;
      }
      case 'agent_entered': {
        const agent = typeof e.agent === 'string' ? e.agent : '';
        if (!facts.startAgent) facts.startAgent = agent;
        facts.finalAgent = agent || facts.finalAgent;
        if (e.first === false && lastTool && !lastTool.handoff) {
          lastTool.handoff = agent;
          facts.handoffs += 1;
        }
        break;
      }
      case 'user_said':
        turn = { say: clean(e.text), at: typeof e.elapsed_s === 'number' ? e.elapsed_s : undefined, said: [], tools: [], waitMs: null };
        calledAt = e.elapsed_s;
        facts.turns.push(turn);
        lastTool = null;
        break;
      case 'agent_said': {
        const text = clean(e.text);
        if (!text) break;
        if (turn) {
          turn.said.push(text);
          if (turn.waitMs === null && typeof calledAt === 'number' && typeof e.elapsed_s === 'number')
            turn.waitMs = Math.max(0, Math.round((e.elapsed_s - calledAt) * 1000));
        } else facts.opening.push(text);
        break;
      }
      case 'tool_called': {
        const tool: FactTool = {
          tool: String(e.tool || e.name || ''),
          args: isObj(e.args) ? e.args : {},
          result: e.result ?? e.output,
          error: e.error ? clean(e.error) : '',
          handoff: typeof e.handoff === 'string' ? e.handoff : '',
        };
        if (turn) turn.tools.push(tool);
        lastTool = tool;
        if (tool.error) facts.errors.push(`The tool “${tool.tool}” failed: ${tool.error}`);
        if (tool.handoff) facts.handoffs += 1;
        break;
      }
      case 'error':
        facts.errors.push(clean(e.message || e.detail || e.error || 'An error was recorded.'));
        break;
      case 'state_changed':
        if (isObj(e.state)) facts.finalState = { ...facts.finalState, ...e.state };
        else if (e.name !== undefined || e.variable !== undefined)
          facts.finalState = { ...facts.finalState, [String(e.name ?? e.variable)]: e.value ?? e.to };
        break;
      case 'call_ended':
        facts.ended = true;
        if (isObj(e.state)) facts.finalState = { ...e.state };
        break;
      default:
    }
  });
  return facts;
}

/** Whether a recorded error is a tool's failure (a failed tool is counted on its own). */
export const isToolError = (text: string): boolean => /^The tool “/.test(text);

/**
 * Runs `work` on `size` items at a time, starting the next as each finishes, so a slow one holds up only its own place.
 * Results keep the order of the items.
 */
export async function fewAtATime<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await work(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, lane));
  return out;
}
