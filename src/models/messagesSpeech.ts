// How written text is said aloud: the pronunciation rules (defaults.conversation.speech.pronunciation), each named by
// the job it does, and the server's answer to "Try a line" (POST /preview/speech) read into plain words. What the voice
// would be given comes from the server only; nothing here guesses it. Pure.
import type { AgentConfig } from '../types/studio';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = <T = unknown,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const text = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export type RuleType = 'dictionary' | 'replace' | 'spell' | 'digits' | 'currency' | 'time' | 'date';

/** What can be added, by what it does (not by its kind in the file). */
export const PRONUNCIATION_KINDS: { type: RuleType; label: string; help: string; seed: Json }[] = [
  { type: 'dictionary', label: 'Say certain words a certain way', help: 'Words a voice reads wrongly (a brand, a name, a place) and how to say each one.', seed: { entries: {} } },
  { type: 'replace', label: 'Replace some text with other text', help: 'Wherever a pattern is found, say something else instead.', seed: { pattern: '', replacement: '' } },
  { type: 'spell', label: 'Spell something out letter by letter', help: 'For codes and reference numbers: “AB12” is said “A B 1 2”.', seed: { pattern: '' } },
  { type: 'digits', label: 'Read long numbers in groups', help: 'A phone or account number is read a few digits at a time, so a caller can follow it.', seed: {} },
  { type: 'currency', label: 'Say amounts of money in words', help: '“$12.50” is said “12 dollars and 50 cents”.', seed: { symbols: ['$'], major_unit: 'dollars', minor_unit: 'cents' } },
  { type: 'time', label: 'Say times of day aloud', help: '“4:30 PM” is said as it is spoken, not read as symbols.', seed: {} },
  { type: 'date', label: 'Say dates aloud', help: '“27-Feb-2026” is said “27th February 2026”.', seed: {} },
];

/** What a kind of rule is called in a sentence. */
export const RULE_WORDS: Record<string, string> = {
  currency: 'an amount of money',
  spell: 'spelled out letter by letter',
  digits: 'a long number in groups',
  time: 'a time of day',
  date: 'a date',
  replace: 'a find-and-replace',
  dictionary: 'a word list',
};
export const ruleWords = (type: unknown) => RULE_WORDS[String(type)] || (type ? String(type).replace(/_/g, ' ') : 'a rule');

export interface Pronunciation {
  rules: Json[];
  applyTo: 'model' | 'all' | '';
}

export function pronunciationOf(config: AgentConfig): Pronunciation {
  const speech = (isObj(config?.defaults?.conversation?.speech) ? config.defaults?.conversation?.speech : {}) as Json;
  return { rules: list<Json>(speech.pronunciation).filter(isObj), applyTo: speech.apply_to === 'model' || speech.apply_to === 'all' ? speech.apply_to : '' };
}

/** Edits defaults.conversation.speech, taking out whatever is left empty. */
function editSpeech(config: AgentConfig, change: (speech: Json) => void): AgentConfig {
  const next = clone(config ?? {});
  const defaults = (isObj(next.defaults) ? next.defaults : {}) as Json;
  const conversation = (isObj(defaults.conversation) ? defaults.conversation : {}) as Json;
  const speech = (isObj(conversation.speech) ? conversation.speech : {}) as Json;
  change(speech);
  if (Array.isArray(speech.pronunciation) && !speech.pronunciation.length) delete speech.pronunciation;
  if (Object.keys(speech).length) conversation.speech = speech;
  else delete conversation.speech;
  if (Object.keys(conversation).length) defaults.conversation = conversation;
  else delete defaults.conversation;
  if (Object.keys(defaults).length) next.defaults = defaults as AgentConfig['defaults'];
  else delete next.defaults;
  return next;
}

export const addRule = (config: AgentConfig, type: RuleType): AgentConfig => {
  const kind = PRONUNCIATION_KINDS.find((k) => k.type === type);
  if (!kind) return config;
  return editSpeech(config, (s) => {
    s.pronunciation = [...list(s.pronunciation), { type, ...clone(kind.seed) }];
  });
};

export const removeRule = (config: AgentConfig, index: number): AgentConfig =>
  editSpeech(config, (s) => {
    s.pronunciation = list(s.pronunciation).filter((_, i) => i !== index);
  });

/** Moves a rule: they apply in order, so the order matters. */
export const moveRule = (config: AgentConfig, from: number, to: number): AgentConfig => {
  const rules = list(config?.defaults?.conversation?.speech?.pronunciation);
  if (to < 0 || to >= rules.length || from < 0 || from >= rules.length || from === to) return config;
  return editSpeech(config, (s) => {
    const next = [...list(s.pronunciation)];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    s.pronunciation = next;
  });
};

