// "Try a line": the four previews that answer for a setting by running the runtime's own code on a sample
// (FRONTEND_GUIDE 10.1): how a line would be said (`POST /preview/speech`), what the safety rules do with a line a
// caller might say (`/preview/guardrails`), what redaction would hide (`/preview/redaction`) and a task step by step
// (`/preview/task`). They call nothing, spend nothing and read no secrets, and they read the config as it is in the
// editor. This module reads each answer TOLERANTLY (a missing part is left out, never an error) and turns it into the
// plain words the panels show. Pure: no DOM.

import { isObj } from './engine.js';
import { enumLabel } from './plainEnums.js';

const list = (v) => (Array.isArray(v) ? v : []);
const text = (v) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

// ---- what the rules are called ------------------------------------------------------------------------------------------------------------------
export const RULE_WORDS = {
  currency: 'an amount of money',
  spell: 'spelled out letter by letter',
  digits: 'a long number in groups',
  time: 'a time of day',
  date: 'a date',
  replace: 'a find-and-replace',
  dictionary: 'a word list',
};
export const ruleWords = (type) => RULE_WORDS[type] || (type ? String(type).replace(/_/g, ' ') : 'a rule');

// What a safety rule did, in the words of the scenario checks (kept here so the panels do not import the scenario form).
export const ACTION_WORDS = {
  deflect: 'It declines and answers with a fixed line.',
  redact_in_logs: 'It hides the match in the saved records. The agent still reads the line.',
  rewrite: 'It rewrites the line before the agent reads it.',
  block: 'It keeps the line from the agent altogether.',
  end_call: 'It ends the call.',
};
export const actionWords = (action) => ACTION_WORDS[action] || (action ? `It does “${action}”.` : '');

// ---- speech ---------------------------------------------------------------------------------------------------------------------------------
export function normalizeSpeech(raw) {
  const r = isObj(raw) ? raw : {};
  return {
    spoken: text(r.spoken),
    text: text(r.text),
    changes: list(r.changes).map((c) => ({
      rule: num(c?.rule),
      type: text(c?.type),
      label: text(c?.label) || ruleWords(c?.type),
      from: text(c?.from),
      to: text(c?.to),
    })),
    applies: r.applies !== false,
    whyNot: text(r.why_not),
    applyTo: text(r.apply_to),
    heldBack: text(r.held_back_at_end),
    streaming: isObj(r.streaming) ? list(r.streaming.spoken_as_it_arrives).map(text) : null,
    problems: list(r.problems).map((p) => (isObj(p) ? text(p.message || p.problem || JSON.stringify(p)) : text(p))),
  };
}

// One line about what happened, for the top of the result.
export function speechVerdict(view) {
  if (!view.applies) return view.whyNot || 'No pronunciation rule applies here.';
  if (!view.changes.length) return 'Nothing in this line is changed: the voice would be given it as written.';
  return `${view.changes.length} change${view.changes.length === 1 ? '' : 's'} before the voice speaks it.`;
}

// ---- redaction ------------------------------------------------------------------------------------------------------------------------------
export function normalizeRedaction(raw) {
  const r = isObj(raw) ? raw : {};
  return {
    redacted: text(r.redacted),
    found: list(r.found)
      .map((f) => ({ kind: text(f?.kind), start: num(f?.start), end: num(f?.end), text: text(f?.text) }))
      .filter((f) => f.text || (f.start !== undefined && f.end !== undefined)),
    entities: list(r.entities).map((e) => (isObj(e) ? { kind: text(e.kind), how: text(e.how) } : { kind: text(e), how: '' })),
    patterns: list(r.patterns).map(text),
    replacement: text(r.replacement),
    masksSensitiveState: r.masks_sensitive_state === true,
    sensitiveVariables: list(r.sensitive_variables).map(text),
    appliesTo: list(r.applies_to).map(text),
    modelSees: text(r.model_sees),
  };
}

// The sample line cut into pieces: { text, hit } so a hit can be drawn marked. Hits that overlap or lie outside the line are ignored.
export function markHits(sample, found) {
  const chars = Array.from(text(sample)); // the server counts characters, not UTF-16 units
  const spans = list(found)
    .filter((f) => Number.isInteger(f.start) && Number.isInteger(f.end) && f.start >= 0 && f.end > f.start && f.end <= chars.length)
    .sort((a, b) => a.start - b.start);
  const pieces = [];
  let at = 0;
  spans.forEach((span) => {
    if (span.start < at) return;
    if (span.start > at) pieces.push({ text: chars.slice(at, span.start).join(''), hit: null });
    pieces.push({ text: chars.slice(span.start, span.end).join(''), hit: span.kind || 'match' });
    at = span.end;
  });
  if (at < chars.length) pieces.push({ text: chars.slice(at).join(''), hit: null });
  return pieces.length ? pieces : [{ text: chars.join(''), hit: null }];
}

