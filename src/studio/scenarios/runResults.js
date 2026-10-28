// Reads the API's test-run answers (`GET /tests`, `POST /tests/run`, `GET /tests/runs/{id}`) into screen shapes, and
// answers what the screens ask: how a run is going, what failed and why, what to do, and "did this version pass?".
//
// Deliberately tolerant: answers may hold more than FRONTEND_GUIDE 10.4 lists, so missing or unfamiliar fields are left
// out, never an error. Pure: no network, no DOM.

import { isObj } from '../form/engine.js';

const list = (v) => (Array.isArray(v) ? v : []);

// A scenario's status in a run, and a run's: running while any is still going.
const STATUSES = ['running', 'passed', 'failed', 'error', 'skipped'];
export const isFinished = (status) => status !== 'running' && status !== undefined && status !== null && status !== '';

const text = (value) => (typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value));

// One check: { kind, expect, passed: true | false | null, detail }; `passed: null` means "couldn't be checked here".
export function normalizeCheck(raw) {
  const check = isObj(raw) ? raw : {};
  const passed = check.passed === true ? true : check.passed === false ? false : null;
  return { kind: text(check.kind), expect: check.expect, passed, detail: text(check.detail) };
}

// A request no mock answered: { method, path, ... } (the API may send a string such as "GET /orders/1").
function normalizeRequest(raw) {
  if (typeof raw === 'string') {
    const m = /^([A-Z]+)\s+(.*)$/.exec(raw.trim());
    return m ? { method: m[1], path: m[2] } : { path: raw };
  }
  if (!isObj(raw)) return { path: '' };
  return { ...raw, method: raw.method ? String(raw.method).toUpperCase() : undefined, path: text(raw.path || raw.url || '') };
}

// What one scenario did in a run.
export function normalizeResult(raw, scenario) {
  const r = isObj(raw) ? raw : {};
  const checks = list(r.checks).map(normalizeCheck);
  const status = STATUSES.includes(r.status) ? r.status : checks.some((c) => c.passed === false) ? 'failed' : checks.length ? 'passed' : 'skipped';
  // Scripted or live, in order: the result's own word; the server's list row (it has `mode` but not the script); the
  // draft's script; else live, the cautious reading because it costs money.
  const known = (value) => (value === 'live' || value === 'scripted' ? value : '');
  const scripted = Array.isArray(scenario?.model_script) && scenario.model_script.length > 0;
  const mode = known(r.mode) || known(scenario?.mode) || (scripted ? 'scripted' : scenario ? 'live' : r.live === true ? 'live' : 'scripted');
  return {
    id: text(r.id ?? scenario?.id),
    status,
    mode,
    checks,
    transcript: list(r.transcript).map((m) => ({ role: text(m?.role), text: text(m?.text), at: m?.at, tools: m?.tools })),
    tools: list(r.tools),
    http: list(r.http),
    unmocked: list(r.unmocked).map(normalizeRequest),
    final_agent: text(r.final_agent),
    final_state: isObj(r.final_state) ? r.final_state : {},
    notes: list(r.notes).map(text).filter(Boolean),
    events: list(r.events),
    usage: list(r.usage),
    reason: text(r.reason || r.skipped_because || (status === 'skipped' ? r.detail : '')),
    detail: status === 'error' ? text(r.detail || r.error) : '',
    ms: typeof r.ms === 'number' ? r.ms : typeof r.duration_ms === 'number' ? r.duration_ms : undefined,
  };
}

