// Reads the server's test-run answers (GET /tests, POST /tests/run, GET /tests/runs/{id}) into screen shapes, and
// answers what the screens ask: how a run is going, what failed and why, what to do next, and "did this version pass?".
//
// Deliberately tolerant: answers may hold more than the guide lists, so missing or unfamiliar fields are left out,
// never an error. Pure: no network, no DOM.

import { isObj, type Obj, type RequestSeen } from './scenario';

const list = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export type RunStatus = 'running' | 'passed' | 'failed' | 'error' | 'skipped';
export type ResultStatus = Exclude<RunStatus, 'running'>;
export const STATUSES: RunStatus[] = ['running', 'passed', 'failed', 'error', 'skipped'];
export const isFinished = (status: unknown): boolean => status !== 'running' && status !== undefined && status !== null && status !== '';

const text = (value: unknown): string => (typeof value === 'string' ? value : value === undefined || value === null ? '' : (JSON.stringify(value) ?? ''));

/** One check: `passed: null` means "could not be checked here" (a reviewer check in a scripted scenario). */
export interface Check {
  kind: string;
  expect: unknown;
  passed: boolean | null;
  detail: string;
}

export function normalizeCheck(raw: unknown): Check {
  const check = isObj(raw) ? raw : {};
  const passed = check.passed === true ? true : check.passed === false ? false : null;
  return { kind: text(check.kind), expect: check.expect, passed, detail: text(check.detail) };
}

/** A request no mock answered: { method, path, ... } (the server may send a string such as "GET /orders/1"). */
export function normalizeRequest(raw: unknown): RequestSeen {
  if (typeof raw === 'string') {
    const m = /^([A-Z]+)\s+(.*)$/.exec(raw.trim());
    return m ? { method: m[1], path: m[2] } : { path: raw };
  }
  if (!isObj(raw)) return { path: '' };
  return { ...raw, method: raw.method ? String(raw.method).toUpperCase() : undefined, path: text(raw.path || raw.url || '') };
}

export interface HttpSeen {
  method?: string;
  path?: string;
  status?: number;
  mocked?: boolean;
  [key: string]: unknown;
}

export interface ToolSeen {
  tool?: string;
  args?: unknown;
  output?: unknown;
  error?: unknown;
  [key: string]: unknown;
}

/** What one scenario did in a run. */
export interface ScenarioResult {
  id: string;
  status: ResultStatus;
  mode: 'live' | 'scripted';
  checks: Check[];
  transcript: Array<{ role: string; text: string }>;
  tools: ToolSeen[];
  http: HttpSeen[];
  unmocked: RequestSeen[];
  final_agent: string;
  final_state: Obj;
  notes: string[];
  /** The same records a call's log holds. */
  events: Obj[];
  usage: Obj[];
  reason: string;
  detail: string;
  ms?: number;
}

const knownMode = (value: unknown): 'live' | 'scripted' | '' => (value === 'live' || value === 'scripted' ? value : '');

export function normalizeResult(raw: unknown, scenario?: Obj | null): ScenarioResult {
  const r = isObj(raw) ? raw : {};
  const checks = list(r.checks).map(normalizeCheck);
  const status: ResultStatus =
    STATUSES.includes(r.status as RunStatus) && r.status !== 'running'
      ? (r.status as ResultStatus)
      : checks.some((c) => c.passed === false)
        ? 'failed'
        : checks.length
          ? 'passed'
          : 'skipped';
  // Scripted or live, in order: the result's own word; the server's list row (it has `mode` but not the script); the
  // draft's script; else live, the cautious reading because it costs money.
  const scripted = Array.isArray(scenario?.model_script) && scenario.model_script.length > 0;
  const mode = knownMode(r.mode) || knownMode(scenario?.mode) || (scripted ? 'scripted' : scenario ? 'live' : r.live === true ? 'live' : 'scripted');
  return {
    id: text(r.id ?? scenario?.id),
    status,
    mode,
    checks,
    transcript: list<Obj>(r.transcript).map((m) => ({ role: text(m?.role), text: text(m?.text) })),
    tools: list<ToolSeen>(r.tools).filter(isObj),
    http: list<HttpSeen>(r.http).filter(isObj),
    unmocked: list(r.unmocked).map(normalizeRequest),
    final_agent: text(r.final_agent),
    final_state: isObj(r.final_state) ? r.final_state : {},
    notes: list(r.notes).map(text).filter(Boolean),
    events: list<Obj>(r.events).filter(isObj),
    usage: list<Obj>(r.usage).filter(isObj),
    reason: text(r.reason || r.skipped_because || (status === 'skipped' ? r.detail : '')),
    detail: status === 'error' ? text(r.detail || r.error) : '',
    ms: typeof r.ms === 'number' ? r.ms : typeof r.duration_ms === 'number' ? r.duration_ms : undefined,
  };
}

/** A whole run: its headline and a result for each scenario that has finished so far. */
export interface Run {
  id: string;
  status: RunStatus;
  ref: string;
  checksum: string;
  startedAt: string;
  finishedAt: string;
  live: boolean;
  judge: boolean;
  total: number;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  scenarios: ScenarioResult[];
}

