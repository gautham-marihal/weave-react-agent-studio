import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  addGuided,
  addPass,
  addWayBack,
  applyStarter,
  applyWords,
  countSteps,
  insertAction,
  enterPath,
  isStepRule,
  lanesOf,
  moveStep,
  numbered,
  parseWords,
  problemsOf,
  removeStep,
  setGoodbye,
  setGuided,
  strandedLanes,
  wordsOf,
} from '../src/studio/agent/detailed/stepsWorkspace/stepsModel.js';

// Build › Steps reads an agent's call from what it already has and writes back to the same places (no new section).

// a dental clinic's line: Reception answers and passes callers to Bookings; a form, a lookup and a message after it
const clinic = () => ({
  schema_version: '1.2',
  meta: { id: 'clinic', name: 'Riverside Dental', version: '1.0.0', status: 'draft' },
  channels: [{ id: 'phone', type: 'sip_voice', greeting: { say: 'Hello, you’ve reached Riverside Dental. How can I help?' } }],
  connections: { diary: { type: 'http', base_url: 'https://diary.example.com' } },
  notifications: [{ id: 'booking_confirmed', channel: 'sms' }],
  forms: [
    {
      id: 'patient_details',
      title: 'Patient details',
      fields: [{ name: 'name', label: 'Name', type: 'text' }],
      on_submit: [
        { type: 'http', connection: 'diary', method: 'GET', path: '/slots', to_state: { slots: '$.slots' } },
        { type: 'set_state', values: { looked_up: true } },
        { type: 'notify', notification: 'booking_confirmed' },
      ],
    },
  ],
  tools: [{ id: 'end_call', type: 'builtin', builtin: 'end_call', params: { say: 'Thank you for calling Riverside Dental. Goodbye.' } }],
  agents: {
    entry: 'reception',
    items: [
      {
        id: 'reception',
        name: 'Reception',
        kind: 'router',
        instructions: { role: 'You answer the clinic’s line.', rules: ['Be warm.', 'Step 1: Find out what they need in one short question.'] },
        handoffs: [{ id: 'to_bookings', tool: 'go_to_bookings', description: 'They want an appointment.', to: 'bookings' }],
        tools: ['end_call'],
      },
      {
        id: 'bookings',
        name: 'Bookings',
        kind: 'specialist',
        instructions: { role: 'You book appointments.', rules: ['Step 1: Offer up to three of the slots, earliest first.'] },
        on_enter: [{ type: 'send_form', form: 'patient_details' }],
        tools: ['end_call'],
      },
    ],
  },
});

test('the call as lanes: greeting, steps taken every time, a form’s own steps, guided steps, where it passes callers, the ending', () => {
  const lanes = lanesOf(clinic());
  assert.deepEqual(
    lanes.map((l) => [l.name, l.first]),
    [
      ['Reception', true],
      ['Bookings', false],
    ],
  );
  assert.deepEqual(
    lanes[0].steps.map((s) => s.kind),
    ['greet', 'guided', 'decide', 'end'],
  );
  assert.deepEqual(lanes[0].steps[2].branches[0], {
    kind: 'pass',
    to: 'bookings',
    toName: 'Bookings',
    when: 'They want an appointment.',
    handoff: 0,
    missing: false,
  });
  assert.deepEqual(
    lanes[1].steps.map((s) => s.kind),
    ['form', 'guided', 'end'],
  );
  assert.deepEqual(
    lanes[1].steps[0].children.map((s) => s.kind),
    ['lookup', 'message'],
    'a form’s steps come with it; the bookkeeping step is counted, not listed',
  );
  assert.equal(lanes[1].steps[0].hiddenChildren, 1);
  assert.deepEqual(lanes[1].from, ['Reception']);
  assert.equal(countSteps(lanes), 9);
  assert.deepEqual(
    numbered(lanes).map((r) => [r.number, r.depth]),
    [
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 0],
      [6, 1],
      [7, 1],
      [8, 0],
      [9, 0],
    ],
  );
  assert.equal(isStepRule('Be warm.'), false, 'a rule not written as a step stays on Subagents');
});

