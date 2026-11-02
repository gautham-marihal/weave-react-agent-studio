import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from '../api/client';
import { NOT_CHECKED, nextCheckDelay, readHealthAnswer, readHealthFailure, type HealthCheck } from '../utils/health';

// Whether the Agent Builder API answers GET /health, asked once for the whole app: the top bar's indicator, the
// strips across every page and Settings read the same answer. It asks every minute while the API answers and every
// 15 s while it can't be reached, only while the tab is visible, and at once when the tab comes back.

const TIMEOUT_MS = 5_000;

export interface ApiHealth {
  check: HealthCheck;
  /** A question is on its way. */
  checking: boolean;
}

let snapshot: ApiHealth = { check: NOT_CHECKED, checking: false };
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;
let timer: number | undefined;

function emit(next: ApiHealth) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function schedule() {
  window.clearTimeout(timer);
  if (listeners.size === 0) return;
  timer = window.setTimeout(() => {
    if (document.visibilityState === 'visible') void checkApiHealth();
    else schedule();
  }, nextCheckDelay(snapshot.check.state));
}

/** Asks the API now (a "Try again" or "Check again"). Resolves when the answer is in; one question at a time. */
export function checkApiHealth(): Promise<void> {
  if (inFlight) return inFlight;
  emit({ ...snapshot, checking: true });
  const controller = new AbortController();
  const abort = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start = performance.now();
  const took = () => Math.round(performance.now() - start);
  inFlight = api
    .health({ signal: controller.signal })
    .then(
      (body) => readHealthAnswer(body, took(), Date.now()),
      (error: unknown) => readHealthFailure(error, took(), Date.now())
    )
    .then((check) => emit({ check, checking: false }))
    .finally(() => {
      window.clearTimeout(abort);
      inFlight = null;
      schedule();
    });
  return inFlight;
}

const onVisible = () => {
  if (document.visibilityState === 'visible') void checkApiHealth();
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener('visibilitychange', onVisible);
    if (!inFlight) void checkApiHealth();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    }
  };
}

const getSnapshot = () => snapshot;

/** The API's latest answer, kept up to date; `recheck` asks again now. */
export function useApiHealth(): ApiHealth & { recheck: () => Promise<void> } {
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { ...value, recheck: checkApiHealth };
}

/** Whether the browser has a network, following it as it changes. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}
