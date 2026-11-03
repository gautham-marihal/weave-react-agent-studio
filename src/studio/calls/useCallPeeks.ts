import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fewAtATime, readFinishedCall } from '../insights/callData.ts';
import { readCall } from '../replay/callFacts.js';
import { peekOf } from './callModel.js';

// What each listed call's record adds to its row (the caller's first words, failed tools), by 'bot/id'. Only finished
// calls are read (their records never change, and readFinishedCall shares one read with every other page), a few at a
// time, at most `max` of them; a call that can't be read is simply left without them.
const AT_A_TIME = 4;

type Row = { bot: string; id: string; outcome: string };
export type Peek = { first: string; failed: number };

export function useCallPeeks(rows: Row[], max = 50): Record<string, Peek> {
  const wanted = rows.filter((r) => r.outcome !== 'progress').slice(0, max);
  const idKey = wanted.map((r) => `${r.bot}/${r.id}`).join(',');
  const read = useQuery({
    queryKey: ['callPeeks', idKey],
    queryFn: async () => {
      const peeks: Record<string, Peek> = {};
      await fewAtATime(wanted, AT_A_TIME, async (r: Row) => {
        try {
          const page = await readFinishedCall(r);
          peeks[`${r.bot}/${r.id}`] = peekOf(readCall(Array.isArray(page?.events) ? page.events : []));
        } catch {
          /* a call that can't be read keeps its plain row */
        }
      });
      return peeks;
    },
    enabled: wanted.length > 0,
    staleTime: Infinity,
    // the last reading stays while a longer list is read
    placeholderData: keepPreviousData,
  });
  return read.data || {};
}
