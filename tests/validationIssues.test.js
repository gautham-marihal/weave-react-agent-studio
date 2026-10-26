import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine } from '../src/studio/form/engine.js';
import { describeIssue, describeIssues, labelPath } from '../src/studio/validation/issues.js';

// The server's own sentences, harvested from POST /validate on deliberately broken copies of the example agent (the messages are what the
// server really says), described for a customer: the setting by its label, what is wrong in plain words, and a fix where one is certain.
const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
const engine = createEngine(schema);
const example = { ...JSON.parse(readFileSync(new URL('./fixtures/agent-config.example.json', import.meta.url), 'utf8')), schema_version: '1.2' };
const ctx = { config: example, schema, engine };
const err = (path, message) => ({ severity: 'error', path, message });
const warn = (path, message) => ({ severity: 'warning', path, message });
const describe = (issue, config = example) => describeIssue(issue, { config, schema, engine });
const fixOf = (d, label) => d.fixes.find((f) => f.label === label || f.id === label);

test('a setting is named by labels, from its screen down, with a list item named by its own id', () => {
  assert.equal(
    labelPath(example, schema, ['channels', 0, 'modalities', 'input'], engine).text,
    `Channels › ${example.channels[0].id} › What it can hear and say › What it accepts`,
  );
  assert.equal(
    labelPath(example, schema, ['defaults', 'conversation', 'inactivity', 'timeout_s'], engine).text,
    'Conversation flow › When the caller goes quiet › Wait before nudging (seconds)',
  );
  assert.equal(labelPath(example, schema, ['persona'], engine).text, 'Personality and rules');
  assert.equal(labelPath(example, schema, ['agents', 'entry'], engine).text, 'Agents › Who answers first');
  assert.equal(labelPath(example, schema, ['tools', 5, 'connection'], engine).parts[0], 'Tools');
  assert.equal(labelPath(example, schema, ['state', 'variables', 'pin', 'type'], engine).text, 'Things it remembers › Variables › pin › Kind of value');
  assert.equal(labelPath(example, schema, [], engine).text, '');
});

test('audio without a model is said as what is missing, with a way to choose one', () => {
  const input = describe(err(['channels', 0, 'modalities', 'input'], "channel 'phone' / agent 'greeter': audio input needs an stt (or realtime) model"));
  assert.match(input.text, /takes audio in.*model to listen with/);
  assert.deepEqual(
    input.fixes.map((f) => [f.label, f.open?.stage]),
    [['Choose a listening model', 'stt']],
  );
  const output = describe(
    err(['channels', 0, 'modalities', 'output'], "channel 'phone' / agent 'greeter': audio output needs a tts (or realtime audio) model"),
  );
  assert.deepEqual(
    output.fixes.map((f) => f.open?.stage),
    ['tts'],
  );
  assert.match(input.where.text, /^Channels › /);
});

test('a name that points at nothing offers the names that exist, nearest first, one click each', () => {
  const issue = err(['agents', 'entry'], "'greter' is not a declared agents id (declared: billing, greeter, safety_watch, tech_support)");
  const d = describe(issue);
  assert.match(d.text, /There is no agent called “greter”\. Choose one that exists\./);
  assert.deepEqual(
    d.fixes.map((f) => f.label),
    ['Use “greeter”', 'Use “billing”', 'Use “safety_watch”'],
  );
  assert.equal(fixOf(d, 'Use “greeter”').apply({ ...example, agents: { ...example.agents, entry: 'greter' } }).agents.entry, 'greeter');
  const conn = describe(err(['tools', 5, 'connection'], "'nope' is not a declared http connections id (declared: billing_api, platform_db, rag_service)"));
  assert.match(conn.text, /There is no connection called “nope”/);
  const none = describe(err(['agents', 'entry'], "'greeter' is not a declared agents id (declared: none declared)"));
  assert.match(none.text, /none has been made yet/);
  assert.deepEqual(none.fixes, []);
});

