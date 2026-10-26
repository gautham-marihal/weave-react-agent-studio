import { describeDuplicates } from '../jsonDuplicates.js';
import { lineOf, locatePath, syntaxErrorLine } from '../jsonPath.js';
import { groupIssues } from '../../api/client.ts';
import type { ValidationReport } from '../../api/types.ts';

// What is wrong with the configuration's JSON text, each at the characters it is about, for the editor to mark: a
// syntax error (where the browser says it is), a key written twice (both places), and, while the JSON reads, what the
// checks say (errors and warnings, at the setting they name; a setting that spans many lines is marked on its first).
// The words are the ones the studio already says about each.

export type JsonProblem = { from: number; to: number; severity: 'error' | 'warning'; message: string };
type Duplicate = { key: string; path: (string | number)[]; offset: number; firstOffset: number };
export type Parsed = { error?: string | null; duplicates?: Duplicate[] | null };

const lineEnd = (text: string, at: number) => {
  const end = text.indexOf('\n', at);
  return end < 0 ? text.length : end;
};

// the end of the word at a place: a quoted string to its closing quote, else up to a space or a bracket, comma or colon (at least one character)
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

// the offset of the start of a 1-based line
export const offsetOfLine = (text: string, line: number): number => {
  let at = 0;
  for (let n = 1; n < line; n += 1) {
    const next = text.indexOf('\n', at);
    if (next < 0) return text.length;
    at = next + 1;
  }
  return at;
};

// where the browser's parse error points: "(line 3 column 22)", else "at position 1234", else nowhere
export function syntaxErrorOffset(message: string, text: string): number | null {
  const named = /\(line (\d+) column (\d+)\)/.exec(message);
  if (named) return Math.min(text.length, offsetOfLine(text, Number(named[1])) + Number(named[2]) - 1);
  const at = /position (\d+)/.exec(message);
  if (at) return Math.min(text.length, Number(at[1]));
  const line = syntaxErrorLine(message, text);
  return line ? offsetOfLine(text, line) : null;
}

export function jsonProblems(text: string, parsed: Parsed, report: Partial<ValidationReport> | null | undefined): JsonProblem[] {
  const out: JsonProblem[] = [];
  const duplicates = parsed.duplicates || [];
  if (duplicates.length) {
    const lineAt = (offset: number) => lineOf(text, offset);
    for (const d of duplicates) {
      const message = describeDuplicates([d], lineAt);
      const width = JSON.stringify(d.key).length;
      for (const at of [d.firstOffset, d.offset]) out.push({ from: at, to: Math.min(text.length, at + width), severity: 'error', message });
    }
    return out;
  }
  if (parsed.error) {
    const at = syntaxErrorOffset(parsed.error, text);
    if (at !== null) out.push({ from: at, to: tokenEnd(text, at), severity: 'error', message: parsed.error });
    return out;
  }
  for (const issue of groupIssues(report)) {
    if (!issue.path) continue;
    const span = locatePath(text, issue.path);
    if (!span) continue;
    const from = Math.min(span[0], text.length);
    out.push({
      from,
      to: Math.max(from, Math.min(span[1], lineEnd(text, from))),
      severity: issue.severity === 'error' ? 'error' : 'warning',
      message: issue.message,
    });
  }
  return out;
}

// the lines with an error, for an editor that marks lines only
export const errorLinesOf = (text: string, problems: JsonProblem[]): Set<number> =>
  new Set(problems.filter((p) => p.severity === 'error').map((p) => lineOf(text, p.from)));
