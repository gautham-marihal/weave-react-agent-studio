// "Is it safe to put this live?" as one list, built from what Studio can read: the server's checks, test runs, the
// knowledge's reading state, provider keys and the recording notice. Pure: no React, no network.
// Two rules keep it honest:
//  - A line appears only when it applies; nothing is called a failure for something the agent doesn't use
//    (no scenarios is amber "none written", never "failed").
//  - It informs, it doesn't decide: the server has no release policy yet, so the list is advice.
import type { AgentConfig, UnsupportedFeature, ValidationReport } from '../types/studio';
import type { TestRun } from '../api/types';
import type { PageTarget } from './agentPages';
import { secretState } from '../utils/providerOptions';
import type { BankingSource } from '../api/gateway';
import { isBankingAgent } from './bankingAgent';
import { gatewayAddressOf } from './bankingTools';
import { BANKING_DEPLOY_NEEDS, bankingStatus } from './bankingStatus';

const list = <T,>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : []);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---- what the runtime can't do yet

/** "security": a protection declared but NOT enforced. The agent looks protected and isn't. */
export const isSecurity = (item: Partial<UnsupportedFeature> | null | undefined): boolean => item?.severity === 'security';

export function splitUnsupported(items: unknown): { security: UnsupportedFeature[]; advice: UnsupportedFeature[] } {
  const all: UnsupportedFeature[] = Array.isArray(items) ? items.filter(isObj).map((i) => i as unknown as UnsupportedFeature) : [];
  return { security: all.filter(isSecurity), advice: all.filter((i) => !isSecurity(i)) };
}

// ---- secrets: names only

/** Each secret a version needs: missing when it is a provider's usual key the server says is not set; known when the
 *  server reports on it at all (others are checked when deploying). `keys` is secret name -> set (GET /providers). */
export function secretsStatus(required: unknown, keys: Record<string, boolean>): { name: string; missing: boolean; known: boolean }[] {
  const names = Array.isArray(required) ? required.filter((n): n is string => typeof n === 'string') : [];
  return names.map((name) => {
    const state = secretState(name, keys);
    return { name, missing: state === 'missing', known: state !== 'unknown' };
  });
}

// ---- the deploy answer's preflight.knowledge

export interface PreflightProblem {
  base: string;
  problem: string;
  fix: string;
}

/** `preflight.knowledge`, whatever shape it has: a flat list, [{ base, problems }] or { base: [problems] }. */
export function normalizePreflightKnowledge(raw: unknown): PreflightProblem[] {
  const rows: PreflightProblem[] = [];
  const push = (base: unknown, p: unknown) => {
    const problem = typeof p === 'string' ? p : isObj(p) ? String(p.problem ?? '') : '';
    const fix = isObj(p) ? String(p.fix ?? '') : '';
    if (problem) rows.push({ base: typeof base === 'string' ? base : '', problem, fix });
  };
  if (Array.isArray(raw))
    raw.forEach((item) => {
      if (isObj(item) && Array.isArray(item.problems)) item.problems.forEach((p) => push(item.base ?? item.id, p));
      else push(isObj(item) ? item.base : '', item);
    });
  else if (isObj(raw)) Object.entries(raw).forEach(([base, problems]) => list(problems as unknown[]).forEach((p) => push(base, p)));
  return rows;
}

// ---- test runs on one exact version

/** One run's headline, read tolerantly from GET /tests/runs. */
export interface RunHeadline {
  id: string;
  status: string;
  /** The checksum of the config the run tested. */
  checksum: string;
  ref: string;
  startedAt: string;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  total: number;
}

export const isFinished = (status: string | undefined): boolean => !!status && status !== 'running';

export function runHeadline(raw: Partial<TestRun> & { id?: string; checksum?: string }): RunHeadline {
  const counts = isObj(raw.counts) ? raw.counts : {};
  return {
    id: String(raw.run_id ?? raw.id ?? ''),
    status: String(raw.status ?? ''),
    checksum: String(raw.config_checksum ?? raw.checksum ?? ''),
    ref: String(raw.ref ?? ''),
    startedAt: String(raw.started_at ?? ''),
    passed: counts.passed ?? 0,
    failed: counts.failed ?? 0,
    errors: counts.error ?? 0,
    skipped: counts.skipped ?? 0,
    total: raw.total ?? (counts as { total?: number }).total ?? 0,
  };
}

/** "The latest run covered only 1 of the 4 scenarios": a passing run that left some out is not a pass of them all. */
export const coveredOnlySome = (run: Pick<RunHeadline, 'total'>, scenarioCount: number): boolean => scenarioCount > 0 && run.total > 0 && run.total < scenarioCount;

export type VersionTestState = 'none' | 'passed' | 'partial' | 'failed';

