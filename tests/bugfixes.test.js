import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStarter } from '../src/studio/starters.ts';
import { minimalConfig } from '../src/demo/demoApi.js';
import { buildWorkflow } from '../src/studio/workflow/workflowModel.js';
import { addSubagent } from '../src/studio/workflow/workflowOps.js';
import { createProblems } from '../src/studio/form/inlineCreate.js';
import { renameEverywhere } from '../src/studio/form/references.js';
import { createEngine } from '../src/studio/form/engine.js';
import { readFileSync } from 'node:fs';
import { evaluateAlerts, effectiveRules } from '../src/studio/insights/alertsModel.js';
import { analyse } from '../src/studio/monitoring/monitorModel.js';
import { latestDraftRun } from '../src/studio/scenarios/runResults.js';
import { testHealth } from '../src/studio/test/testHealth.js';
import { routeHref } from '../src/studio/route.js';
import { stepsOf } from '../src/studio/agent/detailed/toolsWorkspace/toolsWords.js';
import { knowledgeOf, addKnowledgePage } from '../src/studio/setup/setupKnowledge.js';
import { guidedSteps } from '../src/studio/agent/workspace/guidedSteps.js';
import { setMoment } from '../src/studio/agent/blocks/guardrailModel.js';

// Bugs found by the whole-app review of 2026-11-07, each pinned so it stays fixed.

const agent = () => applyStarter(minimalConfig('acme', 'Acme'), 'support');
const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
const engine = createEngine(schema);

test('a subagent named “constructor” is drawn on the Workflow, and can be made, like any other name', () => {
  const start = agent();
  const made = addSubagent(start, start.agents.items[0].id, { name: 'Constructor', when: 'they ask about building' });
  const config = made.config || made;
  assert.ok(config.agents.items.some((a) => a.id === 'constructor'));
  assert.doesNotThrow(() => buildWorkflow(config));
  // a name that only an object's own built-ins have is free
  const c = { ...agent(), state: { variables: {} }, connections: {} };
  assert.equal(createProblems('state_vars', { name: 'constructor' }, c).name, undefined);
  assert.equal(createProblems('http_connections', { name: 'constructor' }, c).name, undefined);
});

test('renaming an agent moves its saved places on the Workflow canvas with it', () => {
  const config = agent();
  const id = config.agents.items[0].id;
  config.builder = { ui: { graph_positions: { [id]: { x: 1, y: 2 }, [`${id}::tool::end_call`]: { x: 3, y: 4 }, other: { x: 5, y: 6 } } } };
  const next = renameEverywhere(engine, config, 'agents', id, 'front_desk');
  assert.deepEqual(Object.keys(next.builder.ui.graph_positions).sort(), ['front_desk', 'front_desk::tool::end_call', 'other']);
});

test('“No calls coming in” stays quiet while a call is going on', () => {
  const now = Date.parse('2026-11-07T15:00:00Z');
  const H = 3600e3;
  const calls = [];
  for (let t = now - 7 * 24 * H + H; t < now - 3.5 * H; t += 0.5 * H)
    calls.push({ bot: 'a', id: `c${t}`, started_at: new Date(t).toISOString(), status: 'ended' });
  const quiet = evaluateAlerts({ calls, bots: [{ id: 'a' }], nowMs: now, rules: effectiveRules({}) });
  assert.equal(quiet.filter((a) => a.rule === 'no_calls').length, 1, 'with nothing going on, it says so');
  calls.push({ bot: 'a', id: 'live', started_at: new Date(now - 60e3).toISOString(), status: 'in_progress' });
  const live = evaluateAlerts({ calls, bots: [{ id: 'a' }], nowMs: now, rules: effectiveRules({}) });
  assert.equal(live.filter((a) => a.rule === 'no_calls').length, 0);
});