export function normalizeRun(raw: unknown, scenarios: unknown[] = []): Run {
  const r = isObj(raw) ? raw : {};
  const known = list<Obj>(scenarios).filter(isObj);
  const results = list<Obj>(r.scenarios).map((item) =>
    normalizeResult(
      item,
      known.find((s) => s.id === item?.id),
    ),
  );
  const count = (status: ResultStatus) => results.filter((x) => x.status === status).length;
  const status: RunStatus = STATUSES.includes(r.status as RunStatus)
    ? (r.status as RunStatus)
    : results.length
      ? results.some((x) => x.status === 'error')
        ? 'error'
        : results.some((x) => x.status === 'failed')
          ? 'failed'
          : 'passed'
      : 'running';
  const options = isObj(r.options) ? r.options : {};
  const counts = isObj(r.counts) ? r.counts : {};
  return {
    id: text(r.id ?? r.run_id),
    status,
    ref: text(r.ref),
    checksum: text(r.config_checksum || r.checksum),
    startedAt: text(r.started_at || r.created_at),
    finishedAt: text(r.finished_at || r.ended_at),
    live: r.live === true || options.live === true,
    judge: r.judge === true || options.judge === true,
    total: typeof r.total === 'number' ? r.total : typeof counts.total === 'number' ? counts.total : results.length,
    passed: count('passed'),
    failed: count('failed'),
    errors: count('error'),
    skipped: count('skipped'),
    scenarios: results,
  };
}

const num = (...values: unknown[]): number => {
  const found = values.find((v) => typeof v === 'number');
  return typeof found === 'number' ? found : 0;
};

/** The headline of a run in the list of earlier runs (no scenarios). */
export function normalizeHeadline(raw: unknown): Run {
  const r = isObj(raw) ? raw : {};
  const run = normalizeRun({ ...r, scenarios: [] });
  const counts = isObj(r.counts) ? r.counts : isObj(r.summary) ? r.summary : {};
  return {
    ...run,
    passed: num(counts.passed, r.passed),
    failed: num(counts.failed, r.failed),
    errors: num(counts.error, counts.errors, r.errors),
    skipped: num(counts.skipped, r.skipped),
    total: num(counts.total, r.total),
  };
}

export interface ScenarioListItem {
  scenario: Obj;
  result: ScenarioResult | null;
  ranAt: string;
  runId: string;
}

/** GET /tests: each scenario with its last result, which may sit under `last`, `last_result` or `result`. */
export function normalizeScenarioList(raw: unknown): { ref: string; networkAllowed: boolean; items: ScenarioListItem[] } {
  const r = isObj(raw) ? raw : {};
  return {
    ref: text(r.ref),
    networkAllowed: r.network_allowed === true,
    items: list<Obj>(r.scenarios)
      .filter(isObj)
      .map((item) => {
        const found = ['last', 'last_result', 'last_run', 'result'].map((key) => item[key]).find((v): v is Obj => isObj(v) && !!(v.status || v.checks));
        const result = found ? normalizeResult({ id: item.id, ...found }, item) : null;
        return {
          scenario: item,
          result,
          ranAt: text(found?.ran_at || found?.finished_at || found?.at || item.ran_at),
          runId: text(found?.run_id || item.run_id),
        };
      }),
  };
}

// ---- what the screens ask

export const failedChecks = (result: ScenarioResult | null | undefined): Check[] => list<Check>(result?.checks).filter((c) => c.passed === false);
export const uncheckedChecks = (result: ScenarioResult | null | undefined): Check[] => list<Check>(result?.checks).filter((c) => c.passed === null);

export interface Tokens {
  input: number;
  output: number;
}

/**
 * What a result cost in model use, when the server says: tokens from its `usage` or its `call_ended` record. Null when
 * nothing was reported (a scripted run uses no model). Never guessed.
 */
export function tokensOf(result: { usage?: unknown; events?: unknown } | null | undefined): Tokens | null {
  const entries = [
    ...list(result?.usage),
    ...list<Obj>(result?.events)
      .filter((e) => isObj(e) && e.event === 'call_ended')
      .flatMap((e) => list(e.usage)),
  ].filter(isObj);
  if (!entries.length) return null;
  const input = entries.reduce((sum, u) => sum + (Number(u.input_tokens) || 0), 0);
  const output = entries.reduce((sum, u) => sum + (Number(u.output_tokens) || 0), 0);
  return input + output > 0 ? { input, output } : null;
}
export function runTokens(run: { scenarios?: unknown } | null | undefined): Tokens | null {
  const each = list<Obj>(run?.scenarios)
    .map(tokensOf)
    .filter((t): t is Tokens => !!t);
  return each.length ? { input: each.reduce((s, t) => s + t.input, 0), output: each.reduce((s, t) => s + t.output, 0) } : null;
}
export const tokenWords = (tokens: Tokens): string => `${tokens.input.toLocaleString('en-US')} tokens in and ${tokens.output.toLocaleString('en-US')} out`;

