import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseCall, headline } from '../src/studio/fixcall/diagnose.js';
import { applyFixes, fixesFor } from '../src/studio/fixcall/fixes.js';
import { readSimple } from '../src/studio/simple/simpleModel.js';
import { readModels } from '../src/studio/models/config.js';
import { plainChanges } from '../src/studio/compare/plainCompare.js';
import { diffConfigs } from '../src/demo/diff.js';

// "Fix this call": what a call's records show went wrong, and the small changes that are suggested for it.
const turn = (say, said, extra = {}) => ({ say, said: Array.isArray(said) ? said : said ? [said] : [], tools: [], waitMs: null, ...extra });
const config = () => ({
  meta: { id: 'a', name: 'A' },
  persona: { style_rules: ['Be kind.'] },
  channels: [{ id: 'phone', type: 'sip_voice' }],
  defaults: { models: { llm: { provider: 'openai', model: 'gpt-5.4' } } },
  agents: { entry: 'main', items: [{ id: 'main', name: 'Main' }] },
});
const kinds = (findings) => findings.map((f) => f.kind);

test('a call that went well has nothing found, and says so', () => {
  const facts = { channelId: 'phone', turns: [turn('Hi, I need my balance', 'Sure, one moment.'), turn('Thanks', 'You are welcome.')] };
  const found = diagnoseCall(facts, { config: config() });
  assert.deepEqual(found, []);
  assert.equal(headline(found), 'Nothing obviously wrong was found in this call.');
});

test('a tool that failed is found once, with its error as the evidence, however many times it failed', () => {
  const failing = { tool: 'lookup_order', error: 'HTTP 500', args: {} };
  const facts = { turns: [turn('Where is my order?', 'Let me check.', { tools: [failing] }), turn('Well?', 'One moment.', { tools: [failing] })] };
  const found = diagnoseCall(facts, { config: config() });
  const f = found.find((x) => x.kind === 'tool_failed');
  assert.equal(found.filter((x) => x.kind === 'tool_failed').length, 1);
  assert.equal(f.turn, 1);
  assert.equal(f.severity, 'high');
  assert.match(f.title, /“lookup_order” failed \(2 times\)/);
  assert.deepEqual(f.evidence, ['HTTP 500']);
});

test('a long wait, silence, a call cut off, and an answer too long to listen to', () => {
  const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
  const facts = { channelId: 'phone', turns: [turn('Hello', 'Hi.', { waitMs: 6200 }), turn('Are you there?', ''), turn('Tell me everything', long)] };
  const found = diagnoseCall(facts, { call: { status: 'unfinished', duration_s: 41 }, config: config() });
  assert.deepEqual(kinds(found).sort(), ['cut_off', 'long_reply', 'no_answer', 'slow_answer']);
  assert.equal(found.find((f) => f.kind === 'slow_answer').severity, 'medium');
  assert.equal(found[0].severity, 'high', 'the serious ones come first');
  assert.match(found.find((f) => f.kind === 'no_answer').evidence[0], /Are you there\?/);
});

test('a long answer is only a problem when it is spoken: in a chat it is not reported', () => {
  const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
  const chat = { ...config(), channels: [{ id: 'web', type: 'web_chat' }] };
  const facts = { channelId: 'web', turns: [turn('Tell me everything', long)] };
  assert.deepEqual(kinds(diagnoseCall(facts, { config: chat })), []);
  assert.deepEqual(kinds(diagnoseCall({ ...facts, channelId: 'phone' }, { config: config() })), ['long_reply']);
});

test('the agent repeating itself and the caller having to repeat themselves are found', () => {
  const facts = {
    turns: [
      turn('What are your hours?', 'We are open from nine to five on weekdays.'),
      turn('What are your hours', 'We are open from nine to five on weekdays.'),
      turn('I already said I want the hours', 'Let me help with something else.'),
    ],
  };
  const found = diagnoseCall(facts, { config: config() });
  assert.deepEqual(kinds(found).sort(), ['caller_repeated', 'caller_repeated', 'repeated_answer']);
  assert.deepEqual(
    found.filter((f) => f.kind === 'caller_repeated').map((f) => f.turn),
    [2, 3],
  );
});

test('a hand-over is noted as worth knowing, not as a failure', () => {
  const facts = { turns: [turn('Give me a person', 'Connecting you.', { tools: [{ tool: 'transfer', handoff: 'billing', args: {} }] })] };
  const f = diagnoseCall(facts, { config: config() });
  assert.deepEqual(
    f.map((x) => [x.kind, x.severity]),
    [['handed_over', 'low']],
  );
});

test('each kind of finding has a suggestion, shown as a sentence, that changes only what it says', () => {
  const base = config();
  const failed = fixesFor({ kind: 'tool_failed', tool: 'lookup_order' }, base);
  assert.equal(failed.length, 1);
  assert.match(failed[0].change, /^Add this rule under Tone and style: “If the “lookup_order” tool fails/);
  const next = failed[0].apply(base);
  assert.deepEqual(readSimple(next).styleRules, ['Be kind.', failed[0].change.replace(/^[^“]*“/, '').replace(/”$/, '')]);
  assert.equal(failed[0].applied(next), true);
  assert.equal(failed[0].apply(next), next, 'applying it twice changes nothing');
  assert.deepEqual(readModels(next), readModels(base), 'nothing else changed');
  ['cut_off', 'no_answer', 'long_reply', 'repeated_answer', 'caller_repeated', 'handed_over'].forEach((kind) =>
    assert.equal(fixesFor({ kind }, base).length >= 1, true, kind),
  );
  assert.deepEqual(fixesFor({ kind: 'unknown_kind' }, base), []);
});

test('a slow answer can be answered with a faster model, offered only when there is one and the model is not already fast', () => {
  const base = config();
  const fixes = fixesFor({ kind: 'slow_answer' }, base);
  const model = fixes.find((f) => f.kind === 'setting');
  assert.ok(model, 'a faster model is offered');
  assert.match(model.change, /Change the language model from “.*” to “.*”/);
  const next = model.apply(base);
  assert.notEqual(readModels(next).llm.model, 'gpt-5.4');
  assert.equal(
    fixesFor({ kind: 'slow_answer' }, next).some((f) => f.kind === 'setting'),
    false,
    'already fast: not offered again',
  );
  assert.ok(
    fixes.some((f) => f.kind === 'wording'),
    'and a rule for shorter answers',
  );
});

test('the suggestions read as plain sentences when compared, and several can be applied together', () => {
  const base = config();
  const fixes = [...fixesFor({ kind: 'long_reply' }, base), ...fixesFor({ kind: 'caller_repeated' }, base)];
  const next = applyFixes(base, fixes);
  assert.equal(readSimple(next).styleRules.length, 3);
  const plain = plainChanges(diffConfigs(base, next));
  assert.equal(plain.total >= 1, true);
  assert.ok(plain.groups.flatMap((g) => g.items).every((i) => !/persona\.style_rules/.test(i.text)));
});
