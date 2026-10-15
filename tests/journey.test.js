import test from 'node:test';
import assert from 'node:assert/strict';
import { NEXT, STAGES, TAB_IDS, TAB_LABELS, nextStep, stageOf, walk } from '../src/studio/journey.js';
import { STATES, agentState, statusLine } from '../src/studio/status.js';
import { TABS, parseRoute, routeHref } from '../src/studio/route.js';

// The journey: four stages, a "Next" from every tab, one name for each state an agent can be in.

test('the tabs are the four stages in the order of the work, and every tab is in exactly one stage', () => {
  assert.deepEqual(STAGES.map((s) => s.label), ['Build', 'Test', 'Release', 'Monitor']);
  assert.deepEqual(TAB_IDS, ['config', 'workflow', 'knowledge', 'test', 'scenarios', 'checks', 'versions', 'deploy', 'calls']);
  assert.equal(new Set(TAB_IDS).size, TAB_IDS.length);
  STAGES.forEach((s) => assert.ok(s.question.endsWith('?') && s.tabs.length > 0));
  assert.equal(stageOf('deploy').id, 'release');
  assert.equal(stageOf('checks').id, 'test');
  assert.equal(stageOf('nonsense').id, 'build', 'an unknown tab is treated as the first');
  assert.equal(TAB_LABELS.config, 'Config');
});

test('every tab the route knows is a tab of the journey, so no old screen or link is lost', () => {
  assert.deepEqual([...TABS].sort(), [...TAB_IDS].sort());
  TAB_IDS.forEach((tab) => assert.equal(parseRoute(`#/bots/acme/${tab}`).tab, tab, `${tab} opens`));
  assert.equal(parseRoute('#/bots/acme').tab, 'config');
  assert.equal(parseRoute('#/bots/acme/readiness').tab, 'config', 'an unknown tab falls back to Config');
  assert.equal(routeHref('acme', 'calls'), '#/bots/acme/calls');
  assert.equal(routeHref('acme', 'config'), '#/bots/acme');
});

test('the whole journey can be walked with the "Next" bar alone, from Build to Monitor, and it ends', () => {
  assert.deepEqual(walk('config'), ['config', 'test', 'scenarios', 'checks', 'versions', 'deploy', 'calls']);
  assert.deepEqual(walk('workflow'), ['workflow', 'test', 'scenarios', 'checks', 'versions', 'deploy', 'calls']);
  assert.deepEqual(walk('knowledge'), ['knowledge', 'test', 'scenarios', 'checks', 'versions', 'deploy', 'calls']);
  assert.equal(NEXT.calls, null, 'the last stop has no next');
  TAB_IDS.filter((t) => t !== 'calls').forEach((tab) => { assert.ok(NEXT[tab].label && NEXT[tab].then && TAB_IDS.includes(NEXT[tab].tab), `${tab} has a next`); });
  assert.equal(nextStep('mystery').tab, 'test', 'an unknown tab gets the first step');
});

test('an agent has one state, named once: a problem outranks a milestone, and a later milestone outranks an earlier one', () => {
  assert.equal(agentState({}).label, 'Draft');
  assert.equal(agentState({ tests: 'passed' }).label, 'Tested');
  assert.equal(agentState({ deployed: { development: '0.1.0' } }).label, 'Live in Development');
  assert.equal(agentState({ deployed: { development: '0.1.0', staging: '0.1.0' } }).label, 'Live in Staging');
  assert.equal(agentState({ deployed: { development: '0.1.0', production: '0.1.0' }, tests: 'passed' }).label, 'Live in Production');
  assert.equal(agentState({ deployed: { production: '1.0.0' }, tests: 'failed' }).label, 'Needs attention');
  assert.equal(agentState({ problems: 2 }).label, 'Needs attention');
  assert.deepEqual(Object.values(STATES).map((s) => s.label), ['Needs attention', 'Live in Production', 'Live in Staging', 'Live in Development', 'Tested', 'Draft']);
});

