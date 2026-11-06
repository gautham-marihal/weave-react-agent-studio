// Build › Conversation in plain words, and the few writes its own editors make (how long it waits, the script for a
// quiet caller, the retries per service). Pure: no React, no DOM, so the tests run it in Node.
//
// Facts it relies on (agent-config-guide 1, 3.10 and 3.25; the schema's own descriptions):
// - inactivity: a check-in every `timeout_s`, `max_nudges` times (check-in n says nudges[n-1]; the last line repeats),
//   then `on_exhausted` one wait later; anything the caller does starts the count again; a goodbye is played in full.
// - reliability: each service retries 3 times, 2 s apart, with a 10 s timeout, unless set; after
//   `max_unrecoverable_errors` (3) failures in a row the call closes, and `on_session_error` can only play a recording,
//   call a web address or write to the log (speech can't finish then).

import { getAtPath } from '../../schemaPath.js';
import { setPath } from '../schemaFacts.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const C = ['defaults', 'conversation'];
export const TURNS = [...C, 'turn_handling'];
export const ENDPOINTING = [...TURNS, 'endpointing'];
export const INTERRUPTION = [...TURNS, 'interruption'];
export const QUIET = [...C, 'inactivity'];
export const R = ['defaults', 'reliability'];

// ---- words --------------------------------------------------------------------------------------------------------

// 150 → "2½ minutes", 60 → "1 minute", 600 → "10 minutes", 45 → "45 seconds"
export function timeWords(seconds) {
  const s = num(seconds);
  if (s === null || s < 0) return '';
  if (s >= 60 && s % 60 === 0) return `${s / 60} minute${s === 60 ? '' : 's'}`;
  if (s >= 90 && s % 30 === 0) return `${Math.floor(s / 60)}½ minutes`;
  return `${s} second${s === 1 ? '' : 's'}`;
}
// 1 → "once", 2 → "twice", 3 → "3 times"
export const countWords = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
// 492 → "8:12"
export const clockText = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
const together = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

// What a line says. Plain text in one language is edited in place (plain); a fixed line (`{ message: id }`, from
// Agent › Fixed lines) is read through to its words and changed there (message: its id), or replaced here by words of
// its own; a line in several languages is left to the form.
const firstText = (v) => (typeof v === 'string' ? v : isObj(v) ? Object.values(v).find((x) => typeof x === 'string') || '' : '');
export function speechText(speech, config) {
  if (typeof speech === 'string') return { text: speech, plain: true };
  if (isObj(speech) && typeof speech.message === 'string') {
    const line = list(config?.messages).find((m) => isObj(m) && m.id === speech.message);
    return { text: firstText(line?.text), plain: false, message: speech.message, what: 'a fixed line' };
  }
  if (isObj(speech)) return { text: firstText(speech), plain: false, what: 'a line in several languages' };
  return { text: '', plain: true };
}

// ---- how long it waits ----------------------------------------------------------------------------------------------

// Quick and Patient fill in the two limits; The usual leaves both unset (the engine's own timing).
export const WAIT_CHOICES = [
  { id: 'quick', name: 'Quick', min: 0.3, max: 1.5, what: 'Snappy. May answer over someone who is still thinking.' },
  { id: 'usual', name: 'The usual', what: 'Nothing set. Right for most calls.' },
  { id: 'patient', name: 'Patient', min: 1, max: 6, what: 'Lets people think aloud. Feels slower.' },
];
export function readWait(config) {
  const e = getAtPath(config, ENDPOINTING);
  const min = num(e?.min_delay);
  const max = num(e?.max_delay);
  const adapt = e?.mode === 'dynamic';
  const preset = WAIT_CHOICES.find((c) => (c.id === 'usual' ? min === null && max === null : c.min === min && c.max === max));
  return { choice: preset ? preset.id : 'own', min, max, adapt };
}
export function setWaitChoice(config, id) {
  const choice = WAIT_CHOICES.find((c) => c.id === id);
  if (!choice) return config;
  let next = setPath(config, [...ENDPOINTING, 'min_delay'], choice.min);
  next = setPath(next, [...ENDPOINTING, 'max_delay'], choice.max);
  return next;
}
// on: the pause adapts to each caller (dynamic); off: back to the usual way (an explicit "fixed" stays fixed)
export function setAdapt(config, on) {
  const mode = getAtPath(config, [...ENDPOINTING, 'mode']);
  if (on) return setPath(config, [...ENDPOINTING, 'mode'], 'dynamic');
  return mode === 'dynamic' ? setPath(config, [...ENDPOINTING, 'mode'], undefined) : config;
}
export function waitWords(config) {
  const w = readWait(config);
  const preset = WAIT_CHOICES.find((c) => c.id === w.choice);
  const name = preset ? preset.name : 'Your own';
  const span =
    w.choice === 'usual'
      ? 'the engine’s own timing'
      : w.min !== null && w.max !== null
        ? `${w.min} to ${w.max} seconds`
        : w.min !== null
          ? `at least ${w.min} seconds`
          : `at most ${w.max} seconds`;
  return { name, span, adapt: w.adapt, choice: w.choice };
}

