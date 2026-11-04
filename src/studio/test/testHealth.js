import { gateCheck } from '../release/gateCheck.js';
import { formatWhen } from '../format.js';

// "Ready to publish?": what the Test stage knows about the draft, in one verdict and a tile per kind of test (Scenarios,
// Simulated callers, Readiness checks), and the short result each part shows beside its name in the views row. Pure:
// no React, no network (useTestHealth in TestHealth.jsx gathers the facts).
//
//   scenarioCount: the scenarios in the draft; latestRun: the newest finished scenario run (normalizeHeadline) or null
//   readiness: the newest readiness run of this agent ({ passed, total, results: [{ passed, title }], ranAt }) or null
//   callers: the latest simulated callers' result this visit ({ passed, attention, total, names }) or null
//   gate: { enabled } "Tests must pass before publishing"; savedAt, dirty: the draft's save state (for the gate)
// -> { verdict: { ok, title, detail }, tiles: [{ id, name, big, of, bars: ['pass' | 'fail' | 'skip' | 'none'], note,
//    chip: { text, tone } | null }], counts: { [part id]: { text, tone } } }
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const bars = (pass, fail, skip, total) =>
  Array.from({ length: Math.min(total, 24) }, (_, i) => {
    const at = (i / Math.min(total, 24)) * total;
    return at < pass ? 'pass' : at < pass + fail ? 'fail' : at < pass + fail + skip ? 'skip' : 'none';
  });

export function testHealth({
  scenarioCount = 0,
  latestRun = null,
  readiness = null,
  callers = null,
  gate = { enabled: false },
  savedAt = '',
  dirty = false,
} = {}) {
  const tiles = [];
  const counts = {};

  // scenarios: the newest finished run
  if (!scenarioCount)
    tiles.push({ id: 'scenarios', name: 'Scenarios', big: '0', of: 'written', bars: [], note: 'None yet: write one, or keep a caller as a test.', chip: null });
  else if (!latestRun) {
    tiles.push({
      id: 'scenarios',
      name: 'Scenarios',
      big: String(scenarioCount),
      of: 'not run yet',
      bars: bars(0, 0, 0, scenarioCount),
      note: 'Run them to see where it stands.',
      chip: null,
    });
    counts.scenarios = { text: 'not run', tone: '' };
  } else {
    const failed = (latestRun.failed || 0) + (latestRun.errors || 0);
    const skipped = latestRun.skipped || 0;
    const total = latestRun.total || scenarioCount;
    tiles.push({
      id: 'scenarios',
      name: 'Scenarios',
      big: String(latestRun.passed || 0),
      of: `of ${total} passed`,
      bars: bars(latestRun.passed || 0, failed, skipped, total),
      note: `Latest run ${formatWhen(latestRun.startedAt) || 'earlier'}${skipped ? `; ${skipped} live not run` : ''}`,
      // scenarios a run left out (live ones, which call a paid model, unless asked) are not failures: said as not run
      chip: failed ? { text: `${failed} fail`, tone: 'bad' } : skipped ? { text: `${skipped} not run`, tone: 'warn' } : { text: 'All pass', tone: 'good' },
    });
    counts.scenarios = failed
      ? { text: `${failed} fail`, tone: 'bad' }
      : skipped
        ? { text: `${latestRun.passed || 0} pass, ${skipped} not run`, tone: 'warn' }
        : { text: `${latestRun.passed || 0} of ${total}`, tone: 'good' };
  }

  // simulated callers: their latest result this visit (a run saves nothing)
  if (!callers || !callers.total)
    tiles.push({
      id: 'callers',
      name: 'Simulated callers',
      big: '–',
      of: 'not tried this visit',
      bars: [],
      note: 'Pick a few callers and try them on the draft.',
      chip: null,
    });
  else {
    const look = callers.attention || 0;
    tiles.push({
      id: 'callers',
      name: 'Simulated callers',
      big: String(callers.passed || 0),
      of: `of ${callers.total} passed`,
      bars: bars(callers.passed || 0, look, Math.max(0, callers.total - (callers.passed || 0) - look), callers.total),
      note: look
        ? `${callers.names?.length ? callers.names.join(' and ') : plural(look, 'caller')} need${look === 1 && !callers.names?.length ? 's' : ''} a look`
        : 'All that ran passed',
      chip: look ? { text: 'Needs a look', tone: 'warn' } : { text: 'All pass', tone: 'good' },
    });
    if (look) counts.callers = { text: `${look} need a look`, tone: 'warn' };
  }

  // readiness checks: the newest run of this agent
  if (!readiness)
    tiles.push({
      id: 'checks',
      name: 'Readiness checks',
      big: '–',
      of: 'not run yet',
      bars: [],
      note: 'Reads the configuration against everyday situations.',
      chip: null,
    });
  else {
    const missed = (readiness.total || 0) - (readiness.passed || 0);
    const first = Array.isArray(readiness.results) ? readiness.results.find((r) => r && r.passed === false) : null;
    tiles.push({
      id: 'checks',
      name: 'Readiness checks',
      big: String(readiness.passed || 0),
      of: `of ${readiness.total || 0}`,
      bars: bars(readiness.passed || 0, 0, missed, readiness.total || 0),
      note: first ? `To look at: ${first.title || first.name || 'one check'}` : 'Every check passed',
      chip: missed ? { text: `${missed} to fix`, tone: 'warn' } : { text: 'All pass', tone: 'good' },
    });
    counts.checks = { text: `${readiness.passed || 0} of ${readiness.total || 0}`, tone: missed ? 'warn' : 'good' };
  }

  // the verdict: the gate's when it is on (it holds publishing); else what the tests say
  let verdict;
  if (gate.enabled) {
    const check = gateCheck({ enabled: true, scenarioCount, latestRun, savedAt, dirty });
    verdict = check.ok ? { ok: true, title: 'Yes: the tests pass', detail: check.why } : { ok: false, title: 'Not yet: publishing is held', detail: check.why };
  } else {
    const failing = latestRun ? (latestRun.failed || 0) + (latestRun.errors || 0) : 0;
    const look = callers?.attention || 0;
    if (!scenarioCount && !callers?.total)
      verdict = { ok: false, title: 'Nothing tested yet', detail: 'Try it, then keep the conversations it must always get right.' };
    else if (failing)
      verdict = { ok: false, title: `Not yet: ${plural(failing, 'scenario')} ${failing === 1 ? 'fails' : 'fail'}`, detail: 'On the latest run.' };
    else if (look) verdict = { ok: false, title: `Nearly: ${plural(look, 'caller')} ${look === 1 ? 'needs' : 'need'} a look`, detail: 'The scenarios pass.' };
    else if (scenarioCount && !latestRun)
      verdict = { ok: false, title: 'Run the scenarios first', detail: `${plural(scenarioCount, 'scenario')} not run yet.` };
    else
      verdict = {
        ok: true,
        title: 'Yes: what was tested passes',
        detail: latestRun ? `Latest run ${formatWhen(latestRun.startedAt) || 'earlier'}.` : 'The callers that ran passed.',
      };
  }
  return { verdict, tiles, counts };
}
