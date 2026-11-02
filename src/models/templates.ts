// Template text: {{state.name}}, {{const.x}}, {{args.x}}, {{x | default('y')}}. The runtime reads these strings; the
// studio only helps write them and hints at a name that points at nothing. Only the server's check is certain, so a
// finding here is a hint (amber), never an error. Pure: no network, no DOM.

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Roots a template may start with anywhere. Only `state`, `const` and `args` names can be checked here. */
export const TEMPLATE_ROOTS = ['state', 'const', 'args', 'result', 'form', 'meta', 'call', 'channel', 'caller'];

export interface Template {
  start: number;
  end: number;
  expr: string;
  root: string;
  name: string;
  text: string;
}

const BLOCK = /\{\{([^{}]*)\}\}/g;

/** Every {{ … }} in a text: `{{ state.intent | default('x') }}` gives root "state", name "intent". */
export function findTemplates(text: unknown): Template[] {
  const found: Template[] = [];
  const source = String(text ?? '');
  const re = new RegExp(BLOCK.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
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

export interface TemplateScope {
  roots: string[];
  anyRoot: boolean;
  /** `args` is null outside a tool: any argument name may exist there. */
  names: { state: string[]; const: string[]; args: string[] | null };
}

/** The names a config offers: its state variables and constants (and a tool's arguments when given). */
export function templateScope(config: unknown, { argNames, extraRoots = [], anyRoot = false }: { argNames?: string[]; extraRoots?: string[]; anyRoot?: boolean } = {}): TemplateScope {
  const c = isObj(config) ? config : {};
  const state = isObj(c.state) && isObj(c.state.variables) ? c.state.variables : {};
  const constants = isObj(c.constants) ? c.constants : {};
  return {
    roots: [...TEMPLATE_ROOTS, ...extraRoots.filter((root) => !TEMPLATE_ROOTS.includes(root))],
    anyRoot,
    names: { state: Object.keys(state), const: Object.keys(constants), args: argNames ?? null },
  };
}

export interface TemplateProblem extends Template {
  severity: 'hint';
  reason: string;
}

/** What looks wrong in a text's templates: a root not offered here, or a name the config lacks. Always a hint. */
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
        reason: `“${t.root}” isn’t a name this agent offers here (${scope.roots.slice(0, 4).join(', ')}…). If the runtime supplies it in this place, ignore this; the server checks it when you save.`,
      });
      return;
    }
    const known = t.root === 'state' ? scope.names.state : t.root === 'const' ? scope.names.const : t.root === 'args' ? scope.names.args : null;
    if (Array.isArray(known) && t.name && !known.includes(t.name)) {
      const where = t.root === 'state' ? 'something it keeps during the call' : t.root === 'const' ? 'a fixed value' : 'an argument of this tool';
      problems.push({
        ...t,
        severity: 'hint',
        reason: `“${t.name}” isn’t ${where}${known.length ? ` (there is ${known.slice(0, 5).join(', ')}${known.length > 5 ? '…' : ''})` : ' (none are set up yet)'}.`,
      });
    }
  });
  return problems;
}

export interface Segment {
  kind: 'plain' | 'tpl' | 'unknown';
  text: string;
}

/** The text cut into plain pieces and templates, the doubtful templates marked, for colouring. */
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

/** A snippet put where the caret is (or over the selection): the new text and where the caret goes. */
export function insertAt(text: unknown, start: number | null | undefined, end: number | null | undefined, snippet: string): { text: string; caret: number } {
  const source = String(text ?? '');
  const from = Math.max(0, Math.min(start ?? source.length, source.length));
  const to = Math.max(from, Math.min(end ?? from, source.length));
  return { text: source.slice(0, from) + snippet + source.slice(to), caret: from + snippet.length };
}

export interface Insertable {
  group: 'argument' | 'state' | 'constant';
  label: string;
  /** The name in words, for a person writing to the agent: "Order number". */
  plain: string;
  snippet: string;
}

/** "order_number" -> "Order number". */
export const humanize = (key: string): string => {
  const text = String(key)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** The names that can be inserted, as chips. */
export function insertables(scope: TemplateScope): Insertable[] {
  const chips: Insertable[] = [];
  (scope.names.args ?? []).forEach((name) => chips.push({ group: 'argument', label: `args.${name}`, plain: humanize(name), snippet: `{{args.${name}}}` }));
  scope.names.state.forEach((name) => chips.push({ group: 'state', label: `state.${name}`, plain: humanize(name), snippet: `{{state.${name}}}` }));
  scope.names.const.forEach((name) => chips.push({ group: 'constant', label: `const.${name}`, plain: humanize(name), snippet: `{{const.${name}}}` }));
  return chips;
}

/** How many words a text has (what a model is given is counted). */
export const wordCount = (text: unknown): number => (String(text ?? '').trim().match(/\S+/g) ?? []).length;
