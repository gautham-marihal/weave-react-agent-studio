import test from 'node:test';
import assert from 'node:assert/strict';
import { describeRecords, enableRedaction, readDataFlow, readRecords, recordingNoticeState, sensitiveThings, setKeepTranscript, setLogDays, setLogEnabled, setRecordAudio, setRecordingDays } from '../src/studio/records/recordsModel.js';

// The decisions behind defaults, said in plain words: where conversations are processed, what is kept about each call, and whether callers are told.

test('where conversations are processed is named, by provider, with the stage each does', () => {
  const flow = readDataFlow({ defaults: { models: { stt: { provider: 'deepgram', model: 'nova-3' }, llm: { provider: 'openai', model: 'gpt-4.1-mini' }, tts: { provider: 'elevenlabs' } } } });
  assert.equal(flow.chosen, true);
  assert.match(flow.sentence, /^Conversations are processed by Deepgram, OpenAI and ElevenLabs\.$/);
  assert.deepEqual(flow.lines, ['Listening: Deepgram (nova-3)', 'Thinking: OpenAI (gpt-4.1-mini)', 'Speaking: ElevenLabs']);
  assert.equal(readDataFlow({ defaults: { models: { llm: { provider: 'openai' } } } }).sentence, 'Conversations are processed by OpenAI.');
});

test('the call summary’s model counts, and nothing chosen is said, not hidden', () => {
  const flow = readDataFlow({ defaults: { models: { llm: { provider: 'openai' } } }, post_call: { summary: { enabled: true, llm: { provider: 'anthropic', model: 'claude' } } } });
  assert.match(flow.sentence, /OpenAI and Anthropic/);
  assert.ok(flow.lines.includes('Call summaries: Anthropic (claude)'));
  const none = readDataFlow({});
  assert.equal(none.chosen, false);
  assert.match(none.sentence, /No AI services are chosen yet/);
});

test('what is kept is read with the schema’s defaults: the call log is on unless turned off', () => {
  assert.deepEqual({ ...readRecords({}), sensitive: undefined }, { logOn: true, logExplicit: false, logFull: false, logDays: null, audio: false, transcript: false, recordingDays: null, modelRequests: false, redactionOn: false, sensitive: undefined });
  assert.equal(readRecords({ observability: { session_log: { enabled: false } } }).logOn, false);
  assert.equal(readRecords({ observability: { session_log: { retention_days: 30, detail: 'full' } } }).logDays, 30);
  assert.equal(readRecords({ post_call: { redaction: { enabled: false } } }).redactionOn, false);
  assert.equal(readRecords({ post_call: { redaction: {} } }).redactionOn, true, 'redaction present and not switched off is on');
});

test('the records are described as sentences, honestly: it keeps what callers say and free speech is not hidden', () => {
  const d = describeRecords({});
  assert.match(d.lines[0], /A log of each call is kept\. It records what callers say, every tool that runs and every request to your systems\./);
  assert.match(d.lines[1], /kept until someone deletes them/);
  assert.match(d.lines.join(' '), /Other things a caller says are not hidden yet/);
  assert.deepEqual(d.problems, []);
  assert.equal(d.headline, 'Call log kept');
  const limited = describeRecords({ observability: { session_log: { retention_days: 1 } }, post_call: { recording: { audio: true, transcript: true, retention_days: 90 } } });
  assert.match(limited.lines.join(' '), /deleted after 1 day\./);
  assert.match(limited.lines.join(' '), /Audio is recorded and Transcripts are kept, for 90 days\./);
  assert.equal(limited.headline, 'Call log kept 1 day · recordings on');
  const off = describeRecords({ observability: { session_log: { enabled: false } } });
  assert.deepEqual(off.lines, ['No log of each call is kept.']);
});

test('things to look at: full model requests, and sensitive details that nothing hides', () => {
  const full = describeRecords({ observability: { log_llm_requests: true, session_log: { detail: 'full' } } });
  assert.equal(full.problems.length, 2);
  const config = { state: { variables: { pin: { type: 'string', sensitive: true } } }, guardrails: { input: [{ id: 'cards', type: 'pii_detect', entities: ['card_number'], enforcement: 'code', on_trigger: { action: 'redact_in_logs' } }] } };
  assert.deepEqual(sensitiveThings(config), ['the remembered value “pin” is marked sensitive', 'a check for card number in what the caller says']);
  assert.match(describeRecords(config).problems.join(' '), /handles sensitive details .* nothing hides them/);
  assert.deepEqual(describeRecords({ ...config, post_call: { redaction: { enabled: true } } }).problems, [], 'once redaction is on, there is nothing to warn about');
  assert.deepEqual(describeRecords({ ...config, observability: { session_log: { enabled: false } } }).problems, [], 'nothing is kept, so nothing to hide');
});

test('callers on a voice channel are told they may be recorded, or the gap is named', () => {
  const voice = { channels: [{ id: 'phone', type: 'sip_voice' }] };
  assert.deepEqual(recordingNoticeState(voice), { voice: true, told: false, keeps: true, missing: true });
  assert.equal(recordingNoticeState({ ...voice, persona: { disclosures: { recording_notice: '  ' } } }).missing, true, 'blank is not a notice');
  assert.equal(recordingNoticeState({ ...voice, persona: { disclosures: { recording_notice: 'Recorded.' } } }).missing, false);
  assert.equal(recordingNoticeState({ channels: [{ id: 'c', type: 'web_chat' }] }).missing, false);
  assert.equal(recordingNoticeState({ ...voice, channels: [{ id: 'phone', type: 'sip_voice', enabled: false }] }).voice, false, 'a channel that is off does not count');
  assert.equal(recordingNoticeState({ ...voice, observability: { session_log: { enabled: false } } }).missing, false, 'nothing is kept, so nothing to announce');
});

test('the setters write ordinary fields and leave the rest alone', () => {
  const base = { schema_version: '1.1', observability: { metrics: true }, post_call: { summary: { enabled: true } } };
  const off = setLogEnabled(base, false);
  assert.deepEqual(off.observability, { metrics: true, session_log: { enabled: false } });
  assert.equal(setLogEnabled(off, false), off, 'the same object when nothing changes');
  const days = setLogDays(off, '30');
  assert.equal(days.observability.session_log.retention_days, 30);
  assert.equal('retention_days' in setLogDays(days, '').observability.session_log, false, 'empty clears it');
  assert.equal('retention_days' in setLogDays(days, '0').observability.session_log, false, 'zero is not a retention');
  const rec = setRecordAudio(setKeepTranscript(base, true), true);
  assert.deepEqual(rec.post_call.recording, { transcript: true, audio: true });
  assert.deepEqual(rec.post_call.summary, { enabled: true });
  assert.equal(setRecordingDays(rec, 90).post_call.recording.retention_days, 90);
  assert.deepEqual(base.observability, { metrics: true }, 'the original is not touched');
});

test('turning redaction on names what the agent handles and raises the schema version it needs', () => {
  const config = { schema_version: '1.1', state: { variables: { pin: { type: 'string', sensitive: true } } }, guardrails: { output: [{ id: 'x', type: 'pii_detect', entities: ['national_id'], enforcement: 'code', on_trigger: { action: 'block' } }] } };
  const { config: next, raised } = enableRedaction(config);
  assert.equal(raised, true);
  assert.equal(next.schema_version, '1.2');
  assert.deepEqual(next.post_call.redaction, { enabled: true, entities: ['card_number', 'national_id', 'pin'] });
  const again = enableRedaction({ ...next });
  assert.equal(again.raised, false, 'already 1.2');
  assert.equal(readRecords(next).redactionOn, true);
});
