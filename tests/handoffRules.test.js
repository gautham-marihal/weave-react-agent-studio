import test from 'node:test';
import assert from 'node:assert/strict';
import { BACK_TOOL_DESCRIPTION, FIRST_AGENT_RULE, handoffGaps, specialistRule, withHandoffRules } from '../src/studio/workflow/handoffRules.js';
import { addAgentTransfer, addSubagent, removeAgent } from '../src/studio/workflow/workflowOps.js';

// Reliable hand-overs between subagents (src/studio/workflow/handoffRules.js): the first agent hands over at once, and
// every specialist sends the caller back for anything outside its role. Live tests showed both go wrong without these
// rules, and that a rule only works when it comes first in the agent's list.

const single = () => ({
  schema_version: '1.1',
  meta: { name: 'Help desk' },
  agents: { entry: 'desk', items: [{ id: 'desk', name: 'Desk', kind: 'standalone', instructions: { role: 'Help callers.' }, tools: [] }] },
  tools: [],
});
const team = () => ({
  ...single(),
  agents: {
    entry: 'desk',
    items: [
      {
        id: 'desk',
        name: 'Desk',
        kind: 'router',
        instructions: { role: 'Route callers.', rules: ['Answer in English.'] },
        tools: [],
        handoffs: [
          { id: 'to_billing', tool: 'go_to_billing', to: 'billing', description: 'Bills.' },
          { id: 'to_orders', tool: 'go_to_orders', to: 'orders', description: 'Orders.' },
        ],
      },
      { id: 'billing', name: 'Billing', kind: 'specialist', instructions: { role: 'Bills.', rules: ['Be brief.'] }, tools: [] },
      { id: 'orders', name: 'Orders', kind: 'specialist', instructions: { role: 'Orders.' }, tools: [] },
    ],
  },
});
const agent = (config, id) => config.agents.items.find((a) => a.id === id);

test('an agent that answers alone needs nothing, and is left as it is', () => {
  const config = single();
  assert.deepEqual(handoffGaps(config), []);
  assert.equal(withHandoffRules(config), config, 'the very same configuration comes back');
});

test('a team without the rules says what each agent is missing', () => {
  assert.deepEqual(handoffGaps(team()), [
    { agentId: 'desk', missing: ['first-agent-rule'] },
    { agentId: 'billing', missing: ['specialist-rule', 'back-tool'] },
    { agentId: 'orders', missing: ['specialist-rule', 'back-tool'] },
  ]);
});

test('the fix puts each rule first, gives every specialist the way back, and keeps what was there', () => {
  const fixed = withHandoffRules(team());
  assert.deepEqual(handoffGaps(fixed), []);
  const back = fixed.tools.find((t) => t.builtin === 'return_to_entry');
  assert.equal(back.description, BACK_TOOL_DESCRIPTION);
  assert.deepEqual(agent(fixed, 'desk').instructions.rules, [FIRST_AGENT_RULE, 'Answer in English.']);
  assert.deepEqual(agent(fixed, 'billing').instructions.rules, [specialistRule(back.id), 'Be brief.']);
  assert.deepEqual(agent(fixed, 'orders').instructions.rules, [specialistRule(back.id)]);
  assert.ok(['billing', 'orders'].every((id) => agent(fixed, id).tools.includes(back.id)));
  assert.equal(agent(fixed, 'orders').instructions.role, 'Orders.', 'the role is untouched');
  assert.deepEqual(withHandoffRules(fixed), fixed, 'running it again changes nothing');
});

test('an existing way back is reused under its own name, and a description someone wrote is kept', () => {
  const config = team();
  config.tools = [{ id: 'back_to_front_desk', type: 'builtin', builtin: 'return_to_entry', description: 'Our own words.' }];
  const fixed = withHandoffRules(config);
  assert.equal(fixed.tools.filter((t) => t.builtin === 'return_to_entry').length, 1);
  assert.equal(fixed.tools[0].description, 'Our own words.');
  assert.ok(agent(fixed, 'billing').instructions.rules[0].includes('use back_to_front_desk in that same reply'));
});

test('the Workflow adds the rules itself when a subagent or an arrow between agents is added', () => {
  const { config, id } = addSubagent(single(), 'desk', { name: 'Billing' });
  assert.deepEqual(handoffGaps(config), [], 'a new subagent comes with everything');
  assert.equal(agent(config, 'desk').instructions.rules[0], FIRST_AGENT_RULE);
  assert.ok(agent(config, id).tools.length === 1);
  const third = addSubagent(config, 'desk', { name: 'Orders' }).config;
  assert.deepEqual(handoffGaps(third), []);
  // an arrow between two existing agents
  const linked = addAgentTransfer(withHandoffRules(team()), 'billing', 'orders');
  assert.deepEqual(handoffGaps(linked), []);
});

test('when only one agent is left the rules come off again', () => {
  const { config, id } = addSubagent(single(), 'desk', { name: 'Billing' });
  const alone = removeAgent(config, id);
  assert.equal(alone.agents.items.length, 1);
  assert.ok(!JSON.stringify(alone).includes(FIRST_AGENT_RULE));
  assert.deepEqual(handoffGaps(alone), []);
});

test('an earlier wording of the rules (the first banking agents) is replaced, not kept beside the new one', () => {
  const config = team();
  config.tools = [{ id: 'back_to_front_desk', type: 'builtin', builtin: 'return_to_entry', description: 'Our own words.' }];
  agent(config, 'desk').instructions.rules = ['Hand the caller to the specialist as soon as you know what they need.', 'Answer in English.'];
  agent(config, 'billing').instructions.rules = ['Your job is only what your role says. Send other things back (a balance, a cheque).', 'Be brief.'];
  agent(config, 'billing').tools = ['back_to_front_desk'];
  assert.equal(handoffGaps(config).length, 3, 'the old wording is not taken for the current one');
  const fixed = withHandoffRules(config);
  assert.deepEqual(agent(fixed, 'desk').instructions.rules, [FIRST_AGENT_RULE, 'Answer in English.']);
  assert.deepEqual(agent(fixed, 'billing').instructions.rules, [specialistRule('back_to_front_desk'), 'Be brief.']);
});