test('“Handled alone” counts calls the agent finished with nobody passed on, never calls cut off', () => {
  const now = Date.parse('2026-11-07T15:00:00Z');
  const calls = Array.from({ length: 10 }, (_, i) => ({
    bot: 'a',
    id: `x${i}`,
    started_at: new Date(now - (i + 1) * 3600e3).toISOString(),
    status: i < 3 ? 'unfinished' : 'ended',
    handoffs: i === 9 ? 1 : 0,
  }));
  const { totals, series } = analyse({ calls, bots: [{ id: 'a' }], nowMs: now, days: 7 });
  assert.equal(totals.handled, 6);
  assert.equal(totals.handledRate, 0.6);
  assert.equal(
    series.reduce((n, d) => n + d.handled, 0),
    6,
  );
});

test('the draft’s latest run is a run of its saved scenarios, never Simulated callers or unsaved edits', () => {
  const runs = [
    { id: 'callers', ref: 'unsaved', status: 'passed', counts: { passed: 5, total: 5 } },
    { id: 'saved', ref: 'draft', status: 'failed', counts: { passed: 1, failed: 1, total: 2 } },
  ];
  assert.equal(latestDraftRun(runs).id, 'saved');
  assert.equal(latestDraftRun([runs[0]]), null);
  assert.equal(latestDraftRun([{ id: 'old', status: 'passed' }]).id, 'old', 'a server that says no ref is believed');
});

test('“Ready to publish?” never says yes for a run that broke, skipped everything, or ran only some scenarios', () => {
  const run = (status, counts) => ({ status, startedAt: '2026-11-07T10:00:00Z', passed: 0, failed: 0, errors: 0, skipped: 0, total: 0, ...counts });
  const verdict = (latestRun, scenarioCount = 3) => testHealth({ scenarioCount, latestRun, gate: { enabled: false } }).verdict;
  assert.equal(verdict(run('error', { total: 3 })).ok, false);
  assert.equal(verdict(run('skipped', { skipped: 3, total: 3 })).ok, false);
  assert.equal(verdict(run('passed', { passed: 1, total: 1 }), 4).ok, false);
  assert.equal(verdict(run('passed', { passed: 3, total: 3 })).ok, true);
});

test('an address leaves out a parameter that is not set (never “item=undefined”)', () => {
  assert.equal(routeHref('a', 'tools', { item: undefined, view: 'x' }), '#/bots/a/tools?view=x');
  assert.equal(routeHref('a', 'tools', { item: null }), '#/bots/a/tools');
});

test('a tool with no id yet is found by its place, so its page draws', () => {
  const config = {
    tools: [
      { id: 'a', type: 'builtin', builtin: 'end_call' },
      { type: 'http', request: { method: 'GET', path: '/x' } },
    ],
  };
  assert.ok(stepsOf(config, '1').length > 0);
});

test('a base of documents named other than “knowledge” is the one the Knowledge part reads and adds to', () => {
  const config = {
    ...agent(),
    knowledge: [{ id: 'help_center', type: 'vector_store', mode: 'inject', sources: [{ type: 'url', url: 'https://example.com/help', crawl_depth: 2 }] }],
  };
  const k = knowledgeOf(config);
  assert.deepEqual(k.pages, ['https://example.com/help']);
  assert.equal(k.depths['https://example.com/help'], 2);
  const added = addKnowledgePage(config, 'https://example.com/faq');
  assert.equal(added.knowledge.length, 1, 'no second base is made');
  assert.equal(added.knowledge[0].sources.length, 2);
});

test('Guided counts ending abusive calls apart from the hand-over rules', () => {
  const config = setMoment(agent(), 'abusive_end', true);
  const step = guidedSteps(config).steps.find((s) => s.id === 'guardrails');
  assert.doesNotMatch(step.answer, /hand-over rule/);
  assert.match(step.answer, /ends abusive calls/i);
});

test('a date written in words is read as its own day, east of UTC too', async () => {
  const before = process.env.TZ;
  process.env.TZ = 'Asia/Singapore';
  try {
    const { readDate } = await import('../src/demo/simulatedPictures.js');
    assert.equal(readDate('05 MAR 2024'), '2024-03-05');
    assert.equal(readDate('March 5, 2024'), '2024-03-05');
  } finally {
    process.env.TZ = before;
  }
});
