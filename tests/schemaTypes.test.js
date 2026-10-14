import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateTypes } from '../scripts/schemaTypes.mjs';

const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
const lf = (text) => text.replace(/\r\n/g, '\n');

test('the generated types are up to date with the schema fixture (run `npm run types` if this fails)', () => {
  const committed = lf(readFileSync(new URL('../src/api/agentConfig.d.ts', import.meta.url), 'utf8'));
  assert.equal(committed, generateTypes(schema));
});

test('the generator turns the shapes of the schema into types', () => {
  const out = generateTypes({
    $defs: {
      id: { type: 'string' },
      mode: { enum: ['a', 'b'] },
      pair: { type: 'object', required: ['x'], properties: { x: { $ref: '#/$defs/id' }, y: { type: 'array', items: { type: 'integer' } } }, additionalProperties: false },
      either: { oneOf: [{ type: 'string' }, { $ref: '#/$defs/pair' }] },
      deep: { $ref: '#/$defs/pair/properties/y' },
    },
    type: 'object', required: ['name'], properties: { name: { type: 'string' }, mode: { $ref: '#/$defs/mode' } },
  });
  assert.match(out, /export type Id = string;/);
  assert.match(out, /export type Mode = "a" \| "b";/);
  assert.match(out, /x: Id;/);
  assert.match(out, /y\?: number\[\];/);
  assert.match(out, /export type Either = \(string \| Pair\);/);
  assert.match(out, /export type Deep = number\[\];/);
  assert.match(out, /export interface AgentConfig \{[\s\S]*name: string;[\s\S]*mode\?: Mode;/);
});
