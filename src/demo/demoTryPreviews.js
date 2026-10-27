// The four "try a line" previews and the redaction kinds IMITATED for demo mode and the tests. With no runtime, simple
// stand-ins give the real shapes and `note` says so. Pure.

import { isObj } from '../studio/form/engine.js';
import { DEMO_PREVIEW_NOTE } from './demoPreview.js';

const list = (v) => (Array.isArray(v) ? v : []);
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tryRe = (source, flags) => {
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
};
const demo = (body) => ({ status: 200, body: { demo: true, note: DEMO_PREVIEW_NOTE, ...body } });
const refuse = (detail) => ({ status: 422, body: { detail } });

// ---- what redaction can find ----------------------------------------------------------------------------------------
export const DEMO_ENTITIES = [
  { kind: 'card_number', how: 'A run of 13 to 19 digits, which may have spaces or dashes between them.', re: /\b\d(?:[ -]?\d){12,18}\b/g },
  { kind: 'bank_account', how: 'A run of 8 to 12 digits.', re: /\b\d{8,12}\b/g },
  { kind: 'national_id', how: 'A letter and 7 digits, or 9 digits written in groups.', re: /\b[A-Z]\d{7}\b|\b\d{3}-\d{2}-\d{4}\b/g },
  { kind: 'phone_number', how: 'A number of 8 to 15 digits, which may start with + and have spaces or dashes.', re: /\+?\d[\d -]{7,14}\d/g },
  { kind: 'email', how: 'Something@something.something.', re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
  { kind: 'date_of_birth', how: 'A date such as 1990-04-12 or 12/04/1990.', re: /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g },
  { kind: 'otp', how: 'A code of 4 to 8 digits near the word code or OTP.', re: /(?<=\b(?:code|otp)\D{0,12})\d{4,8}\b/gi },
  { kind: 'pin', how: 'A code of 4 digits near the word PIN.', re: /(?<=\bpin\D{0,12})\d{4}\b/gi },
];
export const demoEntities = () => DEMO_ENTITIES.map(({ kind, how }) => ({ kind, how }));

function findEntities(line, kinds) {
  const hits = [];
  list(kinds).forEach((kind) => {
    const entity = DEMO_ENTITIES.find((e) => e.kind === kind);
    if (!entity) return;
    for (const m of line.matchAll(new RegExp(entity.re.source, entity.re.flags))) hits.push({ kind, start: m.index, end: m.index + m[0].length, text: m[0] });
  });
  return hits;
}

export function previewRedactionDemo(config, body = {}) {
  const line = String(body.text ?? '');
  const r = isObj(config?.post_call?.redaction) ? config.post_call.redaction : {};
  const replacement = typeof r.replacement === 'string' ? r.replacement : '[REDACTED]';
  const hits = findEntities(line, r.entities);
  list(r.patterns).forEach((source) => {
    const re = tryRe(source, 'g');
    if (re) for (const m of line.matchAll(re)) if (m[0]) hits.push({ kind: 'pattern', start: m.index, end: m.index + m[0].length, text: m[0] });
  });
  const variables = isObj(config?.state?.variables) ? config.state.variables : {};
  const sensitive = Object.entries(variables)
    .filter(([, spec]) => isObj(spec) && spec.sensitive === true)
    .map(([name]) => name);
  const state = isObj(body.state) ? body.state : {};
  if (r.mask_sensitive_state !== false)
    sensitive.forEach((name) => {
      const value = state[name];
      if (value === undefined || value === null || value === '') return;
      const at = line.indexOf(String(value));
      if (at >= 0) hits.push({ kind: 'sensitive_state', start: at, end: at + String(value).length, text: String(value) });
    });
  const ordered = hits.sort((a, b) => a.start - b.start).filter((h, i, all) => i === 0 || h.start >= all[i - 1].end);
  let redacted = '';
  let at = 0;
  ordered.forEach((h) => {
    redacted += line.slice(at, h.start) + replacement;
    at = h.end;
  });
  redacted += line.slice(at);
  const on = r.enabled !== false && (list(r.entities).length || list(r.patterns).length || sensitive.length);
  return demo({
    redacted: on ? redacted : line,
    found: on ? ordered : [],
    entities: demoEntities().filter((e) => list(r.entities).includes(e.kind)),
    patterns: list(r.patterns),
    replacement,
    masks_sensitive_state: r.mask_sensitive_state !== false,
    sensitive_variables: sensitive,
    applies_to: ['saved transcripts and metrics', 'the per-call log', 'text sent in an API call or an email'],
    model_sees: on
      ? 'The model still hears what the caller says during the call. Only what is saved or sent on is cleaned; the exact value of a sensitive variable is kept from it once stored.'
      : 'Redaction is not set up (or is off), so nothing would be hidden.',
  });
}

// ---- safety rules ---------------------------------------------------------------------------------------------------
const INJECTION =
  /ignore (all )?(your )?(previous|prior) instructions|disregard (the |your )?(system|previous)|reveal (your|the) (system )?prompt|you are now/i;
const DEFAULT_LINES = {
  deflect: 'Sorry, I can’t help with that.',
  block: 'Sorry, I can’t help with that.',
  end_call: 'I’m sorry, I have to end this call. Goodbye.',
};
const STRENGTH = ['redact_in_logs', 'rewrite', 'deflect', 'block', 'end_call'];

export function previewGuardrailsDemo(config, body = {}) {
  const line = String(body.text ?? '');
  const rules = list(config?.guardrails?.input);
  const matched = [];
  const notChecked = [];
  rules.forEach((rule) => {
    let found = [];
    if (rule?.type === 'prompt_injection') {
      const m = line.match(INJECTION);
      if (m) found = [{ text: m[0], start: m.index, end: m.index + m[0].length, what: 'an attempt to change its instructions' }];
    } else if (rule?.type === 'pii_detect') {
      found = findEntities(line, rule.entities).map((h) => ({ text: h.text, start: h.start, end: h.end, what: h.kind }));
    } else if (rule?.type === 'regex_block') {
      list(rule.patterns).forEach((source) => {
        const re = tryRe(source, 'gi');
        if (re) for (const m of line.matchAll(re)) if (m[0]) found.push({ text: m[0], start: m.index, end: m.index + m[0].length, what: 'a blocked pattern' });
      });
    } else notChecked.push(rule?.id || rule?.type);
    if (found.length)
      matched.push({
        rule: rule.id,
        type: rule.type,
        action: rule.on_trigger?.action || 'deflect',
        kinds: rule.type === 'pii_detect' ? list(rule.entities) : [],
        found,
      });
  });
  const action = STRENGTH.filter((a) => matched.some((m) => m.action === a)).pop() || null;
  const asked = !['deflect', 'block', 'end_call'].includes(action);
  const rewriteMatches = matched.filter((m) => m.action === 'rewrite').flatMap((m) => m.found);
  let cleaned = line;
  [...rewriteMatches].sort((a, b) => b.start - a.start).forEach((h) => (cleaned = `${cleaned.slice(0, h.start)}[removed]${cleaned.slice(h.end)}`));
  const firstWithLine = matched.find((m) => ['deflect', 'block', 'end_call'].includes(m.action));
  const logged = matched.filter((m) => m.action === 'redact_in_logs').flatMap((m) => m.found);
  let saved = line;
  [...logged].sort((a, b) => b.start - a.start).forEach((h) => (saved = `${saved.slice(0, h.start)}[REDACTED]${saved.slice(h.end)}`));
  return demo({
    matched,
    action,
    model_is_asked: asked,
    says_instead: firstWithLine ? (rules.find((r) => r?.id === firstWithLine.rule)?.on_trigger?.say ?? DEFAULT_LINES[firstWithLine.action] ?? null) : null,
    model_sees: asked ? (action === 'rewrite' ? cleaned : line) : '(the line is withheld from the model)',
    saved_as: saved,
    rules: rules.map((r) => r?.id).filter(Boolean),
    not_checked_in_code: notChecked,
    how_actions_work: {
      deflect: 'A fixed line is said and the model is not asked.',
      redact_in_logs: 'The model still reads the line; the saved records hide the match.',
      rewrite: 'The model reads a cleaned copy of the line.',
      block: 'The line is dropped.',
      end_call: 'The goodbye is said and the call ends.',
    },
    default_lines: DEFAULT_LINES,
    limits: config?.guardrails?.limits || {},
  });
}

// ---- speech ---------------------------------------------------------------------------------------------------------
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ordinal = (n) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;

// Each rule type as a function of the text, returning the new text and the changes it made.
function applyRule(rule, line) {
  const changes = [];
  const make = (re, to) =>
    line.replace(re, (...m) => {
      const out = to(...m);
      if (out !== m[0]) changes.push({ from: m[0], to: out });
      return out;
    });
  let result = line;
  if (rule.type === 'replace') {
    if (!rule.pattern || typeof rule.replacement !== 'string') return { problem: 'the rule needs a pattern and what to say instead', result, changes };
    const re = tryRe(rule.pattern, rule.ignore_case ? 'gi' : 'g');
    if (!re) return { problem: `the pattern “${rule.pattern}” is not a valid regular expression`, result, changes };
    result = make(re, () => rule.replacement);
  } else if (rule.type === 'dictionary') {
    const keys = Object.keys(isObj(rule.entries) ? rule.entries : {})
      .filter((key) => key !== '')
      .sort((a, b) => b.length - a.length);
    if (!keys.length) return { result, changes };
    const flags = rule.ignore_case ? 'gi' : 'g';
    const body = keys.map(escapeRe).join('|');
    const re = new RegExp(rule.whole_word ? `\\b(?:${body})\\b` : body, flags);
    const lookup = (k) => rule.entries[keys.find((key) => (rule.ignore_case ? key.toLowerCase() === k.toLowerCase() : key === k))];
    result = make(re, (m) => lookup(m) ?? m);
  } else if (rule.type === 'spell') {
    if (!rule.pattern) return { problem: 'the rule needs a pattern for what to spell out', result, changes };
    const re = tryRe(rule.pattern, 'g');
    if (!re) return { problem: `the pattern “${rule.pattern}” is not a valid regular expression`, result, changes };
    result = make(re, (m) => m.split('').join(' '));
  } else if (rule.type === 'digits') {
    const min = Math.max(1, Number(rule.min_length) || 6);
    const size = Math.max(1, Number(rule.group_size) || 4);
    result = make(
      new RegExp(`(\\+?)(\\d{${min},})`, 'g'),
      (m, plus, digits) => `${plus ? (rule.plus_prefix ?? 'plus ') : ''}${(digits.match(new RegExp(`.{1,${size}}`, 'g')) || []).join(' ')}`,
    );
  } else if (rule.type === 'currency') {
    if (!rule.major_unit) return { problem: 'the rule needs the word for the main unit, such as “dollars”', result, changes };
    const symbols = list(rule.symbols).length ? rule.symbols : ['$'];
    const re = new RegExp(`(${symbols.map(escapeRe).join('|')})\\s?(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d{2}))?`, 'g');
    result = make(
      re,
      (m, sym, whole, cents) => `${whole.replace(/,/g, '')} ${rule.major_unit}${cents && rule.minor_unit ? ` and ${Number(cents)} ${rule.minor_unit}` : ''}`,
    );
  } else if (rule.type === 'time') {
    result = make(/\b(\d{1,2}):(\d{2})\s?(AM|PM)\b/gi, (m, h, min, ap) => `${h} ${min} ${ap.toUpperCase().split('').join(' ')}`);
  } else if (rule.type === 'date') {
    result = make(/\b(\d{1,2})-([A-Za-z]{3})-(\d{4})\b/g, (m, d, mon, y) => {
      const month = MONTHS.find((name) => name.slice(0, 3).toLowerCase() === mon.toLowerCase());
      return month ? `${ordinal(Number(d))} ${month} ${y}` : m;
    });
  }
  return { result, changes };
}

export function previewSpeechDemo(config, body = {}) {
  const line = String(body.text ?? '');
  const agents = list(config?.agents?.items);
  const agent = agents.find((a) => a?.id === body.agent) || agents.find((a) => a?.id === config?.agents?.entry) || agents[0];
  const channel = list(config?.channels).find((c) => c?.id === body.channel) || list(config?.channels)[0];
  const speechOf = (node) => (isObj(node?.conversation?.speech) ? node.conversation.speech : null);
  const own = [speechOf(agent), speechOf(channel), speechOf(config?.defaults)].find((s) => s && Array.isArray(s.pronunciation));
  const rules = list(own?.pronunciation);
  const applyTo = (speechOf(config?.defaults) || own)?.apply_to === 'all' ? 'all' : 'model';
  const out = { text: line, apply_to: applyTo, spoken: line, changes: [], problems: [], applies: true, held_back_at_end: '' };
  const voice = channel ? list(channel.modalities?.output).includes('audio') || /voice/.test(String(channel.type)) : true;
  if (!voice) return demo({ ...out, applies: false, why_not: 'This channel has no voice, so nothing is spoken.' });
  if (!rules.length) return demo({ ...out, applies: false, why_not: 'No pronunciation rule applies to this agent.' });
  if (body.source === 'fixed' && applyTo === 'model')
    return demo({
      ...out,
      applies: false,
      why_not: 'Fixed lines you wrote yourself are not changed: “which lines use these rules” is set to the AI’s own words.',
    });
  let spoken = line;
  rules.forEach((rule, index) => {
    const done = applyRule(rule, spoken);
    if (done.problem) out.problems.push({ rule: index + 1, message: done.problem });
    spoken = done.result;
    done.changes.forEach((c) => out.changes.push({ rule: index + 1, type: rule.type, label: rule.id || rule.type, from: c.from, to: c.to }));
  });
  out.spoken = spoken;
  const chunks = list(body.chunks).map(String);
  if (chunks.length) {
    // a piece that could still become a match (a trailing number, or the start of AM/PM) waits for the next piece
    let carry = '';
    const arrived = [];
    chunks.forEach((piece, i) => {
      const text = carry + piece;
      const tail = i === chunks.length - 1 ? '' : (text.match(/\d[\d:.,/-]*\s?[AaPp]?[Mm]?$/) || [''])[0];
      carry = tail;
      const speakable = tail ? text.slice(0, -tail.length) : text;
      if (speakable) arrived.push(rules.reduce((acc, rule) => applyRule(rule, acc).result, speakable));
    });
    out.streaming = { spoken_as_it_arrives: arrived };
  }
  return demo(out);
}

// ---- tasks ----------------------------------------------------------------------------------------------------------
// true, false, or null when the imitation can't tell (a condition on a tool argument, result or event)
const compare = (actual, c) => {
  if ('equals' in c) return JSON.stringify(actual ?? null) === JSON.stringify(c.equals);
  if ('not_equals' in c) return JSON.stringify(actual ?? null) !== JSON.stringify(c.not_equals);
  if ('gte' in c) return Number(actual) >= c.gte;
  if ('lte' in c) return Number(actual) <= c.lte;
  if (Array.isArray(c.in)) return c.in.some((v) => JSON.stringify(v) === JSON.stringify(actual ?? null));
  return null;
};
const holds = (condition, state, channelId = '') => {
  if (!isObj(condition)) return null;
  if ('not' in condition) {
    const inner = holds(condition.not, state, channelId);
    return inner === null ? null : !inner;
  }
  const group = Array.isArray(condition.all) ? 'all' : Array.isArray(condition.any) ? 'any' : '';
  if (group) {
    const parts = condition[group].map((c) => holds(c, state, channelId));
    if (group === 'all') return parts.includes(false) ? false : parts.includes(null) ? null : true;
    return parts.includes(true) ? true : parts.includes(null) ? null : false;
  }
  if (typeof condition.state === 'string') return compare(state[condition.state], condition);
  if ('channel' in condition) return channelId ? compare(channelId, { ...condition, equals: condition.channel }) : null;
  return null;
};

export function previewTaskDemo(config, body = {}) {
  const task = list(config?.tasks).find((t) => t?.id === body.task);
  if (!task) return { status: 404, body: { detail: `There is no task '${body.task}' in this configuration.` } };
  const variables = isObj(config?.state?.variables) ? config.state.variables : {};
  const state = { ...Object.fromEntries(Object.entries(variables).map(([k, v]) => [k, v?.initial])), ...(isObj(body.state) ? body.state : {}) };
  const phone = list(config?.channels).find((c) => c?.id === body.channel)?.type === 'sip_voice';
  const taskSkipped = holds(task.skip_if, state, body.channel) === true;
  const steps = list(task.steps).map((step) => {
    const skipped = holds(step.skip_if, state, body.channel) === true;
    const held = holds(step.requires, state, body.channel) === false;
    const out = {
      id: step.id,
      type: step.type || 'collect',
      skipped_now: skipped,
      held_back_now: held,
      skip_if: step.skip_if ?? null,
      requires: step.requires ?? null,
      attempts: step.max_attempts ?? task.max_attempts ?? 3,
      problems: [],
    };
    if ((step.type || 'collect') === 'collect') {
      const keypad = step.input === 'dtmf';
      out.instructions = `Ask the caller: ${step.ask || '(no question written)'}`;
      out.answer_mode = keypad ? 'keypad' : step.validate?.type === 'tool' ? 'tool_arguments' : 'value';
      out.model_tools = keypad ? ['cannot_continue'] : ['cannot_continue', step.validate?.type === 'tool' ? step.validate.tool : 'submit_answer'];
      out.checked_by =
        step.validate?.type === 'tool'
          ? { tool: step.validate.tool, args: step.validate.args || {} }
          : step.validate?.type === 'regex'
            ? { pattern: step.validate.pattern }
            : null;
      out.pass_when = step.pass_when ?? null;
      out.store_in = step.store_in || '';
      if (keypad) {
        out.keypad = { num_digits: step.dtmf?.num_digits ?? null, timeout_s: step.dtmf?.timeout_s ?? 10, terminator: step.dtmf?.terminator ?? '#' };
        if (body.channel && !phone)
          out.problems.push('This step takes keypad digits, which only a phone call can give: on this channel it would end the task as failed.');
      }
    } else out.actions = list(step.do).map((a) => (a?.type ? `${String(a.type).replace(/_/g, ' ')}.` : 'Does something.'));
    return out;
  });
  const ending = (outcome, block) => ({
    sets: isObj(block?.set_state) ? block.set_state : {},
    then_runs: list(block?.do).map((e) => String(e?.type || 'does something').replace(/_/g, ' ')),
    next_task: block?.next || '',
    resumes: block?.resume || 'caller',
    silent: block?.silent === true,
    tells_the_calling_agent:
      block?.tell_model || (block?.silent === true ? 'Carry on with what the caller asked.' : `Tell the caller how it ended (${block?.outcome || outcome}).`),
  });
  return demo({
    task: task.id,
    steps,
    attempts: { limit: task.max_attempts ?? 3, counted: task.attempts_scope === 'task' ? 'task' : 'step' },
    skipped_now: taskSkipped,
    keeps_history: task.return_history === 'full',
    endings: { verified: ending('verified', task.on_success), failed: ending('failed', task.on_failure), declined: ending('declined', task.on_decline) },
    offered_by: list(config?.tools)
      .filter((t) => t?.type === 'task' && t.task === task.id)
      .map((t) => t.id),
    problems: [],
  });
}

// One entry point for the demo API.
export function tryPreviewDemo(path, config, body) {
  if (!isObj(body) || (path !== '/preview/task' && typeof body.text !== 'string'))
    return refuse(path === '/preview/task' ? 'Name the task to preview.' : 'Send some text to try.');
  if (path === '/preview/speech') return previewSpeechDemo(config, body);
  if (path === '/preview/guardrails') return previewGuardrailsDemo(config, body);
  if (path === '/preview/redaction') return previewRedactionDemo(config, body);
  return previewTaskDemo(config, body);
}
