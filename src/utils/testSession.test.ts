import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import {
  disconnectReasonText,
  isAgentParticipant,
  micErrorMessage,
  modelStageCheck,
  roomConnectError,
  sessionStartError,
  traceFromRecord,
  testability,
  channelInputs,
  pictureProblem,
  toolsUsedIn,
  finalStateOf,
} from './testSession';

describe('disconnectReasonText', () => {
  it('says the agent ended it when the room is deleted, as a normal end', () => {
    expect(disconnectReasonText(5)).toMatchObject({ name: 'ROOM_DELETED', text: 'The agent ended the conversation.', error: false });
  });

  it('treats a duplicate identity, a shutdown and a join failure as errors with their own words', () => {
    const texts = [2, 3, 7].map((r) => disconnectReasonText(r));
    expect(texts.map((t) => t.name)).toEqual(['DUPLICATE_IDENTITY', 'SERVER_SHUTDOWN', 'JOIN_FAILURE']);
    expect(texts.every((t) => t.error)).toBe(true);
    expect(new Set(texts.map((t) => t.text)).size).toBe(3);
  });

  it('never returns an empty reason', () => {
    expect(disconnectReasonText(undefined).text).toMatch(/without a reason/);
    expect(disconnectReasonText(99)).toMatchObject({ name: 'REASON_99', error: true });
  });
});

describe('sessionStartError', () => {
  const err = (status: number, kind: ApiError['kind'], message: string, errors: { path: string[]; message: string }[] = []) =>
    new ApiError({ status, kind, message, errors });

  it('keeps LiveKit env var names out of the 503 message and in the trace detail', () => {
    const out = sessionStartError(err(503, 'unavailable', 'LiveKit is not configured'));
    expect(out.message).toMatch(/not set up for test conversations/);
    expect(out.message).not.toMatch(/LIVEKIT_/);
    expect(out.detail).toMatch(/LIVEKIT_API_KEY/);
  });

  it('shows the server’s own errors for a 422', () => {
    const out = sessionStartError(err(422, 'invalid', 'cannot run draft', [{ path: ['channels'], message: 'no web channel' }]));
    expect(out.message).toBe('The server can’t run this draft yet: no web channel');
    expect(sessionStartError(err(422, 'invalid', 'this bot has no web channel')).message).toMatch(/no web channel/);
  });

  it('gives 404, 401, network and an unresponsive server distinct messages', () => {
    const messages = [
      sessionStartError(err(404, 'not_found', 'no such bot')).message,
      sessionStartError(err(401, 'auth', 'bad key')).message,
      sessionStartError(err(0, 'network', 'Could not reach the Agent Builder API.')).message,
      sessionStartError(err(502, 'network', 'The Agent Builder API is not responding.')).message,
      sessionStartError(err(503, 'unavailable', 'x')).message,
    ];
    expect(new Set(messages).size).toBe(messages.length);
    expect(messages[2]).toMatch(/Could not reach/);
    expect(messages[3]).toMatch(/HTTP 502/);
  });

  it('copes with something that is not an API error', () => {
    expect(sessionStartError(new Error('boom'))).toEqual({ message: 'The test conversation could not start.', detail: 'boom' });
  });
});

describe('roomConnectError', () => {
  it('reads LiveKit’s connection error reasons', () => {
    expect(roomConnectError({ reason: 0, message: 'unauthorized' }).message).toMatch(/refused the join token/);
    expect(roomConnectError({ reason: 1, message: 'unreachable' }).message).toMatch(/Could not reach the LiveKit server/);
    expect(roomConnectError(new Error('x')).detail).toBe('LiveKit connect failed: x');
  });
});

describe('micErrorMessage', () => {
  it('names the fix for a blocked, missing or busy microphone', () => {
    expect(micErrorMessage({ name: 'NotAllowedError', message: 'Permission denied' })).toMatch(/blocked/);
    expect(micErrorMessage({ name: 'NotFoundError' })).toMatch(/No microphone/);
    expect(micErrorMessage({ name: 'NotReadableError' })).toMatch(/busy/);
    expect(micErrorMessage(new Error('odd'))).toBe('The microphone could not be turned on: odd');
  });
});

