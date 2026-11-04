// Template text: {{state.name}}, {{const.x}}, {{args.x}}, {{x | default('y')}}. These strings are read by the runtime,
// never by the form, so the form's job is to help write them and to flag a name that points at nothing.
// Pure: no network, no DOM.

import { isObj } from './engine.js';

type Path = Array<string | number>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a draft being edited can be any shape; every read below checks what it finds
type AnyConfig = any;

// Roots a template may start with anywhere. Only `state`, `const` and `args` names can be checked here; the server
// decides the rest (POST /validate, with a path), so findings here are only hints (amber), never errors.
const TEMPLATE_ROOTS = ['state', 'const', 'args', 'result', 'form', 'meta', 'call', 'channel', 'caller'];

type Place = { when: (path: string[]) => boolean; roots?: string[]; any?: boolean };

// Roots that exist only in one place of the config, and what each is:
//   a notification is given `with.…` (the details of what it is sent about)
//   a transfer's address template reads `pbx.…` and `target` (the number it resolved)
//   an event supplies `error`, `reason`, `tool`, `transfer`, `from`, `to` (what happened)
//   a task step's validation reads `value` (the answer just collected)
//   a tool's direct delivery (`result.out_of_band`) reads the response's own field names, so any name is fine there
const PLACE_ROOTS: Place[] = [
  { when: (path) => path.includes('notifications'), roots: ['with'] },
  { when: (path) => path.includes('transfers'), roots: ['pbx', 'target'] },
  { when: (path) => path[0] === 'events' || path.includes('events'), roots: ['error', 'reason', 'tool', 'transfer', 'from', 'to', 'with'] },
  { when: (path) => path.includes('tasks') || path.includes('steps') || path.includes('validate'), roots: ['value'] },
  { when: (path) => path.includes('out_of_band'), any: true },
];
export const TEMPLATE_FILTERS = [
  { name: 'default', snippet: "default('')", help: 'A fallback when the value is empty' },
  { name: 'truncate', snippet: 'truncate(200)', help: 'Cut to a length' },
  { name: 'urlencode', snippet: 'urlencode', help: 'Make safe for a web address' },
];

type Template = { start: number; end: number; expr: string; root: string; name: string; text: string };

const BLOCK = /\{\{([^{}]*)\}\}/g;

// Every {{ … }} in the text, with what it starts with and the name after it:
// `{{ state.intent | default('x') }}` gives root "state", name "intent".
export function findTemplates(text: unknown): Template[] {
  const found: Template[] = [];
  const source = String(text ?? '');
  let match: RegExpExecArray | null;
  BLOCK.lastIndex = 0;
  while ((match = BLOCK.exec(source)) !== null) {
    const expr = match[1];
    const head = expr.split('|')[0].trim();
    const parts = /^([A-Za-z_]\w*)(?:\.([A-Za-z_][\w-]*))?/.exec(head);
    found.push({
      start: match.index,
      end: match.index + match[0].length,
      expr: expr.trim(),
      root: parts ? parts[1] : '',
      name: parts && parts[2] ? parts[2] : '',
      text: match[0],
    });
  }
  return found;
}

// Roots whose names only the runtime knows (call, channel, caller, form): offered as a start, `{{call.}}`, with the
// caret after the dot. `result` is added where the API's answer exists (inside a tool).
export const RUNTIME_ROOTS = [
  { root: 'meta', help: 'About this agent (its id, name, version)' },
  { root: 'call', help: 'About this call or conversation' },
  { root: 'channel', help: 'The channel it is on' },
  { root: 'caller', help: 'The person on the other end' },
  { root: 'form', help: 'What a form collected' },
];

type TemplateScope = {
  roots: string[];
  anyRoot: boolean;
  names: { state: string[]; const: string[]; args: string[] | null };
};

// What names the config offers. `argNames` are the arguments of the tool being edited (its parameters).
export function templateScope(
  config: AnyConfig,
  { argNames, extraRoots = [], anyRoot = false }: { argNames?: string[]; extraRoots?: string[]; anyRoot?: boolean } = {},
): TemplateScope {
  const c = isObj(config) ? config : {};
  return {
    roots: [...TEMPLATE_ROOTS, ...extraRoots.filter((root) => !TEMPLATE_ROOTS.includes(root))],
    anyRoot,
    names: {
      state: Object.keys(isObj(c.state?.variables) ? c.state.variables : {}),
      const: Object.keys(isObj(c.constants) ? c.constants : {}),
      args: argNames || null, // null = not inside a tool: any name is possible
    },
  };
}

// The tool's argument names, from its `parameters` JSON Schema.
export const argNamesOf = (tool: AnyConfig): string[] => (isObj(tool?.parameters?.properties) ? Object.keys(tool.parameters.properties) : []);

type TemplateProblem = Template & { severity: 'hint'; reason: string };

