import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulatedAgent } from '../src/demo/simulatedAgent.js';
import { applyStarter } from '../src/studio/starters.js';
import { minimalConfig } from '../src/demo/demoApi.js';

const support = () => applyStarter(minimalConfig('a', 'Sam'), 'support');

test('it greets with the channel’s greeting, and says the recording notice first on a voice channel', () => {
  const chat = createSimulatedAgent(support());
  const hello = chat.greeting();
  assert.equal(hello.length, 1);
  assert.match(hello[0].text, /Sam/);
  assert.ok(hello.every((m) => m.simulated === true && m.role === 'assistant'));

  const config = support();
  config.channels = [
    { id: 'phone', type: 'sip_voice', enabled: true, modalities: { input: ['audio'], output: ['audio'] }, greeting: { say: { message: 'hi' } } },
  ];
  config.messages = [...config.messages, { id: 'hi', text: { en: 'Thanks for calling.', es: 'Gracias por llamar.' } }];
  config.persona.disclosures = { recording_notice: 'This call may be recorded.' };
  config.defaults.language = { primary: 'en-US', speaks: ['en', 'es'] };
  const voice = createSimulatedAgent(config).greeting();
  assert.deepEqual(
    voice.map((m) => m.text),
    ['This call may be recorded.', 'Thanks for calling.'],
  );
});

test('every reply is marked simulated and none claims to be the real agent', () => {
  const agent = createSimulatedAgent(support());
  const out = agent.reply('What are your opening hours?');
  assert.equal(out.messages.length, 1);
  assert.equal(out.messages[0].simulated, true);
  assert.match(out.messages[0].text, /simulated reply/i);
  assert.deepEqual(out.toolCalls, []);
});

test('saying goodbye uses the end-call tool and its goodbye line, then the conversation is over', () => {
  const agent = createSimulatedAgent(support());
  const out = agent.reply('No thanks, goodbye');
  assert.equal(out.ended, true);
  assert.equal(out.toolCalls[0].id, 'end_call');
  assert.match(out.messages[0].text, /Thanks for getting in touch/);
  assert.equal(agent.ended, true);
  assert.match(agent.reply('hello?').messages[0].text, /has ended/);
});

test('asking for a person uses the callback tool when the agent has one, and says so when it has none', () => {
  const agent = createSimulatedAgent(support());
  const out = agent.reply('Can I speak to a human please');
  assert.equal(out.toolCalls[0].id, 'escalate_to_human');
  assert.match(out.messages[0].text, /person from here right now/);
  const bare = createSimulatedAgent(minimalConfig('a', 'A'));
  assert.match(bare.reply('I want a person').messages[0].text, /no way to do that/);
});

test('a tool whose description matches is "called", its set_state effects apply, and nothing is requested', () => {
  const config = minimalConfig('a', 'A');
  config.state = { variables: { outcome: { type: 'string', nullable: true, default: null } } };
  config.tools = [
    {
      id: 'get_bill',
      type: 'http',
      description: 'Looks up the caller’s bill balance',
      connection: 'c',
      request: { method: 'GET', path: '/b' },
      parameters: { type: 'object', properties: { account_id: { type: 'string' } } },
      effects: [
        {
          do: [
            { type: 'set_state', values: { outcome: 'billed' } },
            { type: 'say', text: 'Your bill is ready.' },
          ],
        },
      ],
    },
  ];
  config.agents.items[0].tools = ['get_bill'];
  const agent = createSimulatedAgent(config);
  const out = agent.reply('How much is my bill?');
  assert.equal(out.toolCalls[0].id, 'get_bill');
  assert.deepEqual(out.toolCalls[0].args, { account_id: '‹account_id from the caller›' });
  assert.equal(agent.state.outcome, 'billed');
  assert.equal(out.messages[0].text, 'Your bill is ready.');
  const plain = createSimulatedAgent({ ...config, tools: [{ ...config.tools[0], effects: undefined }] }).reply('my bill please');
  assert.match(plain.messages[0].text, /No request is made in a simulation/);
});

test('a handoff changes who answers next', () => {
  const config = minimalConfig('a', 'A');
  config.agents.items = [
    {
      id: 'assistant',
      name: 'Front',
      instructions: { role: 'Route people.' },
      tools: [],
      handoffs: [{ id: 'h', tool: 'go_billing', description: 'When they ask about billing or invoices', to: 'billing' }],
    },
    { id: 'billing', name: 'Billing', instructions: { role: 'Answer billing questions.' }, tools: [] },
  ];
  const agent = createSimulatedAgent(config);
  const out = agent.reply('I have a question about my invoice');
  assert.equal(out.handoff, 'billing');
  assert.equal(agent.currentAgent, 'billing');
  assert.match(agent.reply('hello').messages[0].text, /Answer billing questions/);
});

test('it is deterministic: the same conversation gives the same replies', () => {
  const run = () => {
    const a = createSimulatedAgent(support());
    return [a.reply('hi').messages[0].text, a.reply('speak to a person').messages[0].text, a.reply('bye').messages[0].text];
  };
  assert.deepEqual(run(), run());
});
