// Reads the Agent Builder's JSON Schema (draft 2020-12) and answers what a form needs: which control a value needs,
// which oneOf branch it is, which fields exist after if/then, and a sensible default. No React, so it tests alone.

export const isObj = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const union = (a = [], b = []) => [...new Set([...a, ...b])];
export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  return ak.length === bk.length && ak.every((k) => deepEqual(a[k], b[k]));
}

export const humanize = (key) => {
  const text = String(key)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

// Names for the branches of the schema's unions where the schema itself gives none.
const BRANCH_LABELS = {
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

export function createEngine(root) {
  const pointer = (ref) => {
    const parts = ref
      .replace(/^#\/?/, '')
      .split('/')
      .filter(Boolean)
      .map((p) => decodeURIComponent(p).replace(/~1/g, '/').replace(/~0/g, '~'));
    let node = root;
    for (const part of parts) node = node?.[part];
    return node;
  };

  // Follows $ref (any JSON pointer, not only $defs/<name>). Keywords written next to the $ref win.
  function deref(schema, depth = 0) {
    if (schema === true || schema === undefined || schema === null) return {};
    if (!isObj(schema)) return {};
    if (!schema.$ref) return schema;
    if (depth > 24) throw new Error(`$ref loop at ${schema.$ref}`);
    const { $ref, ...rest } = schema;
    const target = pointer($ref);
    if (!target) throw new Error(`Unresolved $ref ${$ref}`);
    return deref({ ...target, ...rest }, depth + 1);
  }

  function mergePair(a, b) {
    const A = deref(a);
    const B = deref(b);
    const out = { ...A, ...B };
    if (A.properties || B.properties) out.properties = mergeProps(A.properties || {}, B.properties || {});
    if (A.required || B.required) out.required = union(A.required, B.required);
    return out;
  }
  function mergeProps(base, over) {
    const out = { ...base };
    for (const [key, schema] of Object.entries(over)) out[key] = key in base ? mergePair(base[key], schema) : schema;
    return out;
  }

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

  // One flat description of a schema: $ref followed, allOf folded in, if/then collected (not yet applied). Cached per
  // schema object (the schema never changes while the editor is open), so callers must treat results as read-only.
  const flatCache = new WeakMap();
  function flatten(schema, depth = 0) {
    if (depth === 0 && isObj(schema)) {
      const hit = flatCache.get(schema);
      if (hit) return hit;
      const made = flattenUncached(schema, 0);
      flatCache.set(schema, made);
      return made;
    }
    return flattenUncached(schema, depth);
  }

  function flattenUncached(schema, depth) {
    const s = deref(schema);
    if (depth > 24) throw new Error('allOf nesting too deep');
    const out = { ...s };
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

  // The shape that applies to this particular value: if/then blocks switch on when their `if` matches.
  function resolveShape(schema, value) {
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

  const typeOk = (type, value) =>
    type === 'string'
      ? typeof value === 'string'
      : type === 'number'
        ? typeof value === 'number'
        : type === 'integer'
          ? Number.isInteger(value)
          : type === 'boolean'
            ? typeof value === 'boolean'
            : type === 'null'
              ? value === null
              : type === 'array'
                ? Array.isArray(value)
                : type === 'object'
                  ? isObj(value)
                  : true;

  // Does `value` satisfy `schema`? Covers the keywords that decide a oneOf branch (type, const, enum,
  // required, properties, additionalProperties/unevaluatedProperties false, nested oneOf); ignores the rest.
  function fits(schema, value, depth = 0) {
    if (depth > 12) return true;
    const s = resolveShape(schema, value);
    if (s.const !== undefined && !deepEqual(s.const, value)) return false;
    if (s.enum && !s.enum.some((item) => deepEqual(item, value))) return false;
    if (s.type && ![].concat(s.type).some((type) => typeOk(type, value))) return false;
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
  function isPureUnion(f) {
    return !!f.oneOf && !f.type && !Object.keys(f.properties).length && f.const === undefined && !f.enum;
  }
  const branchCache = new WeakMap();
  function branchesOf(shape) {
    const cached = isObj(shape) ? branchCache.get(shape) : null;
    if (cached) return cached;
    const out = [];
    for (const branch of shape.oneOf || []) {
      const f = flatten(branch);
      if (isPureUnion(f)) out.push(...branchesOf(f));
      else out.push(branch);
    }
    if (isObj(shape)) branchCache.set(shape, out);
    return out;
  }

  function score(schema, value) {
    const s = resolveShape(schema, value);
    let points = 0;
    if (s.type && [].concat(s.type).some((type) => typeOk(type, value))) points += 2;
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

  function pickBranch(branches, value) {
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

  function branchLabel(branch, index = 0) {
    const s = flatten(branch);
    if (s.title) return s.title;
    const disc = s.properties?.type?.const ?? s.properties?.from?.const ?? s.properties?.builtin?.const;
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

  // What kind of control a (resolved) shape needs.
  function kindOf(shape) {
    if (shape.const !== undefined) return 'const';
    if (shape['x-ref']) return 'ref';
    if (shape['x-ui']?.widget === 'secret-picker') return 'secret';
    if (shape.enum) return 'enum';
    if (shape.oneOf && !shape.type && !Object.keys(shape.properties).length) return 'union';
    const types = [].concat(shape.type || []);
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

  const isNullable = (shape) => Array.isArray(shape.type) && shape.type.includes('null');

  // A value that is a reasonable starting point for a new field of this schema.
  function defaultFor(schema, depth = 0) {
    if (depth > 6) return null;
    const s = resolveShape(schema, undefined);
    if (s.const !== undefined) return s.const;
    if (s.default !== undefined) return JSON.parse(JSON.stringify(s.default));
    const kind = kindOf(s);
    if (kind === 'enum') return s.enum[0];
    if (kind === 'union') {
      const branches = branchesOf(s);
      return branches.length ? defaultFor(branches[0], depth + 1) : null;
    }
    if (kind === 'string' || kind === 'ref' || kind === 'secret') {
      if (kind === 'secret') return { secret: '' };
      return '';
    }
    if (kind === 'number') return typeof s.minimum === 'number' ? s.minimum : 0;
    if (kind === 'boolean') return false;
    if (kind === 'array') return [];
    if (kind === 'map' || kind === 'json') return {};
    if (kind === 'null') return null;
    if (kind === 'object') {
      const out = {};
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

// The ids that an `x-ref` field may point at, taken from the config being edited.
export function collectRefOptions(config) {
  const c = isObj(config) ? config : {};
  const ids = (list) => (Array.isArray(list) ? list.map((item) => item?.id).filter((id) => typeof id === 'string') : []);
  const keys = (object) => (isObj(object) ? Object.keys(object) : []);
  const connectionsOfType = (type) =>
    Object.entries(isObj(c.connections) ? c.connections : {})
      .filter(([, v]) => v?.type === type)
      .map(([k]) => k);
  // read whatever shape the JSON view left (agents.items or handoffs
  // not yet lists): the form must still open to show what is wrong
  const asList = (v) => (Array.isArray(v) ? v : []);
  const handoffTools = asList(c.agents?.items)
    .flatMap((agent) => asList(agent?.handoffs).map((h) => h?.tool))
    .filter((t) => typeof t === 'string');
  return {
    agents: ids(c.agents?.items),
    tools: ids(c.tools),
    tasks: ids(c.tasks),
    knowledge: ids(c.knowledge),
    forms: ids(c.forms),
    wrapups: ids(c.wrapups),
    messages: ids(c.messages),
    notifications: ids(c.notifications),
    channels: ids(c.channels),
    transfers: ids(c.telephony?.transfers),
    input_guardrails: ids(c.guardrails?.input),
    schedules: keys(c.schedules),
    state_vars: keys(c.state?.variables),
    http_connections: connectionsOfType('http'),
    mcp_connections: connectionsOfType('mcp'),
    notifiers: connectionsOfType('notifier'),
    tool_names: [...new Set([...ids(c.tools), ...handoffTools])],
  };
}

// Every { "secret": NAME } mentioned anywhere in the config, for the secret picker's suggestions.
export function collectSecretNames(config) {
  const found = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (isObj(node)) {
      if (typeof node.secret === 'string' && Object.keys(node).length === 1 && node.secret) found.add(node.secret);
      Object.values(node).forEach(walk);
    }
  };
  walk(config);
  return [...found].sort();
}
