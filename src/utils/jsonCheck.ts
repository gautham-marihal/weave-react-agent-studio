// Reading the configuration's JSON text: whether it parses, keys written twice (JSON.parse silently keeps only the last),
// where a path such as ["agents", "items", 0] sits in the text, and what to mark where in the code editor (a syntax error,
// both places of a repeated key, and while it parses, the server's errors and warnings at the setting they name).
// Pure: no React, no DOM.
import type { ValidationReport } from '../types/studio';

export type JsonPathPart = string | number;

export type JsonCheck =
{ok: true;value: unknown;} |
{ok: false;message: string;line: number | null;duplicates?: Duplicate[];};

/** A key written twice in one object: the object's path, the key, where the repeat starts and where the first one does. */
export interface Duplicate {
  path: JsonPathPart[];
  key: string;
  /** Where the repeat (the one JSON.parse would keep) starts in the text. */
  offset: number;
  /** Where the first one (the one that would be lost) starts. */
  firstOffset: number;
}

/** 1-based line number of a character offset. */
export function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

/** The offset of the start of a 1-based line. */
export function offsetOfLine(text: string, line: number): number {
  let at = 0;
  for (let n = 1; n < line; n += 1) {
    const next = text.indexOf('\n', at);
    if (next < 0) return text.length;
    at = next + 1;
  }
  return at;
}

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '/': '/', '\\': '\\', '"': '"' };

/** Every key written twice in the same object. Text that isn't valid JSON gives what was found before the problem. */
export function findDuplicateKeys(text: string): Duplicate[] {
  const found: Duplicate[] = [];
  const n = text.length;
  let i = 0;
  class Stop extends Error {}
  const fail = (): never => {
    throw new Stop();
  };
  const skipWs = () => {
    while (i < n && ' \t\r\n'.includes(text[i])) i += 1;
  };
  const readString = (): string => {
    if (text[i] !== '"') fail();
    i += 1;
    let out = '';
    while (i < n && text[i] !== '"') {
      if (text[i] === '\\') {
        const next = text[i + 1];
        if (next === 'u') {
          out += String.fromCharCode(Number.parseInt(text.slice(i + 2, i + 6), 16) || 0);
          i += 6;
        } else {
          out += ESCAPES[next] ?? next ?? '';
          i += 2;
        }
      } else {
        out += text[i];
        i += 1;
      }
    }
    if (i >= n) fail();
    i += 1;
    return out;
  };
  const readValue = (path: JsonPathPart[]): void => {
    skipWs();
    const c = text[i];
    if (c === '{') {
      i += 1;
      const seen = new Map<string, number>();
      skipWs();
      if (text[i] === '}') {
        i += 1;
        return;
      }
      for (;;) {
        skipWs();
        const keyStart = i;
        const key = readString();
        skipWs();
        if (text[i] !== ':') fail();
        i += 1;
        const first = seen.get(key);
        if (first !== undefined) found.push({ path: [...path], key, offset: keyStart, firstOffset: first });else
        seen.set(key, keyStart);
        readValue([...path, key]);
        skipWs();
        if (text[i] === ',') {
          i += 1;
          continue;
        }
        if (text[i] === '}') {
          i += 1;
          return;
        }
        fail();
      }
    } else if (c === '[') {
      i += 1;
      skipWs();
      if (text[i] === ']') {
        i += 1;
        return;
      }
      for (let index = 0;; index += 1) {
        readValue([...path, index]);
        skipWs();
        if (text[i] === ',') {
          i += 1;
          continue;
        }
        if (text[i] === ']') {
          i += 1;
          return;
        }
        fail();
      }
    } else if (c === '"') {
      readString();
    } else {
      const start = i;
      while (i < n && !' \t\r\n,]}'.includes(text[i])) i += 1;
      if (i === start) fail();
    }
  };
  try {
    readValue([]);
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
  }
  return found;
}

const placeOf = (path: JsonPathPart[]) =>
path.length ? path.map((part, index) => typeof part === 'number' ? `[${part}]` : `${index ? '.' : ''}${part}`).join('') : 'the top level';

