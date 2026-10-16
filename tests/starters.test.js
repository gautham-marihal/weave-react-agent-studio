import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyStarter, STARTERS, INACTIVITY, usesVoice } from '../src/studio/starters.js';
import { runScenarioChecks } from '../src/studio/scenarios.js';
import { ownerOfIn } from '../src/studio/agents.js';
import { applyChange } from '../src/studio/pendingChange.js';

const blank = JSON.parse(
  JSON.stringify({
    schema_version: '1.1',
    meta: { id: 'gm', name: 'GM', version: '0.1.0', status: 'draft' },
    persona: { name: 'GM' },
    channels: [{ id: 'web-chat', type: 'web_chat', enabled: true, greeting: { say: 'Hello! How can I help you today?' } }],
    agents: {
      entry: 'assistant',
      items: [{ id: 'assistant', name: 'GM', kind: 'standalone', instructions: { role: 'You are a helpful assistant.' }, tools: [] }],
    },
  }),
);

test('every starter makes a different agent', () => {
  const made = STARTERS.filter((s) => s.id !== 'blank').map((s) => applyStarter(blank, s.id));
  const unique = (pick) => new Set(made.map(pick)).size;
  assert.equal(
    unique((c) => c.agents.items[0].instructions.role),
    made.length,
  );
  assert.equal(
    unique((c) => c.channels[0].greeting.say),
    made.length,
  );
  assert.equal(
    unique((c) => c.messages[0].text),
    made.length,
  );
  assert.equal(
    unique((c) => c.persona.tone),
    made.length,
  );
});

test('a starter keeps the agent’s own identity and does not change the input', () => {
  const before = JSON.stringify(blank);
  const out = applyStarter(blank, 'lead');
  assert.equal(JSON.stringify(blank), before);
  assert.equal(out.meta.id, 'gm');
  assert.equal(out.meta.name, 'GM');
  assert.equal(out.meta.version, '0.1.0');
  assert.equal(out.persona.name, 'GM');
  assert.match(out.channels[0].greeting.say, /GM/);
});

test('a starter wires the goodbye message to end_call, and applying twice does not duplicate', () => {
  const once = applyStarter(blank, 'support');
  const twice = applyStarter(once, 'support');
  assert.equal(twice.tools.filter((t) => t.id === 'end_call').length, 1);
  assert.equal(twice.messages.filter((m) => m.id === 'goodbye').length, 1);
  assert.deepEqual(twice.agents.items[0].tools, ['end_call', 'escalate_to_human']);
  assert.equal(twice.tools.find((t) => t.id === 'end_call').params.say.message, 'goodbye');
  assert.equal(twice.tools.filter((t) => t.id === 'escalate_to_human').length, 1);
  assert.equal(twice.telephony.transfers.filter((t) => t.id === 'human_support').length, 1);
  assert.equal(new Set(twice.messages.map((m) => m.id)).size, twice.messages.length);
});

test('blank leaves the configuration as it is', () => {
  assert.equal(applyStarter(blank, 'blank'), blank);
});

test('a starter that could not be saved is re-applied as a pending change', () => {
  const result = applyChange(blank, { kind: 'starter', starter: 'feedback' });
  assert.match(result.note, /Feedback collector/);
  assert.match(result.config.agents.items[0].instructions.role, /feedback/i);
});

test('agent ownership: assigned, else the first workspace; a deleted workspace falls back', () => {
  const spaces = [{ id: 'a' }, { id: 'b' }];
  assert.equal(ownerOfIn({}, spaces, 'x'), 'a');
  assert.equal(ownerOfIn({ x: 'b' }, spaces, 'x'), 'b');
  assert.equal(ownerOfIn({ x: 'gone' }, spaces, 'x'), 'a');
  assert.equal(ownerOfIn({ x: 'b' }, [], 'x'), null);
});

test('the example config in the fixtures is untouched by starters (they only fill fields)', () => {
  const example = JSON.parse(readFileSync(new URL('./fixtures/agent-config.example.json', import.meta.url), 'utf8'));
  const out = applyStarter(example, 'support');
  assert.equal(out.meta.id, example.meta.id);
  assert.ok(out.agents.items.length >= 1);
});

test('every starter nudges a silent caller and then ends the call, with the lines it names', () => {
  for (const starter of STARTERS.filter((s) => s.id !== 'blank')) {
    const out = applyStarter(blank, starter.id);
    assert.deepEqual(out.defaults.conversation.inactivity, INACTIVITY, starter.id);
    const ids = new Set(out.messages.map((m) => m.id));
    const named = [...JSON.stringify(out.defaults.conversation.inactivity).matchAll(/"message":"([^"]+)"/g)].map((m) => m[1]);
    named.forEach((id) => assert.ok(ids.has(id), `${starter.id}: ${id} exists`));
    assert.equal(runScenarioChecks(out).find((c) => c.id === 'silent').passed, true, starter.id);
  }
  assert.ok(INACTIVITY.timeout_s >= 8 && INACTIVITY.timeout_s <= 10);
  assert.equal(INACTIVITY.nudges.length, 2);
});

test('a starter keeps inactivity handling the author already set', () => {
  const custom = { enabled: true, timeout_s: 30, max_nudges: 1, nudges: [{ type: 'say', text: 'Hello?' }] };
  const withOwn = { ...blank, defaults: { conversation: { inactivity: custom, max_tool_steps: 4 } } };
  const out = applyStarter(withOwn, 'support');
  assert.deepEqual(out.defaults.conversation.inactivity, custom);
  assert.equal(out.defaults.conversation.max_tool_steps, 4);
});

test('starters that may need a person give the agent a tool for it (the "person" check passes)', () => {
  for (const id of ['support', 'receptionist', 'knowledge', 'appointment']) {
    const out = applyStarter(blank, id);
    const tool = out.tools.find((t) => t.builtin === 'transfer_or_callback');
    assert.ok(tool, id);
    assert.ok(out.agents.items[0].tools.includes(tool.id), id);
    assert.ok(
      out.telephony.transfers.some((t) => t.id === tool.params.transfer),
      `${id}: the transfer it points at exists`,
    );
    assert.ok(
      out.messages.some((m) => m.id === tool.params.fallback[0].text.message),
      `${id}: the fallback line exists`,
    );
    assert.equal(runScenarioChecks(out).find((c) => c.id === 'person').passed, true, id);
  }
  for (const id of ['lead', 'feedback'])
    assert.equal(
      applyStarter(blank, id).tools.some((t) => t.builtin === 'transfer_or_callback'),
      false,
      id,
    );
});

test('a recording notice is added only when voice is in use, and an existing one is kept', () => {
  assert.equal(usesVoice(blank), false);
  assert.equal(applyStarter(blank, 'support').persona.disclosures, undefined);
  const voice = { ...blank, channels: [{ id: 'phone', type: 'sip_voice', enabled: true, greeting: { say: 'Hi' } }] };
  assert.equal(usesVoice(voice), true);
  assert.match(applyStarter(voice, 'support').persona.disclosures.recording_notice, /recorded/);
  const mine = { ...voice, persona: { name: 'GM', disclosures: { recording_notice: 'Calls are recorded.' } } };
  assert.equal(applyStarter(mine, 'support').persona.disclosures.recording_notice, 'Calls are recorded.');
  const off = { ...blank, channels: [{ id: 'phone', type: 'sip_voice', enabled: false }] };
  assert.equal(usesVoice(off), false);
  const byModality = { ...blank, channels: [{ id: 'c', type: 'whatsapp', modalities: { input: ['audio'], output: ['text'] } }] };
  assert.equal(usesVoice(byModality), true);
});