test('adding, changing, moving and removing steps writes the agent’s own places; guided steps are numbered for it', () => {
  let c = clinic();
  c = addGuided(c, 'reception', 'Answer bills from the price list.');
  assert.deepEqual(c.agents.items[0].instructions.rules, [
    'Be warm.',
    'Step 1: Find out what they need in one short question.',
    'Step 2: Answer bills from the price list.',
  ]);
  c = addGuided(c, 'reception', 'Say who you are.', 0);
  assert.deepEqual(c.agents.items[0].instructions.rules.slice(1), [
    'Step 1: Say who you are.',
    'Step 2: Find out what they need in one short question.',
    'Step 3: Answer bills from the price list.',
  ]);
  const guided = lanesOf(c)[0].steps.filter((s) => s.kind === 'guided');
  c = moveStep(c, guided[2], 0);
  assert.equal(c.agents.items[0].instructions.rules[1], 'Step 1: Answer bills from the price list.');
  c = setGuided(
    c,
    lanesOf(c)[0].steps.find((s) => s.kind === 'guided'),
    'Answer bills from the 2026 price list.',
  );
  assert.equal(c.agents.items[0].instructions.rules[1], 'Step 1: Answer bills from the 2026 price list.');
  assert.equal(c.agents.items[0].instructions.rules[0], 'Be warm.', 'other rules stay as they are');

  c = insertAction(c, enterPath(c, 'reception'), 0, { type: 'say', text: 'Calls may be recorded.' });
  assert.deepEqual(c.agents.items[0].on_enter, [{ type: 'say', text: 'Calls may be recorded.' }]);
  const say = lanesOf(c)[0].steps.find((s) => s.kind === 'say');
  c = removeStep(c, say);
  assert.equal(c.agents.items[0].on_enter, undefined, 'an emptied on_enter is taken out (the schema wants one or more)');

  const bookingsForm = lanesOf(c)[1].steps[0];
  c = moveStep(c, bookingsForm.children[1], 0);
  assert.equal(c.forms[0].on_submit[0].type, 'notify', 'a form’s steps move within the form');

  c = setGoodbye(c, 'end_call', 'Bye for now.');
  assert.equal(c.tools[0].params.say, 'Bye for now.');
});

test('passing callers on, and a way back for a subagent that can’t pass them back', () => {
  let c = clinic();
  assert.deepEqual(
    strandedLanes(c).map((a) => a.id),
    ['bookings'],
  );
  c = addWayBack(c, 'bookings');
  assert.deepEqual(strandedLanes(c), []);
  assert.ok(lanesOf(c)[1].steps.some((s) => s.kind === 'decide' && s.branches.some((b) => b.kind === 'back')));
  c = addPass(c, 'bookings', 'reception', 'They ask about a bill.');
  const branches = lanesOf(c)[1].steps.find((s) => s.kind === 'decide').branches;
  assert.ok(branches.some((b) => b.kind === 'pass' && b.to === 'reception' && b.when === 'They ask about a bill.'));
});

test('problems: a removed form, a missing connection or message, a step after the call ends, a photo no way in takes', () => {
  const c = clinic();
  c.agents.items[1].on_enter = [{ type: 'send_form', form: 'gone' }, { type: 'end_call' }, { type: 'say', text: 'Too late.' }];
  c.forms[0].on_submit[0].connection = 'nowhere';
  const steps = lanesOf(c)[1].steps;
  assert.match(problemsOf(c, steps[0])[0].text, /no form “gone” any more/);
  assert.match(problemsOf(c, steps[2])[0].text, /comes after a step that ends the call/);
  c.agents.items[1].on_enter = [{ type: 'send_form', form: 'patient_details' }];
  c.forms[0].on_submit.unshift({ type: 'request_image', kind: 'upload', into: 'card' });
  const form = lanesOf(c)[1].steps[0];
  assert.match(problemsOf(c, form.children[0])[0].text, /No way in takes photos/);
  assert.match(problemsOf(c, form.children[1])[0].text, /connection “nowhere”/);
});

test('in your words: the call as lines, and lines back into steps (subagents named, forms, hand-overs, ending)', () => {
  const words = wordsOf(clinic());
  assert.match(words, /^1\. Greet them: “Hello, you’ve reached Riverside Dental\. How can I help\?”/);
  assert.match(words, /\nBookings:\n5\. Show the form Patient details\n/);
  const parsed = parseWords(
    clinic(),
    [
      '1. Find out what they need.',
      '2. If they want an appointment, pass them to Bookings. If it sounds urgent, put them through to the clinic nurse.',
      'Bookings: take their name with the patient details form.',
      '4. Offer three slots, earliest first.',
      '5. Text them the booking.',
      '6. Say goodbye: “Thanks, bye!”',
    ].join('\n'),
  );
  assert.deepEqual(
    parsed.map((p) => [p.lane, p.kind]),
    [
      ['reception', 'guided'],
      ['reception', 'pass'],
      ['reception', 'guided'],
      ['bookings', 'form'],
      ['bookings', 'guided'],
      ['bookings', 'guided'],
      ['bookings', 'end'],
    ],
  );
  assert.match(parsed[2].note, /Tools › Pass to a person/);
  assert.match(parsed[5].note, /no message to send yet|Connections › Messages/);
  const next = applyWords(clinic(), parsed);
  assert.deepEqual(next.agents.items[0].instructions.rules, [
    'Be warm.',
    'Step 1: Find out what they need.',
    'Step 2: If it sounds urgent, put them through to the clinic nurse.',
  ]);
  assert.deepEqual(next.agents.items[1].instructions.rules, ['Step 1: Offer three slots, earliest first.', 'Step 2: Text them the booking.']);
  assert.equal(next.agents.items[0].handoffs.length, 1, 'a hand-over it already has isn’t added twice');
  assert.deepEqual(next.agents.items[1].on_enter, [{ type: 'send_form', form: 'patient_details' }], 'a form step it already has isn’t added twice');
  assert.equal(next.tools.find((t) => t.id === 'end_call').params.say, 'Thanks, bye!');
});

