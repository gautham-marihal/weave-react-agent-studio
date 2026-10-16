// "Is it safe to put this live?" in one list, built from evidence the studio already has: the validator, the test runs, the knowledge
// indexes, the secrets. It is the same list on the Deploy tab (for a published version) and in the Publish dialog (for the draft).
//
// Two rules keep it honest and generic:
//  - A line appears ONLY when it applies. A bot with no knowledge base has no knowledge line; a bot with no scenarios gets "none written"
//    in amber, never "failed": nothing is called a failure for something the bot doesn't use.
//  - It INFORMS, it does not decide. Which lines must be green before a production deploy is a release policy, and a policy belongs on the
//    server so a browser can't skip it. There is none yet, so the list says it is advice (`policy: 'advice'`).
// Pure: no network, no DOM.

import { isObj } from '../form/engine.js';
import { splitUnsupported } from '../preflight.js';
import { isFinished, testStatusOf } from '../scenarios/runResults.js';
import { baseState, knowledgeSummary } from '../knowledge/model.js';
import { describeRecords, readDataFlow, recordingNoticeState } from '../records/recordsModel.js';

const list = (v) => (Array.isArray(v) ? v : []);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// state: 'ok' (fine) | 'warn' (look at it) | 'bad' (don't go live like this) | 'info' (nothing to judge)
export function buildChecklist({ config, report, version, runs = [], knowledge, providers = [], target = 'version' } = {}) {
  const items = [];
  const add = (item) => items.push(item);
  const reportKnown = isObj(report);

  // ---- valid
  if (reportKnown) {
    const errors = list(report.errors);
    if (errors.length)
      add({
        id: 'valid',
        label: 'Valid',
        state: 'bad',
        text: `${plural(errors.length, 'error')} to fix first`,
        detail: errors.slice(0, 3).map((e) => e.message),
        action: { tab: 'config', label: 'Open Config' },
      });
    else
      add({
        id: 'valid',
        label: 'Valid',
        state: 'ok',
        text: target === 'version' ? 'This version passed the checks when it was published.' : 'The draft passes the checks.',
      });
  }

  // ---- protections declared but not enforced (a security item), and parts that won't run
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

  // ---- tests: on this exact version when we know its checksum, else the latest run on the draft
  const scenarioCount = list(config?.tests).filter(isObj).length;
  if (config) {
    if (scenarioCount === 0) {
      add({
        id: 'tests',
        label: 'Tests',
        state: 'warn',
        text: 'None written',
        detail: ['No test scenarios are written for this agent, so nothing has checked its behaviour.'],
        action: { tab: 'scenarios', label: 'Write scenarios' },
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
          action: { tab: 'scenarios', label: 'Run them all' },
        });
      else if (status.state === 'passed')
        add({
          id: 'tests',
          label: 'Tests',
          state: 'ok',
          text: `Passed on this exact version (${status.run.skipped > 0 ? `${status.run.passed} of ${plural(status.run.total, 'scenario')}; ${status.run.skipped} not run` : plural(status.run.total || scenarioCount, 'scenario')})`,
        });
      else if (status.state === 'failed')
        add({
          id: 'tests',
          label: 'Tests',
          state: 'bad',
          text: `${status.text} on this exact version`,
          detail: [`${status.run.failed} failed, ${status.run.errors} broke, of ${status.run.total}.`],
          action: { tab: 'scenarios', label: 'See the run' },
        });
      else
        add({
          id: 'tests',
          label: 'Tests',
          state: 'warn',
          text: 'Not run on this exact version',
          detail: [runs.some((r) => isFinished(r.status)) ? 'The latest run was on a different configuration.' : 'No scenario has been run yet.'],
          action: { tab: 'scenarios', label: 'Run them' },
        });
    } else {
      const latest = list(runs).find((r) => isFinished(r.status));
      if (!latest) add({ id: 'tests', label: 'Tests', state: 'warn', text: 'Not run yet', action: { tab: 'scenarios', label: 'Run them' } });
      else if (latest.status === 'passed')
        add({ id: 'tests', label: 'Tests', state: 'ok', text: `The latest run passed (${latest.passed} of ${latest.total})` });
      else
        add({
          id: 'tests',
          label: 'Tests',
          state: latest.status === 'skipped' ? 'warn' : 'bad',
          text: `The latest run ${latest.status === 'error' ? 'broke' : latest.status === 'skipped' ? 'skipped everything' : 'failed'}`,
          action: { tab: 'scenarios', label: 'See the run' },
        });
    }
  }

  // ---- knowledge: only when the agent has some
  const bases = list(knowledge?.bases);
  if (bases.length) {
    const summary = knowledgeSummary(knowledge);
    const states = bases.map(baseState);
    if (states.some((s) => s === 'not_built' || s === 'failed'))
      add({
        id: 'knowledge',
        label: 'Knowledge',
        state: 'bad',
        text: `${plural(summary.needsBuild, 'base')} without a current index`,
        detail: bases
          .filter((b) => ['not_built', 'failed', 'stale'].includes(baseState(b)))
          .map((b) => `${b.id}: ${b.problems[0]?.problem || (baseState(b) === 'failed' ? 'the last build failed' : 'no index has been built')}`),
        action: { tab: 'knowledge', label: 'Build it' },
      });
    else if (states.some((s) => s === 'stale' || s === 'building'))
      add({
        id: 'knowledge',
        label: 'Knowledge',
        state: 'warn',
        text: states.includes('building') ? 'An index is still building' : `${plural(summary.needsBuild, 'base')} out of date`,
        detail: bases.flatMap((b) => b.problems.map((p) => `${b.id}: ${p.problem}`)),
        action: { tab: 'knowledge', label: 'Open knowledge' },
      });
    else add({ id: 'knowledge', label: 'Knowledge', state: 'ok', text: `${plural(bases.length, 'base')} ready` });
  }

  // ---- secrets: names only; the studio can't read their values, and can only say a provider's usual key is missing
  const required = list(report?.secrets_required);
  if (required.length) {
    const status = required.map((name) => {
      const owner = list(providers).find((p) => p.default_secret === name);
      return { name, missing: !!owner && owner.key_available === false };
    });
    const missing = status.filter((s) => s.missing);
    if (missing.length)
      add({
        id: 'secrets',
        label: 'Secrets',
        state: 'warn',
        text: `${plural(missing.length, 'secret')} not set on the server`,
        detail: missing.map((s) => s.name),
        note: 'The agent may fail when it needs them. They can’t be set from here yet.',
      });
    else
      add({
        id: 'secrets',
        label: 'Secrets',
        state: 'info',
        text: `${plural(required.length, 'secret')} needed`,
        detail: required,
        note: 'Names only: the studio can’t read them. A name it can’t check is listed here and checked again when you deploy.',
      });
  }

  // ---- what happens to the conversation: where it is processed, what is kept about each call, whether callers are told
  if (isObj(config)) {
    const flow = readDataFlow(config);
    add({
      id: 'data',
      label: 'Where it is processed',
      state: flow.chosen ? 'info' : 'warn',
      text: flow.sentence,
      detail: flow.chosen && flow.names.length > 1 ? flow.lines : [],
      action: { tab: 'config', label: 'Review the AI model' },
    });
    const records = describeRecords(config, { unsupported: report?.unsupported });
    add({
      id: 'records',
      label: 'Call records',
      state: records.problems.length ? 'warn' : 'info',
      text: records.headline,
      detail: [...records.lines, ...records.problems],
      action: { tab: 'config', label: 'Review' },
    });
    if (recordingNoticeState(config).missing)
      add({
        id: 'notice',
        label: 'Recording notice',
        state: 'warn',
        text: 'Callers on a voice channel are not told the call may be recorded',
        detail: ['A log of each call is kept, and in many places callers must be told.'],
        action: { tab: 'config', label: 'Add a notice' },
      });
  }

  return items;
}

