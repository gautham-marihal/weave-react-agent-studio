import test from 'node:test';
import assert from 'node:assert/strict';
import { abilitiesOf, stepsOf, summaryLine, toolsOf } from '../src/studio/agent/detailed/toolsWorkspace/toolsWords.js';

const agentWith = (tools, offered = tools.map((t) => t.id)) => ({
  agents: { entry: 'main', items: [{ id: 'main', name: 'Advisor', tools: offered }] },
  tools,
});

test('the four quick abilities, each on or off, in plain words', () => {
  const config = agentWith([{ id: 'end_call', type: 'builtin', builtin: 'end_call', params: { say: 'Goodbye for now.' } }]);
  const abilities = abilitiesOf(config);
  assert.deepEqual(
    abilities.map((a) => [a.name, a.on]),
    [
      ['End politely', true],
      ['Pass to a person', false],
      ['Take requests', false],
      ['Look things up', false],
    ],
  );
  assert.equal(abilities[0].detail, '“Goodbye for now.”', 'what it says before hanging up');
});

test('every tool as a line: what it does, who uses it, whether it is ready, and the ability that made it', () => {
  const config = agentWith(
    [
      { id: 'end_call', type: 'builtin', builtin: 'end_call' },
      { id: 'deposit_offers', type: 'http', connection: 'svc', request: { method: 'GET', path: '/offers' } },
      { id: 'spare', type: 'builtin', builtin: 'noop' },
    ],
    ['end_call', 'deposit_offers'],
  );
  const tools = toolsOf(config);
  assert.deepEqual(
    tools.map((t) => [t.name, t.does, t.madeBy, t.state.words]),
    [
      ['End call', 'Ends the conversation', 'End politely', 'Ready'],
      ['Deposit offers', 'Looks up in your system', '', 'Ready'],
      ['Spare', 'Rules only', '', 'Not given to an agent'],
    ],
  );
  assert.equal(summaryLine(config), '3 tools · used by Advisor');
  assert.equal(summaryLine({}), 'Only talk, for now');
});

test('a tool as the steps of one run, each said in a few words', () => {
  const config = agentWith([
    {
      id: 'offers',
      type: 'http',
      parameters: { type: 'object', properties: { amount: {}, currency: {} } },
      request: { method: 'GET', path: '/unbound/offers' },
      timeout_s: 10,
      effects: [{ type: 'set_state' }],
    },
  ]);
  assert.deepEqual(
    stepsOf(config, 'offers').map((s) => `${s.title}: ${s.words}`),
    [
      'Asked for: when, and 2 values it fills in',
      'May it run?: always',
      'Calls your system: GET /unbound/offers',
      'What comes back: all of it, to the model',
      'Then: the model answers · 1 step',
      'If it fails: after 10 s',
    ],
  );
  const builtin = agentWith([{ id: 'bye', type: 'builtin', builtin: 'end_call', reply: 'none' }]);
  assert.deepEqual(
    stepsOf(builtin, 'bye').map((s) => s.words),
    ['when it is used', 'always', 'ends the conversation', 'its result, to the model', 'nothing more is said', 'the model is told'],
  );
});
