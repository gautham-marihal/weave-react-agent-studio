// The decisions that sit behind defaults and that a customer should be told about in plain words: where conversations are processed, what is
// kept about each call and for how long, whether callers are told they may be recorded, and whether sensitive details are hidden. Each is
// read from the configuration and written back as an ordinary field, so the Simple view, the form, the JSON and the release page agree.
// The wording follows what the schema says the runtime does; where the schema says something is not applied yet, so does this.
// Pure: no network, no DOM.

import { isObj } from '../form/engine.js';
import { providerLabel } from '../models/catalog.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const list = (v) => (Array.isArray(v) ? v : []);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
function edit(config, change) {
  const next = clone(config);
  change(next);
  return same(next, config) ? config : next;
}

// ---- where conversations are processed ------------------------------------------------------------------------------------------------------
const STAGE_WORDS = { stt: 'Listening', llm: 'Thinking', tts: 'Speaking', realtime: 'Speech-to-speech' };

// The AI services a conversation passes through, and one sentence naming them. A stage with no provider chosen uses the server's default,
// which is said, not hidden.
export function readDataFlow(config) {
  const models = isObj(config?.defaults?.models) ? config.defaults.models : {};
  const stages = [];
  ['stt', 'llm', 'tts', 'realtime'].forEach((stage) => {
    const slot = isObj(models[stage]) ? models[stage] : null;
    const provider = typeof slot?.provider === 'string' ? slot.provider : '';
    if (!provider) return;
    stages.push({ stage, words: STAGE_WORDS[stage], provider, providerName: providerLabel(provider), model: typeof slot.model === 'string' ? slot.model : '' });
  });
  const summary = isObj(config?.post_call?.summary) && config.post_call.summary.enabled === true && isObj(config.post_call.summary.llm) && config.post_call.summary.llm.provider
    ? { stage: 'summary', words: 'Call summaries', provider: config.post_call.summary.llm.provider, providerName: providerLabel(config.post_call.summary.llm.provider), model: config.post_call.summary.llm.model || '' } : null;
  const all = summary ? [...stages, summary] : stages;
  const names = [...new Set(all.map((s) => s.providerName))];
  const lines = all.map((s) => `${s.words}: ${s.providerName}${s.model ? ` (${s.model})` : ''}`);
  if (!all.length) return { stages: all, names, lines, sentence: 'No AI services are chosen yet, so the server’s defaults would be used. Choose them under AI model.' , chosen: false };
  const joined = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return { stages: all, names, lines, sentence: `Conversations are processed by ${joined}.`, chosen: true };
}

// ---- what is kept about each call -------------------------------------------------------------------------------------------------------------
// Things in the agent that are sensitive, in the customer's words. Used to warn when nothing hides them in saved records.
export function sensitiveThings(config) {
  const found = [];
  Object.entries(isObj(config?.state?.variables) ? config.state.variables : {}).forEach(([name, spec]) => { if (isObj(spec) && spec.sensitive === true) found.push(`the remembered value “${name}” is marked sensitive`); });
  ['input', 'output'].forEach((side) => list(config?.guardrails?.[side]).forEach((rule) => {
    if (isObj(rule) && rule.type === 'pii_detect') found.push(`a check for ${list(rule.entities).map((e) => String(e).replace(/_/g, ' ')).join(', ') || 'personal details'} in what ${side === 'input' ? 'the caller says' : 'the agent says'}`);
  }));
  return found;
}

export function readRecords(config) {
  const log = isObj(config?.observability?.session_log) ? config.observability.session_log : {};
  const recording = isObj(config?.post_call?.recording) ? config.post_call.recording : {};
  const redaction = isObj(config?.post_call?.redaction) ? config.post_call.redaction : null;
  return {
    logOn: log.enabled !== false,
    logExplicit: typeof log.enabled === 'boolean',
    logFull: log.detail === 'full',
    logDays: Number.isInteger(log.retention_days) ? log.retention_days : null,
    audio: recording.audio === true,
    transcript: recording.transcript === true,
    recordingDays: Number.isInteger(recording.retention_days) ? recording.retention_days : null,
    modelRequests: config?.observability?.log_llm_requests === true,
    redactionOn: !!redaction && redaction.enabled !== false,
    sensitive: sensitiveThings(config),
  };
}

