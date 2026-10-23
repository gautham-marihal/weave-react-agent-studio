import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONTEXT, SETTINGS, describeSetting, labelOf, levelOf, parentOf, ruleLabel } from '../src/studio/form/plainLanguage.js';

// The plain-language layer must cover EVERY setting the schema has, so a new field or a new schema can't quietly bring back a label like
// "Timeout s" or "Top k". The schema is walked here the way the inventory in the review was: every property of every object it describes.
const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
const deref = (node) => {
  let n = node;
  for (let i = 0; i < 20 && n && n.$ref; i += 1)
    n = n.$ref
      .split('/')
      .slice(1)
      .reduce((x, k) => x?.[k], schema);
  return n;
};

// Every property of every object the schema describes, with the property it lives under (its owner): the same notion the form uses when it
// draws a setting (the property it is inside, not the keys an author chose). A definition used in several places is walked under each.
function inventory() {
  const found = new Map(); // name -> { descriptions: [], parents: Set }
  const add = (name, description, parent) => {
    if (!found.has(name)) found.set(name, { descriptions: [], parents: new Set() });
    const entry = found.get(name);
    if (description) entry.descriptions.push(description);
    entry.parents.add(parent);
  };
  const walk = (node, parent, stack) => {
    if (!node || typeof node !== 'object') return;
    let here = stack;
    if (node.$ref) {
      if (stack.includes(node.$ref)) return;
      here = [...stack, node.$ref];
    }
    const n = deref(node);
    if (!n || typeof n !== 'object') return;
    Object.entries(n.properties || {}).forEach(([prop, sub]) => {
      add(prop, deref(sub)?.description || sub.description || '', parent);
      walk(sub, prop, here);
    });
    ['oneOf', 'anyOf', 'allOf'].forEach((k) => (n[k] || []).forEach((b) => walk(b, parent, here)));
    if (n.items) walk(n.items, parent, here);
    if (n.additionalProperties && typeof n.additionalProperties === 'object') walk(n.additionalProperties, parent, here);
    ['then', 'else', 'if'].forEach((k) => walk(n[k], parent, here));
  };
  Object.entries(schema.properties).forEach(([name, sub]) => {
    add(name, deref(sub)?.description || sub.description || '', '');
    walk(sub, name, []);
  });
  return found;
}

const names = inventory();

test('the schema has hundreds of settings, so the catalogue is checked against all of them', () => {
  assert.ok(names.size > 400, `the schema has ${names.size} distinct property names`);
});

test('every setting has a plain label: no underscores, no unit letters, no unexplained abbreviations', () => {
  const abbreviation = /(^|[\s(])(stt|tts|llm|vad|dnis|uri|sip|dtmf|pii|otel|mime|ivr|jsonpath|s|ms)([\s).,]|$)/i;
  const bad = [];
  for (const [name, info] of names) {
    const label = labelOf(name, { description: info.descriptions[0] });
    if (!label || /_/.test(label) || abbreviation.test(label) || label === name) bad.push(`${name} -> “${label}”`);
    if (/^[a-z]/.test(label)) bad.push(`${name} -> “${label}” (starts with a small letter)`);
  }
  assert.deepEqual(bad, [], `labels that are still the machine's words:\n  ${bad.slice(0, 20).join('\n  ')}`);
});

test('every setting people are meant to meet (guided or detailed) says what it is for', () => {
  const silent = [];
  for (const [name, info] of names) {
    const d = describeSetting(name, { description: info.descriptions[0] });
    if (d.level !== 'expert' && !d.purpose) silent.push(name);
  }
  assert.deepEqual(silent, [], `settings with a label but no purpose: ${silent.join(', ')}`);
});

