import test from 'node:test';
import assert from 'node:assert/strict';
import { chatOf, clockOf } from '../src/studio/calls/callChat.js';

// A call's records as a chat (src/studio/calls/callChat.js): who said each line, the agent speaking at that moment,
// how far into the call, and a line of its own where one agent hands the caller to another.

const records = [
  { kind: 'call_started', elapsed_s: 0, caller: 'GTM-plf0', channel: { type: 'web_voice' } },
  { kind: 'agent_entered', elapsed_s: 0.2, agent: 'front_desk', first: true },
  { kind: 'agent_said', elapsed_s: 11.4, text: 'Welcome to OCBC Bank. How may I help you today?' },
  { kind: 'user_said', elapsed_s: 15.9, text: 'Where is my bank balance?' },
  { kind: 'tool_called', elapsed_s: 20, tool: 'transfer_to_balances' },
  { kind: 'agent_entered', elapsed_s: 21, agent: 'balances' },
  { kind: 'agent_said', elapsed_s: 32, text: 'I can help with your account balance.', interrupted: true },
  { kind: 'user_said', elapsed_s: 36, text: '   ' },
  { kind: 'agent_said', elapsed_s: 3725, text: 'Anything else?', agent: 'front_desk' },
];

test('each line says who spoke and when; a hand-over is a line of its own', () => {
  const chat = chatOf(records);
  assert.equal(chat.caller, 'GTM-plf0');
  assert.deepEqual(chat.agents, ['front_desk', 'balances']);
  assert.equal(chat.turns, 4, 'blank lines are left out');
  assert.deepEqual(
    chat.items.map((item) => (item.type === 'handover' ? `${item.from}→${item.to}` : `${item.role}:${item.agent}`)),
    ['agent:front_desk', 'caller:', 'front_desk→balances', 'agent:balances', 'agent:front_desk'],
  );
  assert.equal(chat.items[0].time, '00:11');
  assert.equal(chat.items[2].time, '00:21', 'the hand-over has its own time');
  assert.equal(chat.items[3].interrupted, true);
});

test('a line that names its own agent wins over the one that took over last', () => {
  const last = chatOf(records).items.at(-1);
  assert.equal(last.agent, 'front_desk');
  assert.equal(last.time, '1:02:05', 'past an hour the clock shows hours');
});

test('with no agent records, agent lines still show, and an empty call has no turns', () => {
  const plain = chatOf([{ kind: 'agent_said', elapsed_s: 1, text: 'Hi' }]);
  assert.deepEqual(plain.items, [{ type: 'line', role: 'agent', agent: '', text: 'Hi', time: '00:01', interrupted: false }]);
  assert.equal(chatOf([]).turns, 0);
  assert.equal(chatOf(null).turns, 0);
});

test('the clock is mm:ss, and empty when the time is unknown', () => {
  assert.equal(clockOf(0), '00:00');
  assert.equal(clockOf(59.9), '00:59');
  assert.equal(clockOf(undefined), '');
  assert.equal(clockOf(-1), '');
});
