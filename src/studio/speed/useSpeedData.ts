import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { keys } from '../../api/queryClient.ts';
import { fewAtATime, loadCalls, newestFirst, readFinishedCall } from '../insights/callData.ts';
import { sampleOf, spreadPick } from './speedModel.ts';
import type { Sample } from './speedModel.ts';
import { periodOf } from '../format.js';

// The calls the Speed page rests on, and only reads: each agent's calls in the period (to count them) and the records
// of PER_AGENT of its finished ones, spread over the days of the period (their timings). Monitoring and Home read the
// same ones (useMonitoring), so the pages say the same. Read through the shared cache: the page opened again shows its
// last reading at once and refreshes it; a call's records are read once for every page.

export const PER_AGENT = 40;
export const MAX_PAGES = 5; // up to 500 calls of each agent in the period: past that, the numbers rest on the newest

export type SpeedReading = {
  errors: { botId: string; message: string }[];
  samples: Sample[];
  totals: Record<string, number>;
  failed: number;
  at: string;
};

async function readSpeed(ids: string[], days: number, perAgent: number, signal: AbortSignal): Promise<SpeedReading> {
  const nowMs = Date.now();
  const { calls, errors } = await loadCalls(ids, { sinceMs: periodOf(nowMs, days).startMs, maxPages: MAX_PAGES, signal });
  const finished = newestFirst(calls.filter((c) => c.status !== 'in_progress'));
  const totals: Record<string, number> = {};
  finished.forEach((c) => {
    totals[c.bot] = (totals[c.bot] || 0) + 1;
  });
  const wanted = ids.flatMap((id) =>
    spreadPick(
      finished.filter((c) => c.bot === id),
      perAgent,
    ),
  );
  let failed = 0;
  const samples = (
    await fewAtATime(wanted, 4, async (c) => {
      try {
        return sampleOf(c, await readFinishedCall(c));
      } catch {
        if (!signal.aborted) failed += 1;
        return null;
      }
    })
  ).filter((s): s is Sample => !!s);
  return { errors, samples, totals, failed, at: new Date().toISOString() };
}

// perAgent: how many of each agent's calls are read for their timings.
//   { loading (reading, the first time or again), refreshing (reading again, with
//   the last reading still shown), errors, samples, totals, failed, at, refresh }
export function useSpeedData(bots: { id: string }[], { days = 14, perAgent = PER_AGENT }: { days?: number; perAgent?: number } = {}) {
  const key = bots.map((b) => b.id).join(',');
  const query = useQuery({
    queryKey: keys.speed(key, days, perAgent),
    queryFn: ({ signal }) => readSpeed(key.split(','), days, perAgent, signal),
    enabled: !!key,
    // the last reading stays on the page (dimmed) while another period is read, rather than the page going blank
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const reading = query.data;
  const failedOutright = query.isError ? [{ botId: '', message: (query.error as Error)?.message || 'The calls could not be read.' }] : [];
  return {
    loading: !!key && query.isFetching,
    refreshing: query.isFetching && !!reading,
    errors: reading ? [...reading.errors, ...failedOutright] : failedOutright,
    samples: reading?.samples || [],
    totals: reading?.totals || {},
    failed: reading?.failed || 0,
    at: reading?.at || null,
    refresh: () => {
      query.refetch();
    },
  };
}
