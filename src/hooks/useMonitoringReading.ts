import { useCallback, useEffect, useRef, useState } from 'react';

// One reading from the server for the insight pages (Monitoring, Speed, Home's numbers), kept by key while Studio is
// open: reopening a page shows the last reading at once and reads again when it is older than `staleMs`. While a new
// reading comes in (another period, Refresh), the last one stays on screen instead of the page going blank.

interface Kept<T> {
  data: T;
  at: number;
}
const kept = new Map<string, Kept<unknown>>();

export interface Reading<T> {
  data: T | undefined;
  /** Nothing to show yet: the first reading is under way. */
  loading: boolean;
  /** A new reading is under way while the last one is shown. */
  refreshing: boolean;
  error: string | null;
  /** When the shown reading was made (ms), 0 when none. */
  at: number;
  reload: () => void;
}

/**
 * Reads `read(signal)` for `key` (nothing while `key` is empty). `everyMs`: read again on that beat while the tab is
 * on screen, and at once when it comes back.
 */
export function useReading<T>(
  key: string,
  read: (signal: AbortSignal) => Promise<T>,
  { staleMs = 60_000, everyMs = 0 }: { staleMs?: number; everyMs?: number } = {},
): Reading<T> {
  const cached = key ? (kept.get(key) as Kept<T> | undefined) : undefined;
  const [shown, setShown] = useState<Kept<T> | undefined>(cached);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const readRef = useRef(read);
  readRef.current = read;
  const forced = useRef(false);

  useEffect(() => {
    if (!key) {
      setShown(undefined);
      setBusy(false);
      return undefined;
    }
    const known = kept.get(key) as Kept<T> | undefined;
    if (known) setShown(known);
    if (known && !forced.current && Date.now() - known.at < staleMs) {
      setBusy(false);
      return undefined;
    }
    forced.current = false;
    const controller = new AbortController();
    setBusy(true);
    setError(null);
    readRef
      .current(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        const next = { data, at: Date.now() };
        kept.set(key, next);
        setShown(next);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setError(e instanceof Error && e.message ? e.message : 'The calls could not be read.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [key, nonce, staleMs]);

  const reload = useCallback(() => {
    forced.current = true;
    setNonce((n) => n + 1);
  }, []);

  // on a beat, and when the tab comes back, while it is on screen
  useEffect(() => {
    if (!key || !everyMs) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, everyMs);
    const onVisible = () => {
      const last = kept.get(key)?.at ?? 0;
      if (document.visibilityState === 'visible' && Date.now() - last > everyMs / 2) reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [key, everyMs, reload]);

  return {
    data: shown?.data,
    loading: busy && !shown,
    refreshing: busy && !!shown,
    error,
    at: shown?.at ?? 0,
    reload,
  };
}
