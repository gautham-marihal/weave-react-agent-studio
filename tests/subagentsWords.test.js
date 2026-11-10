import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStarter } from '../src/studio/starters.ts';
import { minimalConfig } from '../src/demo/demoApi.js';
import { addBackToStart, addSubagent, addTransferToAgent } from '../src/studio/workflow/workflowOps.js';
import { withHandoffRules } from '../src/studio/workflow/handoffRules.js';
import {
  agentsIn,
  firstOf,
  handoversIn,
  relayOf,
  rulesMissing,
  sentenceOf,
  summaryLine,
  together,
  transfersOut,
} from '../src/studio/agent/detailed/subagentsWorkspace/subagentsWords.js';

// Build › Subagents and hand-overs in plain words (subagentsWords.js), for any agent: one alone, a team, hand-overs
// inside it, transfers to another agent's number or to a person, and the ways back to the first.

const agent = () => applyStarter(minimalConfig('acme', 'Acme'), 'support');
const team = () => {
  let config = agent();
  const first = config.agents.items[0].id;
  config = addSubagent(config, first, { name: 'Bookings' }).config;
  config = addSubagent(config, first, { name: 'Billing' }).config;
  const [bookings, billing] = config.agents.items.slice(1).map((a) => a.id);
  config.agents.items[1].instructions.role = 'Books, moves and cancels visits.';
  return { config, first, bookings, billing };
};
const desk = { id: 'sales-line', name: 'Sales line', numbers: [{ number: '+6560000002' }] };

test('one agent alone answers every call itself', () => {
  const config = agent();
  assert.equal(firstOf(config), config.agents.items[0].id);
  assert.equal(agentsIn(config).length, 1);
  assert.equal(agentsIn(config)[0].first, true);
  assert.equal(agentsIn(config)[0].state, null, 'alone, its words are the Agent part’s: nothing to say here');
  assert.equal(summaryLine(config, []), 'One agent: it answers every call itself');
  const said = sentenceOf(config, []);
  assert.equal(said.alone, true);
  assert.equal(said.subs, '');
  assert.equal(rulesMissing(config), 0);
  assert.deepEqual(relayOf(config, []).subs, []);
});

test('a team: who answers first, what each subagent does, and a new one’s placeholder job needs a look', () => {
  const { config, first, bookings, billing } = team();
  const agents = agentsIn(config);
  assert.deepEqual(
    agents.map((a) => [a.key, a.first]),
    [
      [first, true],
      [bookings, false],
      [billing, false],
    ],
  );
  assert.equal(agents[1].does, 'Books, moves and cancels visits.');
  assert.equal(agents[1].state, null);
  assert.equal(agents[2].does, '', 'the words a new subagent starts with are not a job');
  assert.equal(agents[2].state.words, 'Needs a look');
  assert.equal(agents[2].kind, 'Does one job');
  assert.equal(sentenceOf(config, []).subs, '2 subagents');
});

test('hand-overs inside the agent: who passes callers to whom, when, and what is said', () => {
  const { config, first, bookings } = team();
  config.agents.items[0].handoffs[0].announce = 'One moment.';
  const hands = handoversIn(config);
  assert.equal(hands.length, 2);
  assert.equal(hands[0].from, first);
  assert.equal(hands[0].to, bookings);
  assert.equal(hands[0].toName, 'Bookings');
  assert.equal(hands[0].says, 'One moment.');
  assert.equal(hands[0].context, true, 'it carries what was said unless switched off');
  assert.equal(hands[0].key, `${first}/${config.agents.items[0].handoffs[0].id}`);
  // a hand-over to an agent that is not there needs a look
  config.agents.items[0].handoffs[1].to = 'gone';
  assert.equal(handoversIn(config)[1].state.words, 'Needs a look');
});

test('the ways back: a subagent with the back tool can send callers back to the first', () => {
  const { config, bookings, billing } = team();
  const back = config.tools.find((t) => t.builtin === 'return_to_entry').id;
  // the hand-over rules gave every subagent the way back; take Billing's
  config.agents.items[2].tools = config.agents.items[2].tools.filter((t) => t !== back);
  const agents = agentsIn(config);
  assert.equal(agents.find((a) => a.key === bookings).canGoBack, true);
  assert.equal(agents.find((a) => a.key === billing).canGoBack, false);
  assert.equal(agents.find((a) => a.key === bookings).tools, 0, 'the way back is not counted as one of its tools');
  assert.equal(sentenceOf(config, []).back, 1);
  assert.deepEqual(relayOf(config, []).back, ['s0']);
  assert.equal(addBackToStart(config, billing).config.agents.items[2].tools.includes(back), true);
});

test('beyond this agent: a transfer to another agent’s number, or to a person', () => {
  const { config, first } = team();
  const made = addTransferToAgent(config, first, desk);
  const outs = transfersOut(made.config, { agents: [desk] });
  const toDesk = outs.find((o) => o.to === 'agent');
  assert.ok(toDesk, 'a transfer to the Sales line’s number is a hand-over to it');
  assert.equal(toDesk.toName, 'Sales line');
  assert.equal(toDesk.from, first);
  // without the workspace knowing that number, the same transfer goes to a person
  assert.equal(transfersOut(made.config, { agents: [] }).find((o) => o.key === toDesk.key).to, 'person');
  const said = sentenceOf(made.config, { agents: [desk] });
  assert.deepEqual(
    said.others.map((o) => o.toName),
    ['Sales line'],
  );
  const relay = relayOf(made.config, { agents: [desk] });
  assert.equal(relay.beyond[0].toName, 'Sales line');
  assert.equal(relay.beyond[0].fromNode, 'first');
});

test('the relay shows up to six subagents, says how many more, and draws only lines between shown nodes', () => {
  let config = agent();
  const first = config.agents.items[0].id;
  for (let i = 0; i < 8; i += 1) config = addSubagent(config, first, { name: `Desk ${i + 1}` }).config;
  const relay = relayOf(config, []);
  assert.equal(relay.subs.length, 6);
  assert.equal(relay.more, 2);
  assert.equal(relay.lines.length, 6, 'a line to each shown subagent');
  assert.ok(relay.lines.every((l) => l.from === 'first' && /^s[0-5]$/.test(l.to)));
});

test('the summary line and the hand-over rules', () => {
  const { config } = team();
  // two inside the agent, and the starter's hand-over to a person
  assert.match(summaryLine(config, []), /^3 agents · 3 hand-overs · 2 ways back · 1 needs a look$/);
  config.agents.items.forEach((a) => {
    a.instructions.rules = [];
  });
  assert.ok(rulesMissing(config) > 0, 'without the rules, agents are missing them');
  assert.equal(rulesMissing(withHandoffRules(config)), 0);
});

test('names are joined as a sentence says them', () => {
  assert.equal(together([]), '');
  assert.equal(together(['Bookings']), 'Bookings');
  assert.equal(together(['Bookings', 'Billing']), 'Bookings and Billing');
  assert.equal(together(['Bookings', 'Billing', 'Returns'], 'or'), 'Bookings, Billing or Returns');
});
