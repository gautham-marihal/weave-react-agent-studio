// A tool's `effects` are rules: "when this holds, do these steps in order". This names the kinds of step, writes a rule
// as a sentence, makes a new step with what the schema needs (empty, never invented), and reads and writes a simple
// condition ("the state verified is true") as one row. Pure: no React, no network.

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

export type Action = Json & { type?: string };
export type Rule = { when?: Json; do?: Action[] } & Json;

/** In the order the "Add a step" menu offers them: speaking first, then state and flow, then the rest. */
export const ACTION_KINDS: { type: string; label: string }[] = [
  { type: 'say', label: 'Say a line' },
  { type: 'generate', label: 'Say something the model writes' },
  { type: 'set_state', label: 'Change state' },
  { type: 'handoff', label: 'Hand off to another agent' },
  { type: 'return_to_entry', label: 'Return to the first agent' },
  { type: 'end_call', label: 'End the call' },
  { type: 'transfer', label: 'Transfer to a person' },
  { type: 'notify', label: 'Send a notification (SMS or email)' },
  { type: 'send_form', label: 'Show a form' },
  { type: 'wrapup', label: 'Start a wrap-up' },
  { type: 'play_sound', label: 'Play a sound' },
  { type: 'http', label: 'Call an HTTP API' },
  { type: 'collect_dtmf', label: 'Collect keypad digits' },
  { type: 'log', label: 'Write a log line' },
];

export const kindLabel = (type: unknown): string => ACTION_KINDS.find((k) => k.type === type)?.label ?? String(type || 'Something');

/** A new step of a kind, with the fields the schema needs, empty. */
export function makeAction(type: string): Action {
  switch (type) {
    case 'say':
      return { type, text: '' };
    case 'generate':
      return { type, instructions: '' };
    case 'set_state':
      return { type, values: {} };
    case 'handoff':
      return { type, to: '' };
    case 'transfer':
      return { type, transfer: '' };
    case 'notify':
      return { type, notification: '' };
    case 'send_form':
      return { type, form: '' };
    case 'wrapup':
      return { type, wrapup: '' };
    case 'play_sound':
      return { type, sound: '' };
    case 'http':
      return { type, connection: '', method: 'GET', path: '' };
    case 'collect_dtmf':
      return { type, into: '' };
    case 'log':
      return { type, message: '' };
    default:
      return { type };
  }
}

/** A step changed to another kind keeps what the new kind can hold too. */
export function changeKind(action: Action, type: string): Action {
  const made = makeAction(type);
  const keep = Object.fromEntries(Object.entries(isObj(action) ? action : {}).filter(([k]) => k !== 'type' && k in made));
  return { ...made, ...keep };
}

const quote = (v: unknown) => `“${String(v)}”`;
const shortText = (v: unknown, max = 60) => {
  const t = String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};
const speech = (v: unknown) => (isObj(v) && v.message ? `the message ${quote(v.message)}` : v ? quote(shortText(v)) : 'nothing yet');
const show = (v: unknown): string => (Array.isArray(v) ? v.map(show).join(', ') : typeof v === 'string' ? `“${v}”` : String(v));

/** One step as a short sentence. */
export function describeAction(action: unknown): string {
  if (!isObj(action)) return 'Do something';
  switch (action.type) {
    case 'say':
      return `Say ${speech(action.text)}`;
    case 'generate':
      return `Have the model say something: ${quote(shortText(action.instructions) || 'no instructions yet')}`;
    case 'set_state': {
      const pairs = Object.entries(isObj(action.values) ? action.values : {}).map(([k, v]) => `${k} to ${typeof v === 'string' ? quote(v) : JSON.stringify(v)}`);
      return pairs.length ? `Set ${pairs.join(', ')}` : 'Change state (nothing chosen yet)';
    }
    case 'handoff':
      return `Hand off to ${String(action.to || 'an agent (none chosen yet)')}`;
    case 'return_to_entry':
      return 'Return to the first agent';
    case 'end_call':
      return action.say ? `Say ${speech(action.say)}, then end the call` : 'End the call';
    case 'transfer':
      return `Transfer using ${String(action.transfer || 'a transfer (none chosen yet)')}`;
    case 'notify':
      return `Send the notification ${String(action.notification || '(none chosen yet)')}`;
    case 'send_form':
      return `Show the form ${String(action.form || '(none chosen yet)')}`;
    case 'wrapup':
      return `Start the wrap-up ${String(action.wrapup || '(none chosen yet)')}`;
    case 'play_sound':
      return `Play the sound ${typeof action.sound === 'string' && action.sound ? action.sound : '(none chosen yet)'}`;
    case 'http':
      return `Call ${String(action.method || 'GET')} ${String(action.path || '/')} on ${String(action.connection || 'a connection (none chosen yet)')}`;
    case 'collect_dtmf':
      return `Collect keypad digits into ${String(action.into || 'a state variable (none chosen yet)')}`;
    case 'log':
      return `Write to the log: ${quote(shortText(action.message))}`;
    default:
      return kindLabel(action.type);
  }
}

const OPERATOR_WORDS: Record<string, string> = { equals: 'is', not_equals: 'is not', gte: 'is at least', lte: 'is at most', in: 'is one of' };
const SUBJECT_WORDS: Record<string, string> = { state: 'the state', arg: 'the argument', result: 'the result', event: 'the event detail' };

