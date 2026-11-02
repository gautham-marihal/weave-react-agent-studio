import { useEffect, useMemo, useState } from 'react';
import type { AgentConfig } from '../types/studio';
import type { DraftEditor } from './useDraftEditor';
import { useStudio } from '../contexts/StudioContext';
import { changesSince } from '../models/changes';
import { latestVersion } from '../utils/agentStatus';

/** The published config of the newest version (cached on the agent once read), or why it could not be read. */
export function usePublishedConfig(editor: DraftEditor): { config: AgentConfig | null; error: string | null; version: string | null } {
  const { loadVersionConfig } = useStudio();
  const agent = editor.agent;
  const latest = agent ? latestVersion(agent) : undefined;
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!agent || !latest || latest.config) return;
    setError(null);
    loadVersionConfig(agent.id, latest.version).catch((err: unknown) => setError(err instanceof Error ? err.message : 'The published version could not be read.'));
  }, [agent, latest, loadVersionConfig]);
  return { config: latest?.config ?? null, error, version: latest?.version ?? null };
}

/** "N unpublished changes": what the editor's draft changes compared with the newest published version. */
export function useChangesSincePublished(editor: DraftEditor) {
  const published = usePublishedConfig(editor);
  const summary = useMemo(() => changesSince(published.config, editor.config), [published.config, editor.config]);
  return { ...published, summary };
}
