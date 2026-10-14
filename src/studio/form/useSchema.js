import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';

// The config schema is the same for every agent, so it is fetched once and shared.
let cached = null;
let pending = null;

export function useSchema() {
  const [state, setState] = useState({ schema: cached, error: null, loading: !cached });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (cached) { setState({ schema: cached, error: null, loading: false }); return undefined; }
    let off = false;
    setState((old) => ({ ...old, loading: true, error: null }));
    if (!pending) {
      pending = api.schema().then((schema) => { cached = schema; return schema; }).finally(() => { pending = null; });
    }
    pending.then(
      (schema) => { if (!off) setState({ schema, error: null, loading: false }); },
      (error) => { if (!off) setState({ schema: null, error, loading: false }); },
    );
    return () => { off = true; };
  }, [tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, reload };
}
