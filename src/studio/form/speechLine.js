// A line the agent says (the schema's Speech: plain text, or one of its fixed lines, { message: id }), read and
// written the same way on every page: shown as its words, and edited in place. Editing a fixed line changes that
// line's own text, so every place that uses it says the new words, and the link to it is kept; plain text is
// written where it stands. A fixed line said in several languages ({ en: …, es: … }) shows and changes the agent's
// main language; its other languages stay. Pure: no DOM.

import { isObj } from './engine.js';
import { baseOf, primaryOf } from './messages.ts';

const list = (v) => (Array.isArray(v) ? v : []);
const textOf = (v) => (typeof v === 'string' ? v : isObj(v) ? textOf(v.text ?? Object.values(v)[0]) : '');
const mainKey = (config, text) => Object.keys(text).find((k) => baseOf(k) === baseOf(primaryOf(config))) || Object.keys(text)[0];

// { text, fixed: the fixed line's id or '', at: its place in `messages` or -1 }
export function lineOf(config, value) {
  if (isObj(value) && typeof value.message === 'string') {
    const at = list(config?.messages).findIndex((m) => isObj(m) && m.id === value.message);
    const text = at >= 0 ? config.messages[at].text : '';
    return { text: isObj(text) ? textOf(text[mainKey(config, text)]) : textOf(text), fixed: value.message, at };
  }
  return { text: textOf(value), fixed: '', at: -1 };
}

// A copy of `root` with `value` at `path` (lists and objects copied along the way; `undefined` removes the key).
function setAt(root, path, value) {
  if (!path.length) return value;
  const [head, ...rest] = path;
  const copy = Array.isArray(root) ? [...root] : typeof head === 'number' ? [] : { ...(isObj(root) ? root : {}) };
  const below = root == null ? undefined : root[head];
  const next = rest.length ? setAt(below === undefined && typeof rest[0] === 'number' ? [] : below, rest, value) : value;
  if (next === undefined && !Array.isArray(copy)) delete copy[head];
  else copy[head] = next;
  return copy;
}
const getAt = (root, path) => path.reduce((node, key) => (node == null ? undefined : node[key]), root);

// The config with the line at `path` saying `text`: a fixed line's own words change (keeping the link), anything else
// is written as plain text there. Emptied, the line goes from this place only ('' is kept there with `keepEmpty`, for a
// line that must be written): a fixed line other places use is never emptied.
export function setLine(config, path, text, { keepEmpty = false } = {}) {
  if (text === '') return setAt(config, path, keepEmpty ? '' : undefined);
  const line = lineOf(config, getAt(config, path));
  if (line.fixed && line.at >= 0) {
    const now = config.messages[line.at].text;
    if (typeof now === 'string') return setAt(config, ['messages', line.at, 'text'], text);
    if (isObj(now)) return setAt(config, ['messages', line.at, 'text', mainKey(config, now)], text);
  }
  return setAt(config, path, text);
}

// Where else a fixed line is used, for the note beside a field that changes it: the number of places, this one included.
export function fixedLineUses(config, id) {
  if (!id) return 0;
  let n = 0;
  const visit = (node) => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (isObj(node)) {
      if (node.message === id && Object.keys(node).length === 1) n += 1;
      Object.entries(node).forEach(([k, v]) => k !== 'messages' && visit(v));
    }
  };
  visit(config);
  return n;
}

// The words a fixed line's field note shows: '' for plain text.
export function fixedLineNote(config, value) {
  const line = lineOf(config, value);
  if (!line.fixed) return '';
  if (line.at < 0) return `It points at the fixed line “${line.fixed}”, which doesn’t exist: typing here writes plain text instead.`;
  const uses = fixedLineUses(config, line.fixed);
  return uses > 1
    ? `It is the fixed line “${line.fixed}”, used in ${uses} places: changing it here changes all of them.`
    : `It is the fixed line “${line.fixed}”: changing it here changes that line.`;
}