// One verdict for the whole list. It never says "ready" while anything is amber or red.
export function verdict(items) {
  const bad = items.filter((i) => i.state === 'bad').length;
  const warn = items.filter((i) => i.state === 'warn').length;
  if (bad) return { state: 'bad', text: `${plural(bad, 'thing')} to fix before going live${warn ? `, and ${warn} to look at` : ''}` };
  if (warn) return { state: 'warn', text: `Nothing blocks it, but ${plural(warn, 'thing')} to look at` };
  return { state: 'ok', text: 'Everything checked looks fine' };
}

// The server doesn't enforce a release policy yet, so the list can only advise. Said once, in one place.
export const POLICY_NOTE =
  'This list is advice. The server doesn’t enforce a release policy yet, so nothing here can stop a deploy except the typed confirmation for production when a protection isn’t enforced.';

// `preflight.knowledge` in a deploy's answer: the problems for every base the version uses. Tolerant: a flat list of problems, or
// [{ base, problems }] or { base: [problems] }.
export function normalizePreflightKnowledge(raw) {
  const rows = [];
  const push = (base, p) => {
    const problem = typeof p === 'string' ? { problem: p, fix: '' } : { problem: String(p?.problem || ''), fix: String(p?.fix || '') };
    if (problem.problem) rows.push({ base: base || '', ...problem });
  };
  if (Array.isArray(raw))
    raw.forEach((item) => {
      if (isObj(item) && Array.isArray(item.problems)) item.problems.forEach((p) => push(item.base || item.id, p));
      else push(isObj(item) ? item.base : '', item);
    });
  else if (isObj(raw)) Object.entries(raw).forEach(([base, problems]) => list(problems).forEach((p) => push(base, p)));
  return rows;
}
