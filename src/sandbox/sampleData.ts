// "Start the sample data again": Sandbox goes back to how it started. The imitation API's sample agents and calls come
// back (everything made in Sandbox is removed), sample agents hidden from Home are shown again, and the Team page
// starts again with its sample team. Live's data is never touched.
import { SANDBOX_SAMPLE_IDS } from './mode';
import { restoreAgent, undoDismissed } from '../models/manage';

/** Where the Team page keeps Sandbox's team (src/hooks/useTeam.ts). */
export const SANDBOX_TEAM_KEY = 'weave_sandbox_team';

export async function startSampleDataAgain(): Promise<void> {
  const { resetSandbox } = await import('./sandboxApi');
  resetSandbox();
  undoDismissed(SANDBOX_SAMPLE_IDS);
  SANDBOX_SAMPLE_IDS.forEach(restoreAgent);
  try {
    window.localStorage.removeItem(SANDBOX_TEAM_KEY);
  } catch {
    // storage unavailable: nothing was kept
  }
}
