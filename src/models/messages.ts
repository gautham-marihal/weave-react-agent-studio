// Fixed lines (`messages`): one line, or the same line in several languages. The primary language is required when there
// is more than one (the validator says so); every language the agent speaks should be there too, or a caller in that
// language hears the wrong one. Also what a `say` value comes to (a text, or a reference to a fixed line). Pure.

/** A message's text: one line, or the line per language code. */
export type MessageText = string | Record<string, string>;

/** One fixed line as the config keeps it. */
export interface FixedLine {
  id: string;
  text?: MessageText;
  [key: string]: unknown;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = <T = unknown,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
type LanguageConfig = { defaults?: { language?: { primary?: unknown; speaks?: unknown } } } | null | undefined;
const textMap = (value: unknown): value is Record<string, string> => isObj(value);

export const LANGUAGE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]+)?$/;

/** "en-US" -> "en" */
export const baseOf = (code: unknown): string =>
  String(code || '')
    .split('-')[0]
    .toLowerCase();

/** The language the agent mainly speaks, as it is written in the config ('' when none is set). */
export const primaryOf = (config: unknown): string => {
  const language = (config as LanguageConfig)?.defaults?.language;
  if (typeof language?.primary === 'string' && language.primary) return language.primary;
  const speaks = language?.speaks;
  const first = Array.isArray(speaks) ? speaks.find((code): code is string => typeof code === 'string' && !!code) : '';
  return first || '';
};

/**
 * Every language a message should cover, in order: the primary first, then the rest the agent speaks. Duplicates by
 * base language (en and en-US) count once, because a text written for "en" serves "en-US".
 */
export function wantedLanguages(config: unknown): string[] {
  const primary = primaryOf(config);
  const speaks = (config as LanguageConfig)?.defaults?.language?.speaks;
  const out: string[] = [];
  [primary, ...(Array.isArray(speaks) ? speaks : [])].forEach((code) => {
    if (typeof code === 'string' && code && !out.some((have) => baseOf(have) === baseOf(code))) out.push(code);
  });
  return out;
}

/** Does a text map have an entry for this language (an exact code, or one with the same base)? */
export const hasLanguage = (map: unknown, code: string): boolean => textMap(map) && Object.keys(map).some((key) => baseOf(key) === baseOf(code));

export type LanguageStatus = { kind: 'plain' | 'languages'; have: string[]; missing: string[]; primaryMissing: boolean };

/** What a message's text covers. */
export function languageStatus(text: unknown, config: unknown): LanguageStatus {
  const wanted = wantedLanguages(config);
  if (!textMap(text)) return { kind: 'plain', have: [], missing: [], primaryMissing: false };
  const have = Object.keys(text);
  const missing = wanted.filter((code) => !hasLanguage(text, code));
  const primary = primaryOf(config);
  return { kind: 'languages', have, missing, primaryMissing: !!primary && !hasLanguage(text, primary) };
}

/**
 * One text for everyone -> per language, starting with what is there under the primary language (written as its base,
 * "en", the way the example configuration does: a text for "en" serves "en-US").
 */
export function toLanguages(text: unknown, config: unknown): Record<string, string> {
  if (textMap(text)) return text;
  return { [baseOf(primaryOf(config)) || 'en']: typeof text === 'string' ? text : '' };
}

/** Per language -> one text (the primary language's, else the first that has any). */
export function toPlain(text: unknown, config: unknown): string {
  if (!textMap(text)) return typeof text === 'string' ? text : '';
  const primary = primaryOf(config);
  const key = Object.keys(text).find((code) => primary && baseOf(code) === baseOf(primary)) || Object.keys(text)[0];
  return key ? String(text[key] ?? '') : '';
}

/** The languages a card names in its header: "en, es · missing fr", or '' for a plain text. */
export function languageHint(message: unknown, config: unknown): string {
  const text = (message as { text?: unknown } | null | undefined)?.text;
  if (!isObj(message) || !textMap(text)) return '';
  const status = languageStatus(text, config);
  const missing = status.missing.length ? ` · missing ${status.missing.join(', ')}` : '';
  return `${status.have.join(', ')}${missing}`;
}

/** A language code that is fit to add: the pattern, and not there already. '' when it is fine. */
export function languageProblem(code: unknown, map: unknown): string {
  const text = String(code || '').trim();
  if (!text) return 'Type a language code, such as fr or pt-BR.';
  if (!LANGUAGE_PATTERN.test(text)) return 'Use a language code such as fr, es or pt-BR.';
  if (textMap(map) && text in map) return `“${text}” is already there.`;
  return '';
}

/** A message's text in the primary language (else the first one there). */
export function textOf(message: unknown, config: unknown): string {
  const text = isObj(message) ? message.text : undefined;
  if (typeof text === 'string') return text;
  if (!textMap(text)) return '';
  const primary = baseOf(primaryOf(config));
  const key = Object.keys(text).find((k) => baseOf(k) === primary) || Object.keys(text)[0];
  return key ? String(text[key]) : '';
}