// A whole run: its headline and a result for each scenario that has finished so far.
export function normalizeRun(raw, scenarios = []) {
  const r = isObj(raw) ? raw : {};
  const known = list(scenarios);
  const results = list(r.scenarios).map((item) =>
    normalizeResult(
      item,
      known.find((s) => s?.id === item?.id),
    ),
  );
  const count = (status) => results.filter((x) => x.status === status).length;
  const status = STATUSES.includes(r.status)
    ? r.status
    : results.length
      ? results.some((x) => x.status === 'error')
        ? 'error'
        : results.some((x) => x.status === 'failed')
          ? 'failed'
          : 'passed'
      : 'running';
  return {
    id: text(r.id ?? r.run_id),
    status,
    ref: text(r.ref),
    checksum: text(r.config_checksum || r.checksum),
    startedAt: text(r.started_at || r.created_at),
    finishedAt: text(r.finished_at || r.ended_at),
    live: r.live === true,
    judge: r.judge === true,
    runner: text(r.runner),
    total: typeof r.total === 'number' ? r.total : typeof r.counts?.total === 'number' ? r.counts.total : results.length,
    passed: count('passed'),
    failed: count('failed'),
    errors: count('error'),
    skipped: count('skipped'),
    scenarios: results,
  };
}

// The headline of a run in the list of recent runs (no scenarios).
export function normalizeHeadline(raw) {
  const run = normalizeRun({ ...(isObj(raw) ? raw : {}), scenarios: [] });
  const counts = isObj(raw?.counts) ? raw.counts : isObj(raw?.summary) ? raw.summary : {};
  return {
    ...run,
    passed: counts.passed ?? raw?.passed ?? 0,
    failed: counts.failed ?? raw?.failed ?? 0,
    errors: counts.error ?? counts.errors ?? raw?.errors ?? 0,
    skipped: counts.skipped ?? raw?.skipped ?? 0,
    total: counts.total ?? raw?.total ?? 0,
  };
}

// `GET /tests`: each scenario with its last result, which may sit under `last`, `last_result` or `result`.
export function normalizeScenarioList(raw) {
  const items = list(raw?.scenarios);
  return {
    ref: text(raw?.ref),
    networkAllowed: raw?.network_allowed === true,
    items: items.map((item) => {
      const found = ['last', 'last_result', 'last_run', 'result'].map((key) => item?.[key]).find((v) => isObj(v) && (v.status || v.checks));
      const result = found ? normalizeResult({ id: item.id, ...found }, item) : null;
      return {
        scenario: item,
        result,
        ranAt: text(found?.ran_at || found?.finished_at || found?.at || item?.ran_at),
        runId: text(found?.run_id || item?.run_id),
      };
    }),
  };
}

// ---- what the screens ask
const failedChecks = (result) => list(result?.checks).filter((c) => c.passed === false);
const unverifiedChecks = (result) => list(result?.checks).filter((c) => c.passed === null);

// What a run cost in model use, when the server says: tokens from a result's `usage` or its `call_ended` record. Null
// when nothing was reported (so a scripted run, which uses no model, shows nothing). Never guessed.
export function tokensOf(result) {
  const entries = [
    ...list(result?.usage),
    ...list(result?.events)
      .filter((e) => isObj(e) && e.event === 'call_ended')
      .flatMap((e) => list(e.usage)),
  ].filter(isObj);
  if (!entries.length) return null;
  const input = entries.reduce((sum, u) => sum + (Number(u.input_tokens) || 0), 0);
  const output = entries.reduce((sum, u) => sum + (Number(u.output_tokens) || 0), 0);
  return input + output > 0 ? { input, output } : null;
}
export function runTokens(run) {
  const each = list(run?.scenarios).map(tokensOf).filter(Boolean);
  return each.length ? { input: each.reduce((s, t) => s + t.input, 0), output: each.reduce((s, t) => s + t.output, 0) } : null;
}
export const tokenWords = (tokens) => `${tokens.input.toLocaleString('en-US')} tokens in and ${tokens.output.toLocaleString('en-US')} out`;

// The one line under a scenario's status: why it failed, was skipped or broke.
export function resultSummary(result) {
  if (!result) return '';
  if (result.status === 'skipped') return result.reason || 'Skipped.';
  if (result.status === 'error') return result.detail || 'The scenario could not be run.';
  const bad = failedChecks(result);
  if (bad.length)
    return `${bad.length} check${bad.length === 1 ? '' : 's'} failed${result.unmocked.length ? `, and ${result.unmocked.length} request${result.unmocked.length === 1 ? ' was' : 's were'} not answered by any mock` : ''}.`;
  const unverified = unverifiedChecks(result);
  if (unverified.length) return `Passed. ${unverified.length} check${unverified.length === 1 ? ' was' : 's were'} not checked here.`;
  return 'Passed.';
}

