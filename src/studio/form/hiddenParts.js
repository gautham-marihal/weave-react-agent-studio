// The parts of a value that a page asks for somewhere else (`hidden`: the form's set of 'a.b.c' paths), and nothing else: what is left when the form takes
// out what it shows (its Delete, its "Reset to defaults"), so a setting asked by a card above the form is never removed from below it. undefined when
// none of those parts is set. Pure: no React, no DOM.

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

//   base: the value's own path, 'post_call.redaction'
export function hiddenParts(value, base, hidden) {
  const prefix = `${base}.`;
  const paths = hidden ? [...hidden].filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length).split('.')) : [];
  if (!paths.length || !isObj(value)) return undefined;
  const kept = {};
  paths.forEach((parts) => {
    let from = value;
    for (const key of parts) from = isObj(from) ? from[key] : undefined;
    if (from === undefined) return;
    let into = kept;
    parts.slice(0, -1).forEach((key) => {
      into[key] = isObj(into[key]) ? into[key] : {};
      into = into[key];
    });
    into[parts.at(-1)] = JSON.parse(JSON.stringify(from));
  });
  return Object.keys(kept).length ? kept : undefined;
}
