import { useSyncExternalStore } from 'react';
import type { ReadinessStep } from '../models/readiness';
import { targetPath } from '../models/agentPages';
import { setupStepForReadiness } from '../models/setup';
import { useStudio } from '../contexts/StudioContext';
import { inSetup, readProgress, setupVersion, subscribeSetup } from '../utils/setupProgress';

/** Whether this agent's next steps open the guided setup (being set up here, or never published). */
export function useSetupOpen(agentId: string): boolean {
  useSyncExternalStore(subscribeSetup, setupVersion, setupVersion);
  const { getAgent } = useStudio();
  const agent = getAgent(agentId);
  return !!agent && inSetup(readProgress(agentId), agent.versions.length > 0);
}

/** Where a readiness step is done: the setup's step while the agent is being set up, else its own page. */
export function useStepLink(agentId: string): (step: ReadinessStep) => string {
  const setupOpen = useSetupOpen(agentId);
  return (step) => {
    const inWizard = setupOpen ? setupStepForReadiness(step.id) : '';
    return inWizard ? `/agents/${encodeURIComponent(agentId)}/setup/${inWizard}` : targetPath(agentId, step.target);
  };
}