// ---- cutting in ----------------------------------------------------------------------------------------------------

export function readInterrupt(config) {
  const i = getAtPath(config, INTERRUPTION);
  return {
    on: i?.enabled !== false,
    seconds: num(i?.min_duration),
    words: num(i?.min_words),
    resume: i?.resume_false_interruption,
    smarter: i?.mode === 'adaptive',
  };
}
export function interruptWords(config) {
  const i = readInterrupt(config);
  if (!i.on) return { name: 'Callers can’t cut in', detail: 'it always finishes what it is saying' };
  const after = [i.seconds !== null && `${i.seconds} s of speech`, i.words && `${i.words} ${i.words === 1 ? 'word' : 'words'}`].filter(Boolean);
  return { name: 'Callers can cut in', detail: after.length ? `after ${together(after)}` : 'the usual rules for what counts' };
}

// ---- a quiet caller -------------------------------------------------------------------------------------------------

// What happens when the check-ins run out: end the call (with a goodbye), pass to a person, nothing more, or steps of
// its own that only the form can show.
export function readThen(onExhausted, config) {
  if (!isObj(onExhausted)) return { kind: 'unset' };
  const steps = list(onExhausted.do).filter(isObj);
  if (!steps.length) return { kind: 'nothing' };
  const [a, b] = steps;
  if (steps.length === 1 && a.type === 'end_call') return { kind: 'end', goodbye: speechText(a.say, config), at: 0, field: 'say' };
  if (steps.length === 2 && a.type === 'say' && b.type === 'end_call' && b.say === undefined)
    return { kind: 'end', goodbye: speechText(a.text, config), at: 0, field: 'text' };
  if (steps.length === 1 && a.type === 'transfer') return { kind: 'person', transfer: typeof a.transfer === 'string' ? a.transfer : '' };
  return { kind: 'own', count: steps.length };
}

export function readQuiet(config) {
  const q = getAtPath(config, QUIET);
  const lines = list(q?.nudges);
  const count = Number.isInteger(q?.max_nudges) && q.max_nudges >= 0 ? q.max_nudges : lines.length;
  return {
    state: !isObj(q) ? 'unset' : q.enabled === false ? 'off' : 'on',
    timeout: num(q?.timeout_s),
    count,
    lines,
    clock: typeof q?.clock === 'string' ? q.clock : 'auto',
    then: readThen(q?.on_exhausted, config),
  };
}

// The check-ins as they will happen: check-in n says nudges[n-1], and the last line repeats.
export function checkIns(config) {
  const q = readQuiet(config);
  return Array.from({ length: q.count }, (_, i) => {
    const own = i < q.lines.length;
    const step = own ? q.lines[i] : q.lines.at(-1);
    const said =
      isObj(step) && step.type === 'say'
        ? speechText(step.text, config)
        : {
            text: isObj(step) && typeof step.instructions === 'string' ? step.instructions : '',
            plain: false,
            what: isObj(step) ? 'words it makes up itself' : '',
          };
    return { at: i, own, repeats: !own && q.lines.length > 0, ...said };
  });
}

const thenWords = (then, call) =>
  ({
    end: call ? 'says goodbye and ends the call' : 'says goodbye and closes the chat',
    person: 'passes them to a person',
    nothing: 'waits as long as it takes',
    own: `runs ${then.count} steps of its own`,
    unset: 'does nothing more',
  })[then.kind];

// "twice, 2½ minutes apart" · "says goodbye and ends the call"; call: a voice conversation (else a chat)
export function quietWords(config, call = true) {
  const q = readQuiet(config);
  if (q.state === 'off') return { state: 'off', checks: '', then: '', line: 'Off: it waits as long as it takes' };
  if (q.state === 'unset') return { state: 'unset', checks: '', then: '', line: 'Not set up · it waits as long as it takes' };
  const apart = q.timeout ? timeWords(q.timeout) : '';
  // one check-in is "once, after 10 minutes"; more are "twice, 2½ minutes apart"
  const gap = (words) => (!words ? '' : q.count === 1 ? `, after ${words}` : `, ${words} apart`);
  const checks = q.count ? `${countWords(q.count)}${gap(apart)}` : '';
  const then = thenWords(q.then, call);
  const short = q.count ? `${countWords(q.count).replace(/^./, (c) => c.toUpperCase())}${gap(apart.replace(' minutes', ' min'))}` : 'No check-ins';
  return { state: 'on', checks, then, line: `${short} · then ${then}` };
}

