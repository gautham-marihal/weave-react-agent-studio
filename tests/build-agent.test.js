import test from 'node:test';
import assert from 'node:assert/strict';
import { minimalConfig } from '../src/demo/minimalConfig.js';
import { applyStarter } from '../src/studio/starters.js';
import { greetingOf, greetingTarget, readSimple, setAgentName, setGreeting, shareGreeting } from '../src/studio/simple/simpleModel.js';
import { locate } from '../src/studio/newlayout/pages.js';

// The Agent page of the new layout: what it says first (one field for several channels), the name, and where its settings are found from elsewhere.
const twoChannels = () => {
  const config = applyStarter(minimalConfig('acme', 'Acme'), 'support');
  config.channels = [
    { id: 'web_chat', type: 'web_chat', greeting: { say: 'Hi there!' } },
    { id: 'phone', type: 'sip_voice', greeting: { say: 'Hi there!' } },
  ];
  return config;
};
const says = (config) => config.channels.map((c) => c.greeting?.say);

test('emptying what it says first takes the greeting out (an empty one is refused), and the channels then wait for the caller', () => {
  const empty = setGreeting(twoChannels(), '');
  assert.deepEqual(says(empty), [undefined, undefined]);
  assert.ok(!JSON.stringify(empty.channels).includes('"say":""'), 'no empty line is written');
  assert.equal(readSimple(empty).greeting, '');
  assert.deepEqual(greetingOf(empty).waiting, ['Web chat', 'Phone']);
});

test('emptied and typed again on one visit, the field writes to the channels it was for, and a fixed line is pointed at again', () => {
  const config = twoChannels();
  config.messages = [...(config.messages || []), { id: 'hello', text: 'Hello from Acme' }];
  config.channels.forEach((c) => (c.greeting.say = { message: 'hello' }));
  const target = greetingTarget(config);
  const typed = setGreeting(setGreeting(config, '', target), 'Welcome to Acme', target);
  assert.deepEqual(says(typed), [{ message: 'hello' }, { message: 'hello' }], 'still the fixed line');
  assert.equal(typed.messages.find((m) => m.id === 'hello').text, 'Welcome to Acme', 'with its new words');
});

test('a channel that says something else first keeps it; it is shown, and shared only when asked', () => {
  const config = twoChannels();
  config.channels[1].greeting.say = 'Thanks for calling Acme.';
  const target = greetingTarget(config);
  const typed = setGreeting(config, 'Hello!', target);
  assert.deepEqual(says(typed), ['Hello!', 'Thanks for calling Acme.']);
  const shown = greetingOf(typed, target);
  assert.deepEqual(shown.others, [{ name: 'Phone', text: 'Thanks for calling Acme.' }]);
  assert.deepEqual(says(shareGreeting(typed, target)), ['Hello!', 'Hello!'], '“Say this on Phone too”');
});

test('the name it introduces itself by follows the agent’s name, also after the name is emptied and typed again', () => {
  let config = twoChannels();
  config.meta.name = 'Acme';
  config.persona = { ...(config.persona || {}), name: 'Acme' };
  config = setAgentName(config, '');
  config = setAgentName(config, 'Sam');
  assert.equal(config.meta.name, 'Sam');
  assert.equal(config.persona.name, 'Sam', 'no stale or partial name is left');
  const own = setAgentName({ ...config, persona: { ...config.persona, name: 'Riley' } }, 'Acme Desk');
  assert.equal(own.persona.name, 'Riley', 'a name of its own is kept');
});

test('a setting asked for from elsewhere (search, “Show me”) opens where it is really asked', () => {
  assert.deepEqual(locate(['persona', 'tone']), { page: 'agent', drawer: 'behaviour' });
  assert.deepEqual(locate(['persona', 'style_rules', 0]), { page: 'agent', drawer: 'behaviour' });
  assert.deepEqual(locate(['persona', 'disclosures', 'recording_notice']), { page: 'aftercall', focus: 'notice' });
  assert.deepEqual(locate(['channels', 0, 'greeting', 'say']), { page: 'agent', focus: 'greeting' });
  assert.deepEqual(locate(['defaults', 'language', 'speaks']), { page: 'agent', drawer: 'language' });
});
