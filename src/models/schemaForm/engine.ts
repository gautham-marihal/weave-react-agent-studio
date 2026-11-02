// Reads the Agent Builder's JSON Schema (GET /schema, draft 2020-12) and answers what a form needs: which control a
// value needs, which oneOf branch it is, which fields exist after if/then, and a sensible default. Pure: no React.

export type Json = Record<string, unknown>;

/** A schema as written: an object, or `true` (anything goes). */
export type SchemaNode = RawSchema | boolean | null | undefined;

/** The keywords the form reads. Anything else the schema carries is kept, unread. */
export interface RawSchema {
  [key: string]: unknown;
  $ref?: string;
  type?: string | string[];
  properties?: Record<string, SchemaNode>;
  required?: string[];
  allOf?: SchemaNode[];
  oneOf?: SchemaNode[];
  anyOf?: SchemaNode[];
  if?: SchemaNode;
  then?: SchemaNode;
  else?: SchemaNode;
  items?: SchemaNode;
  additionalProperties?: SchemaNode;
  unevaluatedProperties?: SchemaNode;
  propertyNames?: SchemaNode;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  title?: string;
  description?: string;
  'x-ref'?: string;
  'x-ui'?: Json;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  minLength?: number;
  pattern?: string;
  examples?: unknown[];
  deprecated?: boolean;
}

/** A schema flattened for one value: $ref followed, allOf folded in, the if/then blocks that apply merged. */
export interface Shape extends RawSchema {
  properties: Record<string, SchemaNode>;
  required: string[];
  conds: { if: SchemaNode; then: SchemaNode }[];
}

export type Kind = 'const' | 'ref' | 'secret' | 'enum' | 'union' | 'string' | 'number' | 'boolean' | 'array' | 'object' | 'map' | 'json' | 'null';

export const isObj = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value);
const union = (a: string[] = [], b: string[] = []) => [...new Set([...a, ...b])];

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ao = a as Json;
  const bo = b as Json;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  return ak.length === bk.length && ak.every((k) => deepEqual(ao[k], bo[k]));
}

/** "timeout_s" -> "Timeout s": a key made readable, when nothing better is known. */
export const humanize = (key: unknown): string => {
  const text = String(key)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

// Names for the branches of the schema's unions where the schema itself gives none.
const BRANCH_LABELS: Record<string, string> = {
  state: 'State variable',
  arg: 'Tool argument',
  result: 'Tool result',
  event: 'Event detail',
  channel: 'Channel',
  schedule: 'Business hours',
  all: 'All of',
  any: 'Any of',
  not: 'Not',
  message: 'Message',
  secret: 'Secret',
  lookup: 'Lookup by state',
  file: 'File',
  url: 'Web address',
  from: 'Source',
  task: 'Task',
  server: 'MCP server',
};

const INHERITED = [
  'type',
  'additionalProperties',
  'unevaluatedProperties',
  'propertyNames',
  'items',
  'enum',
  'const',
  'title',
  'description',
  'x-ui',
  'x-ref',
  'minimum',
  'maximum',
  'minLength',
  'pattern',
  'format',
];

const typesOf = (type: unknown): string[] => (Array.isArray(type) ? type.map(String) : type === undefined ? [] : [String(type)]);

function typeOk(type: string, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'integer':
      return Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isObj(value);
    default:
      return true;
  }
}

