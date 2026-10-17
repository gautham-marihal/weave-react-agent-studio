import test from 'node:test';
import assert from 'node:assert/strict';
import { testability } from '../src/studio/test/channels.js';

test('a browser can try web chat and web voice, not a phone line', () => {
  assert.deepEqual(testability(null), { state: 'unknown', phone: [] });
  assert.deepEqual(testability({ channels: [{ id: 'phone', type: 'sip_voice', enabled: true }] }), { state: 'none', phone: ['phone'] });
  assert.equal(testability({ channels: [] }).state, 'none');
  assert.equal(testability({}).state, 'none');
  assert.equal(testability({ channels: [{ id: 'web', type: 'web_chat' }] }).state, 'ok');
  assert.equal(
    testability({
      channels: [
        { id: 'v', type: 'web_voice', enabled: true },
        { id: 'phone', type: 'sip_voice' },
      ],
    }).state,
    'ok',
  );
  assert.equal(testability({ channels: [{ id: 'web', type: 'web_chat', enabled: false }] }).state, 'off');
  assert.equal(
    testability({
      channels: [
        { id: 'web', type: 'web_chat', enabled: false },
        { id: 'v', type: 'web_voice' },
      ],
    }).state,
    'ok',
  );
});

test('a server that can’t start sessions says what to do, and keeps its technical words for the person who runs it', async () => {
  const { describeStartError } = await import('../src/studio/test/useLiveSession.js');
  const out = describeStartError(
    { kind: 'unavailable', message: 'this server has no LiveKit credentials (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET), so it cannot start sessions' },
    'draft',
  );
  assert.equal(out.title, 'Live conversations aren’t set up on this server yet');
  assert.doesNotMatch(`${out.title} ${out.body}`, /LIVEKIT|LiveKit|credentials/, 'nothing a customer reads names a server setting');
  assert.match(out.body, /Ask whoever runs the server/);
  assert.match(out.body, /simulated preview/);
  assert.match(out.details, /LIVEKIT_URL/, 'the detail is kept, one click away');
});

test('a channel the agent does not offer to browsers shows the server’s list of the ones it does, not “no web channel”', async () => {
  const { describeStartError } = await import('../src/studio/test/useLiveSession.js');
  const out = describeStartError(
    { kind: 'invalid', errors: [], message: "channel 'phone' is not offered to browsers (offered: web-chat, web-voice)" },
    'draft',
  );
  assert.equal(out.title, 'That channel can’t be tried in a browser');
  assert.match(out.body, /offered: web-chat, web-voice/);
  const none = describeStartError({ kind: 'invalid', errors: [], message: 'this agent has no web channel' }, 'draft');
  assert.equal(none.title, 'This agent can’t be tried in a browser', 'the old message still stands for an agent with none');
});
