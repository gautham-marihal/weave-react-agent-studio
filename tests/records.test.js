import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeRecords,
  enableRedaction,
  readDataFlow,
  readRecords,
  recordingNoticeState,
  sensitiveThings,
  setKeepTranscript,
  setLogDays,
  setLogEnabled,
  setRecordAudio,
  setRecordingDays,
} from '../src/studio/records/recordsModel.js';

// The decisions behind defaults, said in plain words: where conversations are processed, what is kept about each call, and whether callers are told.

test('where conversations are processed is named, by provider, with the stage each does', () => {
  const flow = readDataFlow({
    defaults: {
      models: { stt: { provider: 'deepgram', model: 'nova-3' }, llm: { provider: 'openai', model: 'gpt-4.1-mini' }, tts: { provider: 'elevenlabs' } },
    },
  });
  assert.equal(flow.chosen, true);
  assert.match(flow.sentence, /^Conversations are processed by Deepgram, OpenAI and ElevenLabs\.$/);
  assert.deepEqual(flow.lines, ['Listening: Deepgram (nova-3)', 'Thinking: OpenAI (gpt-4.1-mini)', 'Speaking: ElevenLabs']);
  assert.equal(readDataFlow({ defaults: { models: { llm: { provider: 'openai' } } } }).sentence, 'Conversations are processed by OpenAI.');
});

test('the call summary’s model counts, and nothing chosen is said, not hidden', () => {
  const flow = readDataFlow({
    defaults: { models: { llm: { provider: 'openai' } } },
    post_call: { summary: { enabled: true, llm: { provider: 'anthropic', model: 'claude' } } },
  });
  assert.match(flow.sentence, /OpenAI and Anthropic/);
  assert.ok(flow.lines.includes('Call summaries: Anthropic (claude)'));
  const none = readDataFlow({});
  assert.equal(none.chosen, false);
  assert.match(none.sentence, /No AI services are chosen yet/);
});

test('what is kept is read with the schema’s defaults: the call log is on unless turned off', () => {
  assert.deepEqual(
    { ...readRecords({}), sensitive: undefined },
    {
      logOn: true,
      logExplicit: false,
      logFull: false,
      logDays: null,
      audio: false,
      transcript: false,
      recordingDays: null,
      modelRequests: false,
      redactionOn: false,
      sensitive: undefined,
    },
  );
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
  const limited = describeRecords({
    observability: { session_log: { retention_days: 1 } },
    post_call: { recording: { audio: true, transcript: true, retention_days: 90 } },
  });
  assert.match(limited.lines.join(' '), /deleted after 1 day\./);
  assert.match(limited.lines.join(' '), /Audio is recorded and Transcripts are kept, for 90 days\./);
  assert.equal(limited.headline, 'Call log kept 1 day · recordings on');
  const off = describeRecords({ observability: { session_log: { enabled: false } } });
  assert.deepEqual(off.lines, ['No log of each call is kept.']);
});

test('things to look at: full model requests, and sensitive details that nothing hides', () => {
  const full = describeRecords({ observability: { log_llm_requests: true, session_log: { detail: 'full' } } });
  assert.equal(full.problems.length, 2);
  const config = {
    state: { variables: { pin: { type: 'string', sensitive: true } } },
    guardrails: { input: [{ id: 'cards', type: 'pii_detect', entities: ['card_number'], enforcement: 'code', on_trigger: { action: 'redact_in_logs' } }] },
  };
  assert.deepEqual(sensitiveThings(config), ['the remembered value “pin” is marked sensitive', 'a check for card number in what the caller says']);
  assert.match(describeRecords(config).problems.join(' '), /handles sensitive details .* nothing hides them/);
  assert.deepEqual(
    describeRecords({ ...config, post_call: { redaction: { enabled: true } } }).problems,
    [],
    'once redaction is on, there is nothing to warn about',
  );
  assert.deepEqual(describeRecords({ ...config, observability: { session_log: { enabled: false } } }).problems, [], 'nothing is kept, so nothing to hide');
});

