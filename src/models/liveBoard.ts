// Keeps the Live board up to date (read-only): polls each agent's calls in progress, reads a new call once, then
// follows it on the call stream; past `maxFollowed`, calls are re-read each round so a busy workspace doesn't open a
// stream per call. A call gone from the list is read once more to learn how it ended. No React: see `onChange`.
// The API and the stream are passed in, so tests drive it with a stand-in.

import { RECENT_MS } from './live';

const AT_A_TIME = 4;
type Rec = Record<string, unknown>;
const list = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export interface BoardSummaryRow extends Rec {
  id: string;
  bot: string;
  status: string;
}

export interface LiveBoardApi {
  listCalls: (bot: string, filters: Record<string, unknown>) => Promise<{ calls?: unknown[] } | unknown>;
  getCall: (bot: string, id: string, query: Record<string, unknown>) => Promise<unknown>;
}

export interface FollowHandlers {
  after?: number;
  onRecord?: (record: unknown) => void;
  onEnd?: () => void;
  onError?: () => void;
}
export type Follow = (bot: string, id: string, handlers: FollowHandlers) => () => void;

export interface BoardEntry {
  summary: BoardSummaryRow;
  records: Rec[];
  heardAtMs: number | null;
  endedAtMs: number | null;
  loading: boolean;
}
export interface BoardSnapshot {
  calls: BoardEntry[];
  errors: Array<{ botId: string; message: string }>;
  checkedAt: string | null;
  checking: boolean;
  running: boolean;
  following: number;
}

interface Entry extends BoardEntry {
  stop: (() => void) | null;
  lastSeq: number;
}

export interface LiveBoardOptions {
  api: LiveBoardApi;
  follow?: Follow | null;
  now?: () => number;
  every?: (fn: () => void, ms: number) => unknown;
  stopEvery?: (id: unknown) => void;
  onChange?: (snapshot: BoardSnapshot) => void;
  everyMs?: number;
  recentEveryMs?: number;
  maxFollowed?: number;
}

const callsOf = (answer: unknown): Rec[] =>
  list<Rec>(answer && typeof answer === 'object' ? (answer as Rec).calls : []).filter((c) => c && typeof c === 'object' && c.id);

