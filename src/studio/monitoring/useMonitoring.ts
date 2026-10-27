import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.ts';
import { keys } from '../../api/queryClient.ts';
import type { CallSummary } from '../../api/types.ts';
import { ALL_AGENTS_LIMIT } from '../calls/callModel.js';
import { fewAtATime, readFinishedCall } from '../insights/callData.ts';
import type { ListedCall } from '../insights/callData.ts';
import { readCall } from '../replay/callFacts.js';
import { sampleOf, spreadPick } from '../speed/speedModel.ts';
import { MAX_PAGES, PER_AGENT } from '../speed/useSpeedData.ts';
import { periodOf } from '../format.js';

// Reads (only) what Monitoring needs: each agent's calls for the period and the one before, and records of some
// finished calls spread over the days as Speed picks them, with waits measured as Speed does, so both pages agree.
// Agents are asked a few at a time; one failing doesn't hide the others. Lists come first so the page is useful soon.
//   perAgent, cap: calls read per agent (as many as Speed) and in all (none for Monitoring; Home reads a couple of
//   hundred, shared evenly, so a big workspace reads fewer per agent)
const AT_A_TIME = 4;
const PAGE = 100;
const SAMPLE_CAP = 200;

type Lists = {
  calls: ListedCall[];
  errors: { botId: string; message: string }[];
  nowMs: number;
  startMs: number;
  truncated: boolean;
  listed: { id: string; calls: ListedCall[] }[];
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the facts are callFacts.js's (untyped) reading of a call, plus Speed's waits
type Facts = any;

async function readLists(ids: string[], days: number, signal: AbortSignal): Promise<Lists> {
  const nowMs = Date.now();
  const startMs = periodOf(nowMs, days).startMs;
  const iso = (ms: number) => new Date(ms).toISOString();
  let truncated = false;
  const listed = await fewAtATime(ids, AT_A_TIME, async (id) => {
    const calls: CallSummary[] = [];
    let error: string | null = null;
    // newest first, a page at a time, as many pages as Speed reads; `keep` says which of them belong
    const read = async (filters: { since: string; until?: string }, keep: (c: CallSummary) => boolean) => {
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const answer = await api.listCalls(id, { limit: PAGE, cursor, ...filters }, { signal });
        calls.push(...(Array.isArray(answer?.calls) ? answer.calls : []).filter(keep));
        cursor = answer?.next || undefined;
        if (!cursor) return;
      }
      truncated = true;
    };
    try {
      // the period, then the same length before it (read apart, so a busy period can't leave the one before unread)
      await read({ since: iso(startMs) }, () => true);
      await read({ since: iso(startMs - (nowMs - startMs)), until: iso(startMs - 1) }, (c) => Date.parse(c.started_at) < startMs);
    } catch (e) {
      if (signal.aborted) throw e;
      error = (e as Error)?.message || 'This agent’s calls could not be read.';
    }
    return { id, calls: calls.map((c) => ({ ...c, bot: c.bot || id })), error };
  });
  return {
    calls: listed.flatMap((l) => l.calls),
    errors: listed.filter((l) => l.error).map((l) => ({ botId: l.id, message: l.error as string })),
    nowMs,
    startMs,
    truncated,
    listed,
  };
}

// the records of finished calls of the period, spread over its days
async function readSamples(lists: Lists, ids: string[], perAgent: number, cap: number): Promise<Record<string, Facts>> {
  const start = lists.startMs;
  const each = Math.min(perAgent, Math.max(1, Math.floor(cap / Math.max(1, ids.length))));
  const wanted = lists.listed
    .flatMap((l) =>
      spreadPick(
        [...l.calls]
          .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
          .filter((c) => c.status !== 'in_progress' && Date.parse(c.started_at) >= start),
        each,
      ),
    )
    .slice(0, cap);
  const samples: Record<string, Facts> = {};
  await fewAtATime(wanted, AT_A_TIME, async (c) => {
    try {
      const page = await readFinishedCall(c);
      samples[`${c.bot}/${c.id}`] = {
        ...readCall(Array.isArray(page?.events) ? page.events : []),
        waits: sampleOf(c, page).waits,
      };
    } catch {
      /* one call that cannot be read is left out of the sample */
    }
  });
  return samples;
}

//   { loading (lists being read), calls, samples (once read), errors, nowMs, truncated, refreshing, updatedAt, reload }
export function useMonitoring({
  bots = [],
  days = 7,
  perAgent = PER_AGENT,
  cap = SAMPLE_CAP,
}: {
  bots?: { id: string }[];
  days?: number;
  perAgent?: number;
  cap?: number;
}) {
  const ids = bots.slice(0, ALL_AGENTS_LIMIT).map((b) => b.id);
  const idKey = ids.join(',');
  const lists = useQuery({
    queryKey: keys.monitoringLists(idKey, days),
    queryFn: ({ signal }) => readLists(idKey ? idKey.split(',') : [], days, signal),
    placeholderData: keepPreviousData,
  });
  const listedAt = lists.data && !lists.isPlaceholderData ? lists.dataUpdatedAt : 0;
  const samples = useQuery({
    queryKey: keys.monitoringSamples(idKey, days, perAgent, cap, listedAt),
    queryFn: () => readSamples(lists.data as Lists, idKey ? idKey.split(',') : [], perAgent, cap),
    enabled: !!listedAt,
    // the numbers of the last reading stay while the records of a new one are read
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });
  const data = lists.data;
  return {
    loading: lists.isFetching && !data,
    refreshing: (lists.isFetching || samples.isFetching) && !!data,
    calls: data?.calls || [],
    samples: (samples.data || {}) as Record<string, Facts>,
    errors: data?.errors || (lists.isError ? [{ botId: '', message: (lists.error as Error)?.message || 'The calls could not be read.' }] : []),
    nowMs: data?.nowMs || Date.now(),
    truncated: !!data?.truncated,
    updatedAt: lists.dataUpdatedAt || 0,
    reload: () => {
      lists.refetch();
    },
  };
}
