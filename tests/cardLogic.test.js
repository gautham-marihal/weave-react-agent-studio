import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine } from '../src/studio/form/engine.js';
import { arrayStyle, isComplex, summarize } from '../src/studio/form/cardLogic.js';

const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
const engine = createEngine(schema);

test('lists are drawn by what they hold: ids to pick, a few fixed values, free texts, or objects', () => {
  assert.equal(arrayStyle(engine, engine.flatten(schema.properties.tools)), 'cards');
  assert.equal(arrayStyle(engine, engine.flatten(schema.properties.channels)), 'cards');
  assert.equal(arrayStyle(engine, engine.flatten(schema.properties.persona.properties.style_rules)), 'strings');
  const channel = engine.flatten(schema.$defs.channel);
  assert.equal(arrayStyle(engine, engine.flatten(channel.properties.modalities.properties.input)), 'checks');
  const agent = engine.flatten(schema.$defs.agent);
  assert.equal(arrayStyle(engine, engine.flatten(agent.properties.tools)), 'pick');
});

test('what needs a card of its own: objects, maps, lists of objects and choices of objects', () => {
  assert.equal(isComplex(engine, schema.properties.persona), true);
  assert.equal(isComplex(engine, schema.properties.state.properties.variables), true);
  assert.equal(isComplex(engine, schema.properties.tools), true);
  assert.equal(isComplex(engine, schema.properties.persona.properties.tone), false);
  assert.equal(isComplex(engine, schema.properties.persona.properties.style_rules), false);
  assert.equal(isComplex(engine, schema.$defs.speech), true); // a text or a { message } reference: a choice that includes an object
  assert.equal(isComplex(engine, schema.$defs.action), true);
});

test('a union of kinds is told apart by what the value is', () => {
  const tool = schema.$defs.tool;
  const branches = engine.branchesOf(engine.flatten(tool));
  assert.ok(branches.length >= 6);
  const labels = branches.map((branch, index) => engine.branchLabel(branch, index));
  assert.equal(new Set(labels).size, labels.length, 'every kind has its own label');
  const http = engine.pickBranch(branches, { id: 'x', type: 'http', connection: 'c', request: { method: 'GET', path: '/' } });
  assert.match(labels[http], /http/i);
  const builtin = engine.pickBranch(branches, { id: 'e', type: 'builtin', builtin: 'end_call' });
  assert.match(labels[builtin], /built/i);
  assert.notEqual(http, builtin);
});

test('a card is titled by what the item calls itself, with a short hint', () => {
  assert.deepEqual(summarize({ id: 'lookup', description: 'Gets the bill' }, 0), { title: 'lookup', hint: 'Gets the bill' });
  assert.deepEqual(summarize({ type: 'say', text: 'Hello' }, 1), { title: 'say', hint: 'Hello' });
  assert.deepEqual(summarize({ id: 'a', type: 'http' }, 2), { title: 'a', hint: 'Looks something up' });
  assert.deepEqual(summarize({ x: 1 }, 3), { title: 'Item 4', hint: '' });
  assert.deepEqual(summarize(null, 0), { title: '#1', hint: 'none' });
  assert.deepEqual(summarize('plain', 1), { title: '#2', hint: '"plain"' });
  const long = 'x'.repeat(100);
  assert.equal(summarize({ id: 'a', description: long }, 0).hint, `${'x'.repeat(70)}…`);
  assert.equal(summarize({ text: { message: 'goodbye' }, id: 'm' }, 0).title, 'm');
});

import { carryOver, matchesDiscriminator } from '../src/studio/form/cardLogic.js';

test('a value that carries its kind marker is that kind even when required fields are missing', () => {
  const branches = engine.branchesOf(engine.flatten(schema.$defs.tool));
  const http = branches.find((b) => engine.branchLabel(b, 0) === 'HTTP');
  const builtin = branches.find((b) => engine.branchLabel(b, 0) === 'Built-in');
  const incomplete = { id: 't', type: 'http', connection: 'c', request: { method: 'GET', path: '/' } }; // no `parameters`
  assert.equal(engine.fits(http, incomplete), false);
  assert.equal(matchesDiscriminator(engine, http, incomplete), true);
  assert.equal(matchesDiscriminator(engine, builtin, incomplete), false);
  assert.equal(matchesDiscriminator(engine, http, { id: 't' }), false);
  assert.equal(matchesDiscriminator(engine, http, null), false);
});

test('switching kind keeps what the kinds share, in the new kind’s order, and drops what is only the old kind’s', () => {
  const branches = engine.branchesOf(engine.flatten(schema.$defs.tool));
  const builtin = branches.find((b) => engine.branchLabel(b, 0) === 'Built-in');
  const old = {
    id: 'lookup',
    type: 'http',
    name: 'look_up',
    description: 'Finds it',
    connection: 'c',
    request: { method: 'GET', path: '/' },
    parameters: { type: 'object', properties: {} },
    channels: ['web'],
  };
  const next = carryOver(engine, old, builtin, engine.defaultFor(builtin));
  assert.equal(next.id, 'lookup');
  assert.equal(next.description, 'Finds it');
  assert.equal(next.name, 'look_up');
  assert.deepEqual(next.channels, ['web']);
  assert.equal(next.type, 'builtin');
  assert.ok(!('connection' in next) && !('request' in next), 'http-only fields are dropped');
  assert.deepEqual(Object.keys(next).slice(0, 2), ['id', 'type'], 'the new kind’s own order');
});

test('a field that names something in another collection is not carried across kinds', () => {
  const branches = engine.branchesOf(engine.flatten(schema.$defs.tool));
  const mcp = branches.find((b) => engine.branchLabel(b, 0) === 'MCP server');
  const next = carryOver(engine, { id: 'x', type: 'http', connection: 'billing_api' }, mcp, engine.defaultFor(mcp));
  assert.equal(next.id, 'x');
  assert.notEqual(next.connection, 'billing_api');
  assert.equal(carryOver(engine, 'plain', mcp, 'fresh'), 'fresh');
});

import { isActionList, isRuleList } from '../src/studio/form/cardLogic.js';

test('lists of actions and of rules are told apart from lists of anything else', () => {
  const flat = (s) => engine.flatten(s);
  assert.equal(isRuleList(engine, flat(schema.$defs.toolCommon).properties.effects), true);
  assert.equal(isActionList(engine, flat(schema.$defs.toolCommon).properties.effects), false);
  assert.equal(isActionList(engine, flat(schema.$defs.ruleBlock).properties.do), true);
  assert.equal(isActionList(engine, flat(schema.$defs.conversation).properties.inactivity.properties.nudges), true, 'a list of spoken actions');
  assert.equal(isActionList(engine, flat(schema.$defs.transfer).properties.on_failure), true);
  assert.equal(isActionList(engine, schema.properties.tools), false);
  assert.equal(isActionList(engine, schema.properties.persona.properties.style_rules), false);
  assert.equal(isRuleList(engine, schema.properties.tools), false);
  assert.equal(isRuleList(engine, schema.properties.events), false, 'an event also has `on`, so it keeps its card');
  assert.equal(isActionList(engine, flat(flat(schema.properties.events).items).properties.do), true, 'but its steps are steps');
  assert.equal(isActionList(engine, schema.properties.persona), false);
});