test('a photo step declares the state variable its picture goes into (the server checks it), its own each time', async () => {
  const { insertPhoto } = await import('../src/studio/agent/detailed/stepsWorkspace/stepsModel.js');
  let c = clinic();
  c = insertPhoto(c, ['forms', 0, 'on_submit'], 0);
  c = insertPhoto(c, ['forms', 0, 'on_submit'], 1);
  assert.deepEqual(
    c.forms[0].on_submit.slice(0, 2).map((s) => [s.type, s.into]),
    [
      ['request_image', 'photo'],
      ['request_image', 'photo_2'],
    ],
  );
  assert.deepEqual(c.state.variables.photo, { type: 'string', nullable: true, default: null, description: 'The picture the caller sent (its id).' });
  assert.ok(c.state.variables.photo_2);
});

test('the call in words, turned back into steps with no change, leaves the agent exactly as it was (real agents too)', async () => {
  const { wordsOf: words, parseWords: parse, applyWords: apply } = await import('../src/studio/agent/detailed/stepsWorkspace/stepsModel.js');
  const real = (p) => JSON.parse(fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
  for (const [name, config] of [
    ['clinic', clinic()],
    ['OCBC journey', real('demos/ocbc-journey/personal-banking.config.json')],
    ['use case 1 onboarding', real('demos/unbound/use-case-1/onboarding.config.json')],
  ]) {
    const parsed = parse(config, words(config));
    assert.deepEqual(apply(config, parsed), config, name);
    assert.ok(parsed.some((p) => p.kind === 'keep') || name === 'clinic', `${name}: steps it already takes are kept as they are`);
  }
});

test('a step said for a subagent goes to that subagent, whatever its name; a hand-over is added once', async () => {
  const { parseWords: parse, addPass: pass } = await import('../src/studio/agent/detailed/stepsWorkspace/stepsModel.js');
  const c = clinic();
  c.agents.items[1].name = 'Bookings, rescheduling and cancellations for every Riverside Dental clinic';
  const [p] = parse(c, 'Offer the earliest slot first.', { lane: 'bookings' });
  assert.equal(p.lane, 'bookings');
  const twice = pass(pass(c, 'reception', 'bookings', 'Again.'), 'reception', 'bookings');
  assert.equal(twice.agents.items[0].handoffs.length, 1);
});

test('a step still holding the words it started with is a problem (callers would hear them)', async () => {
  const { SAY_START, GUIDED_START, insertAction: insert } = await import('../src/studio/agent/detailed/stepsWorkspace/stepsModel.js');
  let c = clinic();
  c = insert(c, enterPath(c, 'reception'), 0, { type: 'say', text: SAY_START });
  c = addGuided(c, 'reception', GUIDED_START.guided);
  c = insert(c, enterPath(c, 'reception'), 1, { type: 'http', connection: 'diary', method: 'GET', path: '/' });
  const steps = lanesOf(c)[0].steps;
  assert.match(
    problemsOf(
      c,
      steps.find((s) => s.kind === 'say'),
    )[0].text,
    /callers would hear that/,
  );
  assert.match(
    problemsOf(
      c,
      steps.find((s) => s.kind === 'guided' && s.text === GUIDED_START.guided),
    )[0].text,
    /doesn’t say what to do yet/,
  );
  assert.match(
    problemsOf(
      c,
      steps.find((s) => s.kind === 'lookup'),
    )[0].text,
    /doesn’t say what to look up/,
  );
});

test('a hand-over’s description reads as a condition', async () => {
  const { condition } = await import('../src/studio/agent/detailed/stepsWorkspace/stepsModel.js');
  assert.equal(condition('They want an appointment.'), 'they want an appointment');
  assert.equal(condition('Use when the caller asks for a person, or you cannot help them.'), 'the caller asks for a person, or you cannot help them');
  assert.equal(condition('Use it if the line is busy'), 'the line is busy');
  assert.equal(condition('NRIC was read'), 'NRIC was read', 'an initialism keeps its capitals');
});

test('a common call fills in guided steps and an ending on the first agent', () => {
  const c = clinic();
  c.agents.items[0].instructions.rules = [];
  c.agents.items[0].tools = [];
  const next = applyStarter(c, 'details');
  assert.equal(next.agents.items[0].instructions.rules.length, 4);
  assert.ok(next.agents.items[0].instructions.rules.every((r) => /^Step \d: /.test(r)));
  assert.ok(lanesOf(next)[0].steps.some((s) => s.kind === 'end'));
});

test('a real agent reads as steps: the OCBC journey (onboarding’s form and its many steps, hand-overs, endings)', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../demos/ocbc-journey/personal-banking.config.json', import.meta.url), 'utf8'));
  const lanes = lanesOf(config);
  assert.deepEqual(
    lanes.map((l) => l.key),
    ['front_desk', 'advisor', 'cards', 'banking', 'payments', 'onboarding'],
  );
  const onboarding = lanes.find((l) => l.key === 'onboarding');
  const form = onboarding.steps.find((s) => s.kind === 'form');
  assert.equal(form.form.id, 'application');
  assert.ok(form.children.length > 10, 'the application form’s checks show as its steps');
  assert.ok(lanes[0].steps.find((s) => s.kind === 'decide').branches.length >= 4);
  // nothing is changed by reading it
  assert.deepEqual(JSON.parse(fs.readFileSync(new URL('../demos/ocbc-journey/personal-banking.config.json', import.meta.url), 'utf8')), config);
});

