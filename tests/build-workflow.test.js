import test from 'node:test';
import assert from 'node:assert/strict';
import { minimalConfig } from '../src/demo/minimalConfig.js';
import { applyStarter } from '../src/studio/starters.ts';
import { actionsOf, setHandOver } from '../src/studio/setup/setupModel.js';
import { freshId } from '../src/studio/form/references.js';
import { addEnd, addPhoneTransfer, addSubagent, removeAgent, removeNode, whyKeepAgent } from '../src/studio/workflow/workflowOps.js';
import { addAgentTransfer } from '../src/studio/workflow/workflowOps.js';
import { buildWorkflow, describeItems } from '../src/studio/workflow/workflowModel.js';

// An agent's Workflow page: deleting an agent never leaves something else with nothing to do, a phone transfer added on the canvas is the
// same hand-over the Tools page switches, and the ids it makes fit the schema.
const support = () => applyStarter(minimalConfig('acme', 'Acme'), 'support');
const withSubagent = () => {
  const made = addSubagent(support(), support().agents.items[0].id, { name: 'Billing' });
  return { config: made.config, id: made.id };
};

test('an agent a test is only about is not deleted, and the canvas can say why', () => {
  const { config, id } = withSubagent();
  config.tests = [{ id: 'billing_test', channel: 'web_chat', turns: [], expect: [{ agent_is: id }] }];
  assert.equal(removeAgent(config, id), config, 'nothing changes');
  assert.match(whyKeepAgent(config, id), /test “billing_test”/);
  config.tests[0].expect.push({ said_matches: 'invoice' });
  const gone = removeAgent(config, id);
  assert.notEqual(gone, config);
  assert.deepEqual(gone.tests[0].expect, [{ said_matches: 'invoice' }], 'with another check, only the check about it goes');
});

test('the only agent can’t be deleted, and says so', () => {
  const config = support();
  assert.equal(whyKeepAgent(config, config.agents.items[0].id), 'An agent needs at least one subagent.');
  assert.equal(removeNode(config, config.agents.items[0].id), config);
});

test('ids made from a long base fit in 64 characters, a counter included', () => {
  const long = `sip_${'x'.repeat(90)}`;
  const first = freshId([], long);
  assert.ok(first.length <= 64);
  const second = freshId([first], long);
  assert.ok(second.length <= 64 && second !== first && /_2$/.test(second));
});

test('a phone transfer added on the canvas fills in the hand-over still waiting for its number, so the Tools switch stays one click', () => {
  const config = support();
  const agentId = config.agents.items[0].id;
  const transfers = () => config.telephony.transfers.length;
  const before = transfers();
  const added = addPhoneTransfer(config, agentId, '+6561234567').config;
  assert.equal(added.telephony.transfers.length, before, 'no second transfer beside it');
  assert.equal(actionsOf(added).hand_over.number, '+6561234567');
  const off = setHandOver(added, false);
  assert.equal(actionsOf(off).hand_over.on, false, 'one click turns it off');
  assert.equal(addPhoneTransfer(added, agentId, '+65 6123 4567').config, added, 'the same number again is the block it already has');
});

test('a subagent a call can reach but never leave is flagged, and giving it the end of the call clears it', () => {
  const { config: added, id } = withSubagent();
  const flagged = (c) => buildWorkflow(c).nodes.find((n) => n.id === id)?.deadEnd;
  assert.equal(flagged(added), false, 'a new subagent can always send the caller back, so it is never a dead end');
  // one whose way back was taken away has no way out
  const config = JSON.parse(JSON.stringify(added));
  config.agents.items.find((a) => a.id === id).tools = [];
  assert.equal(flagged(config), true, 'a subagent with no way out is flagged');
  assert.equal(buildWorkflow(config).nodes.find((n) => n.entry)?.deadEnd, false, 'the agent that answers first is never flagged');
  assert.equal(flagged(addEnd(config, id).config), false);
});

test('deleting the End block takes its goodbye with it when nothing else says it', () => {
  const config = support();
  const end = config.tools.find((t) => t.builtin === 'end_call');
  const gone = removeNode(config, `${config.agents.items[0].id}::tool::${end.id}`);
  assert.ok(!gone.tools.some((t) => t.id === end.id));
  assert.ok(!(gone.messages || []).some((m) => m.id === end.params?.say?.message), 'no line is left that nothing says');
});

test('a phone transfer block says where calls go, or that there is no number yet (and what callers get instead)', () => {
  const config = support();
  const block = (c) => buildWorkflow(c).nodes.find((n) => n.type === 'transfer');
  const transfer = config.telephony.transfers[0];
  transfer.target = '';
  assert.deepEqual({ sub: block(config).sub, noNumber: block(config).noNumber }, { sub: 'No number yet: callers are offered a callback', noNumber: true });
  assert.match(
    describeItems(buildWorkflow(config))
      .map((i) => i.text)
      .join(' '),
    /can pass the caller to a person, but has no number yet: callers are offered a callback\./,
  );
  transfer.target = '+6561234567';
  assert.deepEqual({ sub: block(config).sub, noNumber: block(config).noNumber }, { sub: '+6561234567', noNumber: false });
  assert.ok(describeItems(buildWorkflow(config)).some((i) => i.text.endsWith('can pass the caller to a person (+6561234567).')));
  transfer.target = { lookup: { tool: 'find_branch' } };
  assert.equal(block(config).sub, 'chosen by what the caller wants');
});

test('each channel is where a call comes in: it says what it says first (all of it in its tooltip), or that it waits; one switched off says so', () => {
  const config = support();
  const triggers = (c) => buildWorkflow(c).nodes.filter((n) => n.type === 'trigger');
  config.channels.forEach((c) => {
    c.greeting = { say: 'Hello, you have reached Acme support. I can help with orders, returns and anything about your account.' };
  });
  const first = triggers(config)[0];
  assert.equal(
    first.sub,
    'Says “Hello, you have reached Acme support. I can help with orders, returns and anything about your account.”',
    'every word (the block grows)',
  );
  assert.equal(first.full, 'Hello, you have reached Acme support. I can help with orders, returns and anything about your account.');
  config.channels.forEach((c) => delete c.greeting);
  assert.equal(triggers(config)[0].sub, 'Waits for the caller to speak first');
  config.channels[0].enabled = false;
  assert.deepEqual([triggers(config)[0].sub, triggers(config)[0].off], ['Switched off', true]);
  assert.equal(buildWorkflow(config).nodes.filter((n) => n.type === 'agent' && n.entry).length, 1, 'the subagent that answers first is a block of its own');
});

test('an agent no call reaches is named with its id, and one hand-over from the first agent reaches it', () => {
  const { config, id } = withSubagent();
  const entry = config.agents.entry;
  config.agents.items[0].handoffs = [];
  const flow = buildWorkflow(config);
  assert.deepEqual(flow.strandedIds, [id]);
  assert.deepEqual(flow.stranded, ['Billing']);
  const reached = buildWorkflow(addAgentTransfer(config, entry, id));
  assert.deepEqual(reached.strandedIds, []);
});

test('the call step by step: an arrow’s own words end with the sentence, not with a full stop of their own inside the brackets', () => {
  const { config, id } = withSubagent();
  config.agents.items[0].handoffs = [{ id: 'to_billing', tool: 'to_billing', to: id, description: 'The caller asks about a bill.' }];
  const text = describeItems(buildWorkflow(config)).map((i) => i.text);
  assert.ok(text.includes('Acme hands the caller to Billing (The caller asks about a bill).'), text.join(' | '));
});
