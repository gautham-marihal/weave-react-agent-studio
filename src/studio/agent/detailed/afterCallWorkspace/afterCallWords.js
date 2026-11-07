// Build › After the call in plain words, for any agent: what it writes once a call ends (a summary, answers to
// questions), how a call closes, what it keeps and for how long, and what it hides, each with what really happens to it.
// Pure: no React, no DOM, so the tests run it.
//
// From the schema and agent config guide 2 (§3.23 wrap-ups, §3.26 post_call and observability): the log of each call is
// on unless switched off, and kept until deleted unless a number of days is set (or the server's own setting deletes old
// ones); files when it ends are written whatever the reason it ended; hiding replaces what is found in everything kept
// or sent, never in what the agent hears during the call; the exact values of secret variables are hidden even with no
// hiding set up. The server keeps but does not do yet: summaries, questions, and keeping the audio and the transcript;
// its own report says so (`unsupported`), and before it has answered the guide's list stands in.

import { ANSWER_KINDS, SENSITIVE, afterCallOf, closingStarted, notDoneYet } from '../../blocks/afterCallModel.js';
import { humanize } from '../../rowNames.js';
import { lineOf } from '../../../form/speechLine.js';

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');
const clip = (t, n = 60) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
export const together = (words, last = 'and') => (words.length > 1 ? `${words.slice(0, -1).join(', ')} ${last} ${words.at(-1)}` : words[0] || '');
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const days = (n) => plural(n, 'day');

// What the server keeps but does not do: from its report when it has answered, else the guide's list.
// { summary, questions, recording }
export function notRunOf(config, unsupported) {
  if (Array.isArray(unsupported)) {
    const says = notDoneYet(unsupported);
    return { summary: says.summary, questions: says.questions, recording: says.recording };
  }
  const a = afterCallOf(config);
  return { summary: a.summary.on === true, questions: a.questions.length > 0, recording: a.recording.audio === true || a.recording.transcript === true };
}

// ---- what it writes ------------------------------------------------------------------------------------------------
const KIND_WORDS = Object.fromEntries(ANSWER_KINDS);
// a question in words: the kind of answer, and the answers it picks from; what it plainly lacks
export function questionsIn(config) {
  return afterCallOf(config).questions.map((q) => {
    const kind = KIND_WORDS[q.type] || 'No kind of answer yet';
    const answers = q.type === 'enum' ? q.values : [];
    const gap = !q.question.trim()
      ? 'No words yet: say what it should ask'
      : !q.type
        ? 'No kind of answer chosen'
        : q.type === 'enum' && !answers.length
          ? 'One of a list, with no answers to pick from'
          : '';
    return {
      ...q,
      key: String(q.index),
      name: q.question.trim() || `Question ${q.index + 1}`,
      kind,
      answers,
      words: q.type === 'enum' && answers.length ? `One of ${plural(answers.length, 'answer')}` : kind,
      more: answers.length ? clip(answers.join(', ').toLowerCase(), 48) : '',
      gap,
    };
  });
}

// ---- closing a call ------------------------------------------------------------------------------------------------
// a line's words, a fixed line's too
const speech = (v, config) => lineOf(config, v).text;
// what one step does, as a verb ("says goodbye", "hangs up")
export function stepWords(step, config) {
  if (!isObj(step)) return '';
  const name = (id, items) => list(items).find((x) => isObj(x) && x.id === id)?.name || humanize(String(id || ''));
  switch (step.type) {
    case 'say':
      return speech(step.text, config) ? `says “${clip(speech(step.text, config), 40)}”` : 'says a line';
    case 'generate':
      return 'says something it writes';
    case 'end_call':
      return speech(step.say, config) ? `says “${clip(speech(step.say, config), 40)}” and hangs up` : 'hangs up';
    case 'transfer':
      return 'passes the call on';
    case 'handoff':
      return `hands over to ${name(step.to, config?.agents?.items) || 'another agent'}`;
    case 'return_to_entry':
      return 'goes back to the first agent';
    case 'notify':
      return 'sends a notification';
    case 'send_form':
      return 'sends a form';
    case 'http':
      return `calls ${step.connection || 'one of your systems'}`;
    case 'set_state':
      return 'remembers a value';
    case 'play_sound':
      return 'plays a sound';
    case 'log':
      return 'writes a line in the log';
    default:
      return humanize(String(step.type || 'a step')).toLowerCase();
  }
}
// the first closing wait: how long, what then, and whether anything starts it
export function closingOf(config) {
  const at = list(config?.wrapups).findIndex(isObj);
  if (at < 0) return null;
  const w = config.wrapups[at];
  const steps = list(w.on_silence).filter(isObj);
  const then = together(steps.map((s) => stepWords(s, config)).filter(Boolean));
  const wait = Number(w.wait_s);
  return {
    index: at,
    id: str(w.id),
    wait: Number.isFinite(wait) && wait > 0 ? wait : null,
    waitWords: Number.isFinite(wait) && wait > 0 ? plural(wait, 'second') : 'no wait set',
    then: then || 'does nothing',
    started: !!w.id && closingStarted(config, w.id),
    many: list(config?.wrapups).filter(isObj).length,
  };
}

