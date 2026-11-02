// Read-only call loading for the pages that look across many calls (Monitoring, Speed, Home, alerts): each agent's
// calls since a moment, and the records of those that need them, a few at a time. A call or agent that can't be read is
// left out and reported; it never hides the rest. A finished call's records never change, so they are read once while
// Studio is open and shared by every page.

import { api } from '../api/client';
import type { CallsResponse, CallSummaryItem } from '../api/types';
import { fewAtATime, readCall, type CallFacts, type ListedCall } from '../models/callData';
import { sampleOf } from '../models/speed';

const AT_A_TIME = 4;
const PAGE = 100;
/** The records of this many finished calls are kept while Studio is open; the oldest read go first. */
const KEEP_RECORDS = 1500;

export interface LoadedCalls {
  calls: ListedCall[];
  errors: { botId: string; message: string }[];
  /** An agent had more calls in the time asked than were read. */
  truncated: boolean;
}

const messageOf = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/**
 * Each agent's calls from `sinceMs` (to `untilMs`), newest first, a page at a time and at most `maxPages` pages each.
 * `keep` says which of the rows read belong (the server may give a little more than asked).
 */
export async function loadCalls(
  botIds: string[],
  {
    sinceMs,
    untilMs,
    maxPages = 3,
    signal,
    keep = () => true,
  }: { sinceMs: number; untilMs?: number; maxPages?: number; signal?: AbortSignal; keep?: (c: CallSummaryItem) => boolean },
): Promise<LoadedCalls> {
  const since = new Date(sinceMs).toISOString();
  const until = untilMs === undefined ? undefined : new Date(untilMs).toISOString();
  let truncated = false;
  const listed = await fewAtATime(botIds, AT_A_TIME, async (id) => {
    const calls: CallSummaryItem[] = [];
    let cursor: string | undefined;
    try {
      for (let page = 0; page < maxPages; page += 1) {
        const answer: CallsResponse = await api.listCalls(id, { limit: PAGE, cursor, since, until }, { signal });
        calls.push(...(Array.isArray(answer?.calls) ? answer.calls : []).filter(keep));
        cursor = answer?.next || undefined;
        if (!cursor) break;
        if (page === maxPages - 1) truncated = true;
      }
      return { id, calls, error: null as string | null };
    } catch (e) {
      if (signal?.aborted) throw e;
      return { id, calls, error: messageOf(e, 'This agent’s calls could not be read.') };
    }
  });
  return {
    calls: listed.flatMap((l) => l.calls.map((c) => ({ ...c, bot: c.bot || l.id }))),
    errors: listed.filter((l) => l.error).map((l) => ({ botId: l.id, message: l.error as string })),
    truncated,
  };
}

const records = new Map<string, Promise<unknown>>();

/** A finished call's records (GET /calls/{id}), read once and shared. A failed read is forgotten, so the next tries again. */
export function readFinishedCall(c: { bot: string; id: string }): Promise<unknown> {
  const key = `${c.bot}/${c.id}`;
  const known = records.get(key);
  if (known) return known;
  // not tied to one page's signal: another page may be waiting for the same records
  const reading = api.getCall(c.bot, c.id, { limit: 500 });
  records.set(key, reading);
  if (records.size > KEEP_RECORDS) records.delete(records.keys().next().value as string);
  reading.catch(() => records.delete(key));
  return reading;
}

const eventsOf = (page: unknown): unknown[] =>
  page && typeof page === 'object' && Array.isArray((page as { events?: unknown }).events) ? (page as { events: unknown[] }).events : [];

/** A call's facts, with each answer's wait as Speed measures it, so every page says the same about slow answers. */
export const factsOf = (c: ListedCall, page: unknown): CallFacts => ({ ...readCall(eventsOf(page)), waits: sampleOf(c, page).waits });

/**
 * The facts of each call, by 'bot/id'. `known` facts of finished calls are not read again.
 *   failedBots: agents with a call that couldn't be read
 */
export async function loadFacts(
  calls: ListedCall[],
  { known = {}, signal }: { known?: Record<string, CallFacts>; signal?: AbortSignal } = {},
): Promise<{ facts: Record<string, CallFacts>; failed: number; failedBots: Set<string> }> {
  const facts: Record<string, CallFacts> = {};
  let failed = 0;
  const failedBots = new Set<string>();
  await fewAtATime(calls, AT_A_TIME, async (c) => {
    const key = `${c.bot}/${c.id}`;
    if (known[key] && c.status !== 'in_progress') {
      facts[key] = known[key];
      return;
    }
    if (signal?.aborted) return;
    try {
      const page = c.status === 'in_progress' ? await api.getCall(c.bot, c.id, { limit: 500 }, { signal }) : await readFinishedCall(c);
      facts[key] = factsOf(c, page);
    } catch {
      if (signal?.aborted) return;
      failed += 1;
      failedBots.add(c.bot);
    }
  });
  return { facts, failed, failedBots };
}
