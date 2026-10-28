import { useCallback, useEffect, useRef } from 'react';
import { effectiveRules, evaluateAlerts, lookback, reconcile } from './alertsModel.js';
import { loadCalls, loadFacts, newestFirst } from './callData.ts';
import { getInsights, getLive, setInsights, setLive } from './insightsStore.js';

// Checks every agent's recent calls for alerts while the studio is open: soon after opening, every few minutes, and
// when the tab returns after a while. Results go to the shared store (bell, Alerts page, agent banners); new alerts
// also show as browser notifications when turned on. Read-only.

export const CHECK_EVERY_MS = 3 * 60 * 1000;
const RECORDS_PER_AGENT = 40;
let factsSeen = {}; // the records of finished calls do not change: they are read once
let checkNowFn = null;
// Runs the check now (the Alerts page's button); nothing happens when no watcher is running.
export const checkAlertsNow = () => (checkNowFn ? checkNowFn() : null);

// A stopped check (another workspace opened, the studio closing) settles nothing: what it read is not all there is.
const stopped = () => new DOMException('The check was stopped.', 'AbortError');

async function checkAlerts(bots, { nowMs = Date.now(), signal } = {}) {
  const ids = bots.map((b) => b.id);
  const rules = effectiveRules(getInsights().rules);
  const { callsMs, recordsMs } = lookback(rules);
  setLive({ checking: true, watching: ids.length });
  const { calls, errors } = await loadCalls(ids, { sinceMs: nowMs - callsMs, maxPages: 5, signal });
  if (signal?.aborted) throw stopped();
  const recent = newestFirst(calls.filter((c) => c.status !== 'in_progress' && Date.parse(c.started_at) > nowMs - recordsMs));
  const perAgent = new Map();
  const wanted = recent.filter((c) => {
    const n = perAgent.get(c.bot) || 0;
    perAgent.set(c.bot, n + 1);
    return n < RECORDS_PER_AGENT;
  });
  const { facts, failedBots } = await loadFacts(wanted, { known: factsSeen, signal });
  if (signal?.aborted) throw stopped();
  factsSeen = facts;
  // Only agents whose calls and records were all read are checked: one whose reading failed keeps its alerts as they
  // were, rather than having them cleared (and coming back as new) because nothing could be seen.
  const unread = new Set([...errors.map((e) => e.botId), ...failedBots]);
  const checked = new Set(ids.filter((id) => !unread.has(id)));
  const kept = getLive().alerts.filter((a) => unread.has(a.bot));
  const alerts = [...evaluateAlerts({ calls, facts, bots, nowMs, rules }).filter((a) => checked.has(a.bot)), ...kept];
  const { state, fired } = reconcile(getInsights(), alerts, nowMs, checked);
  setInsights(state);
  setLive({ alerts, checkedAt: new Date(nowMs).toISOString(), checking: false, errors, watching: ids.length });
  return { alerts, fired };
}

// A browser notification for each new, unsnoozed alert, when the person turned them on and the browser allows it.
function notify(fired, { onOpen } = {}) {
  const { notify: prefs, acks } = getInsights();
  if (!prefs.browser || typeof window === 'undefined' || !('Notification' in window) || window.Notification.permission !== 'granted') return 0;
  let shown = 0;
  fired
    .filter((a) => !acks[a.key])
    .slice(0, 3)
    .forEach((a) => {
      try {
        const n = new window.Notification(`${a.botName}: ${a.title}`, { body: a.detail, tag: a.key });
        n.onclick = () => {
          window.focus();
          onOpen?.(a);
          n.close();
        };
        shown += 1;
      } catch {
        /* a browser that refuses notifications from a page: the bell still shows it */
      }
    });
  return shown;
}

export function useAlertWatcher({ bots = [], enabled = true, everyMs = CHECK_EVERY_MS, onOpenAlert } = {}) {
  const key = bots.map((b) => `${b.id}:${b.name || ''}`).join(',');
  const latest = useRef({ bots, onOpenAlert });
  latest.current = { bots, onOpenAlert };
  const running = useRef(null);

  const run = useCallback(async () => {
    if (running.current) return running.current;
    const controller = new AbortController();
    const job = (async () => {
      try {
        const { fired } = await checkAlerts(latest.current.bots, { signal: controller.signal });
        notify(fired, { onOpen: latest.current.onOpenAlert });
      } catch (e) {
        if (controller.signal.aborted) setLive({ checking: false });
        else setLive({ checking: false, errors: [{ botId: '', message: e?.message || 'The check could not run.' }] });
      } finally {
        running.current = null;
      }
    })();
    running.current = job;
    job.abort = () => controller.abort();
    return job;
  }, []);

  // Another workspace opened: results for agents not in it are dropped at once (all, if it has none) rather than shown
  // until its own check is done, and the last-check time resets to "not checked yet"; they return when switching back.
  const idsKey = bots.map((b) => b.id).join(',');
  useEffect(() => {
    const ids = new Set(latest.current.bots.map((b) => b.id));
    setLive({ alerts: getLive().alerts.filter((a) => ids.has(a.bot)), watching: ids.size, checkedAt: null, errors: [] });
  }, [idsKey]);

  // the Alerts page's "Check now" runs the same check as the timer
  useEffect(() => {
    checkNowFn = run;
    return () => {
      if (checkNowFn === run) checkNowFn = null;
    };
  }, [run]);

  useEffect(() => {
    if (!enabled || !key) return undefined;
    const first = window.setTimeout(run, 1500);
    const timer = window.setInterval(run, everyMs);
    const onVisible = () => {
      const last = Date.parse(getLive().checkedAt || 0);
      if (document.visibilityState === 'visible' && Date.now() - last > 60 * 1000) run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      running.current?.abort?.();
    };
  }, [enabled, key, everyMs, run]);

  return { checkNow: run };
}