test('typing a guided step keeps every character as typed, spaces too (each keystroke is saved)', () => {
  let c = clinic();
  const typed = 'Ask them which day suits ';
  for (let n = 1; n <= typed.length; n += 1) {
    const step = lanesOf(c)[0].steps.find((s) => s.kind === 'guided');
    c = setGuided(c, step, typed.slice(0, n));
  }
  assert.equal(lanesOf(c)[0].steps.find((s) => s.kind === 'guided').text, typed);
  assert.equal(c.agents.items[0].instructions.rules[1], `Step 1: ${typed}`);
  // a pasted "Step 3:" isn't written twice
  c = addGuided(c, 'reception', 'Step 3: Confirm the day.');
  assert.equal(c.agents.items[0].instructions.rules.at(-1), 'Step 2: Confirm the day.');
  // rules written as one string stay a rule
  const s = clinic();
  s.agents.items[1].instructions.rules = 'Be brief.';
  assert.deepEqual(addGuided(s, 'bookings', 'Offer a slot.').agents.items[1].instructions.rules, ['Be brief.', 'Step 1: Offer a slot.']);
});

test('lines in words: endings and greetings only when the line is about them; a said line with a condition is guided', () => {
  const c = clinic();
  const kinds = (words) => parseWords(c, words, { lane: 'reception' }).map((p) => p.kind);
  assert.deepEqual(kinds('Ask if they want anything else before you end the call.'), ['guided']);
  assert.deepEqual(kinds('Check they are happy, then say goodbye.'), ['guided']);
  assert.deepEqual(kinds('Say goodbye: “Bye for now.”'), ['end']);
  assert.deepEqual(kinds('End the call.'), ['end']);
  assert.deepEqual(kinds('Tell them we welcome new patients.'), ['guided']);
  assert.deepEqual(kinds('Say “We open at nine.” if they ask about hours.'), ['guided']);
  assert.deepEqual(kinds('Say “Calls are recorded.”'), ['say']);
});

test('a hand-over goes to the longest subagent name that fits; a name must end at a word break', () => {
  const c = clinic();
  c.agents.items.push({ id: 'bookings_help', name: 'Bookings help', instructions: { role: 'Help.' } });
  c.agents.items[0].handoffs.push({ id: 'to_help', tool: 'go_help', description: 'Help.', to: 'bookings_help' });
  const [p] = parseWords(c, 'If they are stuck, pass them to Bookings help.', { lane: 'reception' });
  assert.equal(p.to, 'Bookings help');
  const [q] = parseWords(c, 'If they want a slot, pass them to Bookings.', { lane: 'reception' });
  assert.equal(q.to, 'Bookings');
  const [r] = parseWords(c, 'If they want one, pass them to Bookingsdesk.', { lane: 'reception' });
  assert.notEqual(r.kind, 'pass');
});

test('an empty hand-over description is a problem (it can’t be saved); an empty goodbye means none', () => {
  const c = clinic();
  c.agents.items[0].handoffs[0].description = ' ';
  const decide = lanesOf(c)[0].steps.find((s) => s.kind === 'decide');
  assert.match(problemsOf(c, decide)[0].text, /Say when to pass callers to Bookings/);
  const quiet = setGoodbye(c, 'end_call', '');
  assert.equal('say' in quiet.tools[0].params, false);
  // a send_form that names no form isn't matched to a form without an id
  const f = clinic();
  f.forms.push({ title: 'No id' });
  f.agents.items[0].on_enter = [{ type: 'send_form' }];
  assert.ok(lanesOf(f)[0].steps.find((s) => s.kind === 'form').form == null);
});