test('every curated setting is a real one, levels are from the three allowed, and nothing is a copy of the machine name', () => {
  const stale = Object.keys(SETTINGS).filter((name) => !names.has(name));
  assert.deepEqual(stale, [], 'an entry for a property the schema no longer has');
  const levels = new Set(['guided', 'detailed', 'expert']);
  [...Object.entries(SETTINGS), ...Object.entries(CONTEXT)].forEach(([name, entry]) => {
    assert.ok(levels.has(entry.level), `${name} has a level`);
    assert.ok(entry.label && entry.purpose, `${name} has a label and a purpose`);
    assert.ok(entry.purpose.length <= 190, `${name}: the purpose is one sentence or so (${entry.purpose.length} characters)`);
  });
  // each place-specific entry names a place the schema really has: the setting, directly inside that property
  const nowhere = Object.keys(CONTEXT).filter((key) => {
    const [parent, name] = key.split('.');
    return !names.get(name)?.parents.has(parent);
  });
  assert.deepEqual(nowhere, [], 'entries for a place the schema does not have (they would never be used)');
});

test('the words the review named come out in plain language', () => {
  assert.equal(labelOf('timeout_s'), 'Give up after (seconds)');
  assert.equal(labelOf('top_k'), 'How many results');
  assert.equal(labelOf('stt'), 'Listening (speech-to-text)');
  assert.equal(labelOf('tts'), 'Speaking (text-to-speech)');
  assert.equal(labelOf('llm'), 'Thinking (language model)');
  assert.equal(labelOf('vad'), 'Voice detection');
  assert.equal(labelOf('dnis'), 'Phone number it answers');
  assert.equal(labelOf('uri_template'), 'How the address is built');
  assert.equal(labelOf('voice_id'), 'Voice');
  assert.equal(labelOf('api_key'), 'Access key');
  assert.equal(labelOf('http_port'), 'Health-check port');
  assert.equal(labelOf('num_idle_processes'), 'Spare processes');
  assert.equal(labelOf('preconditions'), 'Only allow when…');
  assert.equal(labelOf('effects'), 'Then, in order…');
  assert.equal(labelOf('guardrails'), 'Safety rules');
  assert.match(describeSetting('timeout_s').purpose, /5 to 8 seconds/);
});

test('where one name means different things, the place decides', () => {
  assert.equal(labelOf('description', { path: ['tools', 0, 'description'] }), 'When to use it');
  assert.equal(labelOf('description', { path: ['agents', 'items', 0, 'handoffs', 1, 'description'] }), 'When to hand over');
  assert.equal(labelOf('description', { path: ['meta', 'description'] }), 'Description');
  assert.equal(labelOf('type', { path: ['channels', 0, 'type'] }), 'Kind of channel');
  assert.equal(labelOf('type', { path: ['tools', 2, 'type'] }), 'Kind of tool');
  assert.equal(labelOf('name', { path: ['persona', 'name'] }), 'Name it introduces itself by');
  assert.equal(labelOf('method', { path: ['tools', 0, 'request', 'method'] }), 'Request kind');
  assert.equal(labelOf('mode', { path: ['knowledge', 0, 'mode'] }), 'How it is searched');
  assert.equal(labelOf('timeout_s', { path: ['defaults', 'conversation', 'inactivity', 'timeout_s'] }), 'Wait before nudging (seconds)');
  assert.equal(labelOf('enabled', { path: ['defaults', 'conversation', 'turn_handling', 'interruption', 'enabled'] }), 'Allow interruptions');
  assert.equal(parentOf(['tools', 0, 'timeout_s']), 'tools');
  assert.equal(parentOf(['a', 'b', 3, 'c']), 'b');
  assert.equal(parentOf(['only']), '');
});

