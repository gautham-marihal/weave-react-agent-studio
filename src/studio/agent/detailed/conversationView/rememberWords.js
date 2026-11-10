// What the agent remembers during a call (`state.variables`), in plain words, and the writes of its sheet: a detail's
// kind, how it starts and whether it is kept secret. Pure: no React, no DOM, so the tests run it in Node.
//
// From the schema: a detail is { type: string | integer | number | boolean | enum (with `values`) | object | array,
// nullable, default, sensitive, description, source }. `source` fills it when the call starts: the channel (its id,
// type or voice/chat), a new id (uuid or epoch_hex), the caller's number, the call (id, room, start), a participant
// attribute, or a fixed value. A detail kept secret (`sensitive`) reads as *** everywhere but API requests, transfers
// and notifications.

import { setPath } from '../schemaFacts.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const VARS = ['state', 'variables'];

export const KINDS = [
  { type: 'string', name: 'Text' },
  { type: 'integer', name: 'Whole number' },
  { type: 'number', name: 'Number' },
  { type: 'boolean', name: 'Yes or no' },
  { type: 'enum', name: 'One of a list' },
];
const MORE_KINDS = { object: 'A group of fields', array: 'A list' };
const kindName = (type) => KINDS.find((k) => k.type === type)?.name || MORE_KINDS[type] || 'Text';

// the four usual ways a detail starts (the rest are said in words, and set in the form)
export const STARTS = [
  { how: 'empty', name: 'Empty' },
  { how: 'value', name: 'A value' },
  { how: 'channel', name: 'From the channel' },
  { how: 'newId', name: 'A new id' },
];
const CHANNEL_WORDS = { id: 'its id', type: 'its kind', modality: 'voice or chat' };
const CALL_WORDS = { id: 'its id', room: 'its room', started_at: 'when it started' };

export function startOf(detail) {
  const source = isObj(detail?.source) ? detail.source : null;
  if (source?.channel) return { how: 'channel', words: `From the channel: ${CHANNEL_WORDS[source.channel] || source.channel}`, channel: source.channel };
  if (source?.generate) return { how: 'newId', words: 'A new id', generate: source.generate.kind || 'uuid' };
  if (source?.caller_id) return { how: 'other', words: 'The caller’s number' };
  if (source?.call) return { how: 'other', words: `From the call: ${CALL_WORDS[source.call] || source.call}` };
  if (source && typeof source.constant === 'string') return { how: 'other', words: `Always “${source.constant}”` };
  if (source?.participant_attribute) return { how: 'other', words: 'A detail of the caller’s connection' };
  if (detail?.default !== undefined && detail.default !== null) return { how: 'value', words: `“${String(detail.default)}”`, value: detail.default };
  return { how: 'empty', words: 'Empty' };
}

// every detail, in the order they were added
export function readDetails(config) {
  const vars = isObj(config?.state?.variables) ? config.state.variables : {};
  return Object.entries(vars).map(([key, d]) => {
    const detail = isObj(d) ? d : {};
    const type = typeof detail.type === 'string' ? detail.type : 'string';
    return {
      key,
      words: key.replace(/_/g, ' '),
      type,
      kind: kindName(type),
      values: Array.isArray(detail.values) ? detail.values : [],
      start: startOf(detail),
      secret: detail.sensitive === true,
      description: typeof detail.description === 'string' ? detail.description : '',
    };
  });
}

// the filters over the list, with how many each holds
export function filtersOf(details) {
  const count = (test) => details.filter(test).length;
  return [
    { id: 'all', name: 'All', count: details.length },
    ...KINDS.map((k) => ({ id: k.type, name: k.name, count: count((d) => d.type === k.type) })).filter((f) => f.count > 0),
    { id: 'secret', name: 'Secret', count: count((d) => d.secret) },
  ].filter((f) => f.id === 'all' || f.count > 0);
}
export const matchesFilter = (detail, filter) => filter === 'all' || (filter === 'secret' ? detail.secret : detail.type === filter);

// a name as people write it ("Preferred branch") to the key the config uses ("preferred_branch"), unique
export function keyFor(name, taken = []) {
  const base =
    String(name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^(\d)/, 'detail_$1')
      .slice(0, 60) || 'detail';
  let n = 1;
  while (taken.includes(n === 1 ? base : `${base}_${n}`)) n += 1;
  return n === 1 ? base : `${base}_${n}`;
}

const at = (key, ...rest) => [...VARS, key, ...rest];

// a new detail: Text, starting empty, unless said otherwise
export function addDetail(config, name, { type = 'string', start = 'empty', secret = false } = {}) {
  const taken = Object.keys(isObj(config?.state?.variables) ? config.state.variables : {});
  const key = keyFor(name, taken);
  let next = setPath(config, at(key), {
    type,
    nullable: true,
    default: null,
    ...(type === 'enum' ? { values: [] } : {}),
    ...(secret ? { sensitive: true } : {}),
  });
  next = setStart(next, key, start);
  return { config: next, key };
}

export function setKind(config, key, type) {
  let next = setPath(config, at(key, 'type'), type);
  if (type === 'enum') {
    if (!Array.isArray(config?.state?.variables?.[key]?.values)) next = setPath(next, at(key, 'values'), []);
  } else next = setPath(next, at(key, 'values'), undefined);
  // a value it starts with is kept only when it still fits the kind
  const def = next.state.variables[key].default;
  const fits =
    def === null ||
    def === undefined ||
    (type === 'boolean' ? typeof def === 'boolean' : ['integer', 'number'].includes(type) ? typeof def === 'number' : typeof def === 'string');
  return fits ? next : setPath(next, at(key, 'default'), null);
}

// how it starts: empty, a value (given as typed: "yes" for a yes-or-no, digits for a number), from the channel, a new id
export function setStart(config, key, how, { value, channel = 'id', generate = 'uuid' } = {}) {
  let next = setPath(config, at(key, 'source'), undefined);
  if (how === 'empty') return setPath(setPath(next, at(key, 'default'), null), at(key, 'nullable'), true);
  if (how === 'value') {
    const type = next.state.variables[key].type;
    const typed = value === undefined ? (type === 'boolean' ? false : type === 'integer' || type === 'number' ? 0 : '') : value;
    return setPath(next, at(key, 'default'), typed);
  }
  next = setPath(next, at(key, 'default'), null);
  if (how === 'channel') return setPath(next, at(key, 'source'), { channel });
  if (how === 'newId') return setPath(next, at(key, 'source'), { generate: { kind: generate } });
  return config;
}

export const setSecret = (config, key, on) => setPath(config, at(key, 'sensitive'), on ? true : undefined);
export const setDescription = (config, key, text) => setPath(config, at(key, 'description'), text ? text : undefined);
export const setValues = (config, key, values) => setPath(config, at(key, 'values'), values);