test('the line under an agent’s name says what is saved, how the tests stand, where it is live and how many calls it had, and claims nothing it does not know', () => {
  const full = statusLine({ dirty: false, savedAt: 'just now', scenarioCount: 7, run: { status: 'passed', passed: 7, total: 7 }, deployed: { development: '0.1.0' }, callsToday: 12 });
  assert.deepEqual(full.map((p) => p.text), ['Draft saved just now', 'Tests 7 of 7 passing', 'Live in Development', '12 calls today']);
  assert.deepEqual(full.map((p) => p.tone), ['ok', 'ok', 'ok', 'idle']);
  const bare = statusLine({});
  assert.deepEqual(bare.map((p) => p.text), ['Draft saved', 'No tests written', 'Not live anywhere yet'], 'no calls part until the number is known');
  assert.equal(statusLine({ dirty: true })[0].tone, 'warn');
  assert.equal(statusLine({ scenarioCount: 3 })[1].text, '3 tests, not run yet');
  assert.equal(statusLine({ scenarioCount: 1 })[1].text, '1 test, not run yet');
  const failing = statusLine({ scenarioCount: 7, run: { status: 'failed', passed: 5, total: 7 } });
  assert.deepEqual([failing[1].text, failing[1].tone], ['Tests 5 of 7 passing', 'bad']);
  assert.equal(statusLine({ callsToday: 0 }).at(-1).text, 'No calls today');
  assert.equal(statusLine({ callsToday: 1 }).at(-1).text, '1 call today');
  assert.equal(statusLine({ deployed: { production: '1', development: '1' } }).find((p) => p.id === 'live').text, 'Live in Production and Development');
});

test('on Home, an agent’s progress shows each stage and the one thing to do next, and never claims what it does not know', async () => {
  const { journeyProgress } = await import('../src/studio/journey.js');
  const fresh = journeyProgress({ bot: {}, health: null, callCount: null });
  assert.deepEqual(fresh.stages.map((s) => [s.id, s.state]), [['build', 'todo'], ['test', 'todo'], ['release', 'todo'], ['monitor', 'todo']]);
  assert.deepEqual(fresh.next, { tab: 'config', label: 'Finish building it' });
  const valid = journeyProgress({ bot: {}, health: { state: 'ok', parts: [], checked: ['validity'] } });
  assert.equal(valid.stages[0].state, 'done');
  assert.deepEqual(valid.next, { tab: 'test', label: 'Test it' });
  const invalid = journeyProgress({ bot: {}, health: { state: 'bad', parts: [{ id: 'invalid' }], checked: ['validity'] } });
  assert.deepEqual([invalid.stages[0].state, invalid.next.label], ['attention', 'Fix what the checks found']);
  const failing = journeyProgress({ bot: {}, health: { state: 'bad', parts: [{ id: 'tests_failing' }], checked: ['validity', 'tests'] } });
  assert.deepEqual([failing.stages[1].state, failing.next], ['attention', { tab: 'scenarios', label: 'See the tests that fail' }]);
  const tested = journeyProgress({ bot: { latest_version: '0.1.0' }, health: { state: 'ok', parts: [], checked: ['validity', 'tests'] } });
  assert.deepEqual(tested.stages.map((s) => s.state), ['done', 'done', 'todo', 'todo']);
  assert.deepEqual(tested.next, { tab: 'deploy', label: 'Put it live' }, 'published but not live: the next step is to deploy it');
  assert.equal(tested.stages[2].current, true);
  const live = journeyProgress({ bot: { latest_version: '0.1.0', deployed: { development: '0.1.0' } }, health: { state: 'ok', parts: [], checked: ['validity', 'tests'] }, callCount: 0 });
  assert.deepEqual(live.next, { tab: 'calls', label: 'Watch for calls' });
  const all = journeyProgress({ bot: { latest_version: '0.1.0', deployed: { development: '0.1.0' } }, health: { state: 'ok', parts: [], checked: ['validity', 'tests'] }, callCount: 3 });
  assert.equal(all.allDone, true);
  assert.equal(all.stages.some((s) => s.current), false);
});

test('in the Agents list an agent’s state comes from where it is deployed and what its health says', async () => {
  const { stateFromHealth } = await import('../src/studio/status.js');
  assert.equal(stateFromHealth({}, null).label, 'Draft');
  assert.equal(stateFromHealth({ deployed: { development: '1' } }, { parts: [], checked: ['validity'] }).label, 'Live in Development');
  assert.equal(stateFromHealth({}, { parts: [], checked: ['validity', 'tests'] }).label, 'Tested');
  assert.equal(stateFromHealth({ deployed: { production: '1' } }, { parts: [{ id: 'tests_failing' }], checked: ['tests'] }).label, 'Needs attention');
  assert.equal(stateFromHealth({}, { parts: [{ id: 'invalid' }], checked: ['validity'] }).label, 'Needs attention');
  assert.equal(stateFromHealth({}, { parts: [{ id: 'unsupported' }], checked: ['validity'] }).label, 'Draft', 'parts that will not run are advice, not an emergency');
});
