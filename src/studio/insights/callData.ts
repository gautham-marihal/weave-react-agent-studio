import { api } from '../../api/client.ts';
import { keys, queryClient, RETRY_DELAY, retryable } from '../../api/queryClient.ts';
import type { CallRecords, CallSummary } from '../../api/types.ts';
import { readCall } from '../replay/callFacts.js';
import { sampleOf } from '../speed/speedModel.ts';

// Reads calls for the pages that look across many of them (Speed, Monitoring, Home, the alert check, the questions
// page), and only reads: the list of calls of each agent since a moment, and the records of the calls that need them, a
// few agents (and a few calls) at a time. One agent or one call that cannot be read is left out and reported; it never
// hides the rest.

const AT_A_TIME = 4;
const PAGE = 100;

export type ListedCall = CallSummary & { bot: string };

// `size` at a time: as soon as one is done the next starts, so a slow answer holds up only its own place, not the few asked with it. The results come
// back in the order of the items.
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

// { calls: [summary + bot], errors: [{ botId, message }], truncated }
export async function loadCalls(
  botIds: string[],
  { sinceMs, maxPages = 3, signal }: { sinceMs: number; maxPages?: number; signal?: AbortSignal },
): Promise<{ calls: ListedCall[]; errors: { botId: string; message: string }[]; truncated: boolean }> {
  const since = new Date(sinceMs).toISOString();
  let truncated = false;
  const listed = await fewAtATime(botIds, AT_A_TIME, async (id) => {
    const calls: CallSummary[] = [];
    let cursor: string | undefined;
    try {
      for (let page = 0; page < maxPages; page += 1) {
        const answer = await api.listCalls(id, { limit: PAGE, cursor, since }, { signal });
        calls.push(...(Array.isArray(answer?.calls) ? answer.calls : []));
        cursor = answer?.next || undefined;
        if (!cursor) break;
        if (page === maxPages - 1) truncated = true;
      }
      return { id, calls: calls.map((c) => ({ ...c, bot: c.bot || id })), error: null as string | null };
    } catch (e) {
      return { id, calls: calls.map((c) => ({ ...c, bot: c.bot || id })), error: (e as Error)?.message || 'This agent’s calls could not be read.' };
    }
  });
  return {
    calls: listed.flatMap((l) => l.calls),
    errors: listed.filter((l) => l.error).map((l) => ({ botId: l.id, message: l.error as string })),
    truncated,
  };
}

// The records of a finished call (GET /calls/{id}), kept in the shared cache for as long as the studio is open: a
// finished call does not change, so each is read once whichever page asks first (Speed, Monitoring, Home, the alert
// check and the questions page all share it). A read that failed is not kept, so the next page to ask tries again; a
// server hiccup is retried once.
export function readFinishedCall(c: { bot: string; id: string }): Promise<CallRecords> {
  return queryClient.fetchQuery({
    queryKey: keys.call(c.bot, c.id),
    queryFn: ({ signal }) => api.getCall(c.bot, c.id, { limit: 500 }, { signal }),
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: (failures, error) => failures < 1 && retryable(error),
    retryDelay: RETRY_DELAY,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the facts are callFacts.js's (untyped) reading of a call
type Facts = any;

// The facts of each call (see replay/callFacts.js), by 'bot/id'. `known` are facts already read: a finished call does
// not change, so it is not read again (and its records come from the shared cache when another page read them).
// `failedBots`: the agents one of whose calls could not be read.
export async function loadFacts(
  calls: ListedCall[],
  { known = {}, signal }: { known?: Record<string, Facts>; signal?: AbortSignal } = {},
): Promise<{ facts: Record<string, Facts>; failed: number; failedBots: Set<string> }> {
  const facts: Record<string, Facts> = {};
  let failed = 0;
  const failedBots = new Set<string>();
  await fewAtATime(calls, AT_A_TIME, async (c) => {
    const key = `${c.bot}/${c.id}`;
    if (known[key] && c.status !== 'in_progress') {
      facts[key] = known[key];
      return;
    }
    try {
      const page = c.status === 'in_progress' ? await api.getCall(c.bot, c.id, { limit: 500 }, { signal }) : await readFinishedCall(c);
      // with each answer's wait as Speed measures it, so the slow-answers alert says what the Speed page would
      facts[key] = { ...readCall(Array.isArray(page?.events) ? page.events : []), waits: sampleOf(c, page).waits };
    } catch {
      failed += 1;
      failedBots.add(c.bot);
    }
  });
  return { facts, failed, failedBots };
}

export const newestFirst = <C extends { started_at?: string | null }>(calls: C[]): C[] =>
  [...calls].sort((a, b) => Date.parse(b.started_at || '') - Date.parse(a.started_at || ''));
