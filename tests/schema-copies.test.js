import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { generateTypes } from '../scripts/schemaTypes.mjs';

// The schema is kept in several places; they have to agree, or a download, a build or the editor's types describe an old schema.
const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const fixture = read('./fixtures/agent-config.schema.json');

test('the schema people download (public/config) is the same as the fixture (run `npm run sync-public`)', () => {
  assert.deepEqual(read('../public/config/agent-config.schema.json'), fixture);
});

test('the example people download is the same as the fixture example', () => {
  assert.deepEqual(read('../public/config/agent-config.example.json'), read('./fixtures/agent-config.example.json'));
});

test('the declarations are generated from that same schema', () => {
  const committed = readFileSync(new URL('../src/api/agentConfig.d.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(committed, generateTypes(fixture));
});

test(
  'a built copy (dist/config), when there is one, is not older than the public one (run `npm run build`)',
  { skip: !existsSync(new URL('../dist/config/agent-config.schema.json', import.meta.url)) && 'no build in dist/' },
  () => {
    assert.deepEqual(read('../dist/config/agent-config.schema.json'), fixture);
  },
);

test('the schema names the features the newer copies must have', () => {
  const defs = Object.keys(fixture.$defs);
  ['actionCollectDtmf', 'taskStep'].forEach((name) => assert.ok(defs.includes(name), `${name} is in the schema`));
  assert.ok(fixture.$defs.stateVariable.properties.sensitive, 'sensitive state variables');
  assert.deepEqual(fixture.properties.schema_version.enum, ['1.1', '1.2']);
});
