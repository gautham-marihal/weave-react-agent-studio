import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captionOf,
  speakingEndsAt,
  speakingMs,
  speaksOnly,
  voiceBadge,
  voiceStateOf,
  voiceWords,
  withWrittenReplies,
} from '../src/studio/preview/voiceState.js';

// The voice view of a conversation (src/studio/preview/voiceState.js): which state the orb shows, and its words.

const bot = (text, at, final = true) => ({ id: `b${at}`, role: 'bot', text, at, final });
const you = (text, at) => ({ id: `u${at}`, role: 'user', text, at, final: true });

test('the call’s progress comes first', () => {
  assert.equal(voiceStateOf({ status: 'idle' }), 'idle');
  assert.equal(voiceStateOf({ status: 'starting' }), 'connecting');
  assert.equal(voiceStateOf({ status: 'connecting' }), 'connecting');
  assert.equal(voiceStateOf({ status: 'waiting' }), 'joining');
  assert.equal(voiceStateOf({ status: 'live', reconnecting: true, agentState: 'speaking' }), 'connecting');
  assert.equal(voiceStateOf({ status: 'error' }), 'error');
  assert.equal(voiceStateOf({ status: 'ended' }), 'ended');
});

test('a real agent’s own word wins over what the lines suggest', () => {
  const messages = [you('hello', 1)];
  assert.equal(voiceStateOf({ status: 'live', agentState: 'speaking', messages }), 'speaking');
  assert.equal(voiceStateOf({ status: 'live', agentState: 'listening', messages }), 'listening');
  assert.equal(voiceStateOf({ status: 'live', agentState: 'initializing', messages }), 'thinking', 'an unknown word is ignored');
});

test('without it, the last line says: coming in or just said is speaking, yours is thinking, else listening', () => {
  const now = 100000;
  assert.equal(voiceStateOf({ status: 'live', messages: [] }, now), 'listening');
  assert.equal(voiceStateOf({ status: 'live', messages: [bot('Hi', now - 50, false)] }, now), 'speaking');
  assert.equal(voiceStateOf({ status: 'live', messages: [bot('Hi there', now - 500)] }, now), 'speaking');
  assert.equal(voiceStateOf({ status: 'live', messages: [bot('Hi there', now - 9000)] }, now), 'listening');
  assert.equal(voiceStateOf({ status: 'live', messages: [bot('Hi', 1), you('help', now)] }, now), 'thinking');
  const system = { id: 's', role: 'system', text: 'Note', final: true, at: now };
  assert.equal(voiceStateOf({ status: 'live', messages: [you('help', now), system] }, now), 'thinking', 'notes are not lines');
});

test('a simulated reply is spoken for a time that follows its length, within limits', () => {
  assert.equal(speakingMs(''), 1200);
  assert.equal(speakingMs('x'.repeat(40)), 2200);
  assert.equal(speakingMs('x'.repeat(1000)), 6000);
  assert.equal(speakingEndsAt({ messages: [bot('x'.repeat(40), 1000)] }), 3200);
  assert.equal(speakingEndsAt({ agentState: 'speaking', messages: [bot('x', 1000)] }), null, 'a real agent says when it stops');
  assert.equal(speakingEndsAt({ messages: [you('x', 1000)] }), null);
});

test('the words, the badge and the captions', () => {
  assert.deepEqual(voiceWords('listening'), { title: 'Listening', detail: 'Go ahead, the agent is listening.' });
  assert.deepEqual(voiceWords('error', { error: { title: 'Couldn’t start', body: 'No channel web_voice.' } }), {
    title: 'Connection error',
    detail: 'No channel web_voice.',
  });
  assert.equal(voiceWords('connecting', { reconnecting: true }).title, 'Reconnecting…');
  assert.deepEqual(voiceBadge('error'), { text: 'Error', tone: 'bad' });
  assert.deepEqual(voiceBadge('speaking'), { text: 'Live', tone: 'live' });
  assert.equal(captionOf([]), null);
  assert.deepEqual(captionOf([bot('Hello', 1), you('Hi', 2)]), { who: 'You', text: 'Hi', final: true });
  assert.deepEqual(captionOf([bot('Hel', 1, false)]), { who: 'Agent', text: 'Hel', final: false });
});

test('a voice channel that only speaks gets no captions, and writing its replies out keeps the rest as it was', () => {
  const spoken = { id: 'web-voice', type: 'web_voice', modalities: { input: ['audio'], output: ['audio'] } };
  assert.equal(speaksOnly(spoken), true);
  assert.equal(speaksOnly({ id: 'v', type: 'web_voice' }), true, 'no modalities is the default: speech only');
  assert.equal(speaksOnly({ ...spoken, modalities: { input: ['audio'], output: ['audio', 'text'] } }), false);
  assert.equal(speaksOnly({ id: 'c', type: 'web_chat', modalities: { input: ['text'], output: ['text'] } }), false);
  const chat = { id: 'web-chat', type: 'web_chat', modalities: { input: ['text'], output: ['text'] } };
  const config = { schema_version: '1.1', channels: [spoken, chat, { id: 'v2', type: 'web_voice' }] };
  const next = withWrittenReplies(config, 'web-voice');
  assert.deepEqual(next.channels[0].modalities, { input: ['audio'], output: ['audio', 'text'] });
  assert.equal(next.channels[1], chat, 'other channels are untouched');
  assert.equal(next.channels[2], config.channels[2]);
  assert.deepEqual(withWrittenReplies(config, 'v2').channels[2].modalities, { input: ['audio'], output: ['audio', 'text'] });
  assert.equal(config.channels[0].modalities.output.length, 1, 'the configuration given is not changed');
});
