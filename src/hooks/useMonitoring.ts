import { useCallback } from 'react';
import { fewAtATime, newestFirst, periodOf, type CallFacts, type ListedCall } from '../models/callData';
import { sampleOf, spreadPick, type Sample } from '../models/speed';
import { factsOf, loadCalls, readFinishedCall } from '../utils/callDataLoad';
import { useReading } from './useMonitoringReading';

// Reads (only) what Monitoring needs: each agent's calls for the period and the one before, and the records of some
// finished calls spread over the days as Speed picks them, with waits measured as Speed does, so both pages agree.
// Lists come first so the page is useful soon; the records follow.

/** How many of each agent's finished calls are read for their timings (Monitoring, Speed and Home read the same). */
export const PER_AGENT = 40;
/** Up to this many pages of 100 calls per agent and period: past that, the numbers rest on the newest. */
export const MAX_PAGES = 5;
const AT_A_TIME = 4;

interface Lists {
  calls: ListedCall[];
  errors: { botId: string; message: string }[];
  nowMs: number;
  startMs: number;
  truncated: boolean;
}

async function readLists(ids: string[], days: number, signal: AbortSignal): Promise<Lists> {
  const nowMs = Date.now();
  const startMs = periodOf(nowMs, days).startMs;
  // the period, then the same length before it (read apart, so a busy period can't leave the one before unread)
  const [now, before] = await Promise.all([
    loadCalls(ids, { sinceMs: startMs, maxPages: MAX_PAGES, signal }),
    loadCalls(ids, {
      sinceMs: startMs - (nowMs - startMs),
      untilMs: startMs - 1,
      maxPages: MAX_PAGES,
      signal,
      keep: (c) => Date.parse(c.started_at) < startMs,
    }),
  ]);
  const errors = [...now.errors, ...before.errors.filter((e) => !now.errors.some((n) => n.botId === e.botId))];
  return { calls: [...now.calls, ...before.calls], errors, nowMs, startMs, truncated: now.truncated || before.truncated };
}

/** The finished calls of a period whose records are read for timings: `each` per agent, spread over its days. */
export function sampleCalls(calls: ListedCall[], ids: string[], startMs: number, each: number): ListedCall[] {
  return ids.flatMap((id) =>
    spreadPick(
      newestFirst(calls.filter((c) => c.bot === id && c.status !== 'in_progress' && Date.parse(c.started_at) >= startMs)),
      each,
    ),
  );
}

async function readSamples(lists: Lists, ids: string[], perAgent: number, cap: number): Promise<Record<string, CallFacts>> {
  const each = Math.min(perAgent, Math.max(1, Math.floor(cap / Math.max(1, ids.length))));
  const wanted = sampleCalls(lists.calls, ids, lists.startMs, each).slice(0, cap);
  const samples: Record<string, CallFacts> = {};
  await fewAtATime(wanted, AT_A_TIME, async (c) => {
    try {
      samples[`${c.bot}/${c.id}`] = factsOf(c, await readFinishedCall(c));
    } catch {
      /* one call that cannot be read is left out of the sample */
    }
  });
  return samples;
}

export interface Monitoring {
  /** The lists are being read for the first time. */
  loading: boolean;
  /** A new reading is under way while the last one is shown. */
  refreshing: boolean;
  /** The records of the sampled calls are still being read. */
  sampling: boolean;
  calls: ListedCall[];
  samples: Record<string, CallFacts>;
  errors: { botId: string; message: string }[];
  nowMs: number;
  truncated: boolean;
  reload: () => void;
}

/**
 * The calls of some agents over a period (and the period before), and the records of some of them.
 *   perAgent, cap: records read per agent and in all (Home reads a couple of hundred in all, shared evenly)
 */
export function useMonitoring({
  bots,
  days = 7,
  perAgent = PER_AGENT,
  cap = Infinity,
  everyMs = 0,
}: {
  bots: { id: string }[];
  days?: number;
  perAgent?: number;
  cap?: number;
  everyMs?: number;
}): Monitoring {
  const ids = bots.map((b) => b.id);
  const idKey = ids.join(',');
  const lists = useReading(idKey ? `monitor-lists|${idKey}|${days}` : '', (signal) => readLists(idKey.split(','), days, signal), { everyMs });
  const listed = lists.data;
  const samplesKey = listed && !lists.refreshing && idKey ? `monitor-samples|${idKey}|${days}|${perAgent}|${cap}|${lists.at}` : '';
  const samples = useReading(samplesKey, () => readSamples(listed as Lists, idKey.split(','), perAgent, cap), { staleMs: Infinity });
  const { reload: reloadLists } = lists;
  const reload = useCallback(() => reloadLists(), [reloadLists]);
  return {
    loading: lists.loading,
    refreshing: lists.refreshing || samples.refreshing,
    sampling: !!listed && (samples.loading || (!samples.data && !!samplesKey)),
    calls: listed?.calls ?? [],
    samples: samples.data ?? {},
    errors: listed?.errors ?? (lists.error ? [{ botId: '', message: lists.error }] : []),
    nowMs: listed?.nowMs ?? Date.now(),
    truncated: !!listed?.truncated,
    reload,
  };
}

// ---- Speed's reading

export interface SpeedReading {
  errors: { botId: string; message: string }[];
  samples: Sample[];
  /** Finished calls of the period, per agent. */
  totals: Record<string, number>;
  /** Calls whose records couldn't be read. */
  failed: number;
  at: number;
}

async function readSpeed(ids: string[], days: number, perAgent: number, signal: AbortSignal): Promise<SpeedReading> {
  const nowMs = Date.now();
  const startMs = periodOf(nowMs, days).startMs;
  const { calls, errors } = await loadCalls(ids, { sinceMs: startMs, maxPages: MAX_PAGES, signal });
  const totals: Record<string, number> = {};
  calls
    .filter((c) => c.status !== 'in_progress')
    .forEach((c) => {
      totals[c.bot] = (totals[c.bot] || 0) + 1;
    });
  const wanted = sampleCalls(calls, ids, startMs, perAgent);
  let failed = 0;
  const samples = (
    await fewAtATime(wanted, AT_A_TIME, async (c) => {
      try {
        return sampleOf(c, await readFinishedCall(c));
      } catch {
        if (!signal.aborted) failed += 1;
        return null;
      }
    })
  ).filter((s): s is Sample => !!s);
  return { errors, samples, totals, failed, at: nowMs };
}

/** The Speed page's data for some agents: the calls of the period counted, and the records of some read for timings. */
export function useSpeedData(bots: { id: string }[], { days = 14, perAgent = PER_AGENT }: { days?: number; perAgent?: number } = {}) {
  const idKey = bots.map((b) => b.id).join(',');
  const reading = useReading(idKey ? `speed|${idKey}|${days}|${perAgent}` : '', (signal) => readSpeed(idKey.split(','), days, perAgent, signal));
  const data = reading.data;
  const failedOutright = reading.error ? [{ botId: '', message: reading.error }] : [];
  return {
    loading: reading.loading || reading.refreshing,
    /** Nothing has been read yet. */
    first: reading.loading,
    errors: data ? [...data.errors, ...failedOutright] : failedOutright,
    samples: data?.samples ?? [],
    totals: data?.totals ?? {},
    failed: data?.failed ?? 0,
    at: data?.at ?? 0,
    refresh: reading.reload,
  };
}
