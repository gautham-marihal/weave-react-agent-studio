// "Tests must pass before publishing": when the gate is on, the publish panel is held until the newest run of the
// saved draft's tests passed and nothing was saved or edited after it. "Publish anyway" always stays available: the
// studio informs and a person decides. Pure: no React, no network.
import { runWords, type GateAnswer, type LatestRun } from './readiness';

export interface GateInput {
  enabled?: boolean;
  scenarioCount?: number;
  /** The newest finished run on the saved draft; null when never run. */
  latestRun?: LatestRun | null;
  /** When the draft was last saved (ISO text, or ''). */
  savedAt?: string;
  /** Unsaved edits in the editor. */
  dirty?: boolean;
}

/** action: 'scenarios' = add tests first; 'tests' = run the tests (again); '' = nothing to do. */
export function gateCheck({ enabled = false, scenarioCount = 0, latestRun = null, savedAt = '', dirty = false }: GateInput = {}): GateAnswer {
  if (!enabled) return { ok: true, why: '', action: '' };
  if (scenarioCount === 0) return { ok: false, why: 'This agent has no tests yet, so nothing can show it passes. Add a test scenario first.', action: 'scenarios' };
  if (!latestRun) return { ok: false, why: 'The tests have not been run yet.', action: 'tests' };
  if (latestRun.status !== 'passed')
    return { ok: false, why: `The latest run ${runWords(latestRun)}${latestRun.total ? ` (${latestRun.passed ?? 0} of ${latestRun.total} passed)` : ''}.`, action: 'tests' };
  if (dirty) return { ok: false, why: 'The draft has changes the last run did not see. Save, then run the tests again.', action: 'tests' };
  const ran = Date.parse(latestRun.startedAt ?? '');
  const saved = Date.parse(savedAt);
  // A save in the same second as the run started is not "after" it.
  if (!Number.isNaN(ran) && !Number.isNaN(saved) && saved > ran + 1000)
    return { ok: false, why: 'The draft was saved after the last run. Run the tests again.', action: 'tests' };
  return { ok: true, why: `The latest run passed (${latestRun.passed ?? 0} of ${latestRun.total ?? 0}).`, action: '' };
}
