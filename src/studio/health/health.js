// How an agent is doing at a glance, for the Agents list, from what the API already says (`POST /validate`,
// `GET /tests`, `GET /knowledge`), so the list needs no endpoint of its own. A badge appears only for what applies, and
// "no problems found" names the checks it looked at, never "healthy". Pure: no network, no DOM.

import { isObj } from '../form/engine.js';
import { splitUnsupported } from '../preflight.ts';
import { knowledgeSummary, normalizeKnowledge } from '../knowledge/model.js';
import { normalizeScenarioList } from '../scenarios/runResults.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// tone: 'bad' | 'warn' ; tab: where to look
export function healthFrom({ config, report, tests, knowledge } = {}) {
  const parts = [];
  const checked = [];
  if (isObj(report)) {
    checked.push('validity');
    const errors = Array.isArray(report.errors) ? report.errors.length : 0;
    if (!report.valid) parts.push({ id: 'invalid', tone: 'bad', text: errors ? plural(errors, 'error') : 'invalid', tab: 'config' });
    else {
      const { security, advice } = splitUnsupported(report.unsupported);
      checked.push('what will run');
      if (security.length) parts.push({ id: 'security', tone: 'bad', text: `${security.length} not enforced`, tab: 'config' });
      if (advice.length) parts.push({ id: 'unsupported', tone: 'warn', text: `${advice.length} won’t run`, tab: 'config' });
    }
  }
  const scenarioCount = Array.isArray(config?.tests) ? config.tests.filter(isObj).length : 0;
  if (scenarioCount > 0 && tests) {
    checked.push('tests');
    const items = normalizeScenarioList(tests).items;
    const failing = items.filter((i) => i.result && ['failed', 'error'].includes(i.result.status)).length;
    const neverRun = items.filter((i) => !i.result).length;
    if (failing) parts.push({ id: 'tests_failing', tone: 'bad', text: `${plural(failing, 'test')} failing`, tab: 'scenarios' });
    else if (neverRun === items.length) parts.push({ id: 'tests_not_run', tone: 'warn', text: 'tests not run', tab: 'scenarios' });
  }
  const baseCount = Array.isArray(config?.knowledge) ? config.knowledge.length : 0;
  if (baseCount > 0 && knowledge) {
    checked.push('knowledge');
    const summary = knowledgeSummary(normalizeKnowledge(knowledge));
    if (summary.needsBuild) parts.push({ id: 'knowledge', tone: 'warn', text: `${plural(summary.needsBuild, 'index', 'indexes')} to build`, tab: 'knowledge' });
  }
  const state = parts.some((p) => p.tone === 'bad') ? 'bad' : parts.length ? 'warn' : checked.length ? 'ok' : 'unknown';
  return { state, parts, checked };
}

export const healthTitle = (health) =>
  !health
    ? 'Not checked yet'
    : health.state === 'ok'
      ? `No problems found in: ${health.checked.join(', ')}`
      : health.state === 'unknown'
        ? 'Not checked yet'
        : health.parts.map((p) => p.text).join(', ');
export const needsAttention = (health) => !!health && (health.state === 'bad' || health.state === 'warn');

// The key a result is kept under: it changes when the draft is saved, so an edit asks again.
export const healthKey = (bot) => `${bot?.id}@${bot?.draft_revision ?? ''}`;
