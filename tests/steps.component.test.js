import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { $, $$, actions, byText, setupDom, teardownDom, textOf } from './component/dom.js';
import { minimalConfig } from '../src/demo/demoApi.js';
import { addSubagent } from '../src/studio/workflow/workflowOps.js';

// Build › Steps mounted in jsdom on a real draft, used as a person would: the lanes and steps read from the agent, a
// step opens and changes in place, a step is added from its kinds, the call in words turns into steps, and an agent
// with no steps starts from a common call. Every change lands where the agent already keeps it.
const { mountScreen, act } = await setupDom();
const a = actions(act);
after(() => teardownDom());

const mount = (config) => mountScreen('detailed', config, { ready: '.dtPart', props: { part: 'steps' } });
const until = async (app, check, tries = 60) => {
  for (let i = 0; i < tries && !check(); i += 1) await app.wait(30);
  return check();
};
const view = async (app, name) => {
  const button = byText(app.container, 'button', name);
  if (button && button.getAttribute('aria-pressed') !== 'true') await a.click(button);
};

// a clinic's line: Reception answers and passes callers to Bookings; one guided step on each
function clinic() {
  let c = minimalConfig('clinic', 'Riverside Dental');
  const first = c.agents.items[0].id;
  c.agents.items[0].name = 'Reception';
  c.agents.items[0].instructions = { role: 'You answer the clinic’s line.', rules: ['Be warm.', 'Step 1: Find out what they need.'] };
  const made = addSubagent(c, first, { name: 'Bookings', when: 'They want an appointment.' });
  c = made.config;
  const bookings = c.agents.items.find((x) => x.id === made.id);
  bookings.instructions = { role: 'You book appointments.', rules: ['Step 1: Offer three slots, earliest first.'] };
  return c;
}

test('the call reads as lanes of numbered steps, the first agent first, each step with its kind', async () => {
  const app = await mount(clinic());
  await view(app, 'Step by step');
  assert.ok(await until(app, () => $$(app.container, '.bsLane').length === 2), 'a lane per subagent');
  const lanes = $$(app.container, '.bsLane h2').map(textOf);
  assert.deepEqual(lanes, ['Reception', 'Bookings']);
  assert.match(textOf($(app.container, '.bsSummary')), /across 2 subagents: Reception answers first and passes callers to Bookings/);
  const reception = $$(app.container, '.bsLane')[0];
  assert.ok(
    $$(reception, '.bsStep').some((s) => /Find out what they need/.test(textOf(s)) && /Guided/.test(textOf(s))),
    'a guided step',
  );
  assert.ok(
    $$(reception, '.bsStep').some((s) => /Decide where they go/.test(textOf(s)) && /Bookings/.test(textOf(s))),
    'where it passes callers',
  );
  assert.ok(!$$(app.container, '.bsStep').some((s) => /Be warm/.test(textOf(s))), 'a rule that isn’t a step stays on Subagents');
  await app.unmount();
});

test('a step opens in place and what is typed goes straight into the agent', async () => {
  const app = await mount(clinic());
  await view(app, 'Step by step');
  await until(app, () => $$(app.container, '.bsStep').length > 0);
  const step = $$(app.container, '.bsStep').find((s) => /Find out what they need/.test(textOf(s)));
  await a.click($(step, '.bsWords'));
  const box = $(step, '.bsEditor textarea');
  assert.ok(box, 'its editor opens under it');
  await a.type(box, 'Find out what they need, in one short question.');
  assert.deepEqual(app.config.agents.items[0].instructions.rules.slice(-2), ['Be warm.', 'Step 1: Find out what they need, in one short question.']);
  await a.click(byText(step, 'button', 'Done'));
  assert.equal($(app.container, '.bsEditor'), null, 'Done closes it');
  await app.unmount();
});

