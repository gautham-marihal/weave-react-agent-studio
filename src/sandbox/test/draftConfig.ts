// What a conversation played in this browser runs: the draft as edited, or what was published as a version, "latest"
// or an environment. Shared by Sandbox's conversations (SimulatedSession) and Live's banking rehearsal
// (banking/LiveBankingSession), so both play exactly the same configuration for the same choice.
import { useCallback, useRef } from 'react';
import { api } from '../../api/client';
import type { DraftEditor } from '../../hooks/useDraftEditor';
import type { AgentConfig, EnvironmentName } from '../../types/studio';
import { environments } from '../../utils/agentStatus';

export type GetConfig = (ref: string) => Promise<{ config: AgentConfig; version: string }>;

/** `ref` is "draft" (the editor's contents, unsaved edits included), "latest", a version or an environment. */
export function useDraftConfig(editor: DraftEditor): GetConfig {
  const editorRef = useRef(editor);
  editorRef.current = editor;
  return useCallback(async (ref: string) => {
    const { agent, config } = editorRef.current;
    if (!agent) throw new Error('The agent isn’t loaded yet.');
    if (ref === 'draft') {
      if (!config) throw new Error('The draft can’t be read right now.');
      return { config, version: 'draft' };
    }
    const live = environments.includes(ref as EnvironmentName)
      ? agent.deployments
          .filter((d) => d.environment === ref && d.status === 'active')
          .sort((a, b) => (a.deployed_at < b.deployed_at ? 1 : -1))[0]?.version
      : undefined;
    const version = ref === 'latest' ? agent.versions[0]?.version : (live ?? ref);
    if (!version) throw new Error(`Nothing is published as “${ref}”.`);
    const known = agent.versions.find((v) => v.version === version)?.config;
    return { config: known ?? (await api.getVersion(agent.id, version)).config, version };
  }, []);
}
