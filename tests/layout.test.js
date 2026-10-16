import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine } from '../src/studio/form/engine.js';
import { LAYOUT, SKIPPED_SECTIONS, layoutFor, viewById, viewForPath } from '../src/studio/form/layout.js';

// "All settings" is grouped by task. The guarantee that comes with regrouping: no property of the schema is lost; every one is on exactly one
// screen. This walks the schema the way the form does and fails when a section, or a part of a split section, belongs to no screen.
const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
const engine = createEngine(schema);
const sectionKeys = Object.keys(schema.properties).filter((key) => !SKIPPED_SECTIONS.has(key));
const subkeys = (key) => Object.keys(engine.flatten(schema.properties[key]).properties || {});
const groups = layoutFor(sectionKeys, subkeys);
const views = groups.flatMap((g) => g.views);

test('the groups are the customer’s tasks, in the order of the work, with the engine’s settings last and marked advanced', () => {
  assert.deepEqual(
    groups.map((g) => g.label),
    [
      'About this agent',
      'How it talks',
      'What it can do',
      'How it behaves',
      'Where it is available',
      'After the call',
      'Quality and records',
      'Engine and operator settings',
    ],
  );
  assert.equal(groups.at(-1).advanced, true);
  assert.equal(
    groups.slice(0, -1).some((g) => g.advanced),
    false,
  );
  assert.equal(groups[0].views[0].key, 'meta', 'the first screen is the agent’s name and details, not a server-owned field');
});

test('every property of every section is on a screen: nothing is lost by regrouping', () => {
  const lost = [];
  sectionKeys.forEach((key) => {
    const mine = views.filter((v) => v.key === key);
    if (!mine.length) {
      lost.push(`${key} (the whole section)`);
      return;
    }
    if (mine.some((v) => !v.only)) return; // a whole-section screen shows every property
    const shown = new Set(mine.flatMap((v) => v.only));
    subkeys(key)
      .filter((name) => !shown.has(name))
      .forEach((name) => lost.push(`${key}.${name}`));
  });
  assert.deepEqual(lost, []);
});

test('a property is on one screen only (so a setting has one home, and the three levels agree)', () => {
  const owner = new Map();
  views.forEach((v) => {
    const names = v.only || subkeys(v.key);
    names.forEach((name) => {
      const id = `${v.key}.${name}`;
      assert.ok(!owner.has(id), `${id} is on both ${owner.get(id)} and ${v.id}`);
      owner.set(id, v.id);
    });
  });
});

test('screen ids are unique, and each has a plain label', () => {
  const ids = views.map((v) => v.id);
  assert.equal(new Set(ids).size, ids.length);
  views.forEach((v) => assert.ok(v.label && !/_/.test(v.label), `${v.id} has a label`));
});

test('what the schema adds later is shown, not hidden: a new part of a split section and a new top-level section land in the engine group', () => {
  const grown = layoutFor([...sectionKeys, 'fancy_new_section'], (key) => (key === 'defaults' ? [...subkeys('defaults'), 'brand_new_part'] : subkeys(key)));
  const engineViews = grown.find((g) => g.id === 'engine').views;
  assert.ok(
    engineViews.some((v) => v.key === 'defaults' && v.only?.includes('brand_new_part')),
    'the unclaimed part of defaults has a screen',
  );
  assert.ok(
    engineViews.some((v) => v.key === 'fancy_new_section' && v.label === 'Fancy new section'),
    'the unknown section has a screen with a readable name',
  );
  // and a schema that lacks a section just has no screen for it
  const smaller = layoutFor(
    sectionKeys.filter((k) => k !== 'builder'),
    subkeys,
  );
  assert.ok(!smaller.flatMap((g) => g.views).some((v) => v.key === 'builder'));
});

test('a path is found on its screen, including a section that is split over several', () => {
  assert.equal(viewForPath(groups, ['tools', 3, 'timeout_s']).id, 'tools');
  assert.equal(viewForPath(groups, ['defaults', 'conversation', 'inactivity']).id, 'defaults.conversation');
  assert.equal(viewForPath(groups, ['defaults', 'reliability', 'connection']).id, 'defaults.reliability');
  assert.equal(viewForPath(groups, ['defaults', 'models', 'llm']).id, 'defaults.models');
  assert.equal(viewForPath(groups, ['defaults']).id, 'defaults.language', 'the whole section: its first screen');
  assert.equal(viewForPath(groups, ['nothing']), null);
  assert.equal(viewById(groups, 'defaults.models').label, 'AI models');
});

test('operator-only settings are in the advanced group and nowhere else', () => {
  const engineKeys = groups.find((g) => g.advanced).views.map((v) => v.id);
  ['runtime', 'builder', 'defaults.reliability', 'constants'].forEach((id) => assert.ok(engineKeys.includes(id), `${id} is with the engine settings`));
  LAYOUT.filter((g) => !g.advanced).forEach((g) => g.views.forEach((v) => assert.ok(!['runtime', 'builder'].includes(v.key), `${v.key} is not in ${g.label}`)));
});