describe('modelStageCheck', () => {
  // As GET /providers lists them.
  const providers = [
    { name: 'deepgram', stages: ['stt'], installed: true, key_available: false, default_secret: 'DEEPGRAM_API_KEY' },
    { name: 'openai', stages: ['stt', 'llm', 'tts'], installed: true, key_available: true, default_secret: 'OPENAI_API_KEY' },
    { name: 'cartesia', stages: ['tts'], installed: false, key_available: false, default_secret: 'CARTESIA_API_KEY' },
  ];

  it('passes a set, installed and keyed provider and model', () => {
    expect(modelStageCheck('stt', { provider: 'openai', model: 'gpt-4o-mini-transcribe' }, providers).status).toBe('pass');
  });

  it('fails a missing provider, a missing model, a missing key or an uninstalled provider', () => {
    expect(modelStageCheck('tts', undefined, providers)).toMatchObject({ status: 'fail', detail: 'No text-to-speech provider is set.' });
    expect(modelStageCheck('tts', { provider: 'openai' }, providers).detail).toMatch(/no model is set/);
    expect(modelStageCheck('stt', { provider: 'deepgram', model: 'nova-3' }, providers)).toMatchObject({ status: 'fail', fix: 'Ask the server admin to set DEEPGRAM_API_KEY.' });
    expect(modelStageCheck('tts', { provider: 'cartesia', model: 'sonic' }, providers).detail).toMatch(/not installed/);
    expect(modelStageCheck('tts', { provider: 'deepgram', model: 'aura' }, providers).detail).toMatch(/does not offer/);
  });
});

describe('isAgentParticipant', () => {
  const AGENT = 4;
  it('uses isAgent, then kind, then accepts anyone', () => {
    expect(isAgentParticipant({ isAgent: false, kind: AGENT }, AGENT)).toBe(false);
    expect(isAgentParticipant({ kind: AGENT }, AGENT)).toBe(true);
    expect(isAgentParticipant({ kind: 0 }, AGENT)).toBe(false);
    expect(isAgentParticipant({}, AGENT)).toBe(true);
  });
});

describe('traceFromRecord', () => {
  // Shapes copied from real call logs (GET /bots/{id}/calls/{call}).
  it('maps what was said', () => {
    expect(traceFromRecord({ seq: 5, event: 'user_said', text: 'Hello' })).toEqual({ kind: 'session', label: 'Caller said', detail: 'Hello', status: 'info' });
    expect(traceFromRecord({ seq: 6, event: 'agent_said', text: 'Hi!', interrupted: false })).toMatchObject({ kind: 'agent', detail: 'Hi!' });
  });

  it('maps a tool call with its arguments, result and duration', () => {
    const t = traceFromRecord({ event: 'tool_called', tool: 'check_code', arguments: { code: '[REDACTED]' }, output: 'not accepted', error: false, duration_ms: 666 });
    expect(t).toEqual({ kind: 'tool', label: 'check_code', detail: 'args {"code":"[REDACTED]"} · result not accepted · 666 ms', status: 'ok' });
    expect(traceFromRecord({ event: 'tool_called', tool: 'x', arguments: {}, error: 'timeout' })?.status).toBe('error');
  });

  it('maps an HTTP request to method, path, status and ms', () => {
    expect(traceFromRecord({ event: 'http_request', connection: 'core', method: 'POST', path: '/login', status: 200, ok: true, ms: 659 })).toEqual({
      kind: 'tool',
      label: 'POST · /login',
      detail: 'status 200 · 659 ms · core',
      status: 'ok',
    });
    expect(traceFromRecord({ event: 'http_request', method: 'GET', path: '/x', status: 500, ok: false })?.status).toBe('error');
  });

  it('maps searches, state, handoffs, errors and the end', () => {
    expect(traceFromRecord({ event: 'knowledge_search', query: 'fees', results: [{}, {}] })).toMatchObject({ kind: 'tool', detail: '“fees” · 2 results' });
    expect(traceFromRecord({ event: 'state_changed', variable: 'disposition', previous: 'completed', value: 'abandoned' })).toMatchObject({
      kind: 'agent',
      label: 'disposition changed',
      detail: 'completed → abandoned',
    });
    expect(traceFromRecord({ event: 'handoff', from: 'front_desk', to: 'cards' })).toMatchObject({ kind: 'handoff', label: 'Handed over to cards' });
    expect(traceFromRecord({ event: 'error', message: 'TTS failed' })).toEqual({ kind: 'error', label: 'Error', detail: 'TTS failed', status: 'error' });
    expect(traceFromRecord({ event: 'session_closed', reason: 'user_initiated', error: null })).toMatchObject({ kind: 'end', detail: 'user_initiated', status: 'info' });
    expect(traceFromRecord({ event: 'model_request', model: 'gpt-4.1-mini', messages: 3, tools: ['a', 'b'] })).toMatchObject({ kind: 'llm' });
  });

  it('reads `event` before `kind`, skips artifacts and junk, and shows unknown records by name', () => {
    expect(traceFromRecord({ event: 'artifact', kind: 'transcript' })).toBeNull();
    expect(traceFromRecord(null)).toBeNull();
    expect(traceFromRecord({ seq: 1 })).toBeNull();
    expect(traceFromRecord({ kind: 'user_said', text: 'hey' })).toMatchObject({ label: 'Caller said' });
    expect(traceFromRecord({ seq: 9, t: 'x', event: 'inactivity', step: 'nudge' })).toEqual({ kind: 'agent', label: 'inactivity', detail: '{"step":"nudge"}', status: 'info' });
  });
});

