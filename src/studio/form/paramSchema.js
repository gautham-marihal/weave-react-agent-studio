// A tool's `parameters` is a JSON Schema of the arguments the model fills in. Hand-written JSON Schema is the tool
// editor's biggest hurdle, so the form shows rows (name, kind, the description the model reads, needed, choices). This
// converts rows to schema and back without losing a keyword it doesn't know. Pure: no network, no DOM.

import { isObj } from './engine.js';

export const PARAM_NAME = /^[a-z][a-z0-9_]*$/;
export const PARAM_KINDS = [
  { id: 'string', label: 'Text' },
  { id: 'number', label: 'Number' },
  { id: 'integer', label: 'Whole number' },
  { id: 'boolean', label: 'Yes / no' },
  { id: 'choice', label: 'One of a list' },
];

const SIMPLE_KEYS = ['type', 'description', 'enum'];

// A property the rows can show: a plain type, optionally with a description and (for text) a list of allowed values.
// Anything else (a nested object, a list, $ref, oneOf, patterns, minimum…) is kept whole and shown as "advanced".
function readProperty(name, schema, required) {
  const raw = isObj(schema) ? schema : {};
  const keys = Object.keys(raw);
  const extra = Object.fromEntries(keys.filter((key) => !SIMPLE_KEYS.includes(key)).map((key) => [key, raw[key]]));
  const hasChoices = Array.isArray(raw.enum) && raw.enum.length > 0 && raw.enum.every((item) => typeof item === 'string');
  const known = ['string', 'number', 'integer', 'boolean'].includes(raw.type) && (raw.enum === undefined || (raw.type === 'string' && hasChoices));
  return {
    name,
    kind: !known ? 'advanced' : hasChoices ? 'choice' : raw.type,
    description: typeof raw.description === 'string' ? raw.description : '',
    choices: hasChoices ? raw.enum : [],
    required: required.includes(name),
    extra, // other keywords of this property, written back untouched
    raw: !known ? raw : undefined,
  };
}

// -> { rows, rest, canEdit }. `rest` is everything on the schema besides type/properties/required. `canEdit` is false
// when the schema isn't an object schema the rows can describe (then the form keeps the JSON box).
export function readParams(schema) {
  if (schema === undefined || schema === null) return { rows: [], rest: {}, canEdit: true };
  if (!isObj(schema)) return { rows: [], rest: {}, canEdit: false };
  const { type, properties, required, ...rest } = schema;
  if (type !== undefined && type !== 'object') return { rows: [], rest: {}, canEdit: false };
  if (properties !== undefined && !isObj(properties)) return { rows: [], rest: {}, canEdit: false };
  const need = Array.isArray(required) ? required.filter((name) => typeof name === 'string') : [];
  const rows = Object.keys(properties || {}).map((name) => readProperty(name, properties[name], need));
  return { rows, rest, canEdit: true };
}

export function writeProperty(row) {
  if (row.kind === 'advanced') return row.raw ?? { ...row.extra };
  const out = {};
  out.type = row.kind === 'choice' ? 'string' : row.kind;
  if (row.description) out.description = row.description;
  if (row.kind === 'choice') out.enum = row.choices.filter((choice) => choice !== '');
  return { ...out, ...row.extra };
}

export function writeParams(rows, rest = {}) {
  const properties = {};
  rows.forEach((row) => {
    if (row.name) properties[row.name] = writeProperty(row);
  });
  const required = rows.filter((row) => row.name && row.required).map((row) => row.name);
  const out = { type: 'object', properties };
  if (required.length) out.required = required;
  return { ...out, ...rest };
}

export function problems(rows) {
  const out = [];
  const seen = new Set();
  rows.forEach((row, index) => {
    if (!row.name) out.push({ index, text: 'Give this parameter a name.' });
    else if (!PARAM_NAME.test(row.name))
      out.push({ index, text: `“${row.name}” should be snake_case: lowercase letters, digits and _, starting with a letter.` });
    else if (seen.has(row.name)) out.push({ index, text: `“${row.name}” is used twice.` });
    seen.add(row.name);
    if (row.kind === 'choice' && row.choices.filter(Boolean).length === 0)
      out.push({ index, text: `“${row.name || 'This parameter'}” is “one of a list” but has no choices.` });
    if (row.name && row.kind !== 'advanced' && !row.description.trim())
      out.push({ index, level: 'hint', text: `Say what “${row.name}” is for: the model reads this to decide what to fill in.` });
  });
  return out;
}

// What the model is shown for the tool: its name, what it is for, and the parameters as a plain list.
export function modelView({ name, description, rows }) {
  const params = rows
    .filter((row) => row.name)
    .map((row) => {
      const kind =
        row.kind === 'choice'
          ? `one of: ${row.choices.filter(Boolean).join(', ') || '…'}`
          : row.kind === 'advanced'
            ? 'structured'
            : (PARAM_KINDS.find((k) => k.id === row.kind)?.label || row.kind).toLowerCase();
      return `${row.name} (${kind}${row.required ? ', required' : ', optional'})${row.description ? `: ${row.description}` : ''}`;
    });
  return {
    signature: `${name || 'tool_name'}(${rows
      .filter((row) => row.name)
      .map((row) => row.name)
      .join(', ')})`,
    description: description || '',
    params,
  };
}

// A body for a request built from the parameters: { "city": "{{args.city}}", ... }.
export function bodyFromParams(rows) {
  return Object.fromEntries(rows.filter((row) => row.name).map((row) => [row.name, `{{args.${row.name}}}`]));
}
