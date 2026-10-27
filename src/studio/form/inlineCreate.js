// "＋ New …" beside a field that points at something (a message, a state variable, an HTTP connection): create the thing
// and point the field at it in one step, without leaving the field. Pure: no network, no DOM.

import { isObj } from './engine.js';
import { freshId } from './references.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

export function getAt(root, path) {
  return path.reduce((node, part) => (node === null || node === undefined ? undefined : node[part]), root);
}

// A copy of `root` with `value` at `path` (creating objects on the way; arrays are copied, not extended).
export function setAt(root, path, value) {
  if (!path.length) return value;
  const next = Array.isArray(root) ? [...root] : { ...(isObj(root) ? root : {}) };
  const [head, ...rest] = path;
  next[head] = setAt(root?.[head], rest, value);
  return next;
}

// Which collections can be created from a field, what to ask for, and what the new thing looks like.
export const CREATABLE = {
  messages: { word: 'message', ask: [{ key: 'text', label: 'What it says', multiline: true, required: true }] },
  state_vars: {
    word: 'state variable',
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

const slug = (text) =>
  String(text || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join('_')
    .replace(/[^a-z0-9_]+/g, '')
    .replace(/^[^a-z]+/, '');

// Problems with what was typed, by field key.
export function createProblems(collection, answers, config) {
  const spec = CREATABLE[collection];
  const out = {};
  if (!spec) return out;
  spec.ask.forEach((field) => {
    const value = String(answers[field.key] ?? '').trim();
    if (field.required && !value) out[field.key] = 'Required.';
    else if (field.pattern && value && !new RegExp(field.pattern).test(value)) out[field.key] = field.hint ? `Use ${field.hint}.` : 'Not in the right form.';
  });
  if (collection === 'state_vars' && !out.name && answers.name && isObj(config?.state?.variables) && String(answers.name).trim() in config.state.variables)
    out.name = 'That variable already exists.';
  if (collection === 'http_connections' && !out.name && answers.name && isObj(config?.connections) && String(answers.name).trim() in config.connections)
    out.name = 'That connection already exists.';
  return out;
}

// -> { config, id }: the config with the new thing added (and, when `target` is given, that path set to its id).
export function createAndPoint(config, collection, answers, target) {
  const next = clone(config);
  let id;
  if (collection === 'messages') {
    const messages = Array.isArray(next.messages) ? next.messages : [];
    id = freshId(
      messages.map((m) => m?.id),
      slug(answers.text) || 'message',
    );
    next.messages = [...messages, { id, text: String(answers.text).trim() }];
  } else if (collection === 'state_vars') {
    id = String(answers.name).trim();
    const kind = answers.kind || 'string';
    const variable =
      kind === 'string'
        ? { type: 'string', nullable: true, default: null }
        : kind === 'integer'
          ? { type: 'integer', default: 0 }
          : { type: 'boolean', default: false };
    next.state = { ...(isObj(next.state) ? next.state : {}), variables: { ...(isObj(next.state?.variables) ? next.state.variables : {}), [id]: variable } };
  } else if (collection === 'http_connections') {
    id = String(answers.name).trim();
    next.connections = { ...(isObj(next.connections) ? next.connections : {}), [id]: { type: 'http', base_url: String(answers.base_url).trim() } };
  } else return { config, id: undefined };
  return { config: target ? setAt(next, target, id) : next, id };
}
