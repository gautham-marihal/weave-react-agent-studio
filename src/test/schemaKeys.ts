// Finds keys in a config that the server's schema does not allow (an object with additionalProperties: false that has a
// key it does not list). Used by tests to prove that what the forms write, and what PUT /draft sends, are the server's
// own config paths. Values are not checked here: the server's POST /validate does that.
import schemaSnapshot from './fixtures/agent-config.schema.json';

type Json = Record<string, unknown>;
type Schema = Json & {
  $ref?: string;
  properties?: Record<string, Schema>;
  patternProperties?: Record<string, Schema>;
  additionalProperties?: boolean | Schema;
  items?: Schema;
  allOf?: Schema[];
  oneOf?: Schema[];
  anyOf?: Schema[];
  then?: Schema;
  else?: Schema;
};

/** GET /schema as captured in src/test/fixtures/agent-config.schema.json (refresh with npm run schema:snapshot). */
export const SCHEMA = schemaSnapshot as unknown as Schema;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function resolve(s: Schema | undefined, root: Schema): Schema | undefined {
  let cur = s;
  for (let i = 0; cur?.$ref && i < 10; i++) {
    const name = cur.$ref.split('/').pop() ?? '';
    cur = (root.$defs as Record<string, Schema> | undefined)?.[name];
  }
  return cur;
}

/** Every alternative a schema can take (allOf parts merged, oneOf/anyOf as choices). */
function variants(s: Schema | undefined, root: Schema): Schema[] {
  const r = resolve(s, root);
  if (!r) return [];
  const own = { ...r };
  const parts = [own, ...(r.allOf ?? []).flatMap((p) => variants(p, root)), ...(r.then ? variants(r.then, root) : []), ...(r.else ? variants(r.else, root) : [])];
  const choices = [...(r.oneOf ?? []), ...(r.anyOf ?? [])].flatMap((c) => variants(c, root));
  return [...parts, ...choices];
}

interface Allowed {
  closed: boolean;
  props: Map<string, Schema[]>;
  patterns: Array<[RegExp, Schema]>;
  extra: Schema[];
  items: Schema[];
}

function allowedFor(s: Schema | undefined, root: Schema): Allowed {
  const out: Allowed = { closed: false, props: new Map(), patterns: [], extra: [], items: [] };
  const vs = variants(s, root);
  // Closed only when every alternative that says anything about keys forbids unknown ones.
  const keyed = vs.filter((v) => v.properties || v.additionalProperties !== undefined || v.patternProperties);
  out.closed = keyed.length > 0 && keyed.every((v) => v.additionalProperties === false);
  vs.forEach((v) => {
    Object.entries(v.properties ?? {}).forEach(([k, p]) => out.props.set(k, [...(out.props.get(k) ?? []), p]));
    Object.entries(v.patternProperties ?? {}).forEach(([re, p]) => out.patterns.push([new RegExp(re), p]));
    if (isObj(v.additionalProperties)) out.extra.push(v.additionalProperties as Schema);
    if (v.items) out.items.push(v.items);
  });
  return out;
}

/** Paths (dotted, array items as [i]) of keys the schema does not allow. Empty means every key is a real config key. */
export function unknownKeys(value: unknown, schema: Schema = SCHEMA, root: Schema = SCHEMA, at = ''): string[] {
  const allowed = allowedFor(schema, root);
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => allowed.items.flatMap((s) => unknownKeys(item, s, root, `${at}[${i}]`)));
  }
  if (!isObj(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const here = at ? `${at}.${key}` : key;
    const known = allowed.props.get(key) ?? allowed.patterns.filter(([re]) => re.test(key)).map(([, s]) => s);
    const schemas = known.length ? known : allowed.extra;
    if (!schemas.length) return allowed.closed ? [here] : [];
    // A key is fine when any alternative accepts it; report the alternative with the fewest problems.
    const results = schemas.map((s) => unknownKeys(child, s, root, here));
    return results.reduce((best, r) => (r.length < best.length ? r : best), results[0]);
  });
}

/** Whether a dotted path (no array indexes) names a place the schema has. */
export function isSchemaPath(path: string, schema: Schema = SCHEMA): boolean {
  let current: Schema[] = [schema];
  for (const key of path.split('.')) {
    const next = current.flatMap((s) => {
      const a = allowedFor(s, schema);
      const direct = a.props.get(key) ?? [];
      return direct.length ? direct : a.items.flatMap((i) => allowedFor(i, schema).props.get(key) ?? []);
    });
    if (!next.length) return false;
    current = next;
  }
  return true;
}
