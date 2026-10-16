import test from 'node:test';
import assert from 'node:assert/strict';
import { assemblePrompt, describeCondition, describeWhen, renderTemplate } from '../src/studio/form/promptPreview.js';

const config = {
  persona: { name: 'Sam', company: 'Acme', tone: 'warm', style_rules: ['One question at a time.'], shared_rules: ['Never guess.'] },
  constants: { hours: '9 to 5' },
  state: {
    variables: {
      plan: { type: 'string', default: 'basic' },
      intent: { type: 'string', nullable: true, default: null },
      pin: { type: 'string', sensitive: true },
    },
  },
  channels: [
    { id: 'phone', type: 'sip_voice', instructions_append: 'You are on a phone call. Keep it short.' },
    { id: 'web', type: 'web_chat' },
  ],
  tools: [
    { id: 'lookup', description: 'Gets the bill', parameters: { type: 'object', properties: { account_id: { type: 'string' } } } },
    { id: 'end_call', type: 'builtin', builtin: 'end_call' },
  ],
  agents: {
    entry: 'a',
    items: [
      {
        id: 'a',
        instructions: {
          role: "Help with bills. The plan is {{state.plan}} and we are open {{const.hours}}. Intent: {{state.intent | default('unknown')}}. Ask {{args.who}}.",
          opening: 'Greet the caller.',
          rules: ['Be brief.'],
          conditional: [{ when: { state: 'intent', equals: 'billing' }, append: 'Billing only.' }],
        },
        tools: ['lookup', 'end_call', 'ghost'],
        handoffs: [{ id: 'h', tool: 'go_billing', description: 'When they want billing', to: 'b' }],
      },
    ],
  },
};

test('the pieces come in order, with names the configuration knows filled in', () => {
  const out = assemblePrompt(config, 'a');
  assert.deepEqual(
    out.sections.map((s) => s.id),
    ['persona', 'shared', 'role', 'opening', 'rules', 'conditional-0', 'tools'],
  );
  const role = out.sections.find((s) => s.id === 'role').text;
  assert.match(role, /The plan is basic and we are open 9 to 5/);
  assert.match(role, /Intent: unknown/);
  assert.match(role, /Ask ‹args\.who›/);
  assert.deepEqual(out.unresolved, ['args.who']);
  assert.match(out.sections[0].text, /Your name is Sam, from Acme\./);
});

test('a conditional block says when it applies and is counted apart', () => {
  const out = assemblePrompt(config, 'a');
  const block = out.sections.find((s) => s.conditional);
  assert.equal(block.title, 'Only while the state intent is “billing”');
  assert.ok(out.conditionalWords > 0);
  assert.equal(
    out.words,
    out.sections.filter((s) => !s.conditional).reduce((n, s) => n + s.words, 0),
  );
});

test('the channel adds its own text, and the tools are listed with their arguments', () => {
  const out = assemblePrompt(config, 'a', { channelId: 'phone' });
  assert.match(out.sections.find((s) => s.id === 'channel').text, /phone call/);
  assert.equal(
    assemblePrompt(config, 'a', { channelId: 'web' }).sections.some((s) => s.id === 'channel'),
    false,
  );
  const tools = out.sections.find((s) => s.id === 'tools').text;
  assert.match(tools, /- lookup\(account_id\): Gets the bill/);
  assert.match(tools, /- end_call\(\)/);
  assert.match(tools, /- ghost \(not defined\)/);
  assert.match(tools, /go_billing\(\): When they want billing \(hands the caller to b\)/);
});

test('a sensitive variable is never shown; an unknown agent gives nothing', () => {
  assert.equal(renderTemplate('Pin {{state.pin}}', config).text, 'Pin ‹sensitive: not shown›');
  assert.equal(assemblePrompt(config, 'nobody'), null);
  assert.equal(assemblePrompt({}, 'a'), null);
});

test('conditions in words', () => {
  assert.equal(describeCondition({ state: 'verified', equals: true }), 'the state verified is true');
  assert.equal(describeCondition({ arg: 'n', gte: 3 }), 'the argument n is at least 3');
  assert.equal(describeCondition({ channel: ['phone', 'web'] }), 'the channel is “phone”, “web”');
  assert.equal(
    describeCondition({ all: [{ state: 'a', equals: 'x' }, { not: { state: 'b', in: ['y', 'z'] } }] }),
    'the state a is “x” and not (the state b is one of “y”, “z”)',
  );
  assert.equal(describeCondition({ schedule: 'hours', open: false }), 'hours is closed');
});

// ---- UI review 2.9: a conditional block says when in words, never as the server's raw text -------------------------------------------------------------
test('the `when` of a block is put in words, whether the server sends an object, its JSON, or Python’s way of writing it', () => {
  const words = 'the state pending_request is set';
  assert.equal(describeWhen({ state: 'pending_request', not_equals: null }), words);
  assert.equal(describeWhen('{"state":"pending_request","not_equals":null}'), words);
  assert.equal(describeWhen("{'state': 'pending_request', 'not_equals': None}"), words);
  assert.equal(describeWhen({ state: 'verified', equals: true }), 'the state verified is true');
  assert.equal(describeWhen({ state: 'plan', equals: null }), 'the state plan is not set');
  assert.equal(describeWhen('only on weekdays'), 'only on weekdays', 'plain text is left as it is');
  assert.equal(describeWhen('{not json'), '{not json');
  assert.equal(describeWhen(undefined), '');
});