export function redactionVerdict(view) {
  if (!view.found.length) return 'Nothing in this line would be hidden.';
  return `${view.found.length} thing${view.found.length === 1 ? '' : 's'} would be hidden in what is saved.`;
}

// What a found kind is, as a person says it ("a card number").
export const FOUND_WORDS = {
  card_number: 'a card number',
  bank_account: 'a bank account number',
  national_id: 'a national ID number',
  phone_number: 'a phone number',
  email: 'an email address',
  date_of_birth: 'a date of birth',
  otp: 'a one-time code',
  pin: 'a PIN',
  sensitive_state: 'the value of something marked sensitive',
  pattern: 'a match for one of your patterns',
};
export const foundWords = (kind) => FOUND_WORDS[kind] || (kind ? String(kind).replace(/_/g, ' ') : 'a match');

// ---- guardrails -----------------------------------------------------------------------------------------------------------------------------
export function normalizeGuardrails(raw) {
  const r = isObj(raw) ? raw : {};
  return {
    matched: list(r.matched).map((m) => ({
      rule: text(m?.rule),
      type: text(m?.type),
      action: text(m?.action),
      kinds: list(m?.kinds).map(text),
      found: list(m?.found).map((f) => ({ text: text(f?.text), start: num(f?.start), end: num(f?.end), what: text(f?.what) })),
    })),
    action: text(r.action),
    modelIsAsked: r.model_is_asked !== false,
    saysInstead: r.says_instead === null || r.says_instead === undefined ? '' : text(r.says_instead),
    modelSees: r.model_sees === null || r.model_sees === undefined ? '' : text(r.model_sees),
    savedAs: r.saved_as === null || r.saved_as === undefined ? '' : text(r.saved_as),
    rules: list(r.rules).map((x) => (isObj(x) ? text(x.id || x.rule || JSON.stringify(x)) : text(x))),
    notChecked: list(r.not_checked_in_code).map((x) => (isObj(x) ? text(x.id || x.rule || x.text || JSON.stringify(x)) : text(x))),
    howActionsWork: isObj(r.how_actions_work)
      ? Object.entries(r.how_actions_work).map(([k, v]) => ({ action: k, text: text(v) }))
      : list(r.how_actions_work).map(text),
    defaultLines: isObj(r.default_lines)
      ? Object.entries(r.default_lines)
          .map(([action, line]) => ({ action, line: sayText(line) }))
          .filter((l) => l.line)
      : [],
    limits: isObj(r.limits) ? r.limits : null,
  };
}

// A line as the config holds it (`say`): words, a catalogue message, or words per language; '' when it can't be put in a sentence.
function sayText(v) {
  if (typeof v === 'string') return v;
  if (!isObj(v)) return '';
  if (typeof v.message === 'string') return `the message “${v.message}”`;
  if (typeof v.text === 'string') return v.text;
  const first = Object.values(v).find((x) => typeof x === 'string');
  return first || '';
}

// How each action works, with the line it says by default (FRONTEND_GUIDE 10.1: `how_actions_work` and `default_lines`
// are the form's help text), in the order of how strongly they act. [{ action, label, text, line }]
export function guardrailActions(view) {
  const lines = Object.fromEntries((view?.defaultLines || []).map((l) => [l.action, l.line]));
  const how = Object.fromEntries((view?.howActionsWork || []).filter((a) => isObj(a)).map((a) => [a.action, a.text]));
  const order = ['redact_in_logs', 'rewrite', 'deflect', 'block', 'end_call'];
  const actions = [...new Set([...Object.keys(how), ...Object.keys(lines)])].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  return actions.map((action) => ({ action, label: enumLabel('action', action), text: how[action] || '', line: lines[action] || '' }));
}

