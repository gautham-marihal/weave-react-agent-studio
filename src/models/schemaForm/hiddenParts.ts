// The parts of a value that a page asks for elsewhere (`hidden`: the form's 'a.b.c' paths), and nothing else. The
// form's Delete and "Reset to defaults" keep these, so a setting asked by a card above the form is never removed from
// below it. undefined when none is set. Pure: no React, no DOM.
import { isObj, type Json } from './engine';

//   base: the value's own path, 'post_call.redaction'
export function hiddenParts(value: unknown, base: string, hidden: Iterable<string> | null | undefined): Json | undefined {
  const prefix = `${base}.`;
  const paths = hidden ? [...hidden].filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length).split('.')) : [];
  if (!paths.length || !isObj(value)) return undefined;
  const kept: Json = {};
  paths.forEach((parts) => {
    let from: unknown = value;
    for (const key of parts) from = isObj(from) ? from[key] : undefined;
    if (from === undefined) return;
    let into = kept;
    parts.slice(0, -1).forEach((key) => {
      into[key] = isObj(into[key]) ? into[key] : {};
      into = into[key] as Json;
    });
    into[parts[parts.length - 1]] = JSON.parse(JSON.stringify(from));
  });
  return Object.keys(kept).length ? kept : undefined;
}