/** Sets fields of one rule; undefined or '' takes an optional field out. */
export const setRule = (config: AgentConfig, index: number, patch: Json): AgentConfig =>
  editSpeech(config, (s) => {
    s.pronunciation = list<Json>(s.pronunciation).map((r, i) => {
      if (i !== index || !isObj(r)) return r;
      const next = { ...r };
      Object.entries(patch).forEach(([k, v]) => {
        if (v === undefined || (v === '' && !['pattern', 'replacement', 'major_unit'].includes(k))) delete next[k];
        else next[k] = v;
      });
      return next;
    });
  });

/** Which speech goes through the rules: only the model's words ('model', the default), or fixed lines too ('all'). */
export const setApplyTo = (config: AgentConfig, value: 'model' | 'all' | ''): AgentConfig =>
  editSpeech(config, (s) => {
    if (value) s.apply_to = value;
    else delete s.apply_to;
  });

/** "One per line: written = said" for a word list, and back. Lines without "=" are left out. */
export const entriesToText = (entries: unknown): string =>
  Object.entries(isObj(entries) ? entries : {})
    .map(([k, v]) => `${k} = ${text(v)}`)
    .join('\n');
export function textToEntries(typed: string): Record<string, string> {
  const out: Record<string, string> = {};
  typed.split('\n').forEach((line) => {
    const at = line.indexOf('=');
    if (at <= 0) return;
    const key = line.slice(0, at).trim();
    if (key) out[key] = line.slice(at + 1).trim();
  });
  return out;
}

/** One rule in words, for its row. */
export function pronunciationWords(rule: Json): string {
  switch (rule.type) {
    case 'dictionary': {
      const n = Object.keys(isObj(rule.entries) ? rule.entries : {}).length;
      return n ? `Says ${n} word${n === 1 ? '' : 's'} its own way` : 'A word list with no words yet';
    }
    case 'replace':
      return rule.pattern ? `Says “${text(rule.replacement)}” for /${text(rule.pattern)}/` : 'A find-and-replace with no pattern yet';
    case 'spell':
      return rule.pattern ? `Spells out what matches /${text(rule.pattern)}/` : 'Spells out letter by letter (no pattern yet)';
    case 'digits':
      return `Reads numbers of ${num(rule.min_length) ?? 6} or more digits in groups of ${num(rule.group_size) ?? 4}`;
    case 'currency':
      return `Says amounts${list(rule.symbols).length ? ` after ${list(rule.symbols).map(text).join(' or ')}` : ''} in ${text(rule.major_unit) || '?'}${rule.minor_unit ? ` and ${text(rule.minor_unit)}` : ''}`;
    case 'time':
      return 'Says times of day as they are spoken';
    case 'date':
      return 'Says dates as they are spoken';
    default:
      return `A rule: ${ruleWords(rule.type)}`;
  }
}

// ---- the server's answer to "Try a line" ------------------------------------------------------------------------------------------------
export interface SpeechPreview {
  spoken: string;
  text: string;
  changes: { rule: number | undefined; type: string; label: string; from: string; to: string }[];
  applies: boolean;
  whyNot: string;
  applyTo: string;
  heldBack: string;
  streaming: string[] | null;
  problems: string[];
}

/** POST /preview/speech, read tolerantly: a missing part is left out, never an error. */
export function normalizeSpeech(raw: unknown): SpeechPreview {
  const r = (isObj(raw) ? raw : {}) as Json;
  return {
    spoken: text(r.spoken),
    text: text(r.text),
    changes: list<Json>(r.changes).map((c) => ({
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

/** One line about what happened, for the top of the result. */
export function speechVerdict(view: SpeechPreview): string {
  if (!view.applies) return view.whyNot || 'No pronunciation rule applies here.';
  if (!view.changes.length) return 'Nothing in this line is changed: the voice would be given it as written.';
  return `${view.changes.length} change${view.changes.length === 1 ? '' : 's'} before the voice speaks it.`;
}

/** The body for POST /preview/speech: pieces typed with | between them are sent as the streamed chunks. */
export function speechRequest(config: AgentConfig, line: string, opts: { agent?: string; channel?: string; source?: 'model' | 'fixed'; pieces?: string } = {}): Json {
  const chunks = (opts.pieces ?? '')
    .split('|')
    .map((p) => p.replace(/^\s/, ''))
    .filter((p) => p !== '');
  return {
    config,
    text: line,
    ...(opts.agent ? { agent: opts.agent } : {}),
    ...(opts.channel ? { channel: opts.channel } : {}),
    source: opts.source ?? 'model',
    ...(chunks.length ? { chunks } : {}),
  };
}