// ---- what it keeps -------------------------------------------------------------------------------------------------
const FILE_KIND = { transcript: 'The transcript', metrics: 'The call’s numbers' };
// the files written when a call ends, each in words
export function filesIn(config) {
  return list(config?.post_call?.artifacts)
    .map((f, index) => ({ f, index }))
    .filter(({ f }) => isObj(f))
    .map(({ f, index }) => {
      const sink = isObj(f.sink) ? f.sink : {};
      const what = FILE_KIND[f.kind] || 'A file';
      const where =
        sink.type === 'file'
          ? sink.directory
            ? `to the folder ${sink.directory}`
            : 'to a folder not named yet'
          : sink.type === 'http'
            ? `sent to ${sink.connection || 'a connection not chosen yet'}${sink.path ? ` (${sink.method || 'POST'} ${sink.path})` : ''}`
            : 'nowhere chosen yet';
      return { index, what, where, on: f.enabled !== false, short: `${what.toLowerCase()} ${where.replace(/ \(.*\)$/, '')}` };
    });
}
export function keepsOf(config) {
  const a = afterCallOf(config);
  const log = isObj(config?.observability?.session_log) ? config.observability.session_log : {};
  const logDays = Number(log.retention_days);
  return {
    log: log.enabled !== false,
    logDays: Number.isFinite(logDays) && logDays > 0 ? logDays : null,
    full: log.detail === 'full',
    audio: a.recording.audio === true,
    transcript: a.recording.transcript === true,
    days: a.recording.days,
    files: filesIn(config),
    notice: a.notice.trim(),
  };
}

// ---- what it hides -------------------------------------------------------------------------------------------------
const LABELS = Object.fromEntries(SENSITIVE);
// "Card numbers" reads "card numbers" in a sentence; "PINs" stays as it is
const lower = (label) => (/^[A-Z][A-Z]/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1));
export function hidesOf(config) {
  const r = isObj(config?.post_call?.redaction) ? config.post_call.redaction : null;
  const on = afterCallOf(config).redaction.on;
  const entities = on ? list(r?.entities).filter((e) => typeof e === 'string') : [];
  const patterns = on ? list(r?.patterns).filter((p) => typeof p === 'string' && p.trim()) : [];
  return {
    on,
    entities,
    labels: entities.map((e) => LABELS[e] || humanize(e)),
    patterns,
    replacement: str(r?.replacement) || '[REDACTED]',
    // with no hiding at all, the exact values of secret variables are still hidden
    secrets: r?.mask_sensitive_state !== false,
    gap: on && !entities.length && !patterns.length ? 'Hiding is on, but nothing is chosen to look for' : '',
  };
}
// the kinds it hides, as a phrase ("card numbers and PINs")
export const hiddenWords = (h) =>
  together([
    ...h.labels.map(lower),
    ...(h.patterns.length ? [h.patterns.length === 1 ? 'one pattern of your own' : `${h.patterns.length} patterns of your own`] : []),
  ]);

// a line a caller might say with what it hides in it, for the picture: [text, hidden?] pieces
const SAMPLES = {
  card_number: ['my card is ', '4111 1111 1111 1111'],
  pin: ['my PIN is ', '4821'],
  bank_account: ['my account is ', '0123 456 789'],
  national_id: ['my ID number is ', 'S1234567D'],
  phone_number: ['call me on ', '+65 9123 4567'],
  email: ['my email is ', 'sam@example.com'],
  date_of_birth: ['I was born on ', '4 May 1990'],
  otp: ['the code is ', '583 201'],
};
export function sampleLine(h) {
  const two = h.entities.filter((e) => SAMPLES[e]).slice(0, 2);
  if (!two.length) return null;
  const pieces = [];
  two.forEach((e, i) => {
    const [lead] = SAMPLES[e];
    pieces.push([i === 0 ? `${lead.charAt(0).toUpperCase()}${lead.slice(1)}` : ` and ${lead}`, false]);
    pieces.push([h.replacement, true]);
  });
  pieces.push(['.', false]);
  return pieces;
}

// ---- the whole part --------------------------------------------------------------------------------------------------
// everything the workspace says, read once
export function afterCallIn(config, unsupported) {
  const a = afterCallOf(config);
  return {
    summary: { on: a.summary.on === true, prompt: a.summary.prompt.trim() },
    questions: questionsIn(config),
    closing: closingOf(config),
    keeps: keepsOf(config),
    hides: hidesOf(config),
    notRun: notRunOf(config, unsupported),
  };
}

// the line under the name: what is set, in counts; or how many need a look
export function summaryLine(said, problems = 0) {
  const k = said.keeps;
  const kinds = [k.log, k.transcript, k.audio].filter(Boolean).length;
  const hidden = said.hides.labels.length + (said.hides.patterns.length ? 1 : 0) + (said.hides.secrets ? 1 : 0);
  const parts = [
    said.summary.on && '1 summary',
    said.questions.length && plural(said.questions.length, 'question'),
    // the log alone, as every agent keeps it unless switched off, is named, not counted
    kinds === 1 && k.log ? 'a log of each call' : kinds && plural(kinds, 'kind of record', 'kinds of record'),
    k.files.length && plural(k.files.length, 'file'),
    said.hides.on && hidden && plural(hidden, 'thing hidden', 'things hidden'),
  ].filter(Boolean);
  if (parts.length === 1 && k.log && kinds === 1) parts.length = 0;
  const line = parts.join(' · ');
  const first = parts.length ? line.charAt(0).toUpperCase() + line.slice(1) : k.log ? 'Keeps a log of each call' : 'Keeps nothing of a call';
  return problems ? `${first} · ${problems} ${problems === 1 ? 'needs' : 'need'} a look` : first;
}
// how long, in words: "for 90 days", or "until deleted"
export const forHowLong = (n) => (n ? `for ${days(n)}` : 'until deleted');
export { days };