test('a missing required setting is named, and added with its starting value', () => {
  const persona = describe(err(['persona'], "'name' is a required property"));
  assert.equal(persona.text, '“Name it introduces itself by” has to be filled in here, and it is missing.');
  const fixed = persona.fixes[0].apply({ ...example, persona: { tone: 'warm' } });
  assert.equal(fixed.persona.name, '');
  assert.equal(fixed.persona.tone, 'warm', 'the rest is kept');
  const section = describe(err([], "'meta' is a required property"));
  assert.match(section.text, /The agent needs the “About this agent” section, and it is missing\./);
  assert.deepEqual(section.fixes, [], 'a whole missing section needs the person’s own id and name, so there is nothing to add in one click');
  assert.deepEqual(persona.fixes[0].jumpTo, ['persona', 'name'], 'after adding it the form goes to it, to be filled in');
  const entry = describe(err(['channels', 1], "'entry' is a required property"), {
    ...example,
    channels: [example.channels[0], { id: 'chat', type: 'web_chat', modalities: { input: ['text'], output: ['text'] } }],
    meta: { id: 'acme' },
  });
  assert.equal(
    entry.fixes[0].apply({ ...example, channels: [example.channels[0], { id: 'chat', type: 'web_chat' }], meta: { id: 'acme' } }).channels[1].entry.widget_id,
    'acme-widget',
  );
});

test('numbers, types and choices are said plainly, and a short list of choices becomes buttons', () => {
  assert.equal(describe(err(['tools', 5, 'timeout_s'], '-1 is less than or equal to the minimum of 0')).text, '-1 is too small: it has to be more than 0.');
  assert.match(describe(err(['defaults', 'models', 'llm', 'temperature'], "'hot' is not of type 'number'")).text, /“hot” isn’t a number/);
  const choice = describe(err(['channels', 0, 'type'], "'pigeon' is not one of ['sip_voice', 'web_voice', 'web_chat', 'whatsapp', 'sms', 'email', 'custom']"));
  assert.equal(choice.text, '“pigeon” isn’t one of the choices.');
  assert.deepEqual(choice.fixes, [], 'seven choices are too many for buttons: the person is taken to the field');
  const one = describe(err(['guardrails', 'input', 0, 'enforcement'], "'code' is not one of ['prompt']"));
  assert.equal(one.fixes[0].label, 'Use “prompt”');
  assert.equal(one.fixes[0].apply({ guardrails: { input: [{ id: 'g', enforcement: 'code' }] } }).guardrails.input[0].enforcement, 'prompt');
});

test('an id that breaks the rules is renamed everywhere, a secret name is put in capitals', () => {
  const config = {
    ...example,
    tools: example.tools.map((t, i) => (i === 0 ? { ...t, id: 'Bad ID' } : t)),
    agents: { ...example.agents, items: example.agents.items.map((a, i) => (i === 0 ? { ...a, tools: ['Bad ID', ...a.tools.slice(1)] } : a)) },
  };
  const d = describe(err(['tools', 0, 'id'], "'Bad ID' does not match '^[a-z][a-z0-9_-]{0,63}$'"), config);
  assert.match(d.text, /can’t be used as an id/);
  const renamed = d.fixes[0].apply(config);
  assert.equal(d.fixes[0].label, 'Rename it to “bad_id”');
  assert.equal(renamed.tools[0].id, 'bad_id');
  assert.equal(renamed.agents.items[0].tools[0], 'bad_id', 'what pointed at it follows');
  const secret = describe(err(['connections', 'api', 'auth', 'token', 'secret'], "'lower_case' does not match '^[A-Z][A-Z0-9_]*$'"));
  assert.equal(secret.fixes[0].label, 'Use “LOWER_CASE”');
  assert.equal(secret.fixes[0].apply({ connections: { api: { auth: { token: { secret: 'lower_case' } } } } }).connections.api.auth.token.secret, 'LOWER_CASE');
});

test('a setting the schema doesn’t have here is removed, and the file format is raised when something needs it', () => {
  const extra = describe(err(['knowledge', 0, 'retrieval'], "Additional properties are not allowed ('top_k' was unexpected)"));
  assert.equal(extra.text, '“top_k” isn’t a setting that can be used here.');
  assert.equal(extra.fixes[0].label, 'Remove “top_k”');
  assert.deepEqual(extra.fixes[0].apply({ knowledge: [{ retrieval: { top_k: 0, mode: 'tool' } }] }).knowledge[0].retrieval, { mode: 'tool' });
  const version = describe(err(['schema_version'], 'this config uses features that need schema_version 1.2 (sensitive state variables), but says 1.1'));
  assert.match(version.text, /newer file format \(schema version 1\.2\): sensitive state variables\. The draft says 1\.1\./);
  assert.equal(version.fixes[0].apply({ schema_version: '1.1', a: 1 }).schema_version, '1.2');
});

