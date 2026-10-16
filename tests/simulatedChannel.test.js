import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseSimulatedChannel, isVoiceChannel } from '../src/studio/test/simulatedChannel.js';
import { createSimulatedAgent } from '../src/demo/simulatedAgent.js';

// UI review 2.10: a simulated conversation is typed text, so it is played on a text channel, and it never shows the phone line with a chat's face on it.
const phone = { id: 'phone', type: 'sip_voice', enabled: true, modalities: { input: ['audio'], output: ['audio'] } };
const chat = { id: 'web-chat', type: 'web_chat', enabled: true };
const config = (...channels) => ({
  persona: { disclosures: { recording_notice: 'This call may be recorded.' } },
  channels,
  agents: { entry: 'a', items: [{ id: 'a' }] },
});

test('a text channel is chosen before a voice one, whatever order they are in', () => {
  assert.deepEqual(chooseSimulatedChannel(config(phone, chat)), { id: 'web-chat', type: 'web_chat', voice: false });
  assert.deepEqual(chooseSimulatedChannel(config(chat, phone)), { id: 'web-chat', type: 'web_chat', voice: false });
  assert.equal(chooseSimulatedChannel(config(phone, { id: 'wa', type: 'whatsapp', enabled: true })).id, 'wa', 'any text channel beats a voice one');
});

test('a channel that is switched off is not chosen while another is on, and one that was asked for is used', () => {
  assert.equal(chooseSimulatedChannel(config({ ...chat, enabled: false }, phone)).id, 'phone', 'only the phone is on');
  assert.equal(chooseSimulatedChannel(config(chat, phone), 'phone').id, 'phone', 'asked for by name');
  assert.equal(chooseSimulatedChannel(config(chat, phone), 'nope').id, 'web-chat', 'an unknown name is ignored');
});

test('an agent with only voice channels is simulated on one, and the choice says it is a voice channel', () => {
  assert.deepEqual(chooseSimulatedChannel(config(phone)), { id: 'phone', type: 'sip_voice', voice: true });
  assert.equal(chooseSimulatedChannel(config()), null);
  assert.equal(isVoiceChannel({ id: 'x', type: 'custom', modalities: { output: ['audio'] } }), true, 'audio out makes it voice, whatever its type');
});

test('on the chat the greeting has no voice-only line, and on the phone it does (so the two are not mixed)', () => {
  const both = config(phone, chat);
  const on = (id) =>
    createSimulatedAgent(both, { channelId: id })
      .greeting()
      .map((m) => m.text)
      .join(' ');
  assert.doesNotMatch(on('web-chat'), /may be recorded/);
  assert.match(on('phone'), /may be recorded/);
  const chosen = chooseSimulatedChannel(both).id;
  assert.doesNotMatch(
    createSimulatedAgent(both, { channelId: chosen })
      .greeting()
      .map((m) => m.text)
      .join(' '),
    /may be recorded/,
    'what the simulation now plays by itself',
  );
});
