import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../../../api/client';
import { isBuilding, normalizeBuild, normalizeFiles, normalizeKnowledge, type KnowledgeBuild, type KnowledgeRead } from '../../../../models/knowledge';

// An agent's knowledge as the server sees it (bases, files, indexes), from the SAVED draft, because the server builds
// and searches what is saved. Shared by Build › Knowledge and the workspace Knowledge page. Files come with the
// knowledge answer; when it has none, GET …/knowledge/files is asked as well.

export function useKnowledge(agentId: string) {
  const [data, setData] = useState<KnowledgeRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const turn = useRef(0);

  const reload = useCallback(async () => {
    if (!agentId) return;
    const mine = ++turn.current;
    setLoading(true);
    const [knowledge, files] = await Promise.allSettled([api.getKnowledge(agentId), api.listKnowledgeFiles(agentId)]);
    if (mine !== turn.current) return;
    if (knowledge.status === 'fulfilled') {
      const read = normalizeKnowledge(knowledge.value);
      const listed = files.status === 'fulfilled' ? normalizeFiles(files.value) : [];
      setData({ ...read, files: read.files.length ? read.files : listed });
      setError(null);
    } else {
      setError(knowledge.reason instanceof Error ? knowledge.reason.message : 'The knowledge could not be read.');
    }
    setLoading(false);
  }, [agentId]);

  useEffect(() => {
    setData(null);
    setError(null);
    void reload();
  }, [reload]);

  return { data, error, loading: loading && !data, refreshing: loading, reload };
}

/** How often a running build is asked about. */
export const POLL_MS = 1500;

/**
 * Starts building one base's index and follows the job until it ends. One build per base at a time (a second is refused
 * with 409, and the running one is followed instead). The old index keeps answering while a new one builds.
 *   onDone(baseId, build): called once a followed build has ended (done or failed)
 */
export function useBuilds(agentId: string, { onDone, pollMs = POLL_MS }: { onDone?: (baseId: string, build: KnowledgeBuild | null) => void; pollMs?: number } = {}) {
  const [builds, setBuilds] = useState<Record<string, KnowledgeBuild | null>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const timers = useRef<Record<string, number>>({});
  const alive = useRef(true);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    alive.current = true;
    const own = timers.current;
    return () => {
      alive.current = false;
      Object.values(own).forEach((t) => window.clearTimeout(t));
    };
  }, []);
  useEffect(() => {
    Object.values(timers.current).forEach((t) => window.clearTimeout(t));
    timers.current = {};
    setBuilds({});
    setErrors({});
  }, [agentId]);

  const setError = (baseId: string, message: string | null) =>
    setErrors((old) => {
      const next = { ...old };
      if (message) next[baseId] = message;
      else delete next[baseId];
      return next;
    });

  const follow = useCallback(
    (baseId: string) => {
      window.clearTimeout(timers.current[baseId]);
      const tick = async () => {
        if (!alive.current) return;
        try {
          const status = await api.knowledgeStatus(agentId, baseId);
          if (!alive.current) return;
          const build = normalizeBuild(status?.build);
          setBuilds((old) => ({ ...old, [baseId]: build }));
          if (isBuilding(build)) {
            timers.current[baseId] = window.setTimeout(tick, pollMs);
            return;
          }
          doneRef.current?.(baseId, build);
        } catch (err: unknown) {
          if (alive.current) setError(baseId, err instanceof Error ? `Lost track of the build: ${err.message}` : 'Lost track of the build.');
        }
      };
      timers.current[baseId] = window.setTimeout(tick, pollMs);
    },
    [agentId, pollMs]
  );

  const start = useCallback(
    async (baseId: string) => {
      setError(baseId, null);
      try {
        const job = await api.buildKnowledge(agentId, baseId);
        if (!alive.current) return;
        setBuilds((old) => ({ ...old, [baseId]: normalizeBuild(job) ?? { id: '', status: 'running', log: [], error: '', startedAt: '', finishedAt: '' } }));
        follow(baseId);
      } catch (err: unknown) {
        if (!alive.current) return;
        if (err instanceof ApiError && err.kind === 'conflict') {
          setError(baseId, 'A build of this base is already running. Following it.');
          follow(baseId);
          return;
        }
        const message = err instanceof Error ? err.message : 'The build didn’t start.';
        setError(baseId, err instanceof ApiError && err.kind === 'unavailable' ? `${message} Whoever runs the server has to set the embedding key before indexes can be built.` : message);
      }
    },
    [agentId, follow]
  );

  return { builds, errors, start, follow };
}
