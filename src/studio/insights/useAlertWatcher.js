import { useCallback, useEffect, useRef } from 'react';
import { effectiveRules, evaluateAlerts, lookback, reconcile } from './alertsModel.js';
import { loadCalls, loadFacts, newestFirst } from './callData.js';
import { getInsights, getLive, setInsights, setLive } from './insightsStore.js';

// Checks every agent's recent calls for alerts while the studio is open: once soon after it opens, then every few minutes, and again when the tab comes
// back after a while. What it finds goes to the shared store (the bell, the Alerts page, the banners on an agent read it); an alert that is new this time
// is also shown as a browser notification when the person turned those on. It only reads.

export const CHECK_EVERY_MS = 3 * 60 * 1000;
const RECORDS_PER_AGENT = 40;
let factsSeen = {}; // the records of finished calls do not change: they are read once
let checkNowFn = null;
// Runs the check now (the Alerts page's button); nothing happens when no watcher is running.
export const checkAlertsNow = () => (checkNowFn ? checkNowFn() : null);

export async function checkAlerts(bots, { nowMs = Date.now(), signal } = {}) {
  const ids = bots.map((b) => b.id);
  const rules = effectiveRules(getInsights().rules);
  const { callsMs, recordsMs } = lookback(rules);
  setLive({ checking: true, watching: ids.length });
  const { calls, errors } = await loadCalls(ids, { sinceMs: nowMs - callsMs, maxPages: 5, signal });
  const recent = newestFirst(calls.filter((c) => c.status !== 'in_progress' && Date.parse(c.started_at) > nowMs - recordsMs));
  const perAgent = new Map();
  const wanted = recent.filter((c) => {
    const n = perAgent.get(c.bot) || 0;
    perAgent.set(c.bot, n + 1);
    return n < RECORDS_PER_AGENT;
  });
  const { facts } = await loadFacts(wanted, { known: factsSeen, signal });
  factsSeen = facts;
  const alerts = evaluateAlerts({ calls, facts, bots, nowMs, rules });
  const { state, fired } = reconcile(getInsights(), alerts, nowMs);
  setInsights(state);
  setLive({ alerts, checkedAt: new Date(nowMs).toISOString(), checking: false, errors, watching: ids.length });
  return { alerts, fired };
}

// A browser notification for each alert that is new this time (and not snoozed), when the person turned them on and the browser allows it.
export function notify(fired, { onOpen } = {}) {
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
