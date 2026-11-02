// A tool's `parameters` is a JSON Schema of the arguments the model fills in. Hand-written JSON Schema is the tool
// editor's biggest hurdle, so the page shows rows (name, kind, what it is for, needed, choices). This converts rows to
// schema and back without losing a keyword it doesn't know. Pure: no React, no network.

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

export const PARAM_NAME = /^[a-z][a-z0-9_]*$/;
export type ParamKind = 'string' | 'number' | 'integer' | 'boolean' | 'choice' | 'advanced';
export const PARAM_KINDS: { id: Exclude<ParamKind, 'advanced'>; label: string }[] = [
  { id: 'string', label: 'Text' },
  { id: 'number', label: 'Number' },
  { id: 'integer', label: 'Whole number' },
  { id: 'boolean', label: 'Yes / no' },
  { id: 'choice', label: 'One of a list' },
];

export interface ParamRow {
  name: string;
  kind: ParamKind;
  description: string;
  choices: string[];
  required: boolean;
  /** Other keywords of this property, written back untouched. */
  extra: Json;
  /** The whole property, for one the rows can't show. */
  raw?: Json;
}

const SIMPLE_KEYS = ['type', 'description', 'enum'];

/**
 * A property the rows can show: a plain type, optionally with a description and (for text) a list of allowed values.
 * Anything else (a nested object, a list, $ref, oneOf...) is kept whole and shown as "structured".
 */
function readProperty(name: string, schema: unknown, required: string[]): ParamRow {
  const raw = isObj(schema) ? schema : {};
  const extra = Object.fromEntries(Object.keys(raw).filter((k) => !SIMPLE_KEYS.includes(k)).map((k) => [k, raw[k]]));
  const choices = Array.isArray(raw.enum) && raw.enum.length > 0 && raw.enum.every((x) => typeof x === 'string') ? (raw.enum as string[]) : null;
  const type = String(raw.type);
  const known = ['string', 'number', 'integer', 'boolean'].includes(type) && (raw.enum === undefined || (type === 'string' && !!choices));
  return {
    name,
    kind: !known ? 'advanced' : choices ? 'choice' : (type as ParamKind),
    description: typeof raw.description === 'string' ? raw.description : '',
    choices: choices ?? [],
    required: required.includes(name),
    extra,
    raw: !known ? raw : undefined,
  };
}

/** -> rows, the rest of the schema, and whether the rows can describe it at all (else it is edited as JSON). */
export function readParams(schema: unknown): { rows: ParamRow[]; rest: Json; canEdit: boolean } {
  if (schema === undefined || schema === null) return { rows: [], rest: {}, canEdit: true };
  if (!isObj(schema)) return { rows: [], rest: {}, canEdit: false };
  const { type, properties, required, ...rest } = schema;
  if (type !== undefined && type !== 'object') return { rows: [], rest: {}, canEdit: false };
  if (properties !== undefined && !isObj(properties)) return { rows: [], rest: {}, canEdit: false };
  const need = Array.isArray(required) ? required.filter((n): n is string => typeof n === 'string') : [];
  const props = (properties ?? {}) as Json;
  return { rows: Object.keys(props).map((name) => readProperty(name, props[name], need)), rest, canEdit: true };
}

export function writeProperty(row: ParamRow): Json {
  if (row.kind === 'advanced') return row.raw ?? { ...row.extra };
  const out: Json = { type: row.kind === 'choice' ? 'string' : row.kind };
  if (row.description) out.description = row.description;
  if (row.kind === 'choice') out.enum = row.choices.filter((c) => c !== '');
  return { ...out, ...row.extra };
}

export function writeParams(rows: ParamRow[], rest: Json = {}): Json {
  const properties: Json = {};
  rows.forEach((row) => {
    if (row.name) properties[row.name] = writeProperty(row);
  });
  const required = rows.filter((r) => r.name && r.required).map((r) => r.name);
  const out: Json = { type: 'object', properties };
  if (required.length) out.required = required;
  return { ...out, ...rest };
}

export const newParamRow = (): ParamRow => ({ name: '', kind: 'string', description: '', choices: [], required: false, extra: {} });

export interface ParamProblem {
  index: number;
  level?: 'hint';
  text: string;
}

export function paramProblems(rows: ParamRow[]): ParamProblem[] {
  const out: ParamProblem[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    if (!row.name) out.push({ index, text: 'Give this parameter a name.' });
    else if (!PARAM_NAME.test(row.name)) out.push({ index, text: `“${row.name}” should be snake_case: lowercase letters, digits and _, starting with a letter.` });
    else if (seen.has(row.name)) out.push({ index, text: `“${row.name}” is used twice.` });
    seen.add(row.name);
    if (row.kind === 'choice' && row.choices.filter(Boolean).length === 0) out.push({ index, text: `“${row.name || 'This parameter'}” is “one of a list” but has no choices.` });
    if (row.name && row.kind !== 'advanced' && !row.description.trim()) out.push({ index, level: 'hint', text: `Say what “${row.name}” is for: the model reads this to decide what to fill in.` });
  });
  return out;
}

/** What the model is shown for the tool: its name, what it is for, and the parameters as a plain list. */
export function modelView({ name, description, rows }: { name: string; description?: string; rows: ParamRow[] }) {
  const named = rows.filter((r) => r.name);
  const params = named.map((row) => {
    const kind =
      row.kind === 'choice'
        ? `one of: ${row.choices.filter(Boolean).join(', ') || '…'}`
        : row.kind === 'advanced'
          ? 'structured'
          : (PARAM_KINDS.find((k) => k.id === row.kind)?.label ?? row.kind).toLowerCase();
    return `${row.name} (${kind}${row.required ? ', required' : ', optional'})${row.description ? `: ${row.description}` : ''}`;
  });
  return { signature: `${name || 'tool_name'}(${named.map((r) => r.name).join(', ')})`, description: description ?? '', params };
}

/** A request body built from the parameters: { "city": "{{args.city}}", ... }. */
export function bodyFromParams(rows: ParamRow[]): Record<string, string> {
  return Object.fromEntries(rows.filter((r) => r.name).map((r) => [r.name, `{{args.${r.name}}}`]));
}

/** The tool's argument names, from its `parameters` JSON Schema. */
export const argNamesOf = (tool: unknown): string[] => {
  const params = isObj(tool) && isObj(tool.parameters) ? tool.parameters : null;
  return params && isObj(params.properties) ? Object.keys(params.properties) : [];
};
