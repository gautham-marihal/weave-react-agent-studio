// The studio's data cache (TanStack Query). Pages read through it, so a page opened again shows what it last read straight away while it refreshes in
// the background, two pages that need the same thing ask for it once, and a read that failed because the server hiccuped is asked again a moment
// later. It only reads: nothing here writes to the API.

import { QueryClient, timeoutManager } from '@tanstack/react-query';
import { ApiError } from './client.ts';

// In Node (the unit and component tests), the cache's timers (forgetting what no page uses any more, asking again on an interval) must not keep the
// process alive once the tests are done; in a browser a timer is only a number and nothing changes.
const probe = setTimeout(() => {}, 0) as unknown as { unref?: () => void };
clearTimeout(probe as unknown as number);
if (typeof probe?.unref === 'function') {
  type Timer = ReturnType<typeof setTimeout>;
  const loose = <T extends Timer>(timer: T): T => {
    (timer as unknown as { unref?: () => void }).unref?.();
    return timer;
  };
  timeoutManager.setTimeoutProvider({
    setTimeout: (callback, delay) => loose(setTimeout(callback, delay)),
    clearTimeout: (timer) => clearTimeout(timer),
    setInterval: (callback, delay) => loose(setInterval(callback, delay)),
    clearInterval: (timer) => clearInterval(timer),
  });
}

// A read worth asking again: the server didn't answer, or answered with an error of its own (5xx). A refusal (4xx: not
// found, not allowed, invalid) is final, and so is a person cancelling.
export function retryable(error: unknown): boolean {
  if ((error as Error)?.name === 'AbortError') return false;
  if (error instanceof ApiError) return error.kind === 'network' || error.status >= 500;
  return false;
}

export const RETRY_DELAY = (attempt: number): number => Math.min(800 * 2 ** attempt, 6000);

export function makeQueryClient({ retries = 2 }: { retries?: number } = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // what was read is shown for half a minute without asking again; kept for ten minutes after the last page that used it closes
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        retry: (failures, error) => failures < retries && retryable(error),
        retryDelay: RETRY_DELAY,
        // a person switching back to the studio's tab does not set every page reading again; the pages that are about "now" ask for it themselves
        refetchOnWindowFocus: false,
      },
    },
  });
}

export const queryClient = makeQueryClient();

// The cache's keys, in one place, so two pages that read the same thing share it.
export const keys = {
  /** the records of one call (GET /bots/{bot}/calls/{id}); a finished call's never change */
  call: (bot: string, id: string) => ['call', bot, id] as const,
  /** the Speed page's reading: the agents, the period, how many calls of each */
  speed: (bots: string, days: number, perAgent: number) => ['speed', bots, days, perAgent] as const,
  /** Monitoring's (and Home's) call lists, then the records of some of them */
  monitoringLists: (bots: string, days: number) => ['monitoring', 'lists', bots, days] as const,
  monitoringSamples: (bots: string, days: number, perAgent: number, cap: number, listedAt: number) =>
    ['monitoring', 'samples', bots, days, perAgent, cap, listedAt] as const,
  /** the calls going on now, counted across agents */
  liveCount: (bots: string) => ['liveCount', bots] as const,
  /** the Calls page: the agents asked, the filters, page after page */
  callList: (bots: string, filters: string) => ['callList', bots, filters] as const,
};
