// Where a `path` (["agents", "items", 0]) lives in valid JSON *text*, so a validation error can be highlighted.
// If the exact path does not exist, the nearest existing ancestor is returned.

export function locatePath(text, path) {
  let i = 0;
  const skipWs = () => {
    while (i < text.length && ' \t\r\n'.includes(text[i])) i += 1;
  };

  const readString = () => {
    const start = i;
    i += 1;
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i += 1;
    return { start, end: i, value: JSON.parse(text.slice(start, i)) };
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

  const walk = (rest) => {
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
        if (String(rest[0]) === key.value) return walk(rest.slice(1));
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

// 1-based line number of a character offset.
export function lineOf(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

// A syntax error's line: the one the browser names ("(line 3 column 22)"), else the line of its "at position 1234".
export function syntaxErrorLine(message, text) {
  const named = /\(line (\d+) column \d+\)/.exec(String(message || ''));
  if (named) return Number(named[1]);
  const at = /position (\d+)/.exec(String(message || ''));
  return at ? lineOf(text, Number(at[1])) : null;
}
