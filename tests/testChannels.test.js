import test from 'node:test';
import assert from 'node:assert/strict';
import { testability } from '../src/studio/test/channels.js';

test('a browser can try web chat and web voice, not a phone line', () => {
  assert.deepEqual(testability(null), { state: 'unknown', phone: [] });
  assert.deepEqual(testability({ channels: [{ id: 'phone', type: 'sip_voice', enabled: true }] }), { state: 'none', phone: ['phone'] });
  assert.equal(testability({ channels: [] }).state, 'none');
  assert.equal(testability({}).state, 'none');
  assert.equal(testability({ channels: [{ id: 'web', type: 'web_chat' }] }).state, 'ok');
  assert.equal(testability({ channels: [{ id: 'v', type: 'web_voice', enabled: true }, { id: 'phone', type: 'sip_voice' }] }).state, 'ok');
  assert.equal(testability({ channels: [{ id: 'web', type: 'web_chat', enabled: false }] }).state, 'off');
  assert.equal(testability({ channels: [{ id: 'web', type: 'web_chat', enabled: false }, { id: 'v', type: 'web_voice' }] }).state, 'ok');
});