test('callers on a voice channel are told they may be recorded, or the gap is named', () => {
  const voice = { channels: [{ id: 'phone', type: 'sip_voice' }] };
  assert.deepEqual(recordingNoticeState(voice), { voice: true, told: false, keeps: true, missing: true });
  assert.equal(recordingNoticeState({ ...voice, persona: { disclosures: { recording_notice: '  ' } } }).missing, true, 'blank is not a notice');
  assert.equal(recordingNoticeState({ ...voice, persona: { disclosures: { recording_notice: 'Recorded.' } } }).missing, false);
  assert.equal(recordingNoticeState({ channels: [{ id: 'c', type: 'web_chat' }] }).missing, false);
  assert.equal(
    recordingNoticeState({ ...voice, channels: [{ id: 'phone', type: 'sip_voice', enabled: false }] }).voice,
    false,
    'a channel that is off does not count',
  );
  assert.equal(
    recordingNoticeState({ ...voice, observability: { session_log: { enabled: false } } }).missing,
    false,
    'nothing is kept, so nothing to announce',
  );
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
  const config = {
    schema_version: '1.1',
    state: { variables: { pin: { type: 'string', sensitive: true } } },
    guardrails: { output: [{ id: 'x', type: 'pii_detect', entities: ['national_id'], enforcement: 'code', on_trigger: { action: 'block' } }] },
  };
  const { config: next, raised } = enableRedaction(config);
  assert.equal(raised, true);
  assert.equal(next.schema_version, '1.2');
  assert.deepEqual(next.post_call.redaction, { enabled: true, entities: ['card_number', 'national_id', 'pin'] });
  const again = enableRedaction({ ...next });
  assert.equal(again.raised, false, 'already 1.2');
  assert.equal(readRecords(next).redactionOn, true);
});

// ---- what is said about records follows what the server says the runtime does (UI review 2.1) -------------------------------------------------
const LOGGED = { post_call: { redaction: { enabled: true, entities: ['email'] }, recording: { audio: true, transcript: true } } };
const NOT_REDACTED = { feature: 'post_call.redaction: declared, but NOT yet enforced', where: 'post_call.redaction', severity: 'security' };
const NOT_RECORDED = { feature: 'call recording settings', where: 'post_call.recording' };
const OTHER_SECURITY = {
  feature: 'input guardrails on a realtime (speech-to-speech) model: the rules are not checked there',
  where: 'agents.items[3].overrides.models.realtime',
  severity: 'security',
};
const said = (config, unsupported) => describeRecords(config, { unsupported }).lines.join(' | ');

test('when the server says redaction is not applied, nothing says text is replaced, and a problem says it is not', () => {
  const d = describeRecords(LOGGED, { unsupported: [NOT_REDACTED] });
  assert.equal(d.notApplied.redaction, true);
  assert.match(d.lines.join(' '), /Redaction is set up, but the runtime does not apply it yet: saved transcripts still contain everything that was said/);
  assert.doesNotMatch(d.lines.join(' '), /replaced/);
  assert.match(d.problems.join(' '), /Redaction is declared but the runtime does not apply it/);
});

test('when the server enforces redaction (it lists nothing), the sentence is the true one: callers’ words reach the AI, a sensitive variable’s exact value does not', () => {
  const d = describeRecords(LOGGED, { unsupported: [] });
  assert.equal(d.notApplied.redaction, false);
  assert.match(
    d.lines.join(' '),
    /Sensitive text is replaced in saved transcripts and metrics\. What a caller says still reaches the AI during the call; only the exact value of a sensitive variable is kept from it once stored\./,
  );
  assert.deepEqual(
    d.problems.filter((p) => /Redaction/.test(p)),
    [],
  );
  assert.equal(said(LOGGED), said(LOGGED, []), 'without a list from the server it is the same as an empty one');
});

test('another security item is not mistaken for the redaction one: it is matched by what it names', () => {
  const d = describeRecords(LOGGED, { unsupported: [OTHER_SECURITY] });
  assert.equal(d.notApplied.redaction, false);
  assert.match(d.lines.join(' '), /Sensitive text is replaced/);
});

test('redaction that is not switched on is never reported as not applied, whatever the server lists', () => {
  const d = describeRecords({ observability: { session_log: { enabled: true } } }, { unsupported: [NOT_REDACTED] });
  assert.equal(d.notApplied.redaction, false);
  assert.doesNotMatch(d.lines.join(' '), /Redaction is set up/);
});

test('recording settings the runtime does not apply are not described as done', () => {
  const d = describeRecords(LOGGED, { unsupported: [NOT_RECORDED] });
  assert.equal(d.notApplied.recording, true);
  assert.match(d.lines.join(' '), /Recording is set up, but the runtime does not apply those settings yet/);
  assert.doesNotMatch(d.lines.join(' '), /Audio is recorded|Transcripts are kept/);
  assert.doesNotMatch(d.headline, /recordings on/);
  assert.match(said(LOGGED, []), /Audio is recorded and Transcripts are kept/, 'and when it is applied, it says so as before');
});
