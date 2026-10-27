// JSON.parse silently keeps only the last of two equal keys, so the editor looks for repeats in the raw text first.
// findDuplicateKeys(text) -> [{ path, key, offset, firstOffset }]
//   path         the object that repeats the key, as keys and array indexes (the same shape the API's errors use)
//   key          the repeated key
//   offset       where the repeat starts in the text (the one that would win)
//   firstOffset  where the first one starts (the one that would be lost)
// Text that isn't valid JSON gives whatever was found before the problem; the parse error is reported separately.

const ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '/': '/', '\\': '\\', '"': '"' };

export function findDuplicateKeys(text) {
  const found = [];
  const n = text.length;
  let i = 0;

  class Stop extends Error {}
  const fail = () => {
    throw new Stop();
  };
  const skipWs = () => {
    while (i < n && ' \t\r\n'.includes(text[i])) i += 1;
  };

  const readString = () => {
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

  const readValue = (path) => {
    skipWs();
    const c = text[i];
    if (c === '{') {
      i += 1;
      const seen = new Map();
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
        if (seen.has(key)) found.push({ path: [...path], key, offset: keyStart, firstOffset: seen.get(key) });
        else seen.set(key, keyStart);
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
      for (let index = 0; ; index += 1) {
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

// A sentence for the person: which key, where, and why it matters.
export function describeDuplicates(duplicates, lineOf) {
  const first = duplicates[0];
  const where = first.path.length
    ? first.path.map((part, index) => (typeof part === 'number' ? `[${part}]` : `${index ? '.' : ''}${part}`)).join('')
    : 'the top level';
  const more = duplicates.length > 1 ? ` (and ${duplicates.length - 1} more)` : '';
  return `The key “${first.key}” appears twice in ${where}, on lines ${lineOf(first.firstOffset)} and ${lineOf(first.offset)}${more}. JSON keeps only the last one, so a setting would be lost without warning. Remove one; nothing is saved, validated or published until then.`;
}

// JSON.parse, except that a repeated key is an error instead of a silent loss. For boxes that take pasted JSON.
export function parseJsonStrict(text) {
  const value = JSON.parse(text);
  const duplicates = findDuplicateKeys(text);
  if (duplicates.length) {
    const lineOf = (offset) => text.slice(0, offset).split(String.fromCharCode(10)).length;
    throw new Error(describeDuplicates(duplicates, lineOf));
  }
  return value;
}