// "A caller who stays silent hears a check-in at 2½ and at 5 minutes, and the call ends at 7½ minutes."
export function quietStory(config, call = true) {
  const q = readQuiet(config);
  if (q.state !== 'on' || !q.timeout) return '';
  const who = call ? 'A caller who stays silent' : 'Someone who stops replying';
  const at = Array.from({ length: q.count }, (_, i) => timeWords(q.timeout * (i + 1)));
  const end = timeWords(q.timeout * (q.count + 1));
  const ends = q.then.kind === 'end' ? `the ${call ? 'call' : 'chat'} ends at ${end}` : `“then” runs at ${end}`;
  const heard = at.length ? `${call ? 'hears' : 'gets'} a check-in at ${together(at)}, and ` : 'gets no check-in, and ';
  return `${who} ${heard}${ends}. Anything they do starts the count again.`;
}

const say = (text) => ({ type: 'say', text });

// The check-ins a new agent can start from, in one click: two, then a goodbye (the starters' own lines, written as
// words of its own so the script edits them in place). A call checks in after 12 seconds of quiet (the guide's
// example); a chat waits 2 minutes from the last message (its chat example).
export const QUIET_SETUP = (call) => ({
  enabled: true,
  timeout_s: call ? 12 : 120,
  max_nudges: 2,
  nudges: [say('Are you still there?'), say('I’m still here whenever you’re ready. Is there anything else I can help with?')],
  on_exhausted: { do: [{ type: 'end_call', say: 'I haven’t heard from you, so I’ll end the conversation now. Please get in touch again any time.' }] },
});
// sets it up, keeping anything already chosen (a clock, say)
export const setUpQuiet = (config, call) => setPath(config, QUIET, { ...(getAtPath(config, QUIET) || {}), ...QUIET_SETUP(call) });
// switching check-ins on with nothing set up yet (no wait, no lines) sets them up; otherwise it only turns them on or off
export function setQuietOn(config, on, call) {
  const q = readQuiet(config);
  const empty = q.state === 'unset' || (!q.timeout && !q.lines.length);
  return on && empty ? setUpQuiet(config, call) : setPath(config, [...QUIET, 'enabled'], on);
}
const DEFAULT_LINES = ['Are you still there? Take your time.', 'I haven’t heard from you for a while. I’ll close this conversation soon if there is no reply.'];

// a script started from nothing (a new agent) is switched on by the first thing written into it
const started = (config) => (readQuiet(config).state === 'unset' ? setPath(config, [...QUIET, 'enabled'], true) : config);

export const setQuietTimeout = (config, seconds) => setPath(started(config), [...QUIET, 'timeout_s'], seconds === null ? undefined : seconds);

export function addCheckIn(original) {
  const config = started(original);
  const q = readQuiet(config);
  // the check-ins that repeat the last line keep saying it; the new one gets words of its own
  const lines = [...q.lines];
  while (lines.length && lines.length < q.count) lines.push(structuredClone(lines.at(-1)));
  if (lines.length <= q.count) lines.push(say(DEFAULT_LINES[Math.min(lines.length, DEFAULT_LINES.length - 1)]));
  return setPath(setPath(config, [...QUIET, 'nudges'], lines), [...QUIET, 'max_nudges'], q.count + 1);
}
export function removeCheckIn(config, at) {
  const q = readQuiet(config);
  const lines = q.lines.filter((_, i) => i !== at);
  return setPath(setPath(config, [...QUIET, 'nudges'], lines), [...QUIET, 'max_nudges'], Math.max(0, q.count - 1));
}
// the words of check-in `at`; one that repeats the last line gets its own (the lines before it stay as they are said)
export function setCheckInText(config, at, text) {
  const q = readQuiet(config);
  const lines = [...q.lines];
  while (lines.length <= at) lines.push(lines.length ? structuredClone(lines.at(-1)) : say(''));
  lines[at] = isObj(lines[at]) && lines[at].type === 'say' ? { ...lines[at], text } : say(text);
  return setPath(config, [...QUIET, 'nudges'], lines);
}

