import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { createEngine, type RawSchema, type SchemaEngine } from '../models/schemaForm/engine';

// The config schema (GET /schema) is the same for every agent, so it is fetched once and shared by the settings form,
// the settings search and the Problems panel.
let cached: RawSchema | null = null;
let pending: Promise<RawSchema> | null = null;
let cachedEngine: SchemaEngine | null = null;

/** The schema, from the one shared copy: for code that is not a component (the search). */
export function loadSchema(): Promise<RawSchema> {
  if (cached) return Promise.resolve(cached);
  if (!pending)
    pending = api
      .schema()
      .then((schema) => {
        cached = schema as RawSchema;
        return cached;
      })
      .finally(() => {
        pending = null;
      });
  return pending;
}

/** The form engine for the shared schema (one per schema, so its caches are shared too). */
export function engineFor(schema: RawSchema): SchemaEngine {
  if (!cachedEngine || cachedEngine.root !== schema) cachedEngine = createEngine(schema);
  return cachedEngine;
}

export interface SchemaState {
  schema: RawSchema | null;
  engine: SchemaEngine | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** GET /schema for a component: loading, the error in words, and Try again. */
export function useSchema(): SchemaState {
  const [state, setState] = useState<{ schema: RawSchema | null; error: string | null; loading: boolean }>(() => ({ schema: cached, error: null, loading: !cached }));
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (cached) {
      setState({ schema: cached, error: null, loading: false });
      return undefined;
    }
    let off = false;
    setState((old) => ({ ...old, loading: true, error: null }));
    loadSchema().then(
      (schema) => {
        if (!off) setState({ schema, error: null, loading: false });
      },
      (error: unknown) => {
        if (!off) setState({ schema: null, error: error instanceof Error ? error.message : 'The schema could not be loaded.', loading: false });
      },
    );
    return () => {
      off = true;
    };
  }, [tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  const engine = useMemo(() => (state.schema ? engineFor(state.schema) : null), [state.schema]);
  return { ...state, engine, reload };
}