export function createLiveBoard({
  api,
  follow = null,
  now = () => Date.now(),
  every = (fn, ms) => setInterval(fn, ms),
  stopEvery = (id) => clearInterval(id as ReturnType<typeof setInterval>),
  onChange = () => undefined,
  everyMs = 5000,
  recentEveryMs = 30000,
  // Each followed call holds a connection open. Over HTTP/1.1 a browser allows about 6 per server, so following more
  // would leave nothing for the rest of the app (and the Watch panel's own stream); the others are re-read each round.
  maxFollowed = 3,
}: LiveBoardOptions) {
  let bots: Array<{ id: string }> = [];
  const calls = new Map<string, Entry>();
  const errors: Record<string, string> = {};
  let checkedAt: string | null = null;
  let checking = false;
  let running = false;
  let timers: unknown[] = [];
  let round: Promise<void> | null = null;
  let recentRound: Promise<void> | null = null;

  const keyOf = (bot: string, id: string) => `${bot}/${id}`;
  const followedCount = () => [...calls.values()].filter((c) => c.stop).length;
  const snapshot = (): BoardSnapshot => ({
    calls: [...calls.values()].map((c) => ({ summary: c.summary, records: c.records, heardAtMs: c.heardAtMs, endedAtMs: c.endedAtMs, loading: c.loading })),
    errors: Object.entries(errors).map(([botId, message]) => ({ botId, message })),
    checkedAt,
    checking,
    running,
    following: followedCount(),
  });
  const emit = () => onChange(snapshot());

  async function inChunks<T>(items: T[], work: (item: T) => Promise<unknown>) {
    for (let i = 0; i < items.length; i += AT_A_TIME) await Promise.all(items.slice(i, i + AT_A_TIME).map(work));
  }

  function finish(entry: Entry, status: string) {
    if (entry.summary.status !== 'in_progress' && entry.endedAtMs) return;
    entry.summary = { ...entry.summary, status };
    entry.endedAtMs = entry.endedAtMs || now();
    if (entry.stop) {
      entry.stop();
      entry.stop = null;
    }
  }

  const append = (entry: Entry, records: unknown): boolean => {
    const fresh = list<Rec>(records).filter((r) => r && typeof r.seq === 'number' && (r.seq as number) > entry.lastSeq);
    if (!fresh.length) return false;
    entry.records = [...entry.records, ...fresh].sort((a, b) => (a.seq as number) - (b.seq as number));
    entry.lastSeq = entry.records[entry.records.length - 1].seq as number;
    entry.heardAtMs = now();
    if (fresh.some((r) => r.event === 'call_ended' || r.event === 'session_closed')) finish(entry, 'ended');
    return true;
  };

  // the records of a call since the last one read; `call` in the answer says how it stands now
  async function readMore(entry: Entry) {
    try {
      const page = (await api.getCall(entry.summary.bot, entry.summary.id, { after: entry.lastSeq, limit: 500 })) as Rec | null;
      if (!running) return;
      append(entry, page?.events);
      const call = page?.call && typeof page.call === 'object' ? (page.call as Rec) : null;
      if (call) {
        const status = typeof call.status === 'string' ? call.status : '';
        // an ending already seen (from the stream) stands, even when the server's row has not caught up yet
        const ended = entry.endedAtMs && status === 'in_progress' ? { status: entry.summary.status } : {};
        entry.summary = { ...entry.summary, ...call, id: entry.summary.id, bot: entry.summary.bot, ...ended } as BoardSummaryRow;
        if (status && status !== 'in_progress') finish(entry, status);
      }
    } catch {
      /* the next round tries again */
    }
  }

  function startFollowing(entry: Entry) {
    if (entry.stop || entry.summary.status !== 'in_progress' || followedCount() >= maxFollowed || !follow) return;
    entry.stop = follow(entry.summary.bot, entry.summary.id, {
      after: entry.lastSeq,
      onRecord: (record) => {
        if (running && append(entry, [record])) emit();
      },
      onEnd: () => {
        if (!running) return;
        finish(entry, 'ended');
        void readMore(entry).then(emit);
        emit();
      },
      onError: () => {
        // the stream closed: this call is read on each round instead
        entry.stop = null;
      },
    });
  }

  async function load(entry: Entry) {
    entry.loading = true;
    await readMore(entry);
    entry.loading = false;
    if (running) startFollowing(entry);
  }

  function forgetOld() {
    const cutoff = now() - RECENT_MS;
    const ids = new Set(bots.map((b) => b.id));
    calls.forEach((entry, key) => {
      const old = entry.summary.status !== 'in_progress' && entry.endedAtMs && entry.endedAtMs < cutoff;
      // an agent no longer watched leaves too
      if (old || !ids.has(entry.summary.bot)) {
        if (entry.stop) entry.stop();
        calls.delete(key);
      }
    });
  }

  async function checkLive() {
    if (!running || !bots.length) return;
    checking = true;
    const seenNow = new Set<string>();
    const listed = new Set<string>();
    await inChunks(bots, async (bot) => {
      try {
        const answer = await api.listCalls(bot.id, { status: 'in_progress', limit: 100 });
        // a server that does not filter by status still gives the right calls
        callsOf(answer)
          .filter((c) => c.status === 'in_progress')
          .forEach((c) => {
            const key = keyOf(bot.id, String(c.id));
            seenNow.add(key);
            const known = calls.get(key);
            if (known) {
              const status = known.summary.status === 'in_progress' ? String(c.status) : known.summary.status;
              known.summary = { ...known.summary, ...c, id: known.summary.id, bot: bot.id, status };
            } else
              calls.set(key, {
                summary: { ...c, id: String(c.id), bot: bot.id, status: String(c.status) },
                records: [],
                heardAtMs: null,
                endedAtMs: null,
                stop: null,
                loading: false,
                lastSeq: 0,
              });
          });
        listed.add(bot.id);
        delete errors[bot.id];
      } catch (e) {
        errors[bot.id] = (e as Error)?.message || 'Its calls could not be read.';
      }
    });
    if (!running) return;
    const work: Array<() => Promise<void>> = [];
    calls.forEach((entry, key) => {
      if (entry.summary.status !== 'in_progress') return;
      if (!entry.records.length && !entry.loading) work.push(() => load(entry));
      // gone from the list: read once more, to learn how it ended
      else if (!seenNow.has(key) && listed.has(entry.summary.bot)) work.push(() => readMore(entry));
      // not followed (over the cap, or its stream closed): read what is new
      else if (!entry.stop && !entry.loading) work.push(() => readMore(entry).then(() => startFollowing(entry)));
    });
    await inChunks(work, (job) => job());
    forgetOld();
    checking = false;
    checkedAt = new Date(now()).toISOString();
    emit();
  }

  async function checkRecent() {
    if (!running || !bots.length) return;
    const since = new Date(now() - RECENT_MS).toISOString();
    await inChunks(bots, async (bot) => {
      try {
        const answer = await api.listCalls(bot.id, { since, limit: 50 });
        callsOf(answer)
          .filter((c) => c.status !== 'in_progress')
          .forEach((c) => {
            const key = keyOf(bot.id, String(c.id));
            const known = calls.get(key);
            if (known) {
              if (known.summary.status === 'in_progress') {
                known.summary = { ...known.summary, ...c, id: known.summary.id, bot: bot.id, status: String(c.status) };
                finish(known, String(c.status));
              }
              return;
            }
            const endedAt = Date.parse(String(c.last_event_at || c.started_at || ''));
            const at = Number.isNaN(endedAt) ? now() : Math.min(now(), endedAt);
            calls.set(key, {
              summary: { ...c, id: String(c.id), bot: bot.id, status: String(c.status) },
              records: [],
              heardAtMs: at,
              endedAtMs: at,
              stop: null,
              loading: false,
              lastSeq: 0,
            });
          });
      } catch {
        /* the live round reports the agent's error */
      }
    });
    forgetOld();
    emit();
  }

  const runLive = () => {
    if (!round)
      round = checkLive().finally(() => {
        round = null;
      });
    return round;
  };
  const runRecent = () => {
    if (!recentRound)
      recentRound = checkRecent().finally(() => {
        recentRound = null;
      });
    return recentRound;
  };

  return {
    setBots(next: Array<{ id: string }>) {
      bots = list<{ id: string }>(next).filter((b) => b && b.id);
      Object.keys(errors).forEach((id) => {
        if (!bots.some((b) => b.id === id)) delete errors[id];
      });
      forgetOld();
      emit();
    },
    start() {
      if (running) return Promise.resolve();
      running = true;
      // calls that were followed before a pause are read from where they were, then followed again
      calls.forEach((entry) => {
        if (entry.summary.status === 'in_progress') entry.loading = false;
      });
      timers = [every(() => void runLive(), everyMs), every(() => void runRecent(), recentEveryMs)];
      emit();
      return Promise.all([runLive(), runRecent()]).then(() => undefined);
    },
    stop() {
      running = false;
      checking = false;
      timers.forEach(stopEvery);
      timers = [];
      calls.forEach((entry) => {
        if (entry.stop) {
          entry.stop();
          entry.stop = null;
        }
      });
      emit();
    },
    refresh: () => (running ? Promise.all([runLive(), runRecent()]).then(() => undefined) : Promise.resolve()),
    snapshot,
  };
}

export type LiveBoard = ReturnType<typeof createLiveBoard>;