test('adding a step: the kinds this place can take; a line said every time goes where the agent takes over', async () => {
  const app = await mount(clinic());
  await view(app, 'Step by step');
  await until(app, () => $$(app.container, '.bsStep').length > 0);
  const reception = $$(app.container, '.bsLane')[0];
  await a.click(byText(reception, 'button', /^Add a step$/));
  const panel = $(app.container, '.bsAdd');
  assert.ok(panel, 'the kinds open there');
  const kinds = $$(panel, '.bsKindBtn b').map((b) => textOf(b).replace(/\s*(Every time|Guided)$/, ''));
  assert.ok(kinds.includes('Say something') && kinds.includes('Let the agent handle it') && kinds.includes('Decide where they go'));
  assert.ok(!kinds.includes('Ask for a photo'), 'a photo is asked for only inside a form’s steps');
  assert.ok(!kinds.includes('Show a form'), 'no form to show: not offered (hide, don’t grey out)');
  await a.click(byText(panel, '.bsKindBtn', /^Say something/));
  const reception2 = app.config.agents.items[0];
  assert.deepEqual(reception2.on_enter, [{ type: 'say', text: 'Write the line here.' }]);
  assert.ok($(app.container, '.bsEditor textarea'), 'the new step opens to be written');
  await app.unmount();
});

test('a step said in words is shown before it is added, then added where it belongs', async () => {
  const app = await mount(clinic());
  await view(app, 'Step by step');
  await until(app, () => $$(app.container, '.bsStep').length > 0);
  const bookings = $$(app.container, '.bsLane')[1];
  await a.click(byText(bookings, 'button', /^Add a step$/));
  const panel = $(app.container, '.bsAdd');
  await a.type($(panel, 'input'), 'Read the booking back and wait for a clear yes');
  await a.click(byText(panel, 'button', 'Make it a step'));
  assert.match(textOf($(panel, '.bsPreview')), /Read the booking back.*Guided/, 'what it will be, before anything changes');
  assert.deepEqual(app.config.agents.items[1].instructions.rules, ['Step 1: Offer three slots, earliest first.'], 'nothing changed yet');
  await a.click(byText(panel, 'button', 'Add it'));
  assert.deepEqual(app.config.agents.items[1].instructions.rules, [
    'Step 1: Offer three slots, earliest first.',
    'Step 2: Read the booking back and wait for a clear yes',
  ]);
  await app.unmount();
});

test('in your words: the call as lines, turned into steps, shown, then used (and the hand-over kept once)', async () => {
  const app = await mount(clinic());
  await view(app, 'In your words');
  const box = $(app.container, '.bsWordsIn textarea');
  assert.ok(box, 'the words view');
  assert.match(
    box.value,
    /Find out what they need\.\n3\. If they want an appointment, pass them to Bookings\.\nBookings:\n/,
    'the steps as lines, a lane’s name before its lines',
  );
  assert.match(box.value, /When they need something else, pass them back to Reception\./, 'a way back, in words');
  await a.type(
    box,
    [
      '1. Find out what they need in one question.',
      '2. If they want an appointment, pass them to Bookings.',
      'Bookings: Offer three slots.',
      '4. Say goodbye.',
    ].join('\n'),
  );
  await a.click(byText(app.container, 'button', /Turn into steps/));
  assert.match(textOf($(app.container, '.bsWordsOut')), /4 lines became 4 steps/);
  await a.click(byText(app.container, 'button', /^Use these/));
  assert.deepEqual(app.config.agents.items[0].instructions.rules.slice(-2), ['Be warm.', 'Step 1: Find out what they need in one question.']);
  assert.deepEqual(app.config.agents.items[1].instructions.rules, ['Step 1: Offer three slots.']);
  assert.equal(app.config.agents.items[0].handoffs.length, 1, 'the hand-over it had isn’t added twice');
  assert.ok(
    app.config.agents.items[1].tools.some((t) => /end/.test(t)),
    'the ending is added',
  );
  await app.unmount();
});

test('no steps yet: write the call, add the first step, or start from a common call', async () => {
  const c = minimalConfig('fresh', 'Fresh');
  c.channels = [];
  const app = await mount(c);
  await view(app, 'Step by step');
  assert.ok(await until(app, () => !!$(app.container, '.bsEmpty')), 'the empty page');
  assert.equal($$(app.container, '.bsStarter').length, 3);
  await a.click(byText(app.container, '.bsStarter', /Take details, then confirm/));
  assert.equal(app.config.agents.items[0].instructions.rules.length, 4);
  assert.ok(await until(app, () => $$(app.container, '.bsStep').length >= 5), 'its steps show');
  await app.unmount();
});