/** A sentence for the person: which key, where, on which lines, and why it matters. */
export function describeDuplicates(duplicates: Duplicate[], lineAt: (offset: number) => number): string {
  const first = duplicates[0];
  const more = duplicates.length > 1 ? ` (and ${duplicates.length - 1} more)` : '';
  return `The key “${first.key}” appears twice in ${placeOf(first.path)}, on lines ${lineAt(first.firstOffset)} and ${lineAt(first.offset)}${more}. JSON keeps only the last one, so a setting would be lost without warning. Remove one; nothing is saved, validated or published until then.`;
}

/** A syntax error's line: the one the browser names ("(line 3 column 22)"), else the line of its "at position 1234". */
export function syntaxErrorLine(message: unknown, text: string): number | null {
  const named = /\(line (\d+) column \d+\)/.exec(String(message ?? ''));
  if (named) return Number(named[1]);
  const at = /position (\d+)/.exec(String(message ?? ''));
  return at ? lineOf(text, Number(at[1])) : null;
}

/** Where the browser's parse error points: "(line 3 column 22)", else "at position 1234", else nowhere. */
export function syntaxErrorOffset(message: string, text: string): number | null {
  const named = /\(line (\d+) column (\d+)\)/.exec(message);
  if (named) return Math.min(text.length, offsetOfLine(text, Number(named[1])) + Number(named[2]) - 1);
  const at = /position (\d+)/.exec(message);
  if (at) return Math.min(text.length, Number(at[1]));
  return null;
}

/**
 * Whether the text is a JSON object with no key written twice. A repeated key is an error here, not a silent loss: the
 * draft keeps the last good version until it is fixed.
 */
export function checkJson(text: string): JsonCheck {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid JSON';
    return { ok: false, message: msg.replace(/^JSON\.parse: /, ''), line: syntaxErrorLine(msg, text) };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, message: 'The configuration must be a JSON object, starting with {.', line: 1 };
  }
  const duplicates = findDuplicateKeys(text);
  if (duplicates.length) {
    return { ok: false, message: describeDuplicates(duplicates, (o) => lineOf(text, o)), line: lineOf(text, duplicates[0].offset), duplicates };
  }
  return { ok: true, value };
}

/**
 * Where a path lives in valid JSON text, as [from, to) offsets of its value. When the exact path does not exist the
 * nearest existing ancestor is returned; null when the text can't be read.
 */
