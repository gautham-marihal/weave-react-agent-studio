import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';

// The config schema is the same for every agent, so it is fetched once and shared.
let cached = null;
let pending = null;

// The schema, from the one shared copy: for code that is not a component (the settings search).
export function loadSchema() {
  if (cached) return Promise.resolve(cached);
  if (!pending) pending = api.schema().then((schema) => { cached = schema; return schema; }).finally(() => { pending = null; });
  return pending;
}

export function useSchema() {
  const [state, setState] = useState({ schema: cached, error: null, loading: !cached });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (cached) { setState({ schema: cached, error: null, loading: false }); return undefined; }
    let off = false;
    setState((old) => ({ ...old, loading: true, error: null }));
    loadSchema().then(
      (schema) => { if (!off) setState({ schema, error: null, loading: false }); },
      (error) => { if (!off) setState({ schema: null, error, loading: false }); },
    );
    return () => { off = true; };
  }, [tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, reload };
}
