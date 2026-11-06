import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { $, $$, actions, byText, setupDom, teardownDom, textOf } from './component/dom.js';
import { applyStarter } from '../src/studio/starters.ts';
import { minimalConfig } from '../src/demo/demoApi.js';
import { buildSections } from '../src/studio/agent/buildSections.js';

// An agent's pages, mounted in jsdom with a config in state: the stage tabs, the Overview, the Build list and the Home checklist. (The parts
// of Build › Detailed are in detailed.component.test.js.) Clicks and typing are replayed and the config that comes out is read back.
const { mountScreen, act } = await setupDom();
const a = actions(act);
after(() => teardownDom());

const agent = () => applyStarter(minimalConfig('acme', 'Acme'), 'support');

test('the stages are tabs in the order of the work, the open one marked, with a number where the checks found something to fix', async () => {
  const app = await mountScreen('stagetabs', agent(), { ready: 'nav', props: { page: 'tools', problems: { agent: 2, tools: 1, calls: 4 } } });
  const tabs = $$(app.container, 'nav[aria-label="Agent stages"] button');
  assert.deepEqual(
    tabs.map((b) => b.dataset.stage),
    ['overview', 'build', 'test', 'release', 'monitor'],
  );
  assert.equal($(app.container, 'button[aria-current="page"]').dataset.stage, 'build', 'Tools is part of Build');
  assert.match(
    textOf($(app.container, 'button[data-stage="build"]')),
    /^2\s*Build\s*3/,
    'numbered in the order of the work, with the problems of all of Build',
  );
  assert.match(textOf($(app.container, 'button[data-stage="monitor"]')), /4/);
  await app.unmount();
});

test('the Home checklist names the next step, and a step that is done reads as done', async () => {
  const app = await mountScreen('homepage', agent(), { ready: '.nlPage', props: { summary: {} } });
  const steps = $$(app.container, '.nlSteps li');
  assert.ok(steps.length >= 6);
  assert.equal(steps.filter((s) => s.className.includes('next')).length, 1, 'exactly one is the next step');
  assert.ok($(app.container, '.nlSteps li[data-step="prompt"][data-state="done"]'), 'the starter has instructions');
  assert.match(textOf($(app.container, '.nlSection h2')), /Getting it ready/);
  await app.unmount();
});

test('the Overview lists the parts of building it first while it is not live, each opening its page; the week’s numbers come after', async () => {
  const config = agent();
  const sections = buildSections({ config });
  const app = await mountScreen('homepage', config, { ready: '.nlPage', props: { summary: {}, sections } });
  assert.match(textOf($(app.container, '.nlSection h2')), /^Build/);
  const rows = $$(app.container, '.ovBuild li');
  assert.deepEqual(
    rows.map((r) => r.dataset.part),
    ['agent', 'conversation', 'knowledge', 'tools', 'connections', 'channels', 'media', 'workflow', 'subagents', 'guardrails', 'aftercall'],
  );
  assert.ok($(app.container, '.ovBuild li[data-part="guardrails"][data-state="optional"]'));
  const body = $(app.container, '.ovBody');
  assert.ok(body.lastElementChild.classList.contains('ovKpiStrip'), 'not live: the numbers last');
  await app.unmount();
  const live = await mountScreen('homepage', config, { ready: '.nlPage', props: { summary: { deployed: { development: '0.1.0' } }, sections } });
  assert.ok($(live.container, '.ovBody').firstElementChild.classList.contains('ovKpiStrip'), 'live: the numbers first');
  await live.unmount();
});

