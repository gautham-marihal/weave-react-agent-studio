import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { useAsync } from '../useAsync.js';
import { isBuilding, normalizeBuild, normalizeKnowledge } from './model.js';

// The knowledge of an agent as the server sees it: its bases, their files and indexes. It reads the SAVED draft (`ref: "draft"`): the
// server builds and searches from what is saved, not from unsaved edits in the editor. Reading changes nothing.
export function useKnowledge(botId, ref = 'draft') {
  const load = useAsync((signal) => api.getKnowledge(botId, { ref }, { signal }), [botId, ref]);
  const data = useMemo(() => (load.data ? normalizeKnowledge(load.data) : null), [load.data]);
  return { data, raw: load.data, loading: load.loading, error: load.error, reload: load.reload };
}

// Starts building one base's index and follows the job until it is over. One build per base at a time (the server answers 409 for a second
// one: that one is followed instead). The old index keeps answering while a new one builds, so a failed build costs nothing.
const POLL_MS = 1500;
export function useBuilds(botId, { ref = 'draft', onChange, pollMs = POLL_MS } = {}) {
  const [builds, setBuilds] = useState({}); // baseId -> normalized build
  const [errors, setErrors] = useState({}); // baseId -> message
  const timers = useRef({});
  const alive = useRef(true);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      Object.values(timers.current).forEach(clearTimeout);
    };
  }, []);
  useEffect(() => {
    Object.values(timers.current).forEach(clearTimeout);
    timers.current = {};
    setBuilds({});
    setErrors({});
  }, [botId]);

  const follow = useCallback(
    (baseId) => {
      clearTimeout(timers.current[baseId]);
      const tick = async () => {
        if (!alive.current) return;
        try {
          const status = await api.knowledgeStatus(botId, baseId, ref);
          if (!alive.current) return;
          const build = normalizeBuild(status?.build);
          setBuilds((old) => ({ ...old, [baseId]: build }));
          if (isBuilding(build)) {
            timers.current[baseId] = setTimeout(tick, pollMs);
            return;
          }
          changeRef.current?.(baseId, build);
        } catch (e) {
          if (alive.current) setErrors((old) => ({ ...old, [baseId]: e?.message || 'Lost track of the build.' }));
        }
      };
      timers.current[baseId] = setTimeout(tick, pollMs);
    },
    [botId, ref, pollMs],
  );

  const start = useCallback(
    async (baseId) => {
      setErrors((old) => {
        const next = { ...old };
        delete next[baseId];
        return next;
      });
      try {
        const job = await api.buildKnowledge(botId, baseId, ref);
        if (!alive.current) return;
        setBuilds((old) => ({ ...old, [baseId]: normalizeBuild(job) }));
        follow(baseId);
      } catch (e) {
        if (!alive.current) return;
        if (e?.kind === 'conflict') {
          setErrors((old) => ({ ...old, [baseId]: 'A build of this base is already running. Following it.' }));
          follow(baseId);
          return;
        }
        setErrors((old) => ({
          ...old,
          [baseId]:
            e?.kind === 'unavailable'
              ? `${e.message} An operator has to set the embedding key on the server before indexes can be built.`
              : e?.message || 'The build didn’t start.',
        }));
      }
    },
    [botId, ref, follow],
  );

  return {
    builds,
    errors,
    start,
    follow,
    clearError: (baseId) =>
      setErrors((old) => {
        const next = { ...old };
        delete next[baseId];
        return next;
      }),
  };
}
