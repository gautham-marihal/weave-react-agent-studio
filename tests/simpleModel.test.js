import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStarter } from '../src/studio/starters.ts';
import { minimalConfig } from '../src/demo/demoApi.js';
import {
  BASE_LANGUAGES,
  entryAgentIndex,
  languageName,
  readSimple,
  setAgentName,
  setGreeting,
  setPrimaryLanguage,
  setRecordingNotice,
  setRole,
  setStyleRules,
  setTone,
  toggleSpoken,
} from '../src/studio/simple/simpleModel.js';

const base = () => applyStarter(minimalConfig('acme', 'Acme'), 'support');

test('the everyday settings are read out of the full configuration', () => {
  const read = readSimple(base());
  assert.equal(read.name, 'Acme');
  assert.match(read.role, /customer care agent/);
  assert.match(read.greeting, /How can I help you today/);
  assert.equal(read.agentId, 'assistant');
  assert.deepEqual(
    read.channels.map((c) => c.name),
    ['Web chat'],
  );
  assert.equal(read.voiceChannel, false);
  assert.ok(read.styleRules.length >= 1);
});

test('every setter changes only its own field and gives back the same object when nothing changes', () => {
  const config = base();
  assert.equal(setRole(config, readSimple(config).role), config);
  assert.equal(setTone(config, readSimple(config).tone), config);
  assert.equal(setGreeting(config, readSimple(config).greeting), config);
  assert.equal(setAgentName(config, 'Acme'), config);
  const next = setRole(config, 'You help with bills.');
  assert.equal(next.agents.items[0].instructions.role, 'You help with bills.');
  assert.equal(next.agents.items[0].instructions.opening, config.agents.items[0].instructions.opening, 'the rest of the instructions is kept');
  assert.deepEqual({ ...next, agents: null }, { ...config, agents: null });
  assert.equal(config.agents.items[0].instructions.role.startsWith('You are a customer care agent'), true, 'the input is not changed');
});

test('renaming the agent renames what it calls itself only while the two were the same', () => {
  const config = base();
  assert.equal(setAgentName(config, 'Bolt').persona.name, 'Bolt');
  const custom = { ...config, persona: { ...config.persona, name: 'Sam' } };
  const next = setAgentName(custom, 'Bolt');
  assert.equal(next.meta.name, 'Bolt');
  assert.equal(next.persona.name, 'Sam');
});

test('the greeting is changed where it is written: on the channel, or in the message it points at', () => {
  const config = base();
  assert.equal(setGreeting(config, 'Hi!').channels[0].greeting.say, 'Hi!');
  const ref = {
    ...config,
    channels: [{ ...config.channels[0], greeting: { say: { message: 'hello' } } }],
    messages: [...config.messages, { id: 'hello', text: 'Old' }],
  };
  const next = setGreeting(ref, 'New');
  assert.equal(next.messages.find((m) => m.id === 'hello').text, 'New');
  assert.deepEqual(next.channels[0].greeting.say, { message: 'hello' });
  assert.equal(readSimple(ref).greetingIsReference, true);
  const langs = {
    ...ref,
    defaults: { ...ref.defaults, language: { primary: 'en-US', speaks: ['en', 'es'] } },
    messages: [{ id: 'hello', text: { en: 'Hello', es: 'Hola' } }],
  };
  assert.deepEqual(setGreeting(langs, 'Howdy').messages[0].text, { en: 'Howdy', es: 'Hola' }, 'only the primary language’s text');
});

test('tone, style rules and the recording notice are added and removed cleanly', () => {
  const config = base();
  assert.equal(setTone(config, '').persona.tone, undefined);
  assert.deepEqual(setStyleRules(config, ['A', 'B']).persona.style_rules, ['A', 'B']);
  assert.equal('style_rules' in setStyleRules(config, []).persona, false);
  const noted = setRecordingNotice(config, 'Calls are recorded.');
  assert.equal(noted.persona.disclosures.recording_notice, 'Calls are recorded.');
  assert.equal('disclosures' in setRecordingNotice(noted, '').persona, false);
});

test('the primary language also makes its base language spoken, first; the primary can’t be switched off', () => {
  const config = base();
  const es = setPrimaryLanguage(config, 'es-MX');
  assert.equal(es.defaults.language.primary, 'es-MX');
  assert.deepEqual(es.defaults.language.speaks, ['es']);
  const more = toggleSpoken(es, 'en', true);
  assert.deepEqual(more.defaults.language.speaks, ['es', 'en']);
  assert.deepEqual(toggleSpoken(more, 'en', false).defaults.language.speaks, ['es']);
  assert.deepEqual(toggleSpoken(more, 'es', false).defaults.language.speaks, ['en', 'es'], 'es stays: it is the primary language');
  assert.deepEqual(setPrimaryLanguage(more, 'fr-FR').defaults.language.speaks, ['fr', 'es', 'en']);
  assert.equal(languageName('pt-BR'), 'Portuguese (Brazil)');
  assert.equal(languageName('es-CO'), 'Spanish');
  assert.ok(BASE_LANGUAGES.some((l) => l.code === 'en') && BASE_LANGUAGES.filter((l) => l.code === 'en').length === 1);
});

test('the agent that answers first is a real agent: a null or half-typed item is never chosen', () => {
  assert.equal(entryAgentIndex({ agents: { items: [null, { id: 'a' }] } }), 1);
  assert.equal(entryAgentIndex({ agents: { entry: 'b', items: [null, { id: 'a' }, { id: 'b' }] } }), 2);
  assert.equal(entryAgentIndex({ agents: { items: [null] } }), -1, 'no agent to write into');
});