/**
 * How the tests stand on one exact version: a run carries the checksum of the config it tested, a version its own;
 * equal means that exact version. `runs` newest first.
 */
export function testStatusOf(version: { checksum?: string } | null | undefined, runs: RunHeadline[], { scenarioCount = 0 } = {}): { state: VersionTestState; text: string; run?: RunHeadline } {
  const checksum = version?.checksum;
  if (!checksum) return { state: 'none', text: 'Not run' };
  const latest = runs.find((r) => r.checksum && r.checksum === checksum && isFinished(r.status));
  if (!latest) return { state: 'none', text: 'Not run' };
  if (latest.status === 'passed') {
    if (coveredOnlySome(latest, scenarioCount)) return { state: 'partial', text: `${latest.passed} of ${scenarioCount} ran`, run: latest };
    if (latest.skipped > 0) return { state: 'passed', text: `Passed, ${latest.skipped} not run`, run: latest };
    return { state: 'passed', text: 'Passed', run: latest };
  }
  if (latest.status === 'skipped') return { state: 'none', text: 'Skipped', run: latest };
  return { state: 'failed', text: latest.status === 'error' ? 'Broke' : 'Failed', run: latest };
}

// ---- knowledge (GET /bots/{id}/knowledge?ref=)

export type BaseState = 'external' | 'reading' | 'unread' | 'changed' | 'failed' | 'ready';

export interface KnowledgeRow {
  id: string;
  state: BaseState;
  problems: string[];
}

/** The bases from GET /knowledge ({ bases } or a plain list), each with its reading state. Only a `vector_store` is
 *  read ahead of calls; another type asks a search service and has nothing to read. */
export function knowledgeRows(raw: unknown): KnowledgeRow[] {
  const bases = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.bases) ? raw.bases : [];
  return bases.filter(isObj).map((b) => {
    const problems = list(b.problems as unknown[])
      .map((p) => (typeof p === 'string' ? p : isObj(p) ? String(p.problem ?? '') : ''))
      .filter(Boolean);
    const build = isObj(b.build) ? b.build : null;
    let state: BaseState;
    if (b.type !== undefined && b.type !== 'vector_store') state = 'external';
    else if (build && (build.status === 'running' || build.status === 'pending')) state = 'reading';
    else if (build?.status === 'failed') state = 'failed';
    else if (!b.index) state = 'unread';
    else if (problems.some((p) => /changed after|stale|out of date|not uploaded/i.test(p))) state = 'changed';
    else state = 'ready';
    return { id: String(b.id ?? ''), state, problems };
  });
}

// ---- the recording notice

/** A voice channel, a record of each call kept, and nothing said to callers about it. */
export function recordingNoticeMissing(config: AgentConfig | null | undefined): boolean {
  const voice = list(config?.channels).some((c) => isObj(c) && c.enabled !== false && (c.type === 'sip_voice' || c.type === 'web_voice'));
  const told = typeof config?.persona?.disclosures?.recording_notice === 'string' && config.persona.disclosures.recording_notice.trim() !== '';
  const keeps = config?.observability?.session_log?.enabled !== false || config?.post_call?.recording?.audio === true || config?.post_call?.recording?.transcript === true;
  return voice && keeps && !told;
}

// ---- the list

export type CheckState = 'ok' | 'warn' | 'bad' | 'info';

export interface CheckItem {
  id: 'valid' | 'security' | 'unsupported' | 'tests' | 'knowledge' | 'secrets' | 'notice' | 'banking';
  label: string;
  state: CheckState;
  text: string;
  detail?: string[];
  note?: string;
  action?: { label: string; target: PageTarget };
}

export interface ChecklistInput {
  config: AgentConfig | null | undefined;
  report: ValidationReport | null | undefined;
  /** The version being checked (target 'version'): its checksum ties runs to it. */
  version?: { version?: string; checksum?: string } | null;
  /** Newest first. */
  runs?: RunHeadline[];
  /** GET /knowledge for that version (or the draft); null when not read. */
  knowledge?: KnowledgeRow[] | null;
  /** Secret name -> set on the server (GET /providers). */
  keys?: Record<string, boolean>;
  target?: 'version' | 'draft';
  /** Where banking calls go on this page (bankingSource); only read for a banking agent. */
  banking?: BankingSource | null;
}

const RUN_TESTS: PageTarget = { stage: 'test', focus: 'scenarios' };