test('an unused tool can be given to an agent or deleted, an unknown remembered value can be added, and sensitive details can be hidden', () => {
  const unused = describe(warn(['tools', 14], "tool 'lookup_account' is not used by any agent, task or guardrail"));
  assert.match(unused.text, /isn’t offered to any agent/);
  const labels = unused.fixes.map((f) => f.label);
  assert.equal(labels[0], `Offer it to “${example.agents.entry}”`, 'the agent that answers first, then another');
  assert.equal(labels.at(-1), 'Delete the tool');
  const offered = unused.fixes[0].apply({
    ...example,
    agents: { ...example.agents, items: example.agents.items.map((a) => ({ ...a, tools: (a.tools || []).filter((t) => t !== 'lookup_account') })) },
  });
  assert.ok(offered.agents.items.find((a) => a.id === example.agents.entry).tools.includes('lookup_account'));
  const template = describe(err(['agents', 'items', 0, 'instructions', 'role'], "template 'Hello {{state.nope}}' reads undeclared state variable 'nope'"));
  assert.equal(template.fixes[0].apply({ state: { variables: {} } }).state.variables.nope.type, 'string');
  const redaction = describe(
    warn(
      ['post_call'],
      'the bot declares sensitive variables and saves transcripts, but post_call.redaction is not set; transcripts will contain what callers say',
    ),
  );
  assert.match(redaction.text, /handles sensitive details and saves transcripts/);
  assert.equal(redaction.fixes[0].apply({ schema_version: '1.1' }).post_call.redaction.enabled, true);
});

test('what isn’t recognised is shown as the server wrote it, with its place named', () => {
  const d = describe(err(['defaults', 'language', 'primary'], 'something the studio has never seen'));
  assert.equal(d.recognised, false);
  assert.equal(d.text, 'something the studio has never seen');
  assert.equal(d.where.text, 'Language › Main language');
  assert.deepEqual(d.fixes, []);
});

test('issues are ordered for reading: what can be fixed in a click, then what needs the person, then what is worth a look', () => {
  const shown = describeIssues(
    [
      err(['persona'], "'name' is a required property"),
      err(['tools', 5, 'timeout_s'], '-1 is less than or equal to the minimum of 0'),
      warn(['tools', 14], "tool 'x' is not used by any agent, task or guardrail"),
      warn(['observability'], 'something else'),
    ],
    ctx,
  );
  assert.deepEqual([shown.fixNow.length, shown.needsYou.length, shown.worthALook.length, shown.errors, shown.warnings], [1, 1, 2, 2, 2]);
  assert.equal(shown.worthALook[0].fixes.length > 0, true, 'a warning with a fix is listed before one without');
});

test('every message the server gave for the broken copies gets a plain sentence with a label path, and no raw path is shown', () => {
  const harvested = [
    ['channels.0.modalities.input', "channel 'phone' / agent 'greeter': audio input needs an stt (or realtime) model"],
    ['agents.entry', "'nobody' is not a declared agents id (declared: billing, greeter)"],
    ['persona', "'name' is a required property"],
    ['tools.14.id', "duplicate tool id 'end_call' (2 times)"],
    ['state.variables.mood', "'values' is a required property"],
    ['agents.items.0.instructions.role', "template 'Hello {{state.nope}}' reads undeclared state variable 'nope'"],
    ['defaults.models.llm.temperature', "'hot' is not of type 'number'"],
    ['channels.0.type', "'pigeon' is not one of ['sip_voice', 'web_voice']"],
    ['agents.items', '[] should be non-empty'],
    ['schedules.open.weekly.0.start', "'25:00' does not match '^([01]\\d|2[0-3]):[0-5]\\d$'"],
    ['tests.0.expect.0.tool_called', "'nope' is not a declared tool names id (declared: end_call)"],
  ];
  harvested.forEach(([path, message]) => {
    const issue = err(
      path.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)),
      message,
    );
    const d = describe(issue);
    assert.ok(d.recognised, `${message} is recognised`);
    assert.ok(d.text && d.text !== message, `${message} is rewritten`);
    assert.ok(d.where.text.length > 0, `${message} has a place`);
    assert.doesNotMatch(d.text, /\b[a-z]+_[a-z]+\b(?!['”])/, `${d.text}: no raw key in the sentence (ids the author chose are quoted)`);
  });
});