describe('what a browser can try', () => {
  it('web chat and web voice, not a phone line', () => {
    expect(testability(null)).toEqual({ state: 'unknown', phone: [] });
    expect(testability({ channels: [{ id: 'phone', type: 'sip_voice', enabled: true }] })).toEqual({ state: 'none', phone: ['phone'] });
    expect(testability({ channels: [] }).state).toBe('none');
    expect(testability({}).state).toBe('none');
    expect(testability({ channels: [{ id: 'web', type: 'web_chat' }] }).state).toBe('ok');
    expect(testability({ channels: [{ id: 'v', type: 'web_voice', enabled: true }, { id: 'phone', type: 'sip_voice' }] }).state).toBe('ok');
    expect(testability({ channels: [{ id: 'web', type: 'web_chat', enabled: false }] }).state).toBe('off');
    expect(testability({ channels: [{ id: 'web', type: 'web_chat', enabled: false }, { id: 'v', type: 'web_voice' }] }).state).toBe('ok');
  });

  it('offers pictures, a camera and screen sharing only when the session’s channel takes them', () => {
    expect(channelInputs({ input: ['text'] })).toEqual({ image: false, video: false });
    expect(channelInputs({ input: ['audio', 'text', 'image', 'video'] })).toEqual({ image: true, video: true });
    expect(channelInputs(null)).toEqual({ image: false, video: false });
  });

  it('checks a picture against the channel’s limits', () => {
    expect(pictureProblem({ size: 10, type: 'image/png' }, { acceptedMime: ['image/png'], maxBytes: 100 })).toBe('');
    expect(pictureProblem({ size: 3 * 1048576, type: 'image/png' }, { maxBytes: 1048576 })).toMatch(/3\.0 MB; this channel allows 1\.0 MB/);
    expect(pictureProblem({ size: 10, type: 'image/gif' }, { acceptedMime: ['image/png', 'image/jpeg'] })).toMatch(/accepts image\/png, image\/jpeg/);
  });
});

describe('sessionStartError for a version or an environment, and for a channel not offered', () => {
  const err = (status: number, kind: ApiError['kind'], message: string) => new ApiError({ status, kind, message, errors: [] });

  it('says nothing is live there, instead of “no saved draft”', () => {
    expect(sessionStartError(err(404, 'not_found', 'nothing deployed'), 'staging').message).toMatch(/Nothing is live in “staging” yet/);
    expect(sessionStartError(err(404, 'not_found', 'no versions'), 'latest').message).toMatch(/no published version/);
    expect(sessionStartError(err(404, 'not_found', 'no draft')).message).toMatch(/no saved draft/);
  });

  it('shows the server’s list of channels a browser can try', () => {
    const out = sessionStartError(err(422, 'invalid', "channel 'phone' is not offered to browsers (offered: web-chat, web-voice)"));
    expect(out.message).toMatch(/can’t be tried in a browser: .*offered: web-chat, web-voice/);
  });
});

describe('what a conversation showed', () => {
  const records = [
    { event: 'agent_said', text: 'Hi' },
    { event: 'tool_called', tool: 'find_order', args: {} },
    { event: 'state_changed', variable: 'verified', previous: false, value: true },
    { event: 'tool_called', name: 'end_call' },
    { event: 'state_changed', variable: 'verified', previous: true, value: 'yes' },
  ];
  it('lists the tools used and the state at the end', () => {
    expect(toolsUsedIn(records)).toEqual(['find_order', 'end_call']);
    expect(finalStateOf(records)).toEqual({ verified: 'yes' });
    expect(toolsUsedIn([null, 3, 'x'])).toEqual([]);
  });
});
