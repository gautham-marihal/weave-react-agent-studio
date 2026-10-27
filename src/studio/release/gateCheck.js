import { coveredOnlySome, coveredOnlyText } from '../scenarios/runResults.js';

// "Tests must pass before publishing": while on, publishing holds until the newest test run passed and nothing changed
// since. "Publish anyway" still works: the studio informs, a person decides. Pure: no React, no network.

//   latestRun: the newest finished run ({ status, passed, total, startedAt }) or null
//   savedAt: when the draft was last saved (ISO text, or ''); dirty: unsaved edits
// -> { ok, why, action: 'tests' | 'scenarios' | '' }
export function gateCheck({ enabled = false, scenarioCount = 0, latestRun = null, savedAt = '', dirty = false } = {}) {
  if (!enabled) return { ok: true, why: '', action: '' };
  if (scenarioCount === 0)
    return { ok: false, why: 'This agent has no tests yet, so nothing can show it passes. Keep some callers or write a scenario first.', action: 'callers' };
  if (!latestRun) return { ok: false, why: 'The tests have not been run yet.', action: 'scenarios' };
  if (latestRun.status !== 'passed')
    return {
      ok: false,
      why: `The latest run ${latestRun.status === 'error' ? 'broke' : latestRun.status === 'skipped' ? 'skipped everything' : 'failed'}${latestRun.total ? ` (${latestRun.passed ?? 0} of ${latestRun.total} passed)` : ''}.`,
      action: 'scenarios',
    };
  if (coveredOnlySome(latestRun, scenarioCount)) return { ok: false, why: `${coveredOnlyText(latestRun, scenarioCount)} Run them all.`, action: 'scenarios' };
  const ran = Date.parse(latestRun.startedAt || '');
  const saved = Date.parse(savedAt || '');
  if (dirty) return { ok: false, why: 'The draft has changes the last run did not see. Run the tests again.', action: 'scenarios' };
  if (!Number.isNaN(ran) && !Number.isNaN(saved) && saved > ran + 1000)
    return { ok: false, why: 'The draft was saved after the last run. Run the tests again.', action: 'scenarios' };
  return { ok: true, why: `The latest run passed (${latestRun.passed ?? 0} of ${latestRun.total ?? 0}).`, action: '' };
}
