import { useCallback, useEffect, useRef } from 'react';
import { effectiveRules, evaluateAlerts, lookback, reconcile, type Alert } from '../models/alerts';
import { newestFirst, type CallFacts } from '../models/callData';
import { loadCalls, loadFacts } from '../utils/callDataLoad';
import { getAlertsState, getLiveAlerts, setAlertsState, setLiveAlerts } from './useAlerts';

// Checks every agent's recent calls for alerts while Studio is open in a tab: soon after it opens, every few minutes,
// and when the tab comes back after a while. Results go to the shared store (the bell, the Alerts page, the agent's
// Monitor page); new alerts also show as browser notifications once the person has turned them on. Read-only.

export const CHECK_EVERY_MS = 3 * 60 * 1000;
const RECORDS_PER_AGENT = 40;
// the records of finished calls do not change: they are read once
let factsSeen: Record<string, CallFacts> = {};
let checkNowFn: (() => Promise<void>) | null = null;

/** Runs the check now (the Alerts page's button); nothing happens when no watcher is running. */
export const checkAlertsNow = () => (checkNowFn ? checkNowFn() : null);

// A stopped check (the agents changed, Studio closing) settles nothing: what it read is not all there is.
const stopped = () => new DOMException('The check was stopped.', 'AbortError');

export async function checkAlerts(bots: { id: string; name?: string }[], { nowMs = Date.now(), signal }: { nowMs?: number; signal?: AbortSignal } = {}) {
  const ids = bots.map((b) => b.id);
  const rules = effectiveRules(getAlertsState().rules);
  const { callsMs, recordsMs } = lookback(rules);
  setLiveAlerts({ checking: true, watching: ids.length });
  const { calls, errors } = await loadCalls(ids, { sinceMs: nowMs - callsMs, maxPages: 5, signal });
  if (signal?.aborted) throw stopped();
  const recent = newestFirst(calls.filter((c) => c.status !== 'in_progress' && Date.parse(c.started_at) > nowMs - recordsMs));
  const perAgent = new Map<string, number>();
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
  const kept = getLiveAlerts().alerts.filter((a) => unread.has(a.bot));
  const alerts = [...evaluateAlerts({ calls, facts, bots, nowMs, rules }).filter((a) => checked.has(a.bot)), ...kept];
  const { state, fired } = reconcile(getAlertsState(), alerts, nowMs, checked);
  setAlertsState(state);
  setLiveAlerts({ alerts, checkedAt: new Date(nowMs).toISOString(), checking: false, errors, watching: ids.length });
  return { alerts, fired };
}

/** Whether this browser can show notifications, and what the person allowed. */
export function notificationPermission(): NotificationPermission | 'unsupported' {
  return typeof window !== 'undefined' && 'Notification' in window ? window.Notification.permission : 'unsupported';
}

/** A browser notification for each new alert not acted on, when the person turned them on and the browser allows it. */
export function notify(fired: Alert[], { onOpen }: { onOpen?: (a: Alert) => void } = {}): number {
  const { notify: prefs, acks } = getAlertsState();
  if (!prefs.browser || notificationPermission() !== 'granted') return 0;
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

/** Runs the check in the background for these agents while mounted (Studio mounts it once, in the top bar). */
export function useAlertWatcher({
  bots,
  enabled = true,
  everyMs = CHECK_EVERY_MS,
  onOpenAlert,
}: {
  bots: { id: string; name?: string }[];
  enabled?: boolean;
  everyMs?: number;
  onOpenAlert?: (a: Alert) => void;
}) {
  const key = bots.map((b) => `${b.id}:${b.name || ''}`).join(',');
  const latest = useRef({ bots, onOpenAlert });
  latest.current = { bots, onOpenAlert };
  const running = useRef<{ job: Promise<void>; abort: () => void } | null>(null);

  const run = useCallback(async () => {
    if (running.current) return running.current.job;
    const controller = new AbortController();
    const job = (async () => {
      try {
        const { fired } = await checkAlerts(latest.current.bots, { signal: controller.signal });
        notify(fired, { onOpen: latest.current.onOpenAlert });
      } catch (e) {
        if (controller.signal.aborted) setLiveAlerts({ checking: false });
        else setLiveAlerts({ checking: false, errors: [{ botId: '', message: e instanceof Error ? e.message : 'The check could not run.' }] });
      } finally {
        running.current = null;
      }
    })();
    running.current = { job, abort: () => controller.abort() };
    return job;
  }, []);

  // Other agents (one removed, another added): results for agents no longer here are dropped at once.
  const idsKey = bots.map((b) => b.id).join(',');
  useEffect(() => {
    const ids = new Set(latest.current.bots.map((b) => b.id));
    setLiveAlerts({ alerts: getLiveAlerts().alerts.filter((a) => ids.has(a.bot)), watching: ids.size });
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
    const first = window.setTimeout(() => void run(), 1500);
    const timer = window.setInterval(() => void run(), everyMs);
    const onVisible = () => {
      const last = Date.parse(getLiveAlerts().checkedAt || '') || 0;
      if (document.visibilityState === 'visible' && Date.now() - last > 60 * 1000) void run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      running.current?.abort();
    };
  }, [enabled, key, everyMs, run]);

  return { checkNow: run };
}
