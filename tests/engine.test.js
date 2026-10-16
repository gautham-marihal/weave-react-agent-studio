import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectRefOptions, collectSecretNames, createEngine, isObj } from '../src/studio/form/engine.js';

const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const schema = read('agent-config.schema.json');
const example = read('agent-config.example.json');
const engine = createEngine(schema);

// Walks a value the way the form renderer does and reports anything the form could not place.
function walk(sch, value, path, found) {
  found.nodes += 1;
  const shape = engine.resolveShape(sch, value);
  const kind = engine.kindOf(shape);
  found.kinds[kind] = (found.kinds[kind] || 0) + 1;
  if (kind === 'union') {
    const branches = engine.branchesOf(shape);
    const i = engine.pickBranch(branches, value);
    if (!engine.fits(branches[i], value)) {
      found.problems.push(`${path}: no branch fits`);
      return;
    }
    walk(branches[i], value, path, found);
  } else if (kind === 'object') {
    if (!isObj(value)) {
      found.problems.push(`${path}: expected an object`);
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      if (!(key in shape.properties)) found.problems.push(`${path}: unknown key "${key}"`);
      else walk(shape.properties[key], item, `${path}.${key}`, found);
    }
  } else if (kind === 'array') {
    value.forEach((item, i) => walk(shape.items, item, `${path}[${i}]`, found));
  } else if (kind === 'map' && isObj(shape.additionalProperties)) {
    for (const [key, item] of Object.entries(value)) walk(shape.additionalProperties, item, `${path}{${key}}`, found);
  }
}

test('every value of the full example config has a home in the form', () => {
  const found = { nodes: 0, kinds: {}, problems: [] };
  walk(schema, example, '$', found);
  assert.deepEqual(found.problems, []);
  assert.ok(found.nodes > 1000);
  for (const kind of ['object', 'string', 'enum', 'array', 'number', 'boolean', 'map', 'union', 'ref', 'secret', 'json'])
    assert.ok(found.kinds[kind] > 0, `no ${kind} nodes seen`);
});

const toolBranches = engine.branchesOf(engine.resolveShape(schema.properties.tools.items, undefined));
const tool = (id) => example.tools.find((t) => t.id === id);
const toolKind = (value) => engine.branchLabel(toolBranches[engine.pickBranch(toolBranches, value)]);

test('a tool is recognised by what it is', () => {
  assert.deepEqual(
    toolBranches.map((b, i) => engine.branchLabel(b, i)),
    ['Built-in', 'Task', 'HTTP', 'MCP server', 'Knowledge search', 'Custom code (escape hatch)'],
  );
  assert.equal(toolKind(tool('end_call')), 'Built-in');
  assert.equal(toolKind(tool('verify_caller')), 'Task');
  assert.equal(toolKind(tool('get_bill_summary')), 'HTTP');
  assert.equal(toolKind(tool('crm_tools')), 'MCP server');
  assert.equal(toolKind(tool('search_help_center')), 'Knowledge search');
});

test('if/then decides which parameters a built-in tool has', () => {
  const builtin = toolBranches[0];
  const params = (t) => engine.resolveShape(engine.resolveShape(builtin, t).properties.params, t.params ?? {});
  assert.deepEqual(Object.keys(params(tool('escalate_to_human')).properties).sort(), ['fallback', 'transfer']);
  assert.deepEqual(params(tool('escalate_to_human')).required, ['transfer']);
  assert.deepEqual(Object.keys(params(tool('end_call')).properties), ['say']);
  assert.deepEqual(Object.keys(params(tool('report_hazard_chat')).properties), []);
});

test('conditions, speech and recipients resolve to the right branch', () => {
  const pick = (ref, value) => {
    const branches = engine.branchesOf(engine.resolveShape({ $ref: ref }, undefined));
    return engine.branchLabel(branches[engine.pickBranch(branches, value)]);
  };
  assert.equal(pick('#/$defs/condition', { state: 'verified', equals: false }), 'State variable');
  assert.equal(pick('#/$defs/condition', { arg: 'a', equals: 1 }), 'Tool argument');
  assert.equal(pick('#/$defs/condition', { channel: 'web-chat' }), 'Channel');
  assert.equal(pick('#/$defs/condition', { channel: ['a', 'b'] }), 'Channel');
  assert.equal(pick('#/$defs/condition', { schedule: 'h', open: true }), 'Business hours');
  assert.equal(pick('#/$defs/condition', { all: [{ state: 'x', equals: 1 }] }), 'All of');
  assert.equal(pick('#/$defs/condition', { not: { state: 'x', equals: 1 } }), 'Not');
  assert.equal(pick('#/$defs/condition', { event: 'to', equals: 'billing' }), 'Event detail');
  assert.equal(pick('#/$defs/speech', 'hello'), 'Text');
  assert.equal(pick('#/$defs/speech', { message: 'goodbye' }), 'Message');
  assert.equal(pick('#/$defs/recipients', ['a@b.c']), 'List');
  assert.equal(pick('#/$defs/recipients', { secret: 'X' }), 'Secret reference');
  assert.equal(pick('#/$defs/recipients', { lookup: { state: 's', map: {} } }), 'Lookup by state');
});

test('controls are chosen by kind', () => {
  const kind = (sch, v) => engine.kindOf(engine.resolveShape(sch, v));
  assert.equal(kind({ type: 'string', 'x-ref': 'agents' }), 'ref');
  assert.equal(kind({ $ref: '#/$defs/secretRef' }), 'secret');
  assert.equal(kind({ type: ['integer', 'null'], minimum: 1 }), 'number');
  assert.equal(kind(schema.properties.constants), 'map');
  assert.equal(kind(schema.properties.connections), 'map');
  assert.equal(kind(engine.flatten(schema.$defs.task).properties.inactivity), 'object'); // a $ref into a property
});

test('defaults build for every definition and each union branch is found again from its default', () => {
  for (const name of Object.keys(schema.$defs)) {
    const shape = engine.resolveShape({ $ref: `#/$defs/${name}` }, undefined);
    if (engine.kindOf(shape) !== 'union') {
      engine.defaultFor(shape);
      continue;
    }
    const branches = engine.branchesOf(shape);
    branches.forEach((branch, i) => {
      const made = engine.defaultFor(branch);
      const back = engine.pickBranch(branches, made);
      assert.ok(back === i || engine.fits(branches[back], made), `${name}: default of "${engine.branchLabel(branch, i)}" lands on another branch`);
    });
  }
});

test('reference options and secrets come from the config being edited', () => {
  const refs = collectRefOptions(example);
  assert.deepEqual(refs.agents, ['greeter', 'billing', 'tech_support', 'safety_watch']);
  assert.deepEqual(refs.http_connections.sort(), ['billing_api', 'platform_db', 'rag_service']);
  assert.deepEqual(refs.notifiers.sort(), ['email', 'sms']);
  assert.deepEqual(refs.transfers, ['human_support']);
  assert.equal(refs.state_vars.length, 15);
  assert.ok(refs.tool_names.includes('go_to_billing') && refs.tool_names.includes('end_call'));
  assert.equal(collectSecretNames(example).length, 12);
  assert.deepEqual(collectRefOptions(undefined).agents, []);
});
