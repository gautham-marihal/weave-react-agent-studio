// Turns the agent-config JSON Schema into TypeScript declarations (src/api/agentConfig.d.ts), which the editor uses through JSDoc
// (`@type {import('./agentConfig').AgentConfig}`), so a misspelt field or a wrong shape is flagged while typing.
//
//   npm run types            regenerate from tests/fixtures/agent-config.schema.json
//   npm run sync-fixtures    refreshes that fixture from the server; run `npm run types` after
//
// What it covers: $ref, allOf, oneOf/anyOf, enum, const, arrays, objects with properties and additionalProperties, nullable types.
// What it leaves out: if/then conditions (which fields are required for which `type`), patterns and numeric limits. The validator
// (POST /validate) is the authority on those; these types describe the shape, not every rule.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const pascal = (name) => String(name).replace(/(^|[^A-Za-z0-9]+)([A-Za-z0-9])/g, (_, __, c) => c.toUpperCase());
const KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const key = (name) => (KEY.test(name) ? name : JSON.stringify(name));
const comment = (text, indent) => {
  if (!text) return '';
  const lines = String(text).replace(/\*\//g, '* /').split('\n').map((line) => line.trim()).filter(Boolean);
  const short = lines.join(' ').slice(0, 220) + (lines.join(' ').length > 220 ? '…' : '');
  return `${indent}/** ${short} */\n`;
};

export function generateTypes(schema) {
  const defs = schema.$defs || {};

  // `#/$defs/Name` is a named type; any deeper pointer (`#/$defs/conversation/properties/inactivity`) is written out in place.
  const resolve = (pointer) => pointer.replace(/^#\//, '').split('/').reduce((node, part) => (node ? node[part.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined), schema);
  const ref = (pointer, indent, depth = 0) => {
    const named = /^#\/\$defs\/([^/]+)$/.exec(pointer);
    if (named) return pascal(named[1]);
    const target = resolve(pointer);
    return target && depth < 8 ? wrap(typeOf(target, indent, depth + 1)) : 'unknown';
  };

  function typeOf(node, indent, depth = 0) {
    if (node === true || node === undefined || node === null) return 'unknown';
    if (node === false) return 'never';
    if (node.$ref) {
      const rest = { ...node }; delete rest.$ref;
      const base = ref(node.$ref, indent, depth);
      return Object.keys(rest).some((k) => ['properties', 'allOf', 'oneOf', 'enum', 'type'].includes(k)) ? `${base} & ${typeOf(rest, indent, depth)}` : base;
    }
    if (node.const !== undefined) return JSON.stringify(node.const);
    if (node.enum) return node.enum.map((value) => JSON.stringify(value)).join(' | ') || 'never';
    const pieces = [];
    if (node.oneOf || node.anyOf) pieces.push(`(${(node.oneOf || node.anyOf).map((part) => typeOf(part, indent, depth)).join(' | ')})`);
    if (node.allOf) {
      // parts that are only if/then conditions describe no shape of their own
      const parts = node.allOf.map((part) => typeOf(part, indent, depth)).filter((text) => text !== 'unknown');
      if (parts.length) pieces.push(parts.map((text) => `(${text})`).join(' & '));
    }
    const types = [].concat(node.type || []);
    if (!pieces.length || node.properties || types.length) {
      const own = [];
      (types.length ? types : ['*']).forEach((t) => {
        if (t === 'string') own.push('string');
        else if (t === 'number' || t === 'integer') own.push('number');
        else if (t === 'boolean') own.push('boolean');
        else if (t === 'null') own.push('null');
        else if (t === 'array') own.push(`${wrap(typeOf(node.items, indent, depth))}[]`);
        else if (t === 'object' || (t === '*' && (node.properties || node.additionalProperties !== undefined))) own.push(objectType(node, indent, depth));
        else if (t === '*' && !pieces.length) own.push('unknown');
      });
      if (own.length) pieces.push(own.join(' | '));
    }
    return pieces.join(' & ') || 'unknown';
  }
  const wrap = (text) => (/[|&]/.test(text) ? `(${text})` : text);

  function objectType(node, indent, depth = 0) {
    const props = node.properties || {};
    const required = new Set(node.required || []);
    const inner = `${indent}  `;
    const lines = Object.entries(props).map(([name, child]) => `${comment(child && child.description, inner)}${inner}${key(name)}${required.has(name) ? '' : '?'}: ${typeOf(child, inner, depth)};`);
    const extra = node.additionalProperties;
    // with named properties beside it, the index must also admit their types, so it is left open
    if (extra && typeof extra === 'object') lines.push(`${inner}[key: string]: ${Object.keys(props).length ? 'unknown' : typeOf(extra, inner, depth)};`);
    else if (extra === undefined && node.unevaluatedProperties === undefined && Object.keys(props).length) lines.push(`${inner}[key: string]: unknown;`);
    if (!lines.length) return extra === false ? 'Record<string, never>' : 'Record<string, unknown>';
    return `{\n${lines.join('\n')}\n${indent}}`;
  }

  let out = '// Generated by scripts/schemaTypes.mjs from tests/fixtures/agent-config.schema.json. Do not edit; run `npm run types`.\n';
  out += '// These describe the shape of an agent configuration. Rules that depend on a value (which fields a tool of each type needs, patterns,\n// limits) are not here: POST /validate is the authority on those.\n\n';
  Object.entries(defs).forEach(([name, node]) => {
    out += `${comment(node.title || node.description, '')}export type ${pascal(name)} = ${typeOf(node, '')};\n\n`;
  });
  out += `${comment(schema.title || 'An agent configuration', '')}export interface AgentConfig ${objectType({ ...schema, additionalProperties: false }, '')}\n`;
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const schemaPath = new URL('../tests/fixtures/agent-config.schema.json', import.meta.url);
  const target = new URL('../src/api/agentConfig.d.ts', import.meta.url);
  fs.writeFileSync(target, generateTypes(JSON.parse(fs.readFileSync(schemaPath, 'utf8'))));
  console.log(`Wrote ${fileURLToPath(target)}`);
}