test('Build lists its parts down the side: the open one marked, a done part checked, an optional one unmarked, then its views', async () => {
  const config = agent();
  const sections = buildSections({ config });
  const app = await mountScreen('buildstage', config, { ready: 'nav', props: { page: 'tools', sections } });
  assert.deepEqual(
    $$(app.container, 'nav[aria-label="Build"] button[data-page]').map((b) => b.dataset.page),
    [...['agent', 'conversation', 'knowledge', 'tools', 'connections', 'channels', 'media', 'workflow', 'subagents', 'guardrails', 'aftercall'], 'settings'],
  );
  assert.equal($(app.container, 'button[aria-current="page"]').dataset.page, 'tools');
  assert.ok($(app.container, 'button[data-page="workflow"] [aria-label="Done"]'), 'one agent answers: done');
  assert.ok(!$(app.container, 'button[data-page="guardrails"] [role="img"]'), 'nothing set, optional: no mark');
  assert.match(textOf($(app.container, 'button[data-page="guardrails"]')), /Optional$/, 'it says it is optional instead');
  assert.equal(byText(app.container, 'button', /^JSON$/), null, 'its views are in the bar above it (StageViews), not here');
  assert.equal(textOf($(app.container, '.theOpenPage')), 'the open page');
  await app.unmount();
});

test('the row under the stage tabs holds the open stage’s views: Build’s four, Test’s parts with their latest result, Monitor’s pages', async () => {
  const build = await mountScreen('stageviews', agent(), { ready: '.nlViews', props: { page: 'agent', checks: { checked: true, problems: 2 } } });
  assert.deepEqual(
    $$(build.container, 'nav[aria-label="How to see the draft"] button').map((b) => b.dataset.view),
    ['guided', 'detailed', 'workflow', 'json'],
  );
  assert.equal($(build.container, 'button[aria-current="page"]').dataset.view, 'detailed');
  assert.match(textOf($(build.container, '.nlViewsSide [data-checks]')), /2 problems/, 'the checks on the right');
  await build.unmount();
  const test = await mountScreen('stageviews', agent(), {
    ready: '.nlViews',
    props: { page: 'tests', part: 'scenarios', counts: { scenarios: { text: '2 fail', tone: 'bad' } } },
  });
  assert.deepEqual($$(test.container, 'nav[aria-label="Parts of testing"] button').map(textOf), [
    'Try it',
    'Simulated callers',
    'Scenarios2 fail',
    'Readiness checks',
  ]);
  assert.equal($(test.container, 'button[aria-current="page"]').dataset.part, 'scenarios');
  assert.ok($(test.container, '.nlViewCount.bad'));
  await test.unmount();
  const monitor = await mountScreen('stageviews', agent(), { ready: '.nlViews', props: { page: 'speed' } });
  assert.equal(textOf($(monitor.container, 'nav[aria-label="Monitor"] button[aria-current="page"]')), 'Speed');
  await monitor.unmount();
  const overview = await mountScreen('stageviews', agent(), { ready: 'body', props: { page: 'home' } });
  assert.equal($(overview.container, '.nlViews'), null, 'Overview has no views');
  await overview.unmount();
});

test('while the agent is not ready, the tabs say how far along it is and open the next step; a stage with a step to do is marked', async () => {
  const steps = [
    { id: 'prompt', label: 'Say what it should do', state: 'done', page: 'agent' },
    { id: 'voice', label: 'Pick its language', state: 'todo', page: 'agent', target: { open: 'language' } },
    { id: 'publish', label: 'Publish a version', state: 'todo', page: 'releases' },
    { id: 'abilities', label: 'Give it tools', state: 'optional', page: 'tools' },
  ];
  const opened = [];
  const plan = { steps, next: steps[1], done: 1, total: 3 };
  const app = await mountScreen('stagetabs', agent(), { ready: 'nav', props: { page: 'home', plan, onStep: (step) => opened.push(step.id) } });
  const card = byText(app.container, 'button', /Getting it ready/);
  assert.match(textOf(card), /Getting it ready\s*1 of 3 · Next: Pick its language/);
  assert.equal($$(card, '.nlReadyDots > i').length, 3, 'a dot per step');
  assert.equal($$(card, '.nlReadyDots > i.done').length, 1, 'the done ones filled');
  await a.click(card);
  assert.deepEqual(opened, ['voice'], 'the card opens the next step');
  assert.ok($(app.container, 'button[data-stage="build"] [aria-label="1 step to do"]'), 'a step to do in Build');
  assert.ok($(app.container, 'button[data-stage="release"] [aria-label="1 step to do"]'));
  assert.ok(!$(app.container, 'button[data-stage="overview"] [role="img"]'));
  await app.unmount();
  const ready = await mountScreen('stagetabs', agent(), { ready: 'nav', props: { page: 'home', plan: { steps: [], next: null, done: 3, total: 3 } } });
  assert.equal(byText(ready.container, 'button', /Getting it ready/), null, 'a ready agent has no progress card');
  await ready.unmount();
});

