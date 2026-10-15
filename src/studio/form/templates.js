// @ts-check
// Template text: {{state.name}}, {{const.x}}, {{args.x}}, {{x | default('y')}}. These strings are read by the runtime,
// never by the form, so the form's job is to help write them and to flag a name that points at nothing.
// Pure: no network, no DOM.

import { isObj } from './engine.js';

// The roots a template may start with everywhere. `state`, `const` and `args` have names the config can be checked against; the
// others (a tool's `result`, a form's answers, call details) have names only the runtime knows. Some places add roots of their own
// (PLACE_ROOTS below), so which names are valid depends on where the text sits, and the server is the one that decides: it reports an
// unknown name in `POST /validate` with a path. What this file finds is therefore only ever a HINT (amber), never an error.
export const TEMPLATE_ROOTS = ['state', 'const', 'args', 'result', 'form', 'meta', 'call', 'channel', 'caller'];

// Roots that exist only in one place of the config, and what each is:
//   a notification is given `with.…` (the details of what it is sent about)
//   a transfer's address template reads `pbx.…` and `target` (the number it resolved)
//   an event supplies `error`, `reason`, `tool`, `transfer`, `from`, `to` (what happened)
//   a task step's validation reads `value` (the answer just collected)
//   a tool's direct delivery (`result.out_of_band`) reads the response's own field names, so any name is fine there
export const PLACE_ROOTS = [
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

const BLOCK = /\{\{([^{}]*)\}\}/g;

// Every {{ … }} in the text, with what it starts with and the name after it: `{{ state.intent | default('x') }}` gives
// root "state", name "intent".
export function findTemplates(text) {
  const found = [];
  const source = String(text ?? '');
  let match;
  BLOCK.lastIndex = 0;
  while ((match = BLOCK.exec(source)) !== null) {
    const expr = match[1];
    const head = expr.split('|')[0].trim();
    const parts = /^([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z_][A-Za-z0-9_-]*))?/.exec(head);
    found.push({ start: match.index, end: match.index + match[0].length, expr: expr.trim(), root: parts ? parts[1] : '', name: parts && parts[2] ? parts[2] : '', text: match[0] });
  }
  return found;
}

// Roots only the runtime knows the names under (call details, the channel, the caller, a form's answers): offered as a start, `{{call.}}`,
// with the caret left after the dot. `result` is added where the API's answer exists (inside a tool).
export const RUNTIME_ROOTS = [
  { root: 'meta', help: 'About this agent (its id, name, version)' },
  { root: 'call', help: 'About this call or conversation' },
  { root: 'channel', help: 'The channel it is on' },
  { root: 'caller', help: 'The person on the other end' },
  { root: 'form', help: 'What a form collected' },
];

// What names the config offers. `argNames` are the arguments of the tool being edited (its parameters).
/**
 * @param {any} config
 * @param {{ argNames?: string[], extraRoots?: string[], anyRoot?: boolean }} [where]
 */
export function templateScope(config, { argNames, extraRoots = [], anyRoot = false } = {}) {
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
export const argNamesOf = (tool) => (isObj(tool?.parameters?.properties) ? Object.keys(tool.parameters.properties) : []);

// What looks wrong in the templates of a text: a root that doesn't exist in this place, or a name the config doesn't have. Every
// finding is a HINT (`severity: 'hint'`): the names depend on where the text sits and on what the runtime supplies, so only the server
// can say for certain, and it does, with a path, when the draft is checked.
export function templateProblems(text, scope) {
  const problems = [];
  findTemplates(text).forEach((t) => {
    if (!t.root) { problems.push({ ...t, severity: 'hint', reason: 'Empty or unreadable template.' }); return; }
    if (!scope.roots.includes(t.root)) {
      if (scope.anyRoot) return;
      problems.push({ ...t, severity: 'hint', reason: `“${t.root}” isn’t a name this config offers here (${scope.roots.slice(0, 4).join(', ')}…). If the runtime supplies it in this place, ignore this; the server checks it when you save.` });
      return;
    }
    const known = scope.names[t.root];
    if (Array.isArray(known) && t.name && !known.includes(t.name)) {
      const where = t.root === 'state' ? 'a state variable' : t.root === 'const' ? 'a constant' : 'an argument of this tool';
      problems.push({ ...t, severity: 'hint', reason: `“${t.name}” isn’t ${where}${known.length ? ` (there is ${known.slice(0, 5).join(', ')}${known.length > 5 ? '…' : ''})` : ' (none are defined yet)'}.` });
    }
  });
  return problems;
}

// Cuts the text into plain pieces and templates, marking the ones with a problem, so the screen can colour them.
export function highlightSegments(text, scope) {
  const source = String(text ?? '');
  const bad = new Set(templateProblems(source, scope).map((p) => p.start));
  const segments = [];
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
export function insertAt(text, start, end, snippet) {
  const source = String(text ?? '');
  const from = Math.max(0, Math.min(start ?? source.length, source.length));
  const to = Math.max(from, Math.min(end ?? from, source.length));
  return { text: source.slice(0, from) + snippet + source.slice(to), caret: from + snippet.length };
}

// The insertable names for a scope, as chips: [{ label, snippet }].
export function insertables(scope) {
  const chips = [];
  (scope.names.args || []).forEach((name) => chips.push({ group: 'argument', label: `args.${name}`, snippet: `{{args.${name}}}` }));
  scope.names.state.forEach((name) => chips.push({ group: 'state', label: `state.${name}`, snippet: `{{state.${name}}}` }));
  scope.names.const.forEach((name) => chips.push({ group: 'constant', label: `const.${name}`, snippet: `{{const.${name}}}` }));
  return chips;
}

// Where a string sits in a tool: the arguments only exist inside the tool's own fields.
export const toolIndexOf = (path) => (Array.isArray(path) && path[0] === 'tools' && typeof path[1] === 'number' ? path[1] : null);

// ---- which plain strings are templates -----------------------------------------------------------------------------------------
// The schema doesn't say which strings the runtime reads as templates. These are the ones that do (what the agent is told, what it
// says, what a request sends), plus any text that already contains {{ }}. Everything else (ids, descriptions, names) stays a plain box.
const TEMPLATE_KEYS = new Set(['say', 'text', 'append', 'role', 'opening', 'instructions_append', 'uri_template', 'subject', 'body', 'prompt', 'instructions']);

export function isTemplateString(path, shape, value) {
  const widget = shape?.['x-ui']?.widget;
  if (widget === 'textarea' || widget === 'template') return true;
  if (typeof value === 'string' && value.includes('{{')) return true;
  return Array.isArray(path) && TEMPLATE_KEYS.has(String(path[path.length - 1]));
}

// The prompt the model is given is made of these: they get a word count.
export const isPromptPath = (path) => Array.isArray(path) && (path.includes('instructions') || path[path.length - 1] === 'instructions_append');

export const wordCount = (text) => (String(text ?? '').trim().match(/\S+/g) || []).length;

// Which tool (if any) a field sits inside, so `args` names are known there, and which roots this place adds (PLACE_ROOTS).
export function scopeAt(config, path) {
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