/** The one line under a scenario's status: why it failed, was skipped or broke. */
export function resultSummary(result: ScenarioResult | null | undefined): string {
  if (!result) return '';
  if (result.status === 'skipped') return result.reason || 'Skipped.';
  if (result.status === 'error') return result.detail || 'The scenario could not be run.';
  const bad = failedChecks(result);
  if (bad.length)
    return `${bad.length} check${bad.length === 1 ? '' : 's'} failed${result.unmocked.length ? `, and ${result.unmocked.length} request${result.unmocked.length === 1 ? ' was' : 's were'} not answered by any mock` : ''}.`;
  const unchecked = uncheckedChecks(result);
  if (unchecked.length) return `Passed. ${unchecked.length} check${unchecked.length === 1 ? ' was' : 's were'} not checked here.`;
  return 'Passed.';
}

export interface NextStep {
  kind: 'mock' | 'live' | 'http';
  text: string;
  request?: RequestSeen;
}

/** What to do next about a result: a sentence per thing, with a kind the screen can offer a button for. */
export function nextSteps(result: ScenarioResult | null | undefined, scenario?: Obj | null): NextStep[] {
  const steps: NextStep[] = [];
  if (!result) return steps;
  result.unmocked.forEach((request) =>
    steps.push({
      kind: 'mock',
      request,
      text: `The agent called ${request.method ? `${request.method} ` : ''}${request.path} and nothing answered it. Add a mock for it.`,
    }),
  );
  result.checks.forEach((check) => {
    if (check.passed === null && check.kind === 'judge')
      steps.push({ kind: 'live', text: 'A reviewer criterion needs a live run with grading: a scripted scenario can’t check it.' });
    if (check.passed === false && check.kind === 'http_not_called')
      steps.push({ kind: 'http', text: 'The agent made a request it should not have: see “API requests” in this result for the one that happened.' });
  });
  if (result.status === 'skipped' && scenario && !scenario.model_script)
    steps.push({
      kind: 'live',
      text: 'This scenario has no model script, so it is live: it runs only when you include live scenarios (it uses a paid model).',
    });
  return steps;
}

/** A run that covered only some scenarios (one was picked, or more were written since) can't say all of them pass. */
export const coveredOnlySome = (run: Pick<Run, 'total'> | null | undefined, scenarioCount: number): boolean =>
  scenarioCount > 0 && !!run && run.total > 0 && run.total < scenarioCount;

export interface VersionTestStatus {
  state: 'none' | 'passed' | 'partial' | 'failed';
  text: string;
  run?: Run;
}

/**
 * "This exact version passed": a run carries the checksum of the config it tested, and a published version its own;
 * equal means that exact version. `runs` newest first.
 */
export function testStatusOf(version: { checksum?: string } | null | undefined, runs: Run[], { scenarioCount = 0 } = {}): VersionTestStatus {
  const checksum = version?.checksum;
  if (!checksum) return { state: 'none', text: 'Not run' };
  const matching = runs.filter((r) => r.checksum && r.checksum === checksum && isFinished(r.status));
  if (!matching.length) return { state: 'none', text: 'Not run' };
  const latest = matching[0];
  if (latest.status === 'passed') {
    // A passing run may have covered only some scenarios. Leaving live ones out is the usual cost-saving case, and is
    // said, not hidden.
    if (coveredOnlySome(latest, scenarioCount)) return { state: 'partial', text: `${latest.passed} of ${scenarioCount} ran`, run: latest };
    if (latest.skipped > 0) return { state: 'passed', text: `Passed, ${latest.skipped} not run`, run: latest };
    return { state: 'passed', text: 'Passed', run: latest };
  }
  if (latest.status === 'skipped') return { state: 'none', text: 'Skipped', run: latest };
  return { state: 'failed', text: latest.status === 'error' ? 'Broke' : 'Failed', run: latest };
}

export interface ScenarioTally {
  total: number;
  passed: number;
  failed: number;
  notRun: number;
  liveNotRun: number;
  scriptedNotRun: number;
}

/**
 * How the scenarios stand from each one's latest result (GET /tests rows), not the newest run's headline, which may
 * cover only some. `notRun` (no result, or skipped) splits into live (costly, left out unless asked) and scripted.
 */
export function summariseScenarios(items: Array<{ scenario?: Obj; result?: { status?: string; mode?: string } | null }>): ScenarioTally {
  const out: ScenarioTally = { total: 0, passed: 0, failed: 0, notRun: 0, liveNotRun: 0, scriptedNotRun: 0 };
  items.forEach((item) => {
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

/** Where a run was pointed, in words: "the saved draft", "your unsaved edits", "version 0.1.0", "Staging". */
export function refWords(ref: string): string {
  if (!ref || ref === 'draft') return 'the saved draft';
  if (ref === 'unsaved') return 'your unsaved edits';
  if (/^\d+\.\d+\.\d+/.test(ref)) return `version ${ref}`;
  return ref.charAt(0).toUpperCase() + ref.slice(1);
}