/** What a `say` value (a text, or a { message } reference to a fixed line) comes to; '' when nothing. */
export function speechText(speech: unknown, config: unknown): string {
  if (typeof speech === 'string') return speech;
  if (isObj(speech) && typeof speech.message === 'string' && speech.message)
    return textOf(
      list<Json>((config as { messages?: unknown } | null | undefined)?.messages).find((m) => isObj(m) && m.id === speech.message),
      config
    );
  return '';
}

// ---- the list of fixed lines --------------------------------------------------------------------------------------------------------------
type Cfg = { messages?: unknown; [key: string]: unknown };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The fixed lines, as the config has them (anything that is not a line is left out). */
export const messagesOf = (config: unknown): FixedLine[] =>
  list<Json>((config as Cfg | null | undefined)?.messages).filter((m): m is FixedLine => isObj(m) && typeof m.id === 'string');

function withMessages(config: Cfg, change: (items: Json[]) => Json[]): Cfg {
  const next = clone(config ?? {});
  const items = change(list<Json>(next.messages).map((m) => (isObj(m) ? { ...m } : m)));
  if (items.length) next.messages = items;
  else delete next.messages;
  return next;
}

/** An id fit for a new line: lowercase words joined by _, numbered when taken. */
export function freeMessageId(config: unknown, base = 'line'): string {
  const taken = messagesOf(config).map((m) => m.id);
  const clean = String(base).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[^a-z]+/, '') || 'line';
  let id = clean;
  for (let n = 2; taken.includes(id); n++) id = `${clean}_${n}`;
  return id;
}

/** Adds a line at the end, in one text (per language once more than one is spoken). */
export function addMessage<T extends Cfg>(config: T, text = ''): { config: T; id: string } {
  const id = freeMessageId(config);
  const wanted = wantedLanguages(config);
  const value: MessageText = wanted.length > 1 ? Object.fromEntries(wanted.map((code, i) => [i === 0 ? baseOf(code) : code, i === 0 ? text : ''])) : text;
  return { config: withMessages(config, (items) => [...items, { id, text: value }]) as T, id };
}

/** Changes a line's text (one text, or a map per language). */
export const setMessageText = <T extends Cfg>(config: T, index: number, text: MessageText): T =>
  withMessages(config, (items) => items.map((m, i) => (i === index ? { ...m, text } : m))) as T;

/** Its note for the team, and whether a caller may talk over it (true is the default, so it is taken out). */
export const setMessageField = <T extends Cfg>(config: T, index: number, key: 'description' | 'allow_interruptions', value: string | boolean): T =>
  withMessages(config, (items) =>
    items.map((m, i) => {
      if (i !== index) return m;
      const next = { ...m };
      if (key === 'description') {
        if (String(value).trim()) next.description = String(value);
        else delete next.description;
      } else if (value === true) delete next.allow_interruptions;
      else next.allow_interruptions = false;
      return next;
    })
  ) as T;

export const removeMessage = <T extends Cfg>(config: T, index: number): T => withMessages(config, (items) => items.filter((_, i) => i !== index)) as T;

/** A copy of a list with one item moved (out of range leaves it as it is). */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (!Array.isArray(items) || to < 0 || to >= items.length || from < 0 || from >= items.length || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Moves a line in the list (the order is how they are listed; references go by id, so nothing else changes). */
export const moveMessage = <T extends Cfg>(config: T, from: number, to: number): T => {
  const items = list<Json>(config?.messages);
  const moved = moveItem(items, from, to);
  return moved === items ? config : (withMessages(config, () => moved) as T);
};

/** Where a line is used: every place that says { message: id }, as the dotted path to it. */
export function messageUses(config: unknown, id: string): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string[]) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...path, String(i)]));
    else if (isObj(v)) {
      if (v.message === id && Object.keys(v).length === 1 && path[0] !== 'messages') out.push(path.join('.'));
      Object.entries(v).forEach(([k, x]) => walk(x, [...path, k]));
    }
  };
  walk(config, []);
  return out;
}

/** A place a line is used, in words: "the web chat greeting", "the end call tool". */
export function placeWords(path: string, config: unknown): string {
  const parts = path.split('.');
  const at = (p: string[]) => p.reduce<unknown>((v, k) => (isObj(v) || Array.isArray(v) ? (v as Record<string, unknown>)[k] : undefined), config);
  const name = (v: unknown) => (isObj(v) ? String(v.name ?? v.id ?? '') : '').replace(/[_-]+/g, ' ');
  if (parts[0] === 'channels') return `the greeting on ${name(at(parts.slice(0, 2))) || 'a channel'}`;
  if (parts[0] === 'tools') return `the tool “${name(at(parts.slice(0, 2)))}”`;
  if (parts[0] === 'guardrails') return 'a guardrail';
  if (parts[0] === 'agents') return `the agent “${name(at(parts.slice(0, 3)))}”`;
  if (parts[0] === 'defaults') return 'the conversation settings';
  if (parts[0] === 'telephony') return 'a phone transfer';
  if (parts[0] === 'wrapups') return 'a closing message';
  return parts[0].replace(/_/g, ' ');
}
