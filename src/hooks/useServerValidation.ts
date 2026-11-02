import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Agent, AgentConfig } from '../types/studio';
import { checkValidation, getValidation, subscribeValidation, validationVersion, viewOf, type ValidationView } from '../utils/serverValidation';

/** The server's report for a config, asked for `delay` ms after the config last changed (POST /validate). */
export function useServerValidation(key: string, config: AgentConfig | null | undefined, delay = 500): ValidationView {
  useSyncExternalStore(subscribeValidation, validationVersion, validationVersion);
  const json = useMemo(() => (config ? JSON.stringify(config) : ''), [config]);
  useEffect(() => {
    if (!config || !key) return;
    const t = window.setTimeout(() => void checkValidation(key, config), delay);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, json, delay]);
  return viewOf(getValidation(key), json);
}

/** Store key for an agent's saved draft (what the agent list, Home and readiness read). */
export const draftKey = (agentId: string) => `draft:${agentId}`;
/** Store key for a published version. */
export const versionKey = (agentId: string, version: string) => `version:${agentId}:${version}`;

/** The server's report on each agent's saved draft, asked once per draft revision. */
export function useDraftValidations(agents: Agent[]): Record<string, ValidationView> {
  useSyncExternalStore(subscribeValidation, validationVersion, validationVersion);
  const signature = agents.map((a) => `${a.id}@${a.draft.revision}${a.loadError ? '!' : ''}`).join('|');
  useEffect(() => {
    agents.forEach((a) => {
      if (!a.loadError) void checkValidation(draftKey(a.id), a.draft.config);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  const out: Record<string, ValidationView> = {};
  agents.forEach((a) => {
    out[a.id] = a.loadError ? { status: 'failed', report: null, previous: null, error: a.loadError } : viewOf(getValidation(draftKey(a.id)), JSON.stringify(a.draft.config));
  });
  return out;
}