// What looks wrong in a text's templates: a root not available here, or a name the config lacks. Always a hint
// (`severity: 'hint'`): only the server can say for certain, and does, when the draft is checked.
export function templateProblems(text: unknown, scope: TemplateScope): TemplateProblem[] {
  const problems: TemplateProblem[] = [];
  findTemplates(text).forEach((t) => {
    if (!t.root) {
      problems.push({ ...t, severity: 'hint', reason: 'Empty or unreadable template.' });
      return;
    }
    if (!scope.roots.includes(t.root)) {
      if (scope.anyRoot) return;
      problems.push({
        ...t,
        severity: 'hint',
        reason: `“${t.root}” isn’t a name this config offers here (${scope.roots.slice(0, 4).join(', ')}…). If the runtime supplies it in this place, ignore this; the server checks it when you save.`,
      });
      return;
    }
    const known = (scope.names as Record<string, string[] | null>)[t.root];
    if (Array.isArray(known) && t.name && !known.includes(t.name)) {
      const where = t.root === 'state' ? 'a state variable' : t.root === 'const' ? 'a constant' : 'an argument of this tool';
      problems.push({
        ...t,
        severity: 'hint',
        reason: `“${t.name}” isn’t ${where}${known.length ? ` (there is ${known.slice(0, 5).join(', ')}${known.length > 5 ? '…' : ''})` : ' (none are defined yet)'}.`,
      });
    }
  });
  return problems;
}

type Segment = { kind: 'plain' | 'tpl' | 'unknown'; text: string };

// Cuts the text into plain pieces and templates, marking the ones with a problem, so the screen can colour them.
export function highlightSegments(text: unknown, scope: TemplateScope): Segment[] {
  const source = String(text ?? '');
  const bad = new Set(templateProblems(source, scope).map((p) => p.start));
  const segments: Segment[] = [];
  let at = 0;
  findTemplates(source).forEach((t) => {
    if (t.start > at) segments.push({ kind: 'plain', text: source.slice(at, t.start) });
    segments.push({ kind: bad.has(t.start) ? 'unknown' : 'tpl', text: t.text });
    at = t.end;
  });
  if (at < source.length) segments.push({ kind: 'plain', text: source.slice(at) });
  return segments;
}

// Puts a snippet where the caret is (or over the selection). Returns the new text and where the caret should go.
export function insertAt(text: unknown, start: number | null | undefined, end: number | null | undefined, snippet: string): { text: string; caret: number } {
  const source = String(text ?? '');
  const from = Math.max(0, Math.min(start ?? source.length, source.length));
  const to = Math.max(from, Math.min(end ?? from, source.length));
  return { text: source.slice(0, from) + snippet + source.slice(to), caret: from + snippet.length };
}

// The insertable names for a scope, as chips: [{ label, snippet }].
export function insertables(scope: TemplateScope): { group: string; label: string; snippet: string }[] {
  const chips: { group: string; label: string; snippet: string }[] = [];
  (scope.names.args || []).forEach((name) => chips.push({ group: 'argument', label: `args.${name}`, snippet: `{{args.${name}}}` }));
  scope.names.state.forEach((name) => chips.push({ group: 'state', label: `state.${name}`, snippet: `{{state.${name}}}` }));
  scope.names.const.forEach((name) => chips.push({ group: 'constant', label: `const.${name}`, snippet: `{{const.${name}}}` }));
  return chips;
}

// Where a string sits in a tool: the arguments only exist inside the tool's own fields.
const toolIndexOf = (path: unknown): number | null => (Array.isArray(path) && path[0] === 'tools' && typeof path[1] === 'number' ? path[1] : null);

// ---- which plain strings are templates
// The schema doesn't say which strings the runtime reads as templates: these keys do, plus any text with {{ }} in it.
const TEMPLATE_KEYS = new Set(['say', 'text', 'append', 'role', 'opening', 'instructions_append', 'uri_template', 'subject', 'body', 'prompt', 'instructions']);

export function isTemplateString(path: unknown, shape: AnyConfig, value: unknown): boolean {
  const widget = shape?.['x-ui']?.widget;
  if (widget === 'textarea' || widget === 'template') return true;
  if (typeof value === 'string' && value.includes('{{')) return true;
  return Array.isArray(path) && TEMPLATE_KEYS.has(String(path[path.length - 1]));
}

// The prompt the model is given is made of these: they get a word count.
export const isPromptPath = (path: unknown): boolean =>
  Array.isArray(path) && (path.includes('instructions') || path[path.length - 1] === 'instructions_append');

export const wordCount = (text: unknown): number =>
  (
    String(text ?? '')
      .trim()
      .match(/\S+/g) || []
  ).length;

// Which tool (if any) a field sits inside, so `args` names are known, and which roots this place adds (PLACE_ROOTS).
export function scopeAt(config: AnyConfig, path: Path | null | undefined): TemplateScope {
  const index = toolIndexOf(path);
  const tool = index === null ? null : config?.tools?.[index];
  const where = Array.isArray(path) ? path.map(String) : [];
  const places = PLACE_ROOTS.filter((place) => place.when(where));
  return templateScope(config, {
    argNames: index === null ? undefined : argNamesOf(tool),
    extraRoots: places.flatMap((place) => place.roots || []),
    anyRoot: places.some((place) => place.any),
  });
}

// What the scope at `path` depends on, as one short string (state and constant names, cached per config, plus a tool's
// argument names). A box re-reads its scope only when this changes, so a keystroke elsewhere costs a string compare.
const namesOfConfig = new WeakMap<object, string>();
export function scopeSignature(config: AnyConfig, path: Path | null | undefined): string {
  const c = isObj(config) ? config : {};
  let names = namesOfConfig.get(c);
  if (names === undefined) {
    names = JSON.stringify([Object.keys(isObj(c.state?.variables) ? c.state.variables : {}), Object.keys(isObj(c.constants) ? c.constants : {})]);
    if (isObj(config)) namesOfConfig.set(c, names);
  }
  const index = toolIndexOf(path);
  return index === null ? names : `${names}|${argNamesOf(c.tools?.[index]).join(',')}`;
}
