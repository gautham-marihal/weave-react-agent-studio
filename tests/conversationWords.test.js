import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addCheckIn,
  checkIns,
  countWords,
  failWords,
  interruptWords,
  quietStory,
  quietWords,
  readQuiet,
  readThen,
  readWait,
  reactWords,
  rememberWords,
  removeCheckIn,
  setAdapt,
  setQuietOn,
  setUpQuiet,
  speechText,
  setCheckInText,
  setGoodbye,
  setThen,
  setWaitChoice,
  soundWords,
  timeWords,
  waitWords,
} from '../src/studio/agent/detailed/conversationView/conversationWords.js';

// Build › Conversation in words (src/studio/agent/detailed/conversationView/conversationWords.js): what the overview
// says, and the writes of its own editors, against the schema and agent-config-guide 1 (3.10, 3.25).
const withQuiet = (inactivity) => ({ defaults: { conversation: { inactivity } } });
const turns = (turn_handling) => ({ defaults: { conversation: { turn_handling } } });

test('times and counts are said as people say them', () => {
  assert.equal(timeWords(150), '2½ minutes');
  assert.equal(timeWords(60), '1 minute');
  assert.equal(timeWords(600), '10 minutes');
  assert.equal(timeWords(45), '45 seconds');
  assert.equal(timeWords(1), '1 second');
  assert.deepEqual([1, 2, 3].map(countWords), ['once', 'twice', '3 times']);
});

test('how long it waits: Quick and Patient fill in both limits, The usual leaves them unset, anything else is its own', () => {
  assert.equal(readWait({}).choice, 'usual');
  const quick = setWaitChoice({}, 'quick');
  assert.deepEqual(quick.defaults.conversation.turn_handling.endpointing, { min_delay: 0.3, max_delay: 1.5 });
  assert.equal(readWait(quick).choice, 'quick');
  assert.equal(readWait(setWaitChoice(quick, 'patient')).choice, 'patient');
  const usual = setWaitChoice(quick, 'usual');
  assert.equal(usual.defaults.conversation.turn_handling.endpointing.min_delay, undefined, 'the limits go');
  assert.equal(readWait(usual).choice, 'usual');
  const own = turns({ endpointing: { min_delay: 0.5, max_delay: 3 } });
  assert.deepEqual(waitWords(own), { name: 'Your own', span: '0.5 to 3 seconds', adapt: false, choice: 'own' });
  // adapting is the dynamic mode; switching it off goes back to the usual way, and a fixed mode stays fixed
  const adapt = setAdapt({}, true);
  assert.equal(adapt.defaults.conversation.turn_handling.endpointing.mode, 'dynamic');
  assert.equal(setAdapt(adapt, false).defaults.conversation.turn_handling.endpointing.mode, undefined);
  const fixed = turns({ endpointing: { mode: 'fixed' } });
  assert.equal(setAdapt(fixed, false), fixed);
});

test('cutting in: on unless switched off, with what counts said only when set', () => {
  assert.deepEqual(interruptWords({}), { name: 'Callers can cut in', detail: 'the usual rules for what counts' });
  assert.deepEqual(interruptWords(turns({ interruption: { min_duration: 0.5, min_words: 2 } })), {
    name: 'Callers can cut in',
    detail: 'after 0.5 s of speech and 2 words',
  });
  assert.equal(interruptWords(turns({ interruption: { enabled: false } })).name, 'Callers can’t cut in');
});