test('a setting nobody has written a label for still gets a readable one, with its unit, and the schema’s own first sentence', () => {
  assert.equal(ruleLabel('retry_interval_s'), 'Retry interval (seconds)');
  assert.equal(ruleLabel('max_widgets'), 'Most widgets');
  assert.equal(ruleLabel('min_widgets'), 'Least widgets');
  assert.equal(ruleLabel('num_widgets'), 'Number of widgets');
  assert.equal(ruleLabel('stt_language'), 'Listening language');
  assert.equal(ruleLabel('cache_mb'), 'Cache (MB)');
  assert.equal(ruleLabel(''), '');
  const unknown = describeSetting('brand_new_setting_s', { description: 'Waits this long. It is measured from the start. More text.' });
  assert.equal(unknown.label, 'Brand new setting (seconds)');
  assert.equal(unknown.purpose, 'Waits this long.');
  assert.equal(unknown.curated, false);
  assert.equal(levelOf('brand_new_setting_s'), 'detailed');
  assert.equal(levelOf('worker'), 'expert');
  assert.equal(levelOf('role'), 'guided');
});

// A name that means different things in different places must not wear the label of its commonest meaning. Each of these was found by looking at
// where the schema uses the name; the label is what a person reading THAT place needs.
const CLASHES = {
  'agents.items': 'The agents',
  'items.kind': 'Kind of agent',
  'items.name': 'Name',
  'tools.name': 'Name the model sees',
  'tools.runtime': 'Code language',
  'tools.type': 'Kind of tool',
  'fields.type': 'Kind of answer',
  'fields.options': 'Choices',
  'fields.name': 'Field name',
  'http_mocks.status': 'Answer status',
  'variables.type': 'Kind of value',
  'retrieval.role': 'How passages are shown',
  'vision.mode': 'How the camera is used',
  'request.method': 'Request kind',
  'greeting.say': 'What it says',
  'session_log.enabled': 'Keep a log of each call',
  'summary.enabled': 'Write a call summary',
  'channels.enabled': 'Switched on',
  'thinking.enabled': 'Play a sound while thinking',
  'redaction.enabled': 'Hide sensitive details',
  'guardrails.input': 'Checks on what the caller says',
  'guardrails.output': 'Checks on what the agent says',
  'agents.entry': 'Who answers first',
  'interruption.mode': 'How interruptions are noticed',
  'lookup.state': 'Decided by',
  'lookup.default': 'If nothing matches',
  'connections.kind': 'Kind of service',
  'attachments.kind': 'What is attached',
  'artifacts.kind': 'What is saved',
  'tools.source': 'Which knowledge',
  'turns.say': 'What the caller says',
  'log_file.path': 'File location',
  'reliability.connection': 'Connection to each service',
  'connections.from': 'Sent from',
};

test('where one name means different things, the label that is shown is the one for that place', () => {
  Object.entries(CLASHES).forEach(([key, label]) => {
    const [owner, name] = key.split('.');
    assert.ok(names.get(name)?.parents.has(owner), `${key} exists in the schema`);
    assert.equal(labelOf(name, { owner }), label, key);
  });
  // the owner wins over a path that holds keys an author chose
  assert.equal(labelOf('type', { owner: 'connections', path: ['connections', 'my_crm', 'type'] }), 'Kind of connection');
  assert.equal(labelOf('type', { path: ['connections', 'my_crm', 'type'] }), 'Kind', 'without the owner a chosen key can’t be told from a place');
});

test('every place a setting can be drawn has a plain label, a purpose when it is meant to be met, and a level', () => {
  const levels = new Set(['guided', 'detailed', 'expert']);
  const problems = [];
  for (const [name, info] of names) {
    info.parents.forEach((owner) => {
      const d = describeSetting(name, { owner, description: info.descriptions[0] });
      if (!d.label || /_/.test(d.label)) problems.push(`${owner}.${name} -> “${d.label}”`);
      if (!levels.has(d.level)) problems.push(`${owner}.${name} has no level`);
      if (d.level !== 'expert' && !d.purpose) problems.push(`${owner}.${name} has no purpose`);
    });
  }
  assert.deepEqual(problems, []);
});

test('every setting name the schema has is written up by hand: nothing a customer meets is a label made by rule', () => {
  const unwritten = [...names.keys()].filter((name) => !SETTINGS[name]);
  assert.deepEqual(unwritten, [], 'names with no entry in the catalogue (they would be labelled by rule): add an entry in plainLanguage.js');
});
