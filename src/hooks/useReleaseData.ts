import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { PhoneNumber } from '../api/types';
import { readNumbers } from '../models/releaseEnvironments';
import { runHeadline, type RunHeadline } from '../models/releaseChecklist';

// What the Release page and the publish and deploy dialogs read from the server besides the agent itself: the
// environments, the agent's test runs and its phone numbers. Each says when it could not be read; none is made up.

interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

const message = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

function useLoaded<T>(load: ((signal: AbortSignal) => Promise<T>) | null, deps: unknown[], fallback: string): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!load) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    load(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setData(value);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(message(err, fallback));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}

// GET /environments rarely changes: read once per page load and shared.
let environmentsAnswer: Promise<string[]> | null = null;

/** The environments the server has (GET /environments). */
export function useEnvironments(): Loaded<string[]> {
  return useLoaded(
    () => {
      environmentsAnswer ??= api.environments().catch((err: unknown) => {
        environmentsAnswer = null;
        throw err;
      });
      return environmentsAnswer;
    },
    [],
    'Could not read the environments.',
  );
}

/** The agent's recent test runs (GET /tests/runs), newest first, as headlines. Off when `enabled` is false. */
export function useTestRuns(agentId: string, enabled = true, refreshKey: unknown = 0): Loaded<RunHeadline[]> {
  return useLoaded(
    enabled
      ? async (signal) => {
          const runs = await api.listTestRuns(agentId, 50, { signal });
          return (Array.isArray(runs) ? runs : []).map(runHeadline).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
        }
      : null,
    [agentId, enabled, refreshKey],
    'Could not read the test runs.',
  );
}

/** The agent's phone numbers (GET /bots/{id}/numbers). */
export function useAgentNumbers(agentId: string): Loaded<PhoneNumber[]> {
  return useLoaded(async (signal) => readNumbers(await api.listBotNumbers(agentId, { signal })), [agentId], 'Could not read the phone numbers.');
}

/** GET /bots/{id}/knowledge for a version or the draft. Off when `ref` is empty. */
export function useKnowledgeAt(agentId: string, ref: string, refreshKey: unknown = 0): Loaded<unknown> {
  return useLoaded(ref ? (signal) => api.getKnowledge(agentId, { ref }, { signal }) : null, [agentId, ref, refreshKey], 'Could not read the knowledge.');
}