export function locatePath(text: string, path: readonly JsonPathPart[]): [number, number] | null {
  let i = 0;
  const skipWs = () => {
    while (i < text.length && ' \t\r\n'.includes(text[i])) i += 1;
  };
  const readString = () => {
    const start = i;
    i += 1;
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i += 1;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const skipValue = () => {
    skipWs();
    const ch = text[i];
    if (ch === '"') {
      readString();
      return;
    }
    if (ch === '{' || ch === '[') {
      let depth = 0;
      while (i < text.length) {
        const c = text[i];
        if (c === '"') {
          readString();
          continue;
        }
        if (c === '{' || c === '[') depth += 1;
        if (c === '}' || c === ']') {
          depth -= 1;
          if (depth === 0) {
            i += 1;
            return;
          }
        }
        i += 1;
      }
      return;
    }
    while (i < text.length && !',}] \t\r\n'.includes(text[i])) i += 1;
  };
  const walk = (rest: readonly JsonPathPart[]): [number, number] => {
    skipWs();
    const start = i;
    if (rest.length === 0) {
      skipValue();
      return [start, i];
    }
    const ch = text[i];
    if (ch === '{') {
      i += 1;
      for (;;) {
        skipWs();
        if (i >= text.length || text[i] === '}') {
          i += 1;
          break;
        }
        const key = readString();
        skipWs();
        i += 1; // the colon
        if (String(rest[0]) === key) return walk(rest.slice(1));
        skipValue();
        skipWs();
        if (text[i] === ',') i += 1;
      }
      return [start, i];
    }
    if (ch === '[') {
      i += 1;
      let index = 0;
      for (;;) {
        skipWs();
        if (i >= text.length || text[i] === ']') {
          i += 1;
          break;
        }
        if (Number(rest[0]) === index) return walk(rest.slice(1));
        skipValue();
        skipWs();
        if (text[i] === ',') i += 1;
        index += 1;
      }
      return [start, i];
    }
    skipValue();
    return [start, i];
  };
  try {
    return walk(Array.isArray(path) ? path : []);
  } catch {
    return null;
  }
}

// ---- what the code editor marks ------------------------------------------------------------------------------------
export interface JsonProblem {
  from: number;
  to: number;
  severity: 'error' | 'warning';
  message: string;
}

const lineEnd = (text: string, at: number) => {
  const end = text.indexOf('\n', at);
  return end < 0 ? text.length : end;
};

// The end of the word at a place: a quoted string to its closing quote, else up to a space, bracket, comma or colon.
const tokenEnd = (text: string, at: number): number => {
  if (at >= text.length) return at;
  let i = at + 1;
  if (text[at] === '"') {
    while (i < text.length && text[i] !== '"' && text[i] !== '\n') i += text[i] === '\\' ? 2 : 1;
    return Math.min(text.length, i + 1);
  }
  while (i < text.length && !' \t\r\n,:{}[]'.includes(text[i])) i += 1;
  return i;
};

/**
 * What is wrong with the text, at the characters it is about: a syntax error, a key written twice (both places), and
 * while it parses, the server's errors and warnings at the setting they name (a multi-line value on its first line).
 */
export function jsonProblems(
text: string,
parsed: {error?: string | null;duplicates?: Duplicate[] | null;},
report: Pick<ValidationReport, 'errors' | 'warnings'> | null | undefined)
: JsonProblem[] {
  const out: JsonProblem[] = [];
  const duplicates = parsed.duplicates ?? [];
  if (duplicates.length) {
    for (const d of duplicates) {
      const message = describeDuplicates([d], (o) => lineOf(text, o));
      const width = JSON.stringify(d.key).length;
      for (const at of [d.firstOffset, d.offset]) out.push({ from: at, to: Math.min(text.length, at + width), severity: 'error', message });
    }
    return out;
  }
  if (parsed.error) {
    const at = syntaxErrorOffset(parsed.error, text) ?? (syntaxErrorLine(parsed.error, text) ? offsetOfLine(text, syntaxErrorLine(parsed.error, text) as number) : null);
    if (at !== null) out.push({ from: at, to: tokenEnd(text, at), severity: 'error', message: parsed.error });
    return out;
  }
  const issues = [
  ...(report?.errors ?? []).map((i) => ({ ...i, severity: 'error' as const })),
  ...(report?.warnings ?? []).map((i) => ({ ...i, severity: 'warning' as const }))];

  for (const issue of issues) {
    if (!Array.isArray(issue.path) || !issue.path.length) continue;
    const span = locatePath(text, issue.path);
    if (!span) continue;
    const from = Math.min(span[0], text.length);
    out.push({ from, to: Math.max(from, Math.min(span[1], lineEnd(text, from))), severity: issue.severity, message: issue.message });
  }
  return out;
}

/** The lines with an error, for the plain editor that marks lines only. */
export const errorLinesOf = (text: string, problems: JsonProblem[]): Set<number> =>
new Set(problems.filter((p) => p.severity === 'error').map((p) => lineOf(text, p.from)));

/** A path typed by a person ("agents.items[0].tools", "tools.2") as path parts; null when it can't be read. */
export function parsePathText(input: string): JsonPathPart[] | null {
  const typed = input.trim().replace(/^\$\.?/, '');
  if (!typed) return null;
  const out: JsonPathPart[] = [];
  const re = /([^.[\]]+)|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  let consumed = '';
  while ((m = re.exec(typed)) !== null) {
    consumed += m[0];
    if (m[2] !== undefined) out.push(Number(m[2]));else
    out.push(/^\d+$/.test(m[1]) ? Number(m[1]) : m[1]);
  }
  return out.length && consumed.length === typed.replace(/\./g, '').length ? out : null;
}
