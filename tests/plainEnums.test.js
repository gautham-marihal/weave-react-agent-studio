import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ENUM_LABELS, KEEP_AS_WRITTEN, enumLabel, enumLabels } from '../src/studio/form/plainEnums.js';

// The choices of every setting are drawn in words. This walks the schema: a choice with no label (and not on the keep-as-written list) fails, so a
// setting added to the schema later arrives with a label or is named here on purpose.
const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));

function enumsOf(schema) {
  const found = [];
  const walk = (node, name) => {
    if (Array.isArray(node)) { node.forEach((item) => walk(item, name)); return; }
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node.enum) && node.enum.every((v) => typeof v === 'string')) found.push({ name, values: node.enum });
    Object.entries(node).forEach(([key, value]) => {
      if (key === 'properties' && value && typeof value === 'object') Object.entries(value).forEach(([prop, shape]) => walk(shape, prop));
      else walk(value, name);
    });
  };
  walk(schema, '');
  return found;
}

test('every choice of every setting in the schema has a plain label, or is kept as written on purpose', () => {
  const missing = [];
  enumsOf(schema).forEach(({ name, values }) => values.forEach((value) => {
    if (KEEP_AS_WRITTEN.has(value)) return;
    if (enumLabel(name, value) === value && !ENUM_LABELS[name]?.[value]) missing.push(`${name || '(a list)'}: ${value}`);
  }));
  assert.deepEqual([...new Set(missing)], [], `choices still in the machine’s words:\n  ${[...new Set(missing)].join('\n  ')}`);
});

test('a label never contains an underscore or leaves the value unrecognisable, and none is empty', () => {
  Object.entries(ENUM_LABELS).forEach(([name, byValue]) => Object.entries(byValue).forEach(([value, label]) => {
    assert.ok(label.trim().length > 0, `${name}.${value} has a label`);
    assert.ok(!/_/.test(label), `${name}.${value}: “${label}” has an underscore`);
  }));
});

test('enumLabels gives labels only where they differ, adds the value for technical names, and keeps a suffix', () => {
  assert.deepEqual(enumLabels('kind', ['standalone']), { standalone: 'Standalone: handles calls on its own' });
  assert.deepEqual(enumLabels('method', ['GET', 'sip_refer']), { sip_refer: 'Transfer by SIP' });
  assert.equal(enumLabels('kind', ['router'], { technical: true }).router, 'Router: passes callers on (router)');
  assert.equal(enumLabels('builtin', ['noop'], { suffix: { noop: '(not available yet)' } }).noop, 'Do nothing itself (not available yet)');
  assert.equal(enumLabels('builtin', ['mystery'], { suffix: { mystery: '(not available yet)' } }).mystery, 'mystery (not available yet)');
  assert.equal(enumLabel('unlisted_name', 'hold_music'), 'Hold music', 'a choice that means one thing everywhere is found without its name');
  assert.equal(enumLabel('unlisted_name', 'something_new'), 'something_new');
});