test('the top bar: Publish is the main action, Save shows only when there is something to save, problems show as a chip, the rest is in More', async () => {
  const opened = [];
  const app = await mountScreen('topbar', agent(), { ready: '.nlBar', props: { problems: 0, changes: 3, onChanges: () => opened.push('changes') } });
  const buttons = () => $$(app.container, '.nlBarActions > button:not(.stMenuBtn)').map(textOf);
  assert.deepEqual(buttons(), ['Describe', 'Test', 'Publish3 changes not published'], 'saved: no Save button, no chip; Publish counts the changes');
  assert.equal(textOf($(app.container, '.nlBarActions .primaryCta .nlCount')), '3 changes not published', 'read out in words');
  assert.equal($(app.container, '.nlChanges'), null, 'the changes are counted on Publish, not in a chip of their own');
  await a.open($(app.container, '.nlBarActions .stMenuBtn'));
  const more = $$(document.body, '.stMenu [role="menuitem"]').map(textOf);
  ['Run the checks', 'What changed since publishing (3)', 'Share…', 'Publish a new version…', 'Deploy a version…', 'Roll back…', 'All versions'].forEach(
    (item) => assert.ok(more.includes(item), `${item} is in More`),
  );
  await a.pick($$(document.body, '.stMenu [role="menuitem"]').find((el) => textOf(el) === 'What changed since publishing (3)'));
  assert.deepEqual(opened, ['changes'], 'what changed opens from More');
  await app.unmount();

  const dirty = await mountScreen('topbar', agent(), { ready: '.nlBar', props: { dirty: true, problems: 2 } });
  assert.deepEqual($$(dirty.container, '.nlBarActions > button:not(.stMenuBtn)').map(textOf), ['2 problems', 'Describe', 'Test', 'Save', 'Publish']);
  assert.equal(textOf($(dirty.container, '.nlMono')), 'A', 'the agent’s initials beside its name');
  assert.equal(textOf($(dirty.container, '.nlBarActions .primaryCta')), 'Save', 'with unsaved edits Save is the main action');
  assert.match(textOf($(dirty.container, '.nlSaveState')), /Unsaved changes/);
  await dirty.unmount();

  const testing = await mountScreen('topbar', agent(), { ready: '.nlBar', props: { testOpen: true } });
  assert.equal(byText(testing.container, '.nlBarActions button', 'Test').getAttribute('aria-pressed'), 'true', 'Test shows the panel is open');
  await testing.unmount();
});

test('the agent switcher lists the other agents and opens one on the same page; it also leads to all agents and to creating one', async () => {
  window.location.hash = '#/bots/a/tools';
  const bots = [
    { id: 'a', name: 'Acme', deployed: { staging: '0.1.0' } },
    { id: 'b', name: 'Bookings', deployed: {} },
  ];
  const app = await mountScreen('agentswitch', agent(), { ready: '.agentSwitch', props: { bots, tab: 'tools' } });
  assert.match(textOf($(app.container, '.agentSwitchButton')), /Acme\s*Live in Staging/);
  // the list is drawn above the page (a Radix menu), so it is looked for in the whole page
  await a.open($(app.container, '.agentSwitchButton'));
  const items = $$(document.body, '.agentSwitchMenu [role="menuitem"]').map(textOf);
  assert.deepEqual(items, ['BBookingsDraft', 'All agents', 'Create an agent']);
  await a.pick($$(document.body, '.agentSwitchMenu [role="menuitem"]')[0]);
  assert.equal(window.location.hash, '#/bots/b/tools', 'the same page of the other agent');
  assert.equal($(document.body, '.agentSwitchMenu'), null, 'and the list closes');
  await app.unmount();
});