test('a quiet caller: check-ins as they happen, the last line repeating, and what comes then', () => {
  const config = withQuiet({
    enabled: true,
    timeout_s: 150,
    max_nudges: 3,
    nudges: [{ type: 'say', text: 'Still there?' }],
    on_exhausted: { do: [{ type: 'end_call', say: 'Bye.' }] },
  });
  const steps = checkIns(config);
  assert.equal(steps.length, 3);
  assert.deepEqual(
    steps.map((s) => [s.own, s.repeats, s.text]),
    [
      [true, false, 'Still there?'],
      [false, true, 'Still there?'],
      [false, true, 'Still there?'],
    ],
    'the guide: nudge n uses nudges[n-1], and the last one repeats',
  );
  assert.deepEqual(quietWords(config), {
    state: 'on',
    checks: '3 times, 2½ minutes apart',
    then: 'says goodbye and ends the call',
    line: '3 times, 2½ min apart · then says goodbye and ends the call',
  });
  assert.equal(
    quietStory(config),
    'A caller who stays silent hears a check-in at 2½ minutes, 5 minutes and 7½ minutes, and the call ends at 10 minutes. Anything they do starts the count again.',
  );
  assert.equal(quietWords(withQuiet({ enabled: false })).state, 'off');
  assert.equal(quietWords({}).state, 'unset', 'not set: nothing made up');
  assert.equal(quietWords(withQuiet({ timeout_s: 600, max_nudges: 1, on_exhausted: { do: [] } }), false).checks, 'once, after 10 minutes');
});

test('the script’s writes: add, remove, its own words for a repeated line, and then', () => {
  const start = withQuiet({ enabled: true, timeout_s: 30, max_nudges: 1, nudges: [{ type: 'say', text: 'Hello?' }] });
  const more = addCheckIn(start);
  assert.equal(readQuiet(more).count, 2);
  assert.equal(readQuiet(more).lines.length, 2, 'a new check-in gets its own line');
  assert.equal(readQuiet(removeCheckIn(more, 0)).lines[0].text, readQuiet(more).lines[1].text, 'removing one keeps the others in order');
  // adding after check-ins that repeat the last line: they keep saying it, and the new one has words of its own
  const repeating = addCheckIn(withQuiet({ timeout_s: 30, max_nudges: 2, nudges: [{ type: 'say', text: 'Hello?' }] }));
  assert.deepEqual(
    readQuiet(repeating).lines.map((l) => l.text),
    ['Hello?', 'Hello?', 'I haven’t heard from you for a while. I’ll close this conversation soon if there is no reply.'],
  );
  // a repeated line gets its own words; the earlier lines stay as they were
  const repeated = withQuiet({ timeout_s: 30, max_nudges: 3, nudges: [{ type: 'say', text: 'Hello?' }] });
  const own = setCheckInText(repeated, 2, 'Last call.');
  assert.deepEqual(
    readQuiet(own).lines.map((l) => l.text),
    ['Hello?', 'Hello?', 'Last call.'],
  );
  // then: end the call with a goodbye, pass to a person, nothing more
  const end = setThen(start, 'end', { goodbye: 'Goodbye.' });
  assert.deepEqual(end.defaults.conversation.inactivity.on_exhausted, { do: [{ type: 'end_call', say: 'Goodbye.' }] });
  assert.equal(readThen(setGoodbye(end, 'Bye now.').defaults.conversation.inactivity.on_exhausted).goodbye.text, 'Bye now.');
  assert.deepEqual(setThen(start, 'person', { transfer: 'desk' }).defaults.conversation.inactivity.on_exhausted, {
    do: [{ type: 'transfer', transfer: 'desk' }],
  });
  assert.deepEqual(setThen(start, 'nothing').defaults.conversation.inactivity.on_exhausted, { do: [] });
  // a "say, then end" pair is read as ending the call, and its goodbye is the say's words (which must stay)
  const pair = { do: [{ type: 'say', text: 'Goodbye.' }, { type: 'end_call' }] };
  assert.deepEqual(readThen(pair), { kind: 'end', goodbye: { text: 'Goodbye.', plain: true }, at: 0, field: 'text' });
  assert.equal(setGoodbye(withQuiet({ on_exhausted: pair }), '').defaults.conversation.inactivity.on_exhausted.do[0].text, '');
  assert.deepEqual(readThen({ do: [{ type: 'say', text: 'a' }, { type: 'log', message: 'b' }, { type: 'end_call' }] }), { kind: 'own', count: 3 });
});

