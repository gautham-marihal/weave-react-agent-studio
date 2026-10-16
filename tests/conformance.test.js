import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectRefOptions, createEngine } from '../src/studio/form/engine.js';
import { COLLECTIONS, allReferences, findUsage, renameEverywhere } from '../src/studio/form/references.js';
import { corpus } from './corpus/corpus.js';
import { readEnv } from '../scripts/apiSchema.mjs';

// Conformance over a corpus of configs (see corpus/corpus.js): the checks that keep the studio generic as it grows. A new kind of bot, or a
// new schema feature, can't quietly break an editor that only ever saw one shape. This file is the part that needs no browser: renaming
// every id and map key of every config must leave nothing pointing at the old name and break nothing that worked. The part that draws every
// section is conformance.component.test.js.
//
// With CONFORMANCE_SERVER=1 (and AGENT_BUILDER_URL / AGENT_BUILDER_API_KEY, or a running local API) every config, and every renamed copy, is also
// sent to the server's POST /validate (a read: nothing is saved), and the studio's claim "this is valid" is held to the server's word.
const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
const engine = createEngine(schema);
const entries = corpus(engine);
const clone = (v) => JSON.parse(JSON.stringify(v));

const idsOf = (config, collection) => {
  const info = COLLECTIONS[collection];
  const holder = info.path.reduce((node, key) => (node == null ? node : node[key]), config);
  if (info.kind === 'list') return Array.isArray(holder) ? holder.map((item) => item?.id).filter((id) => typeof id === 'string' && id) : [];
  return holder && typeof holder === 'object' && !Array.isArray(holder) ? Object.keys(holder) : [];
};

// pointers whose value is not an id that exists (a "dangling" pointer)
function dangling(config) {
  const options = collectRefOptions(config);
  return allReferences(engine, config)
    .filter((hit) => hit.type === 'value' && typeof hit.value === 'string' && hit.value && !(options[hit.collection] || []).includes(hit.value))
    .map((hit) => `${hit.path.join('.')} -> ${hit.value}`);
}

const serverEnv = readEnv();
const askServer = process.env.CONFORMANCE_SERVER === '1';
async function validate(config) {
  const base = (serverEnv.AGENT_BUILDER_URL || 'http://localhost:8100').replace(/\/$/, '');
  const response = await fetch(`${base}/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(serverEnv.AGENT_BUILDER_API_KEY ? { Authorization: `Bearer ${serverEnv.AGENT_BUILDER_API_KEY}` } : {}) },
    body: JSON.stringify(config),
  });
  if (!response.ok && response.status !== 422) throw new Error(`POST /validate answered ${response.status}`);
  return response.json();
}

for (const entry of entries) {
  test(`${entry.name}: renaming every id and key leaves nothing pointing at the old name, and renaming back restores the config`, () => {
    const before = dangling(entry.config);
    let renamed = 0;
    for (const collection of Object.keys(COLLECTIONS)) {
      for (const id of idsOf(entry.config, collection)) {
        const to = `${id}_renamed`.slice(0, 64);
        const usesBefore = findUsage(engine, entry.config, collection, id).length;
        const next = renameEverywhere(engine, clone(entry.config), collection, id, to);
        assert.equal(findUsage(engine, next, collection, id).length, 0, `${collection} “${id}”: something still points at the old name`);
        assert.equal(findUsage(engine, next, collection, to).length, usesBefore, `${collection} “${id}”: every pointer moved`);
        assert.ok(idsOf(next, collection).includes(to) && !idsOf(next, collection).includes(id), `${collection} “${id}”: the item itself was renamed`);
        const worse = dangling(next).filter((d) => !before.includes(d.replace(to, id)) && !before.includes(d));
        assert.deepEqual(worse, [], `${collection} “${id}”: renaming left a pointer to nothing`);
        const back = renameEverywhere(engine, clone(next), collection, to, id);
        assert.deepEqual(back, entry.config, `${collection} “${id}”: renaming there and back is not the identity`);
        renamed += 1;
      }
    }
    assert.ok(renamed > 0 || Object.keys(entry.config).length < 6, 'something was renamed');
  });
}

test('the corpus has the shapes the review found trouble with: HTTP tools, handoffs, several channels, many agents, every tool kind', () => {
  const all = entries.map((e) => e.config);
  const kinds = new Set(all.flatMap((c) => (c.tools || []).map((t) => t.type)));
  ['http', 'builtin'].forEach((k) => assert.ok(kinds.has(k), `a corpus tool of kind ${k}`));
  assert.ok(
    all.some((c) => (c.tools || []).length >= 30),
    'a config with 30 or more tools',
  );
  assert.ok(
    all.some((c) => (c.agents?.items || []).length >= 6),
    'a config with several agents',
  );
  assert.ok(
    all.some((c) => (c.channels || []).length >= 5),
    'a config with every kind of channel',
  );
  assert.ok(entries.length >= 10);
});

test(
  'the server agrees with the corpus: what is called valid is valid, and a rename never makes it worse',
  { skip: !askServer && 'set CONFORMANCE_SERVER=1 (and point AGENT_BUILDER_URL at an API) to ask the server' },
  async () => {
    for (const entry of entries.filter((e) => e.valid)) {
      const report = await validate(entry.config);
      assert.equal(report.valid, true, `${entry.name}: the server says it is not valid: ${JSON.stringify((report.errors || []).slice(0, 3))}`);
      const collection = Object.keys(COLLECTIONS).find((c) => idsOf(entry.config, c).length > 0);
      if (!collection) continue;
      const id = idsOf(entry.config, collection)[0];
      const next = renameEverywhere(engine, clone(entry.config), collection, id, `${id}_renamed`);
      const after = await validate(next);
      assert.ok(
        (after.errors || []).length <= (report.errors || []).length,
        `${entry.name}: renaming ${collection} “${id}” added errors: ${JSON.stringify((after.errors || []).slice(0, 3))}`,
      );
    }
  },
);
