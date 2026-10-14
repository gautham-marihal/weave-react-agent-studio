// The paths a tool uses to pick fields out of an API response (`result.to_llm`, `result.to_state`). The runtime
// understands a small subset, not full JSONPath:
//
//   $.a.b          a field of a field
//   $.a[0].b       an element of a list
//   $['a-b']       a field whose name isn't a plain word (a hyphen, a dot, a space)
//   $.items[*].id  that field of every element
//
// No filters (?(…)), no recursive descent (..), no slices. A path that uses them, or one that matches nothing, gives
// NO error at runtime: the value is simply empty. So the form checks the grammar and tries paths on a sample response.
// Pure: no network, no DOM.

const WORD = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parsePath(text) {
  const source = String(text ?? '').trim();
  if (!source) throw new Error('Enter a path, for example $.balance');
  if (source[0] !== '$') throw new Error('A path starts with $, for example $.balance');
  const segments = [];
  let i = 1;
  while (i < source.length) {
    const c = source[i];
    if (c === '.') {
      if (source[i + 1] === '.') throw new Error('“..” (search everywhere) isn’t supported. Name each step: $.a.b');
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i + 1));
      if (!match) throw new Error(`Expected a field name after “.” at position ${i + 1}. A name with a hyphen or dot goes in brackets: $['a-b']`);
      segments.push({ key: match[0] });
      i += 1 + match[0].length;
    } else if (c === '[') {
      const close = source.indexOf(']', i);
      if (close === -1) throw new Error('A “[” is never closed.');
      const inner = source.slice(i + 1, close).trim();
      if (inner === '*') segments.push({ all: true });
      else if (/^\d+$/.test(inner)) segments.push({ index: Number(inner) });
      else if (/^(['"]).*\1$/.test(inner)) segments.push({ key: inner.slice(1, -1) });
      else if (inner.startsWith('?')) throw new Error('Filters like [?(@.x > 1)] aren’t supported. Pick a field, an index [0] or [*].');
      else if (inner.includes(':')) throw new Error('Slices like [0:2] aren’t supported. Use [0], [1] or [*].');
      else throw new Error(`Don’t understand [${inner}]. Use [0], [*] or ['name'].`);
      i = close + 1;
    } else throw new Error(`Unexpected “${c}” at position ${i}. Steps are .name, [0], [*] or ['name'].`);
  }
  return segments;
}

export function validatePath(text) {
  try { return { ok: true, segments: parsePath(text) }; } catch (error) { return { ok: false, error: error.message }; }
}

// All the values a path picks out of `value` (empty when nothing matches).
export function evalPath(value, text) {
  let nodes = [value];
  for (const seg of parsePath(text)) {
    const next = [];
    nodes.forEach((node) => {
      if (seg.all) { if (Array.isArray(node)) next.push(...node); } else if ('index' in seg) { if (Array.isArray(node) && seg.index < node.length) next.push(node[seg.index]); } else if (node !== null && typeof node === 'object' && !Array.isArray(node) && seg.key in node) next.push(node[seg.key]);
    });
    nodes = next;
  }
  return nodes;
}

const step = (key) => (WORD.test(key) ? `.${key}` : `['${key.replace(/'/g, "\\'")}']`);

// The path of every leaf (and of every list of objects, as [*]) in a sample response, for picking from a tree.
export function samplePaths(sample, { max = 200 } = {}) {
  const out = [];
  const walk = (node, path, depth) => {
    if (out.length >= max || depth > 8) return;
    if (Array.isArray(node)) {
      if (!node.length) { out.push({ path, kind: 'list', preview: '[]' }); return; }
      const first = node[0];
      if (first !== null && typeof first === 'object') {
        out.push({ path: `${path}[*]`, kind: 'list', preview: `${node.length} item${node.length === 1 ? '' : 's'}` });
        walk(first, `${path}[*]`, depth + 1);
      } else out.push({ path: `${path}[*]`, kind: 'list', preview: node.slice(0, 3).map((x) => JSON.stringify(x)).join(', ') + (node.length > 3 ? '…' : '') });
    } else if (node !== null && typeof node === 'object') {
      Object.keys(node).forEach((key) => walk(node[key], `${path}${step(key)}`, depth + 1));
    } else out.push({ path, kind: node === null ? 'null' : typeof node, preview: node === null ? 'null' : String(node).slice(0, 60) });
  };
  walk(sample, '$', 0);
  return out;
}

// A short way to show what a path picked: "$.a → 42", "$.items[*].id → 3 values", "no match".
export function describeMatches(sample, text) {
  try {
    const found = evalPath(sample, text);
    if (!found.length) return { ok: false, text: 'matches nothing in the sample' };
    if (found.length === 1) return { ok: true, text: JSON.stringify(found[0]).slice(0, 80) };
    return { ok: true, text: `${found.length} values: ${found.slice(0, 3).map((x) => JSON.stringify(x)).join(', ')}${found.length > 3 ? '…' : ''}` };
  } catch (error) { return { ok: false, text: error.message }; }
}

// What the model would be shown: only the fields `to_llm` names (or the whole response when it names none).
export function modelSees(sample, toLlm) {
  const paths = Array.isArray(toLlm) ? toLlm.filter(Boolean) : [];
  if (!paths.length) return { whole: true, value: sample, missing: [] };
  const value = {};
  const missing = [];
  paths.forEach((path) => {
    try {
      const found = evalPath(sample, path);
      if (!found.length) missing.push(path); else value[path] = found.length === 1 ? found[0] : found;
    } catch { missing.push(path); }
  });
  return { whole: false, value, missing };
}