test('behind the scenes, in words', () => {
  assert.deepEqual(failWords({}), { name: 'Closes after 3 failures in a row', usual: true, detail: 'each service retries first' });
  const failing = {
    defaults: {
      reliability: {
        max_unrecoverable_errors: 2,
        on_session_error: {
          do: [
            { type: 'play_sound', sound: 'x' },
            { type: 'log', message: 'y' },
          ],
        },
      },
    },
  };
  assert.deepEqual(failWords(failing), { name: 'Closes after 2 failures in a row', usual: false, detail: 'first it plays a recording and writes to the log' });
  const vars = { state: { variables: { first_name: { type: 'string' }, pin: { type: 'string', sensitive: true } } } };
  assert.deepEqual(rememberWords(vars), { count: 2, secret: 1, first: ['first name', 'pin'] });
  assert.deepEqual(reactWords({ events: [{ on: 'call_started' }, { on: 'state_changed' }, { on: 'call_started' }] }), {
    count: 3,
    names: ['A call starts', 'A detail changes'],
  });
  const sounds = soundWords({
    defaults: {
      conversation: { speech: { pronunciation: [{ type: 'currency' }, { type: 'date' }, { type: 'spell' }] }, noise_cancellation: { enabled: true } },
    },
  });
  assert.deepEqual([sounds.rules, sounds.ruleNames, sounds.noise, sounds.menus, sounds.thinking], [3, 'Money, Dates and 1 more', true, false, false]);
});

test('a new agent: no check-ins set up is said plainly, and set up in one click with words that can be changed in place', () => {
  assert.deepEqual(quietWords({}), { state: 'unset', checks: '', then: '', line: 'Not set up · it waits as long as it takes' });
  const call = setUpQuiet({}, true);
  assert.equal(quietWords(call).line, 'Twice, 12 seconds apart · then says goodbye and ends the call');
  assert.ok(
    checkIns(call).every((c) => c.plain && c.text),
    'each check-in has words, edited in place',
  );
  assert.equal(readQuiet(setUpQuiet({}, false)).timeout, 120, 'a chat waits longer');
  // the switch: on with nothing set up sets it up; off and on again keeps what was written
  assert.equal(readQuiet(setQuietOn({}, true, true)).count, 2);
  const off = setQuietOn(call, false, true);
  assert.equal(readQuiet(off).state, 'off');
  assert.deepEqual(readQuiet(setQuietOn(off, true, true)).lines, readQuiet(call).lines);
  // a clock already chosen stays
  assert.equal(readQuiet(setUpQuiet(withQuiet({ clock: 'silence' }), true)).clock, 'silence');
});

test('a fixed line is read through to its words (the starters write their check-ins as fixed lines)', () => {
  const config = {
    messages: [
      { id: 'still_there', text: 'Are you still there?' },
      { id: 'bye', text: { en: 'Goodbye.', es: 'Adiós.' } },
    ],
    defaults: {
      conversation: {
        inactivity: {
          enabled: true,
          timeout_s: 10,
          max_nudges: 1,
          nudges: [{ type: 'say', text: { message: 'still_there' } }],
          on_exhausted: { do: [{ type: 'end_call', say: { message: 'bye' } }] },
        },
      },
    },
  };
  assert.deepEqual(speechText({ message: 'still_there' }, config), {
    text: 'Are you still there?',
    plain: false,
    message: 'still_there',
    what: 'a fixed line',
  });
  assert.equal(checkIns(config)[0].text, 'Are you still there?');
  assert.equal(readQuiet(config).then.goodbye.text, 'Goodbye.', 'a line in several languages reads as its first');
  // words of its own replace the fixed line for this check-in only
  assert.deepEqual(readQuiet(setCheckInText(config, 0, 'Hello?')).lines[0], { type: 'say', text: 'Hello?' });
});
