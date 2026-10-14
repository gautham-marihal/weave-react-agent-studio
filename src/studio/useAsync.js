import { useCallback, useEffect, useRef, useState } from 'react';

// Runs `load(signal)` whenever `deps` change (or reload() is called). Stale answers are dropped.
// While reloading, the previous data is kept so the screen does not flash empty.
export function useAsync(load, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const controller = new AbortController();
    setState((old) => ({ ...old, loading: true, error: null }));
    loadRef.current(controller.signal).then(
      (data) => { if (!controller.signal.aborted) setState({ data, error: null, loading: false }); },
      (error) => { if (error?.name !== 'AbortError' && !controller.signal.aborted) setState((old) => ({ data: old.data, error, loading: false })); },
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { ...state, reload };
}