// What is kept, as sentences a customer can read, and what is wrong with it (the problems are things to look at, not errors).
export function describeRecords(config) {
  const r = readRecords(config);
  const lines = [];
  const problems = [];
  if (r.logOn) {
    lines.push(`A log of each call is kept. It records what callers say, every tool that runs and every request to your systems${r.logFull ? ', and every model request in full' : ''}.`);
    lines.push(r.logDays ? `Call logs are deleted after ${plural(r.logDays, 'day')}.` : 'Call logs are kept until someone deletes them (unless the people who run your servers set a limit).');
    if (r.logFull) problems.push('The call log holds every model request in full. Use that for testing, not for real callers.');
  } else {
    lines.push('No log of each call is kept.');
  }
  if (r.audio || r.transcript) lines.push(`${[r.audio ? 'Audio is recorded' : '', r.transcript ? 'Transcripts are kept' : ''].filter(Boolean).join(' and ')}${r.recordingDays ? `, for ${plural(r.recordingDays, 'day')}` : ''}.`);
  if (r.modelRequests) problems.push('Every request to the AI model is written to the call log. That stores everything the caller said. Keep it off for real callers.');
  if (r.logOn || r.audio || r.transcript) {
    lines.push(r.redactionOn
      ? 'Sensitive text is replaced in saved transcripts and metrics. It still reaches the AI during the call.'
      : 'Only values marked sensitive are hidden in the call log. Other things a caller says are not hidden yet.');
  }
  if (r.sensitive.length && !r.redactionOn && (r.logOn || r.audio || r.transcript)) problems.push(`The agent handles sensitive details (${r.sensitive.slice(0, 2).join('; ')}${r.sensitive.length > 2 ? '; …' : ''}) but nothing hides them in saved transcripts.`);
  const kept = r.logOn ? (r.logDays ? `Call log kept ${plural(r.logDays, 'day')}` : 'Call log kept') : 'No call log';
  return { read: r, lines, problems, headline: `${kept}${r.audio || r.transcript ? ' · recordings on' : ''}` };
}

// Voice channels: does the agent tell callers they may be recorded, and does anything record?
export function recordingNoticeState(config) {
  const voice = list(config?.channels).some((c) => isObj(c) && c.enabled !== false && ['sip_voice', 'web_voice'].includes(c.type));
  const told = isObj(config?.persona?.disclosures) && typeof config.persona.disclosures.recording_notice === 'string' && config.persona.disclosures.recording_notice.trim() !== '';
  const r = readRecords(config);
  const keeps = r.logOn || r.audio || r.transcript;
  return { voice, told, keeps, missing: voice && keeps && !told };
}

// ---- setters (each returns the same object when nothing would change) -------------------------------------------------------------------------
const observability = (next) => { next.observability = { ...(isObj(next.observability) ? next.observability : {}) }; return next.observability; };
const sessionLog = (next) => { const o = observability(next); o.session_log = { ...(isObj(o.session_log) ? o.session_log : {}) }; return o.session_log; };
const recording = (next) => { next.post_call = { ...(isObj(next.post_call) ? next.post_call : {}) }; next.post_call.recording = { ...(isObj(next.post_call.recording) ? next.post_call.recording : {}) }; return next.post_call.recording; };

export const setLogEnabled = (config, on) => edit(config, (next) => { sessionLog(next).enabled = !!on; });
export function setLogDays(config, days) {
  return edit(config, (next) => {
    const log = sessionLog(next);
    if (days === null || days === undefined || days === '' || !(Number(days) >= 1)) delete log.retention_days; else log.retention_days = Math.floor(Number(days));
  });
}
export const setRecordAudio = (config, on) => edit(config, (next) => { recording(next).audio = !!on; });
export const setKeepTranscript = (config, on) => edit(config, (next) => { recording(next).transcript = !!on; });
export function setRecordingDays(config, days) {
  return edit(config, (next) => {
    const rec = recording(next);
    if (days === null || days === undefined || days === '' || !(Number(days) >= 1)) delete rec.retention_days; else rec.retention_days = Math.floor(Number(days));
  });
}

// Turns redaction on for what the agent handles. Redaction is a schema 1.2 feature, so the version is raised if it is lower (`raised` says so).
export function enableRedaction(config) {
  const entities = new Set(['card_number']);
  ['input', 'output'].forEach((side) => list(config?.guardrails?.[side]).forEach((rule) => { if (isObj(rule) && rule.type === 'pii_detect') list(rule.entities).forEach((e) => entities.add(e)); }));
  Object.entries(isObj(config?.state?.variables) ? config.state.variables : {}).forEach(([name, spec]) => { if (isObj(spec) && spec.sensitive === true && /pin/i.test(name)) entities.add('pin'); });
  const allowed = ['card_number', 'bank_account', 'national_id', 'phone_number', 'email', 'date_of_birth', 'otp', 'pin'];
  const next = clone(config);
  next.post_call = { ...(isObj(next.post_call) ? next.post_call : {}) };
  next.post_call.redaction = { enabled: true, entities: [...entities].filter((e) => allowed.includes(e)) };
  let raised = false;
  if (next.schema_version !== '1.2') { next.schema_version = '1.2'; raised = true; }
  return { config: next, raised };
}