// What to do next about a result (7.6): a sentence per thing, with an `action` the screen can offer.
export function nextSteps(result, scenario) {
  const steps = [];
  if (!result) return steps;
  result.unmocked.forEach((request) =>
    steps.push({
      kind: 'mock',
      request,
      text: `The bot called ${request.method ? `${request.method} ` : ''}${request.path} and nothing answered it. Add a mock for it.`,
    }),
  );
  list(result.checks).forEach((check) => {
    if (check.passed === null && check.kind === 'judge')
      steps.push({ kind: 'live', text: 'A reviewer criterion needs a live run with grading: a scripted scenario can’t check it.' });
    if (check.passed === false && check.kind === 'http_not_called')
      steps.push({ kind: 'http', text: 'The bot made a request it should not have: see “API requests” in this result for the one that happened.' });
  });
  if (result.status === 'skipped' && scenario && !scenario.model_script)
    steps.push({
      kind: 'live',
      text: 'This scenario has no model script, so it is live: it runs only when you include live scenarios (it calls a paid model).',
    });
  return steps;
}

// A run that covered only some scenarios (one was picked, or more were written since) can't say all of them pass. A
// run that doesn't say how many it covered is not called partial.
export const coveredOnlySome = (run, scenarioCount) => scenarioCount > 0 && run?.total > 0 && run.total < scenarioCount;
// "The latest run covered only 1 of the 4 scenarios."
export const coveredOnlyText = (run, scenarioCount) => `The latest run covered only ${run.total} of the ${scenarioCount} scenarios.`;

// ---- "this exact version passed"
// A run carries the checksum of the config it tested, and a published version its own: equal means that exact version.
export function testStatusOf(version, runs, { scenarioCount = 0 } = {}) {
  const checksum = version?.checksum;
  if (!checksum) return { state: 'none', text: 'Not run' };
  const matching = list(runs).filter((r) => r.checksum && r.checksum === checksum && isFinished(r.status));
  if (!matching.length) return { state: 'none', text: 'Not run' };
  const latest = matching[0]; // newest first
  if (latest.status === 'passed') {
    // A passing run may have covered only some scenarios: leaving scripted ones out makes it partial. Leaving live
    // ones out is the usual cost-saving case, and is said, not hidden.
    const ran = latest.passed + latest.failed + latest.errors;
    if (coveredOnlySome(latest, scenarioCount)) return { state: 'partial', text: `${latest.passed} of ${scenarioCount} ran`, run: latest };
    if (latest.skipped > 0) return { state: 'passed', text: `Passed, ${latest.skipped} not run`, run: latest, ran };
    return { state: 'passed', text: 'Passed', run: latest, ran };
  }
  if (latest.status === 'skipped') return { state: 'none', text: 'Skipped', run: latest };
  return { state: 'failed', text: latest.status === 'error' ? 'Broke' : 'Failed', run: latest };
}

// How the scenarios stand from each one's latest result (GET /tests rows), not the newest run's headline, which may
// cover only some. `notRun` (no result, or skipped) splits into live (costly, left out unless asked) and scripted.
export function summariseScenarios(items) {
  const out = { total: 0, passed: 0, failed: 0, notRun: 0, liveNotRun: 0, scriptedNotRun: 0 };
  list(items).forEach((item) => {
    const status = item?.result?.status;
    out.total += 1;
    if (status === 'passed') out.passed += 1;
    else if (status === 'failed' || status === 'error') out.failed += 1;
    else {
      out.notRun += 1;
      const scenario = item?.scenario;
      const mode =
        item?.result?.mode ||
        (scenario?.mode === 'live' || scenario?.mode === 'scripted'
          ? scenario.mode
          : Array.isArray(scenario?.model_script) && scenario.model_script.length
            ? 'scripted'
            : 'live');
      if (mode === 'live') out.liveNotRun += 1;
      else out.scriptedNotRun += 1;
    }
  });
  return out;
}
