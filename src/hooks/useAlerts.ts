import { useSyncExternalStore } from 'react';
import {
  EMPTY_ALERTS_STATE,
  alertsByAgent,
  withStatus,
  type Ack,
  type Alert,
  type AlertsState,
  type AlertWithStatus,
  type RuleOverrides,
} from '../models/alerts';

// What a person decided about alerts, kept in this browser (not on the server): rule numbers, "I'm on it" and snoozes,
// the history, and whether browser notifications are on. Plus the latest check's results (not kept). Every reader, and
// other tabs, see a change at once; with storage blocked it still works until the page closes.

const KEY = 'weave_alerts_v1';
const listeners = new Set<() => void>();
let saved: AlertsState | null = null;

/** The latest check: the alerts that hold, when it ran, and what couldn't be read. */
export interface LiveAlerts {
  alerts: Alert[];
  checkedAt: string | null;
  checking: boolean;
  errors: { botId: string; message: string }[];
  watching: number;
}
let live: LiveAlerts = { alerts: [], checkedAt: null, checking: false, errors: [], watching: 0 };

function read(): AlertsState {
  if (saved) return saved;
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) || 'null') as Partial<AlertsState> | null;
    saved =
      raw && typeof raw === 'object'
        ? {
            rules: raw.rules && typeof raw.rules === 'object' ? raw.rules : {},
            acks: raw.acks && typeof raw.acks === 'object' ? raw.acks : {},
            history: Array.isArray(raw.history) ? raw.history : [],
            notify: { browser: !!raw.notify?.browser },
          }
        : { ...EMPTY_ALERTS_STATE };
  } catch {
    saved = { ...EMPTY_ALERTS_STATE };
  }
  return saved;
}
const emit = () => listeners.forEach((l) => l());

export const getAlertsState = (): AlertsState => read();

/** Changes what is kept: an object, or a function of the current state. */
export function setAlertsState(next: AlertsState | ((s: AlertsState) => AlertsState)) {
  saved = typeof next === 'function' ? next(read()) : next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    /* storage unavailable: kept for this page only */
  }
  emit();
}
export const getLiveAlerts = (): LiveAlerts => live;
export function setLiveAlerts(patch: Partial<LiveAlerts>) {
  live = { ...live, ...patch };
  emit();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) {
      saved = null;
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
};
export const useAlertsState = (): AlertsState => useSyncExternalStore(subscribe, read, () => EMPTY_ALERTS_STATE);
export const useLiveAlerts = (): LiveAlerts => useSyncExternalStore(subscribe, getLiveAlerts, () => live);

// ---- small edits

export const setRule = (id: string, patch: { enabled?: boolean; params?: Record<string, number> }) =>
  setAlertsState((s) => {
    const rules: RuleOverrides = { ...s.rules };
    const was = rules[id] || {};
    rules[id] = { ...was, ...patch, params: { ...(was.params || {}), ...(patch.params || {}) } };
    return { ...s, rules };
  });
export const resetRules = () => setAlertsState((s) => ({ ...s, rules: {} }));
export const acknowledge = (key: string, by = '') => setAlertsState((s) => ({ ...s, acks: { ...s.acks, [key]: { at: new Date().toISOString(), by } as Ack } }));
export const snooze = (key: string, until: string) => setAlertsState((s) => ({ ...s, acks: { ...s.acks, [key]: { until } } }));
export const reopen = (key: string) =>
  setAlertsState((s) => {
    const acks = { ...s.acks };
    delete acks[key];
    return { ...s, acks };
  });
export const setBrowserNotifications = (browser: boolean) => setAlertsState((s) => ({ ...s, notify: { browser } }));
export const clearHistory = () => setAlertsState((s) => ({ ...s, history: s.history.filter((h) => !h.clearedAt) }));

// ---- what the screens read

/** The alerts that hold now with what was done about them, for these agents only (all, without `agentIds`). */
export function useAlertsNow(agentIds?: string[]): AlertWithStatus[] {
  const { acks } = useAlertsState();
  const { alerts } = useLiveAlerts();
  const ids = agentIds ? new Set(agentIds) : null;
  return withStatus(
    alerts.filter((a) => !ids || ids.has(a.bot)),
    acks,
    Date.now(),
  );
}

/** How many alerts nobody has looked at yet (not "I'm on it", not snoozed), for the bell. */
export function useNewAlertCount(agentIds?: string[]): number {
  return useAlertsNow(agentIds).filter((a) => a.status === 'new').length;
}

/** The alerts that hold for each agent (not snoozed): { botId: { count, critical } }, for lists of agents. */
export function useAlertsByAgent(): Record<string, { count: number; critical: number }> {
  return alertsByAgent(useAlertsNow());
}