test('the guided view: nine steps down the side, one step at a time with Back and Next, every answer written to the draft', async () => {
  const config = agent();
  const opened = [];
  const app = await mountScreen('guidedbuild', config, { ready: '.gdFlow', props: { onOpen: (page) => opened.push(page) } });
  const rail = () => $$(app.container, '.gdStep').map((b) => b.dataset.step);
  const current = () => $(app.container, '.gdStep[aria-current="step"]')?.dataset.step;
  const answer = (id) => textOf($(app.container, `.gdStep[data-step="${id}"] .gdStepAnswer`));
  assert.deepEqual(rail(), ['who', 'voice', 'knowledge', 'tools', 'channels', 'workflow', 'guardrails', 'aftercall', 'ready']);
  assert.equal(current(), 'who');
  assert.equal(textOf($(app.container, '#gd-question')), 'Who is your agent?');
  assert.ok($(app.container, '.gdNav button').disabled, 'no Back on the first step');

  // 1 · who it is: the tone as cards, written as words the model reads
  await a.click(byText(app.container, '.gdPick', /^Formal/));
  assert.equal(app.config.persona.tone, 'formal, polite, precise');
  assert.equal(byText(app.container, '.gdPick', /^Formal/).getAttribute('aria-checked'), 'true');
  await a.type($(app.container, '.gdTwo input'), 'Maya');
  assert.equal(app.config.persona.name, 'Maya');
  assert.equal(textOf($(app.container, '.gdSoFar .gdWho strong')), 'Maya', 'the card beside says who it is');

  // Next: language and voice; a language card is its main language
  await a.click($(app.container, '.gdNext'));
  assert.equal(current(), 'voice');
  await a.click(byText(app.container, '.gdPick', /^English \(UK\)/));
  assert.equal(app.config.defaults.language.primary, 'en-GB');
  assert.match(answer('voice'), /English \(United Kingdom\)/);

  // 6 · a first agent passing people on: a named specialist is a new agent, and one agent can't be chosen back here
  await a.click($(app.container, '.gdStep[data-step="workflow"]'));
  await a.click(byText(app.container, '.gdPick', /A first agent passes people on/));
  await a.type($(app.container, '.gdAddInline input'), 'Billing');
  await a.click($(app.container, '.gdAddInline button[type="submit"]'));
  assert.equal(app.config.agents.items.length, 2);
  assert.ok(byText(app.container, '.gdPick', /One agent answers everything/).disabled);
  assert.match(answer('workflow'), /2 agents/);

  // 8 · after the call: a common question in one press, and keeping the audio tells callers first
  await a.click($(app.container, '.gdStep[data-step="aftercall"]'));
  await a.click(byText(app.container, '.gdChip', /Was the caller’s problem solved/));
  assert.equal(app.config.post_call.analysis.length, 1);
  await a.click(byText(app.container, '.gdChip.choice', 'Transcript and audio'));
  assert.equal(app.config.post_call.recording.audio, true);
  assert.ok(app.config.persona.disclosures.recording_notice, 'a recording notice is added');
  await a.click(byText(app.container, '.gdMore button', /Detailed view/));
  assert.deepEqual(opened, ['aftercall'], 'every step links to all its settings');

  // 9 · ready: every answer with a way back to it
  await a.click($(app.container, '.gdStep[data-step="ready"]'));
  assert.equal($$(app.container, '.gdAnswers li').length, 8);
  assert.equal($(app.container, '.gdAside'), null, 'the agent itself is the step');
  await a.click(byText(app.container, '.gdAnswers li', /Its boundaries/).querySelector('button'));
  assert.equal(current(), 'guardrails');
  await app.unmount();
});