/** A condition in words: `{ state: 'verified', equals: true }` -> "the state verified is true". */
export function describeCondition(condition: unknown): string {
  if (!isObj(condition)) return 'a condition holds';
  const subject = ['state', 'arg', 'result', 'event'].find((k) => k in condition);
  if (subject) {
    const operator = Object.keys(OPERATOR_WORDS).find((k) => k in condition);
    const label = SUBJECT_WORDS[subject];
    const name = String(condition[subject]);
    if (operator === 'not_equals' && condition[operator] === null) return `${label} ${name} is set`;
    if (operator === 'equals' && condition[operator] === null) return `${label} ${name} is not set`;
    return operator ? `${label} ${name} ${OPERATOR_WORDS[operator]} ${show(condition[operator])}` : `${label} ${name} is set`;
  }
  if ('channel' in condition) return `the channel is ${show(condition.channel)}`;
  if ('schedule' in condition) return `${String(condition.schedule)} is ${condition.open ? 'open' : 'closed'}`;
  if (Array.isArray(condition.all)) return condition.all.map(describeCondition).join(' and ');
  if (Array.isArray(condition.any)) return condition.any.map(describeCondition).join(' or ');
  if ('not' in condition) return `not (${describeCondition(condition.not)})`;
  return 'a condition holds';
}

/** A rule as one sentence: "When the result $.status is “ok”: say “Done”, then end the call." */
export function describeRule(rule: unknown): string {
  if (!isObj(rule)) return 'A rule';
  const steps = (Array.isArray(rule.do) ? rule.do : []).map((a) => describeAction(a).replace(/^./, (c) => c.toLowerCase()));
  const lead = rule.when === undefined ? 'Always' : `When ${describeCondition(rule.when)}`;
  if (!steps.length) return `${lead}: nothing yet`;
  return `${lead}: ${steps.join(', then ')}.`;
}

/** A copy of a list with one item moved (out-of-range moves leave it as it is). */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (!Array.isArray(items) || to < 0 || to >= items.length || from < 0 || from >= items.length || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** A new rule: always, saying a line (an empty rule would not be valid: it needs one step at least). */
export const newRule = (): Rule => ({ do: [makeAction('say')] });

// ---- a simple condition, as one row -----------------------------------------------------------------------------------

export type ConditionSource = 'state' | 'arg' | 'result' | 'event';
export type ConditionOperator = 'equals' | 'not_equals' | 'gte' | 'lte' | 'in';
export const CONDITION_SOURCES: [ConditionSource, string][] = [
  ['state', 'State variable'],
  ['arg', 'Tool argument'],
  ['result', 'Tool result'],
  ['event', 'Event detail'],
];
export const CONDITION_OPERATORS: [ConditionOperator, string][] = [
  ['equals', 'is'],
  ['not_equals', 'is not'],
  ['gte', 'is at least'],
  ['lte', 'is at most'],
  ['in', 'is one of'],
];
const SOURCE_KEYS = CONDITION_SOURCES.map(([k]) => k as string);
const OPERATOR_KEYS = CONDITION_OPERATORS.map(([k]) => k as string);

/** Exactly one thing tested and at most one comparison (all / any / not, channels and hours are not simple). */
export function isSimpleCondition(value: unknown): boolean {
  if (!isObj(value)) return false;
  const keys = Object.keys(value);
  const sources = keys.filter((k) => SOURCE_KEYS.includes(k));
  const operators = keys.filter((k) => OPERATOR_KEYS.includes(k));
  return sources.length === 1 && operators.length <= 1 && keys.length === sources.length + operators.length;
}

export interface SimpleCondition {
  source: ConditionSource;
  subject: string;
  operator: ConditionOperator;
  value: unknown;
}

export function readCondition(value: unknown): SimpleCondition {
  const obj = isObj(value) && Object.keys(value).length ? value : { state: '' };
  const source = (SOURCE_KEYS.find((k) => k in obj) ?? 'state') as ConditionSource;
  const operator = (OPERATOR_KEYS.find((k) => k in obj) ?? 'equals') as ConditionOperator;
  return { source, subject: String(obj[source] ?? ''), operator, value: obj[operator] === undefined ? '' : obj[operator] };
}

const asNumber = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : 0);

/** The condition with one part changed; the compared value follows the comparison (numbers, a list, or as typed). */
export function writeCondition(current: SimpleCondition, change: Partial<SimpleCondition>): Json {
  const next = { ...current, ...change };
  if (change.source !== undefined && change.source !== current.source) next.subject = '';
  if (change.operator !== undefined && change.operator !== current.operator) {
    const single = Array.isArray(current.value) ? (current.value[0] ?? '') : current.value;
    next.value = next.operator === 'in' ? (Array.isArray(current.value) ? current.value : []) : next.operator === 'gte' || next.operator === 'lte' ? asNumber(single) : single;
  }
  return { [next.source]: next.subject, [next.operator]: next.value };
}

/**
 * A value typed in the "is" box, as the value it means: true / false / null and numbers are read as such, anything else
 * stays text. "is not null" means "is set".
 */
export function typedValue(text: string): unknown {
  const t = text.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
  if (t !== '' && Number.isFinite(Number(t)) && /^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return text;
}

/** A value as it is shown in the box. */
export const valueText = (value: unknown): string => (typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value));
