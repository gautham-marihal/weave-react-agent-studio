// Two kinds of text a tool's request and response hold, and the hints the Tools page gives while they are typed:
//
// Templates, {{args.order_id}} {{state.name}} {{const.url}}: read by the runtime, so the page helps write them (chips
// to insert the names this config has) and hints at a name that points at nothing. Only ever a hint: the server's
// checks decide.
//
// Response paths (`result.to_llm`, `result.to_state`), a small subset of JSONPath the runtime reads:
//   found          a bare name is the same as $.found
//   $.a.b          a field of a field
//   $.a[0].b       an element of a list
//   $.a-b          a hyphen is fine after a dot; a name with a dot or a space goes in brackets: $['a.b']
//   $.items[*].id  that field of every element
// No filters, recursive descent or slices. A path using them, or matching nothing, gives no runtime error, just an
// empty value, so the page checks the grammar and tries paths on a pasted sample. Pure: no React, no network.

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

// ---- templates -----------------------------------------------------------------------------------------------------

/** Roots a template may start with in a tool. Only `state`, `const` and `args` names can be checked here. */
export const TEMPLATE_ROOTS = ['state', 'const', 'args', 'result', 'form', 'meta', 'call', 'channel', 'caller'];

export interface Template {
  start: number;
  end: number;
  expr: string;
  root: string;
  name: string;
  text: string;
}

/** Every {{ … }} in the text: `{{ state.intent | default('x') }}` gives root "state", name "intent". */
export function findTemplates(text: unknown): Template[] {
  const found: Template[] = [];
  const source = String(text ?? '');
  const block = /\{\{([^{}]*)\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = block.exec(source)) !== null) {
    const expr = match[1];
    const parts = /^([A-Za-z_]\w*)(?:\.([A-Za-z_][\w-]*))?/.exec(expr.split('|')[0].trim());
    found.push({ start: match.index, end: match.index + match[0].length, expr: expr.trim(), root: parts ? parts[1] : '', name: parts?.[2] ?? '', text: match[0] });
  }
  return found;
}

export interface TemplateScope {
  roots: string[];
  names: { state: string[]; const: string[]; args: string[] | null };
}

/** What names the config offers; `argNames` are the arguments of the tool being edited (null: any name). */
export function templateScope(config: unknown, { argNames }: { argNames?: string[] } = {}): TemplateScope {
  const c = (isObj(config) ? config : {}) as Json;
  const state = isObj(c.state) && isObj(c.state.variables) ? c.state.variables : {};
  return {
    roots: TEMPLATE_ROOTS,
    names: { state: Object.keys(state), const: Object.keys(isObj(c.constants) ? c.constants : {}), args: argNames ?? null },
  };
}

/** What looks wrong in a text's templates: a root not offered here, or a name the config lacks. Always a hint. */
export function templateProblems(text: unknown, scope: TemplateScope): (Template & { reason: string })[] {
  const out: (Template & { reason: string })[] = [];
  findTemplates(text).forEach((t) => {
    if (!t.root) {
      out.push({ ...t, reason: 'Empty or unreadable template.' });
      return;
    }
    if (!scope.roots.includes(t.root)) {
      out.push({ ...t, reason: `“${t.root}” isn’t a name this config offers here (${scope.roots.slice(0, 4).join(', ')}…). The server checks it when you save.` });
      return;
    }
    const known = (scope.names as Record<string, string[] | null>)[t.root];
    if (Array.isArray(known) && t.name && !known.includes(t.name)) {
      const where = t.root === 'state' ? 'a state variable' : t.root === 'const' ? 'a constant' : 'an argument of this tool';
      out.push({ ...t, reason: `“${t.name}” isn’t ${where}${known.length ? ` (there is ${known.slice(0, 5).join(', ')}${known.length > 5 ? '…' : ''})` : ' (none are defined yet)'}.` });
    }
  });
  return out;
}

/** The names that can be inserted, as chips. */
export function insertables(scope: TemplateScope): { group: string; label: string; snippet: string }[] {
  return [
    ...(scope.names.args ?? []).map((n) => ({ group: 'argument', label: `args.${n}`, snippet: `{{args.${n}}}` })),
    ...scope.names.state.map((n) => ({ group: 'state', label: `state.${n}`, snippet: `{{state.${n}}}` })),
    ...scope.names.const.map((n) => ({ group: 'constant', label: `const.${n}`, snippet: `{{const.${n}}}` })),
  ];
}

/** Puts a snippet where the caret is (or over the selection); returns the new text and where the caret goes. */
export function insertAt(text: unknown, start: number | null | undefined, end: number | null | undefined, snippet: string): { text: string; caret: number } {
  const source = String(text ?? '');
  const from = Math.max(0, Math.min(start ?? source.length, source.length));
  const to = Math.max(from, Math.min(end ?? from, source.length));
  return { text: source.slice(0, from) + snippet + source.slice(to), caret: from + snippet.length };
}

// ---- response paths -------------------------------------------------------------------------------------------------

export type PathStep = { key: string } | { index: number } | { all: true };

const rooted = (source: string) => (source[0] === '$' ? source : source[0] === '[' ? `$${source}` : `$.${source}`);

