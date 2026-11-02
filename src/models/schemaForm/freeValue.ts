// What a free value box or a JSON box takes from what was typed. JSON with a key written twice is held back with the
// reason: applying it would quietly lose one of the two values. Pure: no React, no DOM.

/** The first key written twice in the same object of a JSON text, or null. (The text is assumed to parse.) */
export function repeatedKey(text: string): string | null {
  const stack: (Set<string> | null)[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      let raw = '';
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\') {
          raw += text.slice(j, j + 2);
          j += 2;
        } else {
          raw += text[j];
          j += 1;
        }
      }
      let k = j + 1;
      while (k < text.length && /\s/.test(text[k])) k += 1;
      const top = stack[stack.length - 1];
      if (text[k] === ':' && top) {
        const key = JSON.parse(`"${raw}"`) as string;
        if (top.has(key)) return key;
        top.add(key);
      }
      i = j + 1;
      continue;
    }
    if (c === '{') stack.push(new Set());
    else if (c === '[') stack.push(null);
    else if (c === '}' || c === ']') stack.pop();
    i += 1;
  }
  return null;
}

/** JSON.parse, refusing a key written twice in one object. */
export function parseJsonStrict(text: string): unknown {
  const value = JSON.parse(text) as unknown;
  const twice = repeatedKey(text);
  if (twice !== null) throw new Error(`“${twice}” appears twice in the same object`);
  return value;
}

// A text that reads as something other than text: a number, true/false/null.
const READS_AS_JSON = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)$/;

/** How a value is shown in a free value box: text as it is, anything else as JSON. */
export function showFreeValue(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return READS_AS_JSON.test(value.trim()) || /^[[{"]/.test(value.trim()) ? JSON.stringify(value) : value;
  return JSON.stringify(value);
}

/** What was typed in a free value box: JSON when it reads as JSON, else the text; or why it is held back. */
export function readFreeValue(raw: string): { value: unknown } | { problem: string } {
  const t = raw.trim();
  if (READS_AS_JSON.test(t) || /^[[{]/.test(t) || /^".*"$/.test(t)) {
    try {
      return { value: parseJsonStrict(t) };
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      return /appears twice/.test(message) ? { problem: message } : { value: raw };
    }
  }
  return { value: raw };
}
