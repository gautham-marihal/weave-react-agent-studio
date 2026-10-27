import { EXTRA_PAGE_IDS } from '../src/studio/agent/pages.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, TAB_IDS } from '../src/studio/journey.js';
import { STATES, agentState, statusLine } from '../src/studio/status.js';
import { TABS, parseRoute, routeHref } from '../src/studio/route.js';

// The journey: four stages with the addresses of their pages, one name for each state an agent can be in.

test('the tabs are the four stages in the order of the work, and every tab is in exactly one stage', () => {
  assert.deepEqual(
    STAGES.map((s) => s.label),
    ['Build', 'Test', 'Release', 'Monitor'],
  );
  assert.deepEqual(TAB_IDS, [
    'describe',
    'config',
    'workflow',
    'knowledge',
    'test',
    'scenarios',
    'checks',
    'versions',
    'deploy',
    'calls',
    'questions',
    'speed',
  ]);
  assert.equal(new Set(TAB_IDS).size, TAB_IDS.length);
  STAGES.forEach((s) => assert.ok(s.question.endsWith('?') && s.tabs.length > 0));
});

test('every tab the route knows is a tab of the journey, so no old screen or link is lost', () => {
  // the addresses the stages had, and the agent's own pages (see agent/pages.js); every old address still opens
  assert.deepEqual([...TABS].sort(), [...TAB_IDS, ...EXTRA_PAGE_IDS].sort());
  TAB_IDS.forEach((tab) => assert.equal(parseRoute(`#/bots/acme/${tab}`).tab, tab, `${tab} opens`));
  assert.equal(parseRoute('#/bots/acme').tab, 'config');
  assert.equal(parseRoute('#/bots/acme/readiness').tab, 'config', 'an unknown tab falls back to Config');
  assert.equal(routeHref('acme', 'calls'), '#/bots/acme/calls');
  assert.equal(routeHref('acme', 'config'), '#/bots/acme/config', 'every page is named in its address');
  assert.equal(routeHref('acme'), '#/bots/acme', 'with no page, the agent opens on its Home');
});

test('an agent has one state, named once: a problem outranks a milestone, and a later milestone outranks an earlier one', () => {
  assert.equal(agentState({}).label, 'Draft');
  assert.equal(agentState({ tests: 'passed' }).label, 'Tested');
  assert.equal(agentState({ deployed: { development: '0.1.0' } }).label, 'Live in Development');
  assert.equal(agentState({ deployed: { development: '0.1.0', staging: '0.1.0' } }).label, 'Live in Staging');
  assert.equal(agentState({ deployed: { development: '0.1.0', production: '0.1.0' }, tests: 'passed' }).label, 'Live in Production');
  assert.equal(agentState({ deployed: { production: '1.0.0' }, tests: 'failed' }).label, 'Needs attention');
  assert.equal(agentState({ problems: 2 }).label, 'Needs attention');
  assert.deepEqual(
    Object.values(STATES).map((s) => s.label),
    ['Needs attention', 'Live in Production', 'Live in Staging', 'Live in Development', 'Tested', 'Draft'],
  );
});

test('the line under an agent’s name says what is saved, how the tests stand, where it is live and how many calls it had, and claims nothing it does not know', () => {
  const full = statusLine({
    dirty: false,
    savedAt: 'just now',
    scenarioCount: 7,
    run: { status: 'passed', passed: 7, total: 7 },
    deployed: { development: '0.1.0' },
    callsToday: 12,
  });
  assert.deepEqual(
    full.map((p) => p.text),
    ['Draft saved just now', 'Tests 7 of 7 passing', 'Live in Development', '12 calls today'],
  );
  assert.deepEqual(
    full.map((p) => p.tone),
    ['ok', 'ok', 'ok', 'idle'],
  );
  const bare = statusLine({});
  assert.deepEqual(
    bare.map((p) => p.text),
    ['Draft saved', 'No tests written', 'Not live anywhere yet'],
    'no calls part until the number is known',
  );
  assert.equal(statusLine({ dirty: true })[0].tone, 'warn');
  assert.equal(statusLine({ scenarioCount: 3 })[1].text, '3 tests, not run yet');
  assert.equal(statusLine({ scenarioCount: 1 })[1].text, '1 test, not run yet');
  const failing = statusLine({ scenarioCount: 7, run: { status: 'failed', passed: 5, total: 7 } });
  assert.deepEqual([failing[1].text, failing[1].tone], ['Tests 5 of 7 passing', 'bad']);
  assert.equal(statusLine({ callsToday: 0 }).at(-1).text, 'No calls today');
  assert.equal(statusLine({ callsToday: 1 }).at(-1).text, '1 call today');
  assert.equal(statusLine({ deployed: { production: '1', development: '1' } }).find((p) => p.id === 'live').text, 'Live in Production and Development');
});

test('in the Agents list an agent’s state comes from where it is deployed and what its health says', async () => {
  const { stateFromHealth } = await import('../src/studio/status.js');
  assert.equal(stateFromHealth({}, null).label, 'Draft');
  assert.equal(stateFromHealth({ deployed: { development: '1' } }, { parts: [], checked: ['validity'] }).label, 'Live in Development');
  assert.equal(stateFromHealth({}, { parts: [], checked: ['validity', 'tests'] }).label, 'Tested');
  assert.equal(stateFromHealth({ deployed: { production: '1' } }, { parts: [{ id: 'tests_failing' }], checked: ['tests'] }).label, 'Needs attention');
  assert.equal(stateFromHealth({}, { parts: [{ id: 'invalid' }], checked: ['validity'] }).label, 'Needs attention');
  assert.equal(
    stateFromHealth({}, { parts: [{ id: 'unsupported' }], checked: ['validity'] }).label,
    'Draft',
    'parts that will not run are advice, not an emergency',
  );
});