export function parsePath(text: unknown): PathStep[] {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) throw new Error('Enter a path, for example balance or $.balance');
  const source = rooted(trimmed);
  const steps: PathStep[] = [];
  let i = 1;
  while (i < source.length) {
    const c = source[i];
    if (c === '.') {
      if (source[i + 1] === '.') throw new Error('“..” (search everywhere) isn’t supported. Name each step: $.a.b');
      const match = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(source.slice(i + 1));
      if (!match) throw new Error(`Expected a field name after “.” at position ${i + 1}. A name with a dot or a space goes in brackets: $['a.b']`);
      steps.push({ key: match[0] });
      i += 1 + match[0].length;
    } else if (c === '[') {
      const close = source.indexOf(']', i);
      if (close === -1) throw new Error('A “[” is never closed.');
      const inner = source.slice(i + 1, close).trim();
      if (inner === '*') steps.push({ all: true });
      else if (/^\d+$/.test(inner)) steps.push({ index: Number(inner) });
      else if (/^(['"]).*\1$/.test(inner)) steps.push({ key: inner.slice(1, -1) });
      else if (inner.startsWith('?')) throw new Error('Filters like [?(@.x > 1)] aren’t supported. Pick a field, an index [0] or [*].');
      else if (inner.includes(':')) throw new Error('Slices like [0:2] aren’t supported. Use [0], [1] or [*].');
      else throw new Error(`Don’t understand [${inner}]. Use [0], [*] or ['name'].`);
      i = close + 1;
    } else throw new Error(`Unexpected “${c}” at position ${i}. Steps are .name, [0], [*] or ['name'].`);
  }
  return steps;
}

export function validatePath(text: unknown): { ok: true; steps: PathStep[] } | { ok: false; error: string } {
  try {
    return { ok: true, steps: parsePath(text) };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** All the values a path picks out of `value` (empty when nothing matches). */
export function evalPath(value: unknown, text: unknown): unknown[] {
  let nodes: unknown[] = [value];
  for (const step of parsePath(text)) {
    const next: unknown[] = [];
    nodes.forEach((node) => {
      if ('all' in step) {
        if (Array.isArray(node)) next.push(...node);
      } else if ('index' in step) {
        if (Array.isArray(node) && step.index < node.length) next.push(node[step.index]);
      } else if (isObj(node) && step.key in node) next.push(node[step.key]);
    });
    nodes = next;
  }
  return nodes;
}

const WORD = /^[A-Za-z_]\w*$/;
const stepText = (key: string) => (WORD.test(key) ? `.${key}` : `['${key.replace(/'/g, "\\'")}']`);

export interface SamplePath {
  path: string;
  kind: string;
  preview: string;
}

/** The path of every leaf (and of every list, as [*]) in a sample response, to pick from. */
export function samplePaths(sample: unknown, { max = 200 }: { max?: number } = {}): SamplePath[] {
  const out: SamplePath[] = [];
  const walk = (node: unknown, path: string, depth: number) => {
    if (out.length >= max || depth > 8) return;
    if (Array.isArray(node)) {
      if (!node.length) {
        out.push({ path, kind: 'list', preview: '[]' });
        return;
      }
      const first: unknown = node[0];
      if (first !== null && typeof first === 'object') {
        out.push({ path: `${path}[*]`, kind: 'list', preview: `${node.length} item${node.length === 1 ? '' : 's'}` });
        walk(first, `${path}[*]`, depth + 1);
      } else
        out.push({
          path: `${path}[*]`,
          kind: 'list',
          preview:
            node
              .slice(0, 3)
              .map((x) => JSON.stringify(x))
              .join(', ') + (node.length > 3 ? '…' : ''),
        });
    } else if (isObj(node)) {
      Object.keys(node).forEach((key) => walk(node[key], `${path}${stepText(key)}`, depth + 1));
    } else out.push({ path, kind: node === null ? 'null' : typeof node, preview: node === null ? 'null' : String(node).slice(0, 60) });
  };
  walk(sample, '$', 0);
  return out;
}

/** What a path picked, shortly: "42", "3 values: 1, 2, 3", or why nothing. */
export function describeMatches(sample: unknown, text: unknown): { ok: boolean; text: string } {
  try {
    const found = evalPath(sample, text);
    if (!found.length) return { ok: false, text: 'matches nothing in the sample' };
    if (found.length === 1) return { ok: true, text: String(JSON.stringify(found[0])).slice(0, 80) };
    return {
      ok: true,
      text: `${found.length} values: ${found
        .slice(0, 3)
        .map((x) => JSON.stringify(x))
        .join(', ')}${found.length > 3 ? '…' : ''}`,
    };
  } catch (error: unknown) {
    return { ok: false, text: error instanceof Error ? error.message : String(error) };
  }
}

/** What the model would be shown: only the fields `to_llm` names (or the whole response when it names none). */
export function modelSees(sample: unknown, toLlm: unknown): { whole: boolean; value: unknown; missing: string[] } {
  const paths = Array.isArray(toLlm) ? toLlm.filter((p): p is string => typeof p === 'string' && !!p) : [];
  if (!paths.length) return { whole: true, value: sample, missing: [] };
  const value: Json = {};
  const missing: string[] = [];
  paths.forEach((path) => {
    try {
      const found = evalPath(sample, path);
      if (!found.length) missing.push(path);
      else value[path] = found.length === 1 ? found[0] : found;
    } catch {
      missing.push(path);
    }
  });
  return { whole: false, value, missing };
}

/** Text that may look like a credential in a header's name: never put a secret in a header. */
export const CREDENTIAL_NAME = /authori[sz]ation|api[-_ ]?key|token|secret|password|passwd|bearer/i;

/** The address a request calls, from the connection's base address, the path and the query. */
export function joinUrl(base: unknown, path: unknown, query: unknown): string {
  const root = String(base ?? '').replace(/\/+$/, '');
  const tail = String(path ?? '');
  const url = root ? `${root}${tail.startsWith('/') || !tail ? '' : '/'}${tail}` : tail || '…';
  const pairs = isObj(query) ? Object.entries(query).filter(([k]) => k) : [];
  return pairs.length ? `${url}?${pairs.map(([k, v]) => `${k}=${String(v)}`).join('&')}` : url;
}
