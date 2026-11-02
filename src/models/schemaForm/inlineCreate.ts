// "New …" beside a field that points at something (a fixed line, a remembered value, an HTTP connection): make the
// thing and point the field at it in one step, without leaving the field. Pure: no network, no DOM.
import type { Path } from '../../types/studio';
import { isObj, type Json } from './engine';
import { freshId } from './references';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function getAt(root: unknown, path: Path): unknown {
  return path.reduce<unknown>((node, part) => (node === null || node === undefined ? undefined : (node as Record<string | number, unknown>)[part]), root);
}

/** A copy of `root` with `value` at `path` (objects made on the way; untouched parts are shared). */
export function setAt(root: unknown, path: Path, value: unknown): unknown {
  if (!path.length) return value;
  const next = (Array.isArray(root) ? [...root] : { ...(isObj(root) ? root : {}) }) as Record<string | number, unknown>;
  const [head, ...rest] = path;
  next[head] = setAt((root as Record<string | number, unknown> | null | undefined)?.[head], rest, value);
  return next;
}

export interface AskField {
  key: string;
  label: string;
  hint?: string;
  pattern?: string;
  required?: boolean;
  multiline?: boolean;
  options?: [string, string][];
}

/** Which collections can be made from a field, what to ask, and what the new thing looks like. */
export const CREATABLE: Record<string, { word: string; ask: AskField[] }> = {
  messages: { word: 'fixed line', ask: [{ key: 'text', label: 'What it says', multiline: true, required: true }] },
  state_vars: {
    word: 'remembered value',
    ask: [
      { key: 'name', label: 'Name', hint: 'lowercase letters, digits and _', pattern: '^[a-z][a-z0-9_]{0,63}$', required: true },
      {
        key: 'kind',
        label: 'Holds',
        options: [
          ['string', 'Text'],
          ['integer', 'A number'],
          ['boolean', 'Yes / no'],
        ],
        required: true,
      },
    ],
  },
  http_connections: {
    word: 'HTTP connection',
    ask: [
      { key: 'name', label: 'Name', hint: 'lowercase letters, digits, - and _', pattern: '^[a-z][a-z0-9_-]{0,63}$', required: true },
      { key: 'base_url', label: 'Base URL', hint: 'e.g. https://api.example.com', pattern: '^https?://\\S+$', required: true },
    ],
  },
};

const slug = (text: unknown) =>
  String(text || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join('_')
    .replace(/[^a-z0-9_]+/g, '')
    .replace(/^[^a-z]+/, '');

export type Answers = Record<string, string | undefined>;

/** Problems with what was typed, by field key. */
export function createProblems(collection: string, answers: Answers, config: unknown): Record<string, string> {
  const spec = CREATABLE[collection];
  const out: Record<string, string> = {};
  if (!spec) return out;
  spec.ask.forEach((field) => {
    const value = String(answers[field.key] ?? '').trim();
    if (field.required && !value) out[field.key] = 'Required.';
    else if (field.pattern && value && !new RegExp(field.pattern).test(value)) out[field.key] = field.hint ? `Use ${field.hint}.` : 'Not in the right form.';
  });
  const name = String(answers.name ?? '').trim();
  const vars = getAt(config, ['state', 'variables']);
  const connections = getAt(config, ['connections']);
  if (collection === 'state_vars' && !out.name && name && isObj(vars) && name in vars) out.name = 'That variable already exists.';
  if (collection === 'http_connections' && !out.name && name && isObj(connections) && name in connections) out.name = 'That connection already exists.';
  return out;
}

/** The config with the new thing added (and, when `target` is given, that path set to its id). */
export function createAndPoint<T>(config: T, collection: string, answers: Answers, target?: Path | null): { config: T; id: string | undefined } {
  const next = clone(config) as unknown as Json;
  let id: string;
  if (collection === 'messages') {
    const messages = Array.isArray(next.messages) ? next.messages : [];
    id = freshId(
      messages.map((m) => (isObj(m) ? m.id : undefined)),
      slug(answers.text) || 'message',
    );
    next.messages = [...messages, { id, text: String(answers.text).trim() }];
  } else if (collection === 'state_vars') {
    id = String(answers.name).trim();
    const kind = answers.kind || 'string';
    const variable =
      kind === 'string' ? { type: 'string', nullable: true, default: null } : kind === 'integer' ? { type: 'integer', default: 0 } : { type: 'boolean', default: false };
    const state = isObj(next.state) ? next.state : {};
    next.state = { ...state, variables: { ...(isObj(state.variables) ? state.variables : {}), [id]: variable } };
  } else if (collection === 'http_connections') {
    id = String(answers.name).trim();
    next.connections = { ...(isObj(next.connections) ? next.connections : {}), [id]: { type: 'http', base_url: String(answers.base_url).trim() } };
  } else return { config, id: undefined };
  return { config: (target ? setAt(next, target, id) : next) as T, id };
}
