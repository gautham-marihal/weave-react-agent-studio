// Keeps the Live board up to date, and only reads. Every few seconds it asks each agent for its calls in progress (a
// few agents at a time); a call it has not seen is read once (its records so far) and then followed record by record
// through the call stream; past `maxFollowed` calls, the rest are read again on each round instead, so a busy workspace
// does not open a stream per call. A call that leaves the list is read once more to learn how it ended. Calls that
// ended in the last minutes are listed too, and kept for RECENT_MS. Nothing here knows React: the page subscribes to
// `onChange`; the tests drive it with a fake api, a fake stream and a fake clock.

import { RECENT_MS } from './liveModel.js';

const AT_A_TIME = 4;
const list = (v) => (Array.isArray(v) ? v : []);

export function createLiveBoard({
  api,
  follow,
  now = () => Date.now(),
  every = (fn, ms) => setInterval(fn, ms),
  stopEvery = (id) => clearInterval(id),
  onChange = () => {},
  everyMs = 5000,
  recentEveryMs = 30000,
  maxFollowed = 12,
} = {}) {
  let bots = [];
  const calls = new Map(); // key → { summary, records, heardAtMs, endedAtMs, stop, loading, lastSeq }
  let errors = {};
  let checkedAt = null;
  let checking = false;
  let running = false;
  let timers = [];
  let round = null;
  let recentRound = null;

  const keyOf = (bot, id) => `${bot}/${id}`;
  const followedCount = () => [...calls.values()].filter((c) => c.stop).length;
  const snapshot = () => ({
    calls: [...calls.values()].map((c) => ({ summary: c.summary, records: c.records, heardAtMs: c.heardAtMs, endedAtMs: c.endedAtMs, loading: c.loading })),
    errors: Object.entries(errors).map(([botId, message]) => ({ botId, message })),
    checkedAt,
    checking,
    running,
    following: followedCount(),
  });
  const emit = () => onChange(snapshot());

  async function inChunks(items, work) {
    for (let i = 0; i < items.length; i += AT_A_TIME) await Promise.all(items.slice(i, i + AT_A_TIME).map(work));
  }

  const append = (entry, records) => {
    const fresh = list(records).filter((r) => r && typeof r.seq === 'number' && r.seq > entry.lastSeq);
    if (!fresh.length) return false;
    entry.records = [...entry.records, ...fresh].sort((a, b) => a.seq - b.seq);
    entry.lastSeq = entry.records[entry.records.length - 1].seq;
    entry.heardAtMs = now();
    if (fresh.some((r) => r.event === 'call_ended' || r.event === 'session_closed')) finish(entry, 'ended');
    return true;
  };
  function finish(entry, status) {
    if (entry.summary.status !== 'in_progress' && entry.endedAtMs) return;
    entry.summary = { ...entry.summary, status };
    entry.endedAtMs = entry.endedAtMs || now();
    if (entry.stop) {
      entry.stop();
      entry.stop = null;
    }
  }

  // the records of a call since the last one read; `call` in the answer says how it stands now
  async function readMore(entry) {
    try {
      const page = await api.getCall(entry.summary.bot, entry.summary.id, { after: entry.lastSeq, limit: 500 });
      if (!running) return;
      append(entry, page?.events);
      if (page?.call) {
        const status = page.call.status;
        // an ending already seen (from the stream) stands, even when the server's row has not caught up yet
        const ended = entry.endedAtMs && status === 'in_progress' ? { status: entry.summary.status } : {};
        entry.summary = { ...entry.summary, ...page.call, bot: entry.summary.bot, ...ended };
        if (status && status !== 'in_progress') finish(entry, status);
      }
    } catch {
      /* the next round tries again */
    }
  }

  function startFollowing(entry) {
    if (entry.stop || entry.summary.status !== 'in_progress' || followedCount() >= maxFollowed || !follow) return;
    entry.stop = follow(entry.summary.bot, entry.summary.id, {
      after: entry.lastSeq,
      onRecord: (record) => {
        if (running && append(entry, [record])) emit();
      },
      onEnd: () => {
        if (!running) return;
        finish(entry, 'ended');
        readMore(entry).then(emit);
        emit();
      },
      onError: () => {
        // the stream closed: this call is read on each round instead
        entry.stop = null;
      },
    });
  }

  async function load(entry) {
    entry.loading = true;
    await readMore(entry);
    entry.loading = false;
    if (running) startFollowing(entry);
  }

  async function checkLive() {
    if (!running || !bots.length) return;
    checking = true;
    const seenNow = new Set();
    const listed = new Set();
    await inChunks(bots, async (bot) => {
      try {
        const answer = await api.listCalls(bot.id, { status: 'in_progress', limit: 100 });
        // a server that does not filter by status still gives the right calls
        list(answer?.calls)
          .filter((c) => c && c.id && c.status === 'in_progress')
          .forEach((c) => {
            const key = keyOf(bot.id, c.id);
            seenNow.add(key);
            const known = calls.get(key);
            if (known)
              known.summary = { ...known.summary, ...c, bot: bot.id, status: known.summary.status === 'in_progress' ? c.status : known.summary.status };
            else calls.set(key, { summary: { ...c, bot: bot.id }, records: [], heardAtMs: null, endedAtMs: null, stop: null, loading: false, lastSeq: 0 });
          });
        listed.add(bot.id);
        delete errors[bot.id];
      } catch (e) {
        errors[bot.id] = e?.message || 'Its calls could not be read.';
      }
    });
    if (!running) return;
    const work = [];
    calls.forEach((entry, key) => {
      const live = entry.summary.status === 'in_progress';
      if (!live) return;
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
        list(answer?.calls)
          .filter((c) => c && c.id && c.status !== 'in_progress')
          .forEach((c) => {
            const key = keyOf(bot.id, c.id);
            const known = calls.get(key);
            if (known) {
              if (known.summary.status === 'in_progress') {
                known.summary = { ...known.summary, ...c, bot: bot.id };
                finish(known, c.status);
              }
              return;
            }
            const endedAt = Date.parse(c.last_event_at || c.started_at);
            calls.set(key, {
              summary: { ...c, bot: bot.id },
              records: [],
              heardAtMs: Number.isNaN(endedAt) ? now() : Math.min(now(), endedAt),
              endedAtMs: Number.isNaN(endedAt) ? now() : Math.min(now(), endedAt),
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

  function forgetOld() {
    const cutoff = now() - RECENT_MS;
    calls.forEach((entry, key) => {
      if (entry.summary.status !== 'in_progress' && entry.endedAtMs && entry.endedAtMs < cutoff) {
        if (entry.stop) entry.stop();
        calls.delete(key);
      }
    });
    // an agent no longer watched
    const ids = new Set(bots.map((b) => b.id));
    calls.forEach((entry, key) => {
      if (!ids.has(entry.summary.bot)) {
        if (entry.stop) entry.stop();
        calls.delete(key);
      }
    });
  }

  const runOnce = (fn, slot) => {
    if (slot === 'live') {
      if (round) return round;
      round = fn().finally(() => {
        round = null;
      });
      return round;
    }
    if (recentRound) return recentRound;
    recentRound = fn().finally(() => {
      recentRound = null;
    });
    return recentRound;
  };

  return {
    setBots(next) {
      bots = list(next).filter((b) => b && b.id);
      Object.keys(errors).forEach((id) => {
        if (!bots.some((b) => b.id === id)) delete errors[id];
      });
      forgetOld();
      emit();
    },
    start() {
      if (running) return;
      running = true;
      // calls that were followed before a pause are read from where they were, then followed again
      calls.forEach((entry) => {
        if (entry.summary.status === 'in_progress') entry.loading = false;
      });
      timers = [every(() => runOnce(checkLive, 'live'), everyMs), every(() => runOnce(checkRecent, 'recent'), recentEveryMs)];
      emit();
      return Promise.all([runOnce(checkLive, 'live'), runOnce(checkRecent, 'recent')]);
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
    refresh: () => (running ? Promise.all([runOnce(checkLive, 'live'), runOnce(checkRecent, 'recent')]) : Promise.resolve()),
    snapshot,
  };
}