// kind: 'end' | 'person' | 'nothing'; a goodbye that was written stays when switching back to ending the call
export function setThen(config, kind, { transfer = '', goodbye = '' } = {}) {
  const steps = kind === 'end' ? [{ type: 'end_call', ...(goodbye ? { say: goodbye } : {}) }] : kind === 'person' ? [{ type: 'transfer', transfer }] : [];
  return setPath(started(config), [...QUIET, 'on_exhausted'], { do: steps });
}
export function setGoodbye(config, text) {
  const then = readThen(getAtPath(config, [...QUIET, 'on_exhausted']), config);
  if (then.kind !== 'end') return config;
  // a goodbye on the ending step may be left out; a "say" step must keep its words, even empty ones
  return setPath(config, [...QUIET, 'on_exhausted', 'do', then.at, then.field], then.field === 'text' ? text : text || undefined);
}
// the transfers a quiet caller can be passed to ({ id, name })
export const transfersOf = (config) =>
  list(config?.telephony?.transfers)
    .filter((t) => isObj(t) && typeof t.id === 'string')
    .map((t) => ({ id: t.id, name: typeof t.name === 'string' && t.name ? t.name : t.id }));

// ---- when a service fails -------------------------------------------------------------------------------------------

export const SERVICES = [
  ['stt', 'Hearing'],
  ['llm', 'Thinking'],
  ['tts', 'Speaking'],
];
// the usual of each retry setting (the SDK's defaults, as the schema states them)
export const RETRY_FIELDS = [
  { field: 'max_retry', label: 'Tries again', usual: 3, unit: 'times', integer: true },
  { field: 'retry_interval_s', label: 'Gap between tries', usual: 2, unit: 's' },
  { field: 'timeout_s', label: 'Gives up after', usual: 10, unit: 's' },
];
export const retryPath = (stage, field) => [...R, 'connection', stage, field];

const CLOSE_STEPS = { play_sound: 'plays a recording', http: 'calls a web address', log: 'writes to the log' };
export function failWords(config) {
  const n = num(getAtPath(config, [...R, 'max_unrecoverable_errors']));
  const steps = list(getAtPath(config, [...R, 'on_session_error', 'do'])).filter(isObj);
  const close = together([...new Set(steps.map((s) => CLOSE_STEPS[s.type] || 'runs a step'))]);
  return {
    name: `Closes after ${n ?? 3} failures in a row`,
    usual: n === null,
    detail: close ? `first it ${close}` : 'each service retries first',
  };
}

// ---- what it remembers, what it reacts to ---------------------------------------------------------------------------

export function rememberWords(config) {
  const vars = isObj(config?.state?.variables) ? config.state.variables : {};
  const names = Object.keys(vars);
  return {
    count: names.length,
    secret: names.filter((n) => isObj(vars[n]) && vars[n].sensitive).length,
    first: names.slice(0, 4).map((n) => n.replace(/_/g, ' ')),
  };
}

export const EVENT_WORDS = {
  call_started: 'A call starts',
  call_ended: 'A call ends',
  handoff: 'It hands over to a subagent',
  tool_error: 'A tool fails',
  session_error: 'The session fails',
  escalation: 'It escalates to a person',
  inactivity: 'Someone goes quiet',
  transfer_succeeded: 'A transfer works',
  transfer_failed: 'A transfer fails',
  state_changed: 'A detail changes',
  guardrail_triggered: 'A safety rule matches',
  limit_reached: 'A call limit is reached',
};
export const eventName = (on) => EVENT_WORDS[on] || String(on || 'Something happens').replace(/_/g, ' ');
export function reactWords(config) {
  const events = list(config?.events).filter(isObj);
  const names = [...new Set(events.map((e) => eventName(e.on)))];
  return { count: events.length, names };
}

// ---- how it sounds --------------------------------------------------------------------------------------------------

const RULE_NAMES = {
  currency: 'Money',
  spell: 'Spell out',
  digits: 'Long numbers',
  time: 'Times',
  date: 'Dates',
  replace: 'Find and replace',
  dictionary: 'A word list',
};
export const ruleName = (type) => RULE_NAMES[type] || 'A rule';
export function soundWords(config) {
  const rules = list(getAtPath(config, [...C, 'speech', 'pronunciation'])).filter(isObj);
  const kinds = [...new Set(rules.map((r) => ruleName(r.type || r.kind)))];
  const all = getAtPath(config, [...C, 'speech', 'apply_to']) === 'all';
  const thinking = getAtPath(config, [...C, 'sounds', 'thinking']);
  const noise = getAtPath(config, [...C, 'noise_cancellation']);
  return {
    rules: rules.length,
    ruleNames: kinds.length > 2 ? `${kinds.slice(0, 2).join(', ')} and ${kinds.length - 2} more` : together(kinds),
    forAll: all,
    thinking: isObj(thinking) && thinking.enabled !== false && list(thinking.clips).length > 0,
    noise: noise === true || (isObj(noise) && noise.enabled === true),
    menus: getAtPath(config, [...C, 'ivr_detection']) === true,
  };
}
