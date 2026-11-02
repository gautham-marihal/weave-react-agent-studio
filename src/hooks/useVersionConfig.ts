import { useEffect, useState } from 'react';
import type { Agent, AgentConfig } from '../types/studio';
import { useStudio } from '../contexts/StudioContext';

export interface VersionConfigState {
  config: AgentConfig | undefined;
  loading: boolean;
  error: string | null;
}

/** The config of one published version (or 'draft'), fetched from the server the first time it is needed. */
export function useVersionConfig(agent: Agent, ref: string | undefined): VersionConfigState {
  const { loadVersionConfig } = useStudio();
  const cached = !ref ? undefined : ref === 'draft' ? agent.draft.config : agent.versions.find((v) => v.version === ref)?.config;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setError(null);
    if (!ref || cached) return;
    let live = true;
    setLoading(true);
    loadVersionConfig(agent.id, ref)
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : 'Could not load this version.');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [agent.id, ref, cached, loadVersionConfig]);

  return { config: cached, loading: loading && !cached, error };
}