export function createEngine(root: RawSchema) {
  const pointer = (ref: string): unknown => {
    const parts = ref
      .replace(/^#\/?/, '')
      .split('/')
      .filter(Boolean)
      .map((p) => decodeURIComponent(p).replace(/~1/g, '/').replace(/~0/g, '~'));
    let node: unknown = root;
    for (const part of parts) node = isObj(node) ? node[part] : undefined;
    return node;
  };

  /** Follows $ref (any JSON pointer). Keywords written next to the $ref win. */
  function deref(schema: SchemaNode | unknown, depth = 0): RawSchema {
    if (!isObj(schema)) return {};
    const s = schema as RawSchema;
    if (!s.$ref) return s;
    if (depth > 24) throw new Error(`$ref loop at ${s.$ref}`);
    const { $ref, ...rest } = s;
    const target = pointer($ref);
    if (!isObj(target)) throw new Error(`Unresolved $ref ${$ref}`);
    return deref({ ...target, ...rest }, depth + 1);
  }

  function mergePair(a: SchemaNode, b: SchemaNode): RawSchema {
    const A = deref(a);
    const B = deref(b);
    const out: RawSchema = { ...A, ...B };
    if (A.properties || B.properties) out.properties = mergeProps(A.properties || {}, B.properties || {});
    if (A.required || B.required) out.required = union(A.required, B.required);
    return out;
  }
  function mergeProps(base: Record<string, SchemaNode>, over: Record<string, SchemaNode>): Record<string, SchemaNode> {
    const out = { ...base };
    for (const [key, schema] of Object.entries(over)) out[key] = key in base ? mergePair(base[key], schema) : schema;
    return out;
  }

  // One flat description of a schema, cached per schema object (the schema never changes while the form is open), so
  // results are read-only.
  const flatCache = new WeakMap<object, Shape>();
  function flatten(schema: SchemaNode | unknown, depth = 0): Shape {
    if (depth === 0 && isObj(schema)) {
      const hit = flatCache.get(schema);
      if (hit) return hit;
      const made = flattenUncached(schema, 0);
      flatCache.set(schema, made);
      return made;
    }
    return flattenUncached(schema, depth);
  }

  function flattenUncached(schema: SchemaNode | unknown, depth: number): Shape {
    const s = deref(schema);
    if (depth > 24) throw new Error('allOf nesting too deep');
    const out = { ...s } as Shape;
    delete out.allOf;
    delete out.if;
    delete out.then;
    delete out.else;
    out.properties = { ...(s.properties || {}) };
    out.required = [...(s.required || [])];
    out.conds = [];
    if (s.if && s.then) out.conds.push({ if: s.if, then: s.then });
    for (const part of s.allOf || []) {
      const f = flatten(part, depth + 1);
      out.properties = mergeProps(f.properties, out.properties);
      out.required = union(out.required, f.required);
      out.conds.push(...f.conds);
      for (const key of INHERITED) if (out[key] === undefined && f[key] !== undefined) out[key] = f[key];
      if (f.oneOf && !out.oneOf) out.oneOf = f.oneOf;
    }
    return out;
  }

  /** The shape that applies to this value: if/then blocks switch on when their `if` matches. */
  function resolveShape(schema: SchemaNode | unknown, value: unknown): Shape {
    const shape = flatten(schema);
    if (!shape.conds.length || !isObj(value)) return shape;
    let out = shape;
    for (const cond of shape.conds) {
      if (!fits(cond.if, value)) continue;
      const then = flatten(cond.then);
      out = { ...out, properties: mergeProps(out.properties, then.properties), required: union(out.required, then.required) };
    }
    return out;
  }

  /**
   * Does `value` satisfy `schema`? Covers the keywords that decide a oneOf branch (type, const, enum, required,
   * properties, closed objects, nested oneOf); ignores the rest.
   */
  function fits(schema: SchemaNode | unknown, value: unknown, depth = 0): boolean {
    if (depth > 12) return true;
    const s = resolveShape(schema, value);
    if (s.const !== undefined && !deepEqual(s.const, value)) return false;
    if (s.enum && !s.enum.some((item) => deepEqual(item, value))) return false;
    const types = typesOf(s.type);
    if (types.length && !types.some((type) => typeOk(type, value))) return false;
    if (isObj(value)) {
      if (s.required.some((key) => !(key in value))) return false;
      const closed = s.additionalProperties === false || s.unevaluatedProperties === false;
      for (const [key, item] of Object.entries(value)) {
        if (key in s.properties) {
          if (!fits(s.properties[key], item, depth + 1)) return false;
        } else if (closed) return false;
      }
    }
    if (Array.isArray(value) && s.items && value.some((item) => !fits(s.items, item, depth + 1))) return false;
    if (s.oneOf && !s.oneOf.some((branch) => fits(branch, value, depth + 1))) return false;
    return true;
  }

  // A oneOf whose branches are themselves oneOfs (recipients -> lookupValue) is listed as one flat set.
  function isPureUnion(f: Shape): boolean {
    return !!f.oneOf && !f.type && !Object.keys(f.properties).length && f.const === undefined && !f.enum;
  }
  const branchCache = new WeakMap<object, SchemaNode[]>();
  function branchesOf(shape: Shape): SchemaNode[] {
    const cached = branchCache.get(shape);
    if (cached) return cached;
    const out: SchemaNode[] = [];
    for (const branch of shape.oneOf || []) {
      const f = flatten(branch);
      if (isPureUnion(f)) out.push(...branchesOf(f));
      else out.push(branch);
    }
    branchCache.set(shape, out);
    return out;
  }

  function score(schema: SchemaNode, value: unknown): number {
    const s = resolveShape(schema, value);
    let points = 0;
    if (typesOf(s.type).some((type) => typeOk(type, value))) points += 2;
    if (isObj(value)) {
      for (const [key, item] of Object.entries(value)) {
        if (!(key in s.properties)) {
          points -= 1;
          continue;
        }
        const sub = flatten(s.properties[key]);
        points += sub.const !== undefined ? (deepEqual(sub.const, item) ? 4 : -10) : 1;
      }
      points -= s.required.filter((key) => !(key in value)).length;
    }
    return points;
  }

  /** The branch a value is: the first it fits, else the closest. */
  function pickBranch(branches: SchemaNode[], value: unknown): number {
    for (let i = 0; i < branches.length; i += 1) if (fits(branches[i], value)) return i;
    let best = 0;
    let bestScore = -Infinity;
    branches.forEach((branch, i) => {
      const points = score(branch, value);
      if (points > bestScore) {
        best = i;
        bestScore = points;
      }
    });
    return best;
  }

  function branchLabel(branch: SchemaNode, index = 0): string {
    const s = flatten(branch);
    if (s.title) return s.title;
    const constOf = (k: string) => {
      const p = s.properties[k];
      return isObj(p) ? p.const : undefined;
    };
    const disc = constOf('type') ?? constOf('from') ?? constOf('builtin');
    if (disc !== undefined) return humanize(disc);
    if (s.const !== undefined) return humanize(s.const);
    if (s.enum) return 'Choose from a list';
    if (s.type === 'string') return 'Text';
    if (s.type === 'null') return 'None';
    if (s.type === 'array') return 'List';
    if (s.type === 'boolean') return 'Yes / no';
    if (s.type === 'number' || s.type === 'integer') return 'Number';
    const key = s.required?.[0];
    if (key) return BRANCH_LABELS[key] || humanize(key);
    return `Option ${index + 1}`;
  }

  /** What kind of control a (resolved) shape needs. */
  function kindOf(shape: Shape): Kind {
    if (shape.const !== undefined) return 'const';
    if (shape['x-ref']) return 'ref';
    if (isObj(shape['x-ui']) && shape['x-ui'].widget === 'secret-picker') return 'secret';
    if (shape.enum) return 'enum';
    if (shape.oneOf && !shape.type && !Object.keys(shape.properties).length) return 'union';
    const types = typesOf(shape.type);
    const main = types.find((type) => type !== 'null');
    if (main === 'string') return 'string';
    if (main === 'number' || main === 'integer') return 'number';
    if (main === 'boolean') return 'boolean';
    if (main === 'array') return shape.items ? 'array' : 'json';
    if (main === 'object' || (!main && Object.keys(shape.properties).length)) {
      if (Object.keys(shape.properties).length) return 'object';
      if (isObj(shape.additionalProperties) || shape.propertyNames) return 'map';
      return 'json';
    }
    if (types.length === 1 && types[0] === 'null') return 'null';
    return 'json';
  }

  const isNullable = (shape: Shape): boolean => Array.isArray(shape.type) && shape.type.includes('null');

  /** A value that is a reasonable starting point for a new field of this schema. */
  function defaultFor(schema: SchemaNode | unknown, depth = 0): unknown {
    if (depth > 6) return null;
    const s = resolveShape(schema, undefined);
    if (s.const !== undefined) return s.const;
    if (s.default !== undefined) return JSON.parse(JSON.stringify(s.default));
    const kind = kindOf(s);
    if (kind === 'enum') return s.enum?.[0];
    if (kind === 'union') {
      const branches = branchesOf(s);
      return branches.length ? defaultFor(branches[0], depth + 1) : null;
    }
    if (kind === 'secret') return { secret: '' };
    if (kind === 'string' || kind === 'ref') return '';
    if (kind === 'number') return typeof s.minimum === 'number' ? s.minimum : 0;
    if (kind === 'boolean') return false;
    if (kind === 'array') return [];
    if (kind === 'map' || kind === 'json') return {};
    if (kind === 'null') return null;
    if (kind === 'object') {
      const out: Json = {};
      for (const key of s.required) if (key in s.properties) out[key] = defaultFor(s.properties[key], depth + 1);
      // consts (the discriminator of a union branch) are always part of the object, required or not
      for (const [key, sub] of Object.entries(s.properties)) {
        const f = flatten(sub);
        if (f.const !== undefined) out[key] = f.const;
      }
      return out;
    }
    return null;
  }

  return { root, deref, flatten, resolveShape, fits, pickBranch, branchesOf, branchLabel, kindOf, isNullable, defaultFor, isPureUnion };
}

export type SchemaEngine = ReturnType<typeof createEngine>;

/** The ids each `x-ref` collection offers, read from the config being edited (whatever shape the JSON view left). */
export type RefOptions = Record<string, string[]>;

export function collectRefOptions(config: unknown): RefOptions {
  const c = isObj(config) ? config : {};
  const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const ids = (list: unknown) =>
    asList(list)
      .map((item) => (isObj(item) ? item.id : undefined))
      .filter((id): id is string => typeof id === 'string');
  const keys = (object: unknown) => (isObj(object) ? Object.keys(object) : []);
  const at = (...path: string[]): unknown => path.reduce<unknown>((node, k) => (isObj(node) ? node[k] : undefined), c);
  const connectionsOfType = (type: string) =>
    Object.entries(isObj(c.connections) ? c.connections : {})
      .filter(([, v]) => isObj(v) && v.type === type)
      .map(([k]) => k);
  const handoffTools = asList(at('agents', 'items'))
    .flatMap((agent) => asList(isObj(agent) ? agent.handoffs : undefined).map((h) => (isObj(h) ? h.tool : undefined)))
    .filter((t): t is string => typeof t === 'string');
  return {
    agents: ids(at('agents', 'items')),
    tools: ids(c.tools),
    tasks: ids(c.tasks),
    knowledge: ids(c.knowledge),
    forms: ids(c.forms),
    wrapups: ids(c.wrapups),
    messages: ids(c.messages),
    notifications: ids(c.notifications),
    channels: ids(c.channels),
    transfers: ids(at('telephony', 'transfers')),
    input_guardrails: ids(at('guardrails', 'input')),
    schedules: keys(c.schedules),
    state_vars: keys(at('state', 'variables')),
    http_connections: connectionsOfType('http'),
    mcp_connections: connectionsOfType('mcp'),
    notifiers: connectionsOfType('notifier'),
    tool_names: [...new Set([...ids(c.tools), ...handoffTools])],
  };
}

/** Every { "secret": NAME } named anywhere in the config, for the secret box's suggestions. */
export function collectSecretNames(config: unknown): string[] {
  const found = new Set<string>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (isObj(node)) {
      if (typeof node.secret === 'string' && Object.keys(node).length === 1 && node.secret) found.add(node.secret);
      Object.values(node).forEach(walk);
    }
  };
  walk(config);
  return [...found].sort();
}
