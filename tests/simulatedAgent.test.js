import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulatedAgent } from '../src/demo/simulatedAgent.js';
import { applyStarter } from '../src/studio/starters.ts';
import { minimalConfig } from '../src/demo/demoApi.js';
import { setDetails, setHandOver } from '../src/studio/setup/setupModel.js';

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

// the agent a first-time user builds: requests on, a person to pass to with a number, documents to answer from
const clinic = () => {
  let config = applyStarter(minimalConfig('smile', 'Smile Dental'), 'appointment');
  config = setHandOver(setDetails(config, true, { fields: ['name', 'phone', 'need', 'when'] }), true, { number: '+6561234567' });
  return { ...config, knowledge: [{ id: 'knowledge', type: 'vector_store', mode: 'inject', sources: [] }] };
};

test('pain or an emergency goes to a person at once, put through when there is a number', () => {
  const agent = createSimulatedAgent(clinic());
  const out = agent.reply('I have really bad tooth pain');
  assert.deepEqual(
    out.toolCalls.map((c) => c.id),
    ['escalate_to_human'],
  );
  assert.match(out.messages[0].text, /^I’m sorry to hear that\. I’ll put you through to someone on the team now\./);
});

test('a booking is taken down detail by detail, keeping the day and time it was asked for', () => {
  const agent = createSimulatedAgent(clinic());
  const first = agent.reply('Can I book a check-up on Saturday morning?');
  assert.match(first.messages[0].text, /I can take that request for you\. Could I have your name/);
  assert.match(agent.reply('Sam Tan').messages[0].text, /phone number/);
  const done = agent.reply('91234567');
  assert.match(done.messages[0].text, /Thank you, Sam\. I’ve noted your request for Saturday morning\. Our team will confirm it/);
  assert.deepEqual(done.toolCalls[0].args, {
    need: 'Can I book a check-up on Saturday morning?',
    when: 'Saturday morning',
    name: 'Sam Tan',
    phone: '91234567',
  });
});

test('it answers from the line of its documents that fits the question, and says plainly what it is otherwise', () => {
  const agent = createSimulatedAgent(clinic());
  const hits = [{ text: 'Prices:\n- Check-up and consultation: S$45\n- Scale and polish (cleaning): S$90', source: 'smile-dental-info.txt', score: 0.4 }];
  assert.match(
    agent.reply('How much is a cleaning?', { hits }).messages[0].text,
    /^Scale and polish \(cleaning\): S\$90\. \(Simulated: found in smile-dental-info\.txt/,
  );
  assert.match(agent.reply('Do you sell bicycles?').messages[0].text, /simulated reply.*add the answer under What it knows/);
  assert.match(agent.reply('What can you do?').messages[0].text, /take a request for our team.*pass you to someone on the team.*answer questions/);
});

test('a document run together into one passage still gives the one line asked about, and everyday words find it', () => {
  const agent = createSimulatedAgent(clinic());
  const passage =
    'Address: 12 Orchard Road, Singapore 238826. Opening hours: Monday to Saturday, 9am to 6pm. Prices: - Check-up and consultation: S$45 - Scale and polish (cleaning): S$90 - X-ray: S$30 each';
  const hits = [{ text: passage, source: 'info.txt', score: 0.2 }];
  assert.match(agent.reply('How much is a cleaning?', { hits }).messages[0].text, /^Scale and polish \(cleaning\): S\$90\./);
  assert.match(agent.reply('Where are you located?', { hits }).messages[0].text, /^Address: 12 Orchard Road/);
  assert.match(agent.reply('When are you open?', { hits }).messages[0].text, /^Opening hours: Monday to Saturday/);
});