// The limits in force and the goodbye said when one is reached (`limits` of the guardrails preview), in a sentence; '' when none is set.
export function limitsSentence(limits) {
  if (!isObj(limits)) return '';
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  const parts = [];
  const minutes = n(limits.max_call_duration_s);
  if (minutes) parts.push(`after ${minutes % 60 === 0 ? `${minutes / 60} minute${minutes === 60 ? '' : 's'}` : `${minutes} seconds`} on the line`);
  if (n(limits.max_silence_s)) parts.push(`after ${limits.max_silence_s} seconds with nothing from the caller`);
  if (n(limits.max_tool_calls_per_call)) parts.push(`at tool call ${limits.max_tool_calls_per_call + 1}`);
  if (n(limits.max_handoffs_per_call)) parts.push(`at move ${limits.max_handoffs_per_call + 1} to another agent`);
  const said = sayText(limits.say);
  // a catalogue message is named, words are quoted; a sentence that ends in its own stop gets no second one
  const goodbye = !said ? '' : said.startsWith('the message') ? `${said}.` : /[.!?]$/.test(said) ? `“${said}”` : `“${said}”.`;
  if (!parts.length) return goodbye ? `When a limit is reached the call ends, and the agent first says ${goodbye}` : '';
  const last = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} or ${parts.at(-1)}` : parts[0];
  return `Limits in force: a call ends ${last}.${goodbye ? ` Before it ends the agent says ${goodbye}` : ''}`;
}

export function guardrailsVerdict(view) {
  if (!view.matched.length) return 'No safety rule caught this line. The agent would read it as written.';
  const names = view.matched.map((m) => `“${m.rule}”`).join(' and ');
  return `${view.matched.length === 1 ? 'The rule' : 'The rules'} ${names} caught this line. ${actionWords(view.action)}`.trim();
}

// ---- tasks ----------------------------------------------------------------------------------------------------------------------------------
export const STEP_WORDS = { collect: 'Ask the caller', call: 'Call a tool', say: 'Say something' };

export function normalizeTask(raw) {
  const r = isObj(raw) ? raw : {};
  const endings = isObj(r.endings) ? r.endings : {};
  return {
    steps: list(r.steps).map((s, index) => ({
      index: index + 1,
      id: text(s?.id),
      type: text(s?.type),
      skippedNow: s?.skipped_now === true,
      heldBackNow: s?.held_back_now === true,
      skipIf: s?.skip_if ?? null,
      requires: s?.requires ?? null,
      attempts: num(s?.attempts),
      instructions: text(s?.instructions),
      modelTools: list(s?.model_tools).map((t) => (isObj(t) ? text(t.name || t.tool || JSON.stringify(t)) : text(t))),
      answerMode: text(s?.answer_mode),
      checkedBy: s?.checked_by ?? null,
      passWhen: s?.pass_when ?? null,
      storeIn: text(s?.store_in),
      actions: list(s?.actions).map(text),
      keypad: isObj(s?.keypad) ? { numDigits: num(s.keypad.num_digits), timeoutS: num(s.keypad.timeout_s), terminator: text(s.keypad.terminator) } : null,
      problems: list(s?.problems).map(text),
    })),
    attempts: isObj(r.attempts) ? { limit: num(r.attempts.limit), counted: text(r.attempts.counted) } : null,
    skippedNow: r.skipped_now === true,
    keepsHistory: r.keeps_history === true,
    endings: ['verified', 'failed', 'declined']
      .filter((k) => isObj(endings[k]))
      .map((k) => ({
        name: k,
        sets: isObj(endings[k].sets) ? endings[k].sets : {},
        thenRuns: list(endings[k].then_runs).map(text),
        nextTask: text(endings[k].next_task),
        resumes: text(endings[k].resumes),
        silent: endings[k].silent === true,
        tells: text(endings[k].tells_the_calling_agent),
      })),
    offeredBy: list(r.offered_by).map(text),
    problems: list(r.problems).map(text),
  };
}

// The words for how a step's answer is checked: "" when nothing checks it.
export function checkedWords(step) {
  const by = step.checkedBy;
  if (isObj(by) && by.tool) return `by the tool “${by.tool}”`;
  if (typeof by === 'string' && by) return `by the pattern /${by}/`;
  if (isObj(by) && (by.regex || by.pattern)) return `by the pattern /${by.regex || by.pattern}/`;
  if (step.passWhen) return 'by a condition you wrote on what it returns';
  return '';
}

export function stepState(step) {
  if (step.skippedNow) return { tag: 'skipped', words: 'Skipped for this caller, because it is already known.' };
  if (step.heldBackNow) return { tag: 'held', words: 'Held back for now: the steps before it have to finish first.' };
  return { tag: 'runs', words: '' };
}

// ---- the sentences the panels share -----------------------------------------------------------------------------------------------------------
export const PREVIEW_SOURCE = { server: 'exact', demo: 'demo imitation' };

// What went wrong asking, in a customer's words.
export function askProblem(error) {
  if (!error) return '';
  const said = String(error.message || '');
  const own = said && !/^Request failed/.test(said);
  if (error.kind === 'client_bug') return 'Something went wrong asking the server. Try again, and tell us if it keeps happening.';
  if (error.status === 404 || error.status === 405) return own && error.status === 404 ? said : 'This server cannot try this setting yet.';
  return `The server could not answer: ${said || 'unknown problem'}`;
}