export function buildChecklist({ config, report, version, runs = [], knowledge = null, keys = {}, target = 'version', banking = null }: ChecklistInput): CheckItem[] {
  const items: CheckItem[] = [];
  const add = (item: CheckItem) => items.push(item);

  // ---- valid
  if (report) {
    const errors = list(report.errors);
    if (errors.length)
      add({
        id: 'valid',
        label: 'Valid',
        state: 'bad',
        text: `${plural(errors.length, 'error')} to fix first`,
        detail: errors.slice(0, 3).map((e) => e.message),
        action: { label: 'See what to fix', target: { stage: 'build', focus: 'problems' } },
      });
    else add({ id: 'valid', label: 'Valid', state: 'ok', text: target === 'version' ? 'This version passes the server’s checks.' : 'The draft passes the server’s checks.' });
  }

  // ---- protections declared but not enforced, and parts that won't run
  const { security, advice } = splitUnsupported(report?.unsupported);
  if (security.length)
    add({
      id: 'security',
      label: 'Protections',
      state: 'bad',
      text: `${plural(security.length, 'protection')} declared but not enforced`,
      detail: security.map((s) => `${s.feature} (${s.where})`),
      note: 'The agent looks protected and is not.',
    });
  if (advice.length)
    add({
      id: 'unsupported',
      label: 'What will run',
      state: 'warn',
      text: `${plural(advice.length, 'part')} the runtime can’t run yet`,
      detail: advice
        .slice(0, 5)
        .map((s) => `${s.feature} (${s.where})`)
        .concat(advice.length > 5 ? [`and ${advice.length - 5} more`] : []),
    });

  // ---- tests: on this exact version for a version, the latest run for the draft
  const scenarioCount = list(config?.tests as unknown[]).filter(isObj).length;
  if (config) {
    if (scenarioCount === 0) {
      add({
        id: 'tests',
        label: 'Tests',
        state: 'warn',
        text: 'None written',
        detail: ['No test scenarios are written for this agent, so nothing has checked its behaviour.'],
        action: { label: 'Write scenarios', target: { stage: 'build', focus: 'tests' } },
      });
    } else if (target === 'version') {
      const status = testStatusOf(version, runs, { scenarioCount });
      if (status.state === 'partial')
        add({
          id: 'tests',
          label: 'Tests',
          state: 'warn',
          text: `Only part of the tests ran on this exact version (${status.text})`,
          detail: ['The latest run covered some of the scenarios, so it cannot say that all of them pass.'],
          action: { label: 'Run them all', target: RUN_TESTS },
        });
      else if (status.state === 'passed' && status.run)
        add({
          id: 'tests',
          label: 'Tests',
          state: 'ok',
          text: `Passed on this exact version (${status.run.skipped > 0 ? `${status.run.passed} of ${plural(status.run.total, 'scenario')}; ${status.run.skipped} not run` : plural(status.run.total || scenarioCount, 'scenario')})`,
        });
      else if (status.state === 'failed' && status.run)
        add({
          id: 'tests',
          label: 'Tests',
          state: 'bad',
          text: `${status.text} on this exact version`,
          detail: [`${status.run.failed} failed, ${status.run.errors} broke, of ${status.run.total}.`],
          action: { label: 'See the run', target: RUN_TESTS },
        });
      else
        add({
          id: 'tests',
          label: 'Tests',
          state: 'warn',
          text: 'Not run on this exact version',
          detail: [runs.some((r) => isFinished(r.status)) ? 'The latest run was on a different configuration.' : 'No scenario has been run yet.'],
          action: { label: 'Run them', target: RUN_TESTS },
        });
    } else {
      const latest = runs.find((r) => isFinished(r.status));
      if (!latest) add({ id: 'tests', label: 'Tests', state: 'warn', text: 'Not run yet', action: { label: 'Run them', target: RUN_TESTS } });
      else if (latest.status === 'passed') add({ id: 'tests', label: 'Tests', state: 'ok', text: `The latest run passed (${latest.passed} of ${latest.total})` });
      else
        add({
          id: 'tests',
          label: 'Tests',
          state: latest.status === 'skipped' ? 'warn' : 'bad',
          text: `The latest run ${latest.status === 'error' ? 'broke' : latest.status === 'skipped' ? 'skipped everything' : 'failed'}`,
          action: { label: 'See the run', target: RUN_TESTS },
        });
    }
  }

  // ---- knowledge: only when the agent has some
  const bases = list(knowledge);
  if (bases.length) {
    const knowledgePage: PageTarget = { stage: 'build', section: 'knowledge' };
    const needs = bases.filter((b) => b.state === 'unread' || b.state === 'failed');
    const behind = bases.filter((b) => b.state === 'changed' || b.state === 'reading');
    if (needs.length)
      add({
        id: 'knowledge',
        label: 'Knowledge',
        state: 'bad',
        text: `${plural(needs.length, 'base')} not read yet`,
        detail: [...needs, ...bases.filter((b) => b.state === 'changed')].map((b) => `${b.id}: ${b.problems[0] || (b.state === 'failed' ? 'reading its documents failed' : 'its documents have not been read')}`),
        action: { label: 'Read them', target: knowledgePage },
      });
    else if (behind.length)
      add({
        id: 'knowledge',
        label: 'Knowledge',
        state: 'warn',
        text: behind.some((b) => b.state === 'reading') ? 'Documents are still being read' : `${plural(behind.length, 'base')} out of date`,
        detail: behind.flatMap((b) => b.problems.map((p) => `${b.id}: ${p}`)),
        action: { label: 'Open knowledge', target: knowledgePage },
      });
    else add({ id: 'knowledge', label: 'Knowledge', state: 'ok', text: `${plural(bases.length, 'base')} ready` });
  }

  // ---- secrets: names only; Studio can only tell when a provider's usual key is missing
  const required = list(report?.secrets_required);
  if (required.length) {
    const missing = secretsStatus(required, keys).filter((s) => s.missing);
    if (missing.length)
      add({
        id: 'secrets',
        label: 'Provider keys',
        state: 'warn',
        text: `${plural(missing.length, 'key')} not set on the server`,
        detail: missing.map((s) => s.name),
        note: 'Calls that need them will fail. An admin sets them on the server; they can’t be set from here.',
      });
    else
      add({
        id: 'secrets',
        label: 'Provider keys',
        state: 'info',
        text: `${plural(required.length, 'secret')} needed`,
        detail: required,
        note: 'Names only: Studio can’t read them. A name it can’t check is checked again when you deploy.',
      });
  }

  // ---- the recording notice
  if (config && recordingNoticeMissing(config))
    add({
      id: 'notice',
      label: 'Recording notice',
      state: 'warn',
      text: 'Callers on a voice channel are not told the call may be recorded',
      detail: ['A record of each call is kept, and in many places callers must be told.'],
      action: { label: 'Add a notice', target: { stage: 'build', section: 'aftercall' } },
    });

  // ---- banking: what a banking agent needs to work once deployed, said plainly
  if (config && isBankingAgent(config)) {
    const tools: PageTarget = { stage: 'build', section: 'tools' };
    const status = banking ? bankingStatus(banking) : null;
    const address = gatewayAddressOf(config);
    if (!address)
      // Studio fills the address in itself (from the Studio server's BANKING_GATEWAY_URL) when it makes or refreshes a
      // banking agent; nobody types it. Empty means it was made before that, or this Studio has no gateway server.
      add({
        id: 'banking',
        label: 'Banking',
        state: 'bad',
        text: 'No gateway address yet',
        detail: [
          'Refresh banking tools fills it in from the banking gateway this Studio server is connected to (BANKING_GATEWAY_URL, or BANKING_GATEWAY_RUNTIME_URL when the runtime needs another address).',
          BANKING_DEPLOY_NEEDS,
        ],
        action: { label: 'Refresh banking tools', target: tools },
      });
    else if (status?.mock && banking?.studio === 'live')
      // Live on the mock bank: everything works, on test data. Said before a deploy, never hidden.
      add({
        id: 'banking',
        label: 'Banking',
        state: 'warn',
        text: 'Tested on the mock bank (test data)',
        detail: [status.text, BANKING_DEPLOY_NEEDS],
        note: `A deployed agent reaches the gateway at ${address}. Before real customers call, make sure that is a gateway on the bank’s real systems, not the mock bank.`,
      });
    else
      add({ id: 'banking', label: 'Banking', state: 'info', text: status ? status.text : 'Needs the banking gateway', detail: [BANKING_DEPLOY_NEEDS], note: 'Studio can’t check the server’s secret or whether the runtime reaches the gateway; the deploy’s own checks name a missing secret.' });
  }

  return items;
}

/** One verdict for the whole list. It never says "fine" while anything is amber or red. */
export function verdict(items: Pick<CheckItem, 'state'>[]): { state: 'ok' | 'warn' | 'bad'; text: string } {
  const bad = items.filter((i) => i.state === 'bad').length;
  const warn = items.filter((i) => i.state === 'warn').length;
  if (bad) return { state: 'bad', text: `${plural(bad, 'thing')} to fix before going live${warn ? `, and ${warn} to look at` : ''}` };
  if (warn) return { state: 'warn', text: `Nothing blocks it, but ${plural(warn, 'thing')} to look at` };
  return { state: 'ok', text: 'Everything checked looks fine' };
}

/** The server doesn't enforce a release policy yet, so the list can only advise. Said once, in one place. */
export const POLICY_NOTE =
  'This list is advice. The server doesn’t enforce a release policy yet, so nothing here stops a deploy; Production still asks for the typed confirmation.';
