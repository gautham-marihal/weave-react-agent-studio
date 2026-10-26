// After the call in plain words, for the top of the After the call page: a summary of each call, questions answered
// about each call, what is recorded (and what callers are told about it), and the sensitive details hidden in what is
// kept. Each reads its part and writes it back complete; a part left empty is taken out, so nothing is written that was
// not chosen. Pure: no React, no DOM.

import { notApplied, sensitiveEntities } from '../../records/recordsModel.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const clone = (v) => JSON.parse(JSON.stringify(v));
const str = (v) => (typeof v === 'string' ? v : '');

// Changes `post_call` on a copy, and takes out what is left empty.
function edit(config, change) {
  const next = clone(config || {});
  next.post_call = isObj(next.post_call) ? next.post_call : {};
  change(next.post_call, next);
  ['summary', 'recording', 'redaction'].forEach((part) => {
    if (isObj(next.post_call[part]) && Object.keys(next.post_call[part]).length === 0) delete next.post_call[part];
  });
  if (Array.isArray(next.post_call.analysis) && next.post_call.analysis.length === 0) delete next.post_call.analysis;
  if (Object.keys(next.post_call).length === 0) delete next.post_call;
  return next;
}

// What is set. A switch the configuration does not set is `null` ("the server decides"), not off: nothing here pretends to know the server's default.
// Each question keeps `index`, its place in `post_call.analysis`, which is what the setters take: an item that is not a question is skipped here but
// still counts there. A kind of answer that is missing or unknown is '' (none chosen yet), never one the configuration does not say.
export function afterCallOf(config) {
  const pc = isObj(config?.post_call) ? config.post_call : {};
  const bool = (v) => (v === true ? true : v === false ? false : null);
  const kinds = ANSWER_KINDS.map(([id]) => id);
  return {
    summary: { on: bool(pc.summary?.enabled), prompt: str(pc.summary?.prompt) },
    questions: list(pc.analysis)
      .map((q, index) => ({ q, index }))
      .filter(({ q }) => isObj(q))
      .map(({ q, index }) => ({
        index,
        id: str(q.id),
        question: str(q.question),
        type: kinds.includes(q.type) ? q.type : '',
        values: list(q.values).filter((v) => typeof v === 'string'),
      })),
    recording: {
      audio: bool(pc.recording?.audio),
      transcript: bool(pc.recording?.transcript),
      days: Number.isFinite(Number(pc.recording?.retention_days)) && pc.recording?.retention_days ? Number(pc.recording.retention_days) : null,
    },
    notice: str(config?.persona?.disclosures?.recording_notice),
    // hiding sensitive details is on once `post_call.redaction` is there and not switched off (`enabled` defaults to true inside it); with no
    // `post_call.redaction` nothing is hidden but the values marked sensitive, so it is off, as the release checklist reads it (readRecords)
    redaction: {
      on: isObj(pc.redaction) && pc.redaction.enabled !== false,
      entities: list(pc.redaction?.entities).filter((e) => typeof e === 'string'),
    },
  };
}

// ---- the summary --------------------------------------------------------------------------------------------------------------------------------
export function setSummary(config, { on, prompt } = {}) {
  return edit(config, (pc) => {
    const summary = isObj(pc.summary) ? { ...pc.summary } : {};
    if (on !== undefined) summary.enabled = !!on;
    if (prompt !== undefined) {
      const text = String(prompt || '').trim();
      if (text) summary.prompt = String(prompt);
      else delete summary.prompt;
    }
    pc.summary = summary;
  });
}

// ---- questions about each call ------------------------------------------------------------------------------------------------------------------
// The kinds of answer, in words.
export const ANSWER_KINDS = [
  ['boolean', 'Yes or no'],
  ['enum', 'One of a list'],
  ['number', 'A number'],
  ['string', 'In a few words'],
];
// Questions people often start from.
export const QUESTION_IDEAS = [
  { question: 'Was the caller’s problem solved?', type: 'boolean' },
  { question: 'Why did they get in touch?', type: 'enum', values: ['A question', 'A problem', 'A booking', 'A complaint', 'Something else'] },
  { question: 'How did the caller feel at the end?', type: 'enum', values: ['Happy', 'Neutral', 'Unhappy'] },
];

const idFrom = (text, taken) => {
  const base =
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^[^a-z]+/, '')
      .slice(0, 40) || 'question';
  let id = base;
  let n = 2;
  while (taken.includes(id)) {
    id = `${base}_${n}`;
    n += 1;
  }
  return id;
};

// A question's id is made once, from its words, when it is added, and stays the same when the words change (other places may point at it).
export function addQuestion(config, { question = '', type = 'boolean', values = [] } = {}) {
  return edit(config, (pc) => {
    const analysis = list(pc.analysis);
    const id = idFrom(question || 'question', analysis.map((q) => q?.id).filter(Boolean));
    const item = { id, type, question: String(question || '') };
    if (type === 'enum') item.values = values.length ? values : ['Yes', 'No'];
    pc.analysis = [...analysis, item];
  });
}

// change: { question?, type?, values? }; a list of values stays only with "One of a list"
export function setQuestion(config, index, change) {
  return edit(config, (pc) => {
    const analysis = list(pc.analysis).map((q) => (isObj(q) ? { ...q } : q));
    const q = analysis[index];
    if (!isObj(q)) return;
    if (change.question !== undefined) q.question = String(change.question);
    if (change.type !== undefined) q.type = change.type;
    if (change.values !== undefined)
      q.values = list(change.values)
        .map((v) => String(v).trim())
        .filter(Boolean);
    if (q.type === 'enum' && !list(q.values).length) q.values = ['Yes', 'No'];
    if (q.type !== 'enum') delete q.values;
    pc.analysis = analysis;
  });
}

export function removeQuestion(config, index) {
  return edit(config, (pc) => {
    pc.analysis = list(pc.analysis).filter((_, i) => i !== index);
  });
}

// ---- recording ----------------------------------------------------------------------------------------------------------------------------------
// change: { audio?, transcript?, days? ('' or null keeps them until someone deletes them) }
// Days are whole days, one at least: part of a day is one day, never "no limit".
export function setRecording(config, change) {
  return edit(config, (pc) => {
    const recording = isObj(pc.recording) ? { ...pc.recording } : {};
    if (change.audio !== undefined) recording.audio = !!change.audio;
    if (change.transcript !== undefined) recording.transcript = !!change.transcript;
    if (change.days !== undefined) {
      const days = Number(change.days);
      if (change.days === '' || change.days === null || !Number.isFinite(days) || days <= 0) delete recording.retention_days;
      else recording.retention_days = Math.max(1, Math.round(days));
    }
    pc.recording = recording;
  });
}

// The recording notice, said at the start of a call before the greeting: `persona.disclosures.recording_notice`. It is
// asked here, beside what is recorded, and nowhere else on the agent's pages.
export function setNotice(config, text) {
  const next = clone(config || {});
  const value = String(text || '');
  const persona = isObj(next.persona) ? { ...next.persona } : {};
  const disclosures = isObj(persona.disclosures) ? { ...persona.disclosures } : {};
  if (value.trim()) disclosures.recording_notice = value;
  else delete disclosures.recording_notice;
  if (Object.keys(disclosures).length) persona.disclosures = disclosures;
  else delete persona.disclosures;
  if (Object.keys(persona).length) next.persona = persona;
  else delete next.persona;
  return next;
}

// ---- hiding sensitive details -------------------------------------------------------------------------------------------------------------------
export const SENSITIVE = [
  ['card_number', 'Card numbers'],
  ['bank_account', 'Bank account numbers'],
  ['national_id', 'ID numbers'],
  ['phone_number', 'Phone numbers'],
  ['email', 'Email addresses'],
  ['date_of_birth', 'Dates of birth'],
  ['otp', 'One-time codes'],
  ['pin', 'PINs'],
];

// change: { on?, entities? } Switched on from nothing, it starts with what the agent already handles: card numbers, the
// kinds its Guardrails' personal-details checks look for, and PINs when a value it keeps sensitive looks like one (so
// it never starts on with nothing ticked, which hides nothing more). On is written as `enabled: true`, because with no
// `post_call.redaction` nothing is hidden; switched off with nothing else in it, the part is taken out (which is off
// too). It is a schema 1.2 setting: a configuration that keeps it is raised to 1.2 when it says less, as
// enableRedaction does on the release page (every 1.1 configuration is a valid 1.2 one once it says so).
export function setRedaction(config, change) {
  return edit(config, (pc, next) => {
    const was = isObj(pc.redaction) ? pc.redaction : null;
    const on = change.on !== undefined ? !!change.on : !!was && was.enabled !== false;
    const redaction = was ? { ...was } : {};
    if (change.on !== undefined) redaction.enabled = !!change.on;
    if (change.on === true && change.entities === undefined && !list(redaction.entities).length) {
      const known = SENSITIVE.map(([id]) => id);
      const first = sensitiveEntities(next).filter((id) => known.includes(id));
      if (first.length) redaction.entities = known.filter((id) => first.includes(id));
    }
    if (change.entities !== undefined) {
      const known = SENSITIVE.map(([id]) => id);
      const entities = known.filter((id) => change.entities.includes(id));
      if (entities.length) redaction.entities = entities;
      else delete redaction.entities;
    }
    // still on with nothing ticked: it stays, said
    if (on && Object.keys(redaction).length === 0) redaction.enabled = true;
    // switched off with only the ticks it started with (nobody chose them): nothing was chosen, so nothing is kept
    if (change.on === false && Object.keys(redaction).every((key) => key === 'enabled' || key === 'entities')) {
      const known = SENSITIVE.map(([id]) => id);
      const first = known.filter((id) => sensitiveEntities(next).includes(id));
      if (list(redaction.entities).join() === first.join()) delete redaction.entities;
    }
    if (redaction.enabled === false && Object.keys(redaction).length === 1) {
      delete pc.redaction;
      return;
    }
    pc.redaction = redaction;
    // (a version that isn't a number reads as older too)
    const version = Number(next.schema_version);
    if (Number.isNaN(version) || version < 1.2) next.schema_version = '1.2';
  });
}

// What the settings form below still shows of After the call: everything but what the blocks above ask (so nothing is asked twice).
export const ASKED_ABOVE = [
  ['post_call', 'summary', 'enabled'],
  ['post_call', 'summary', 'prompt'],
  ['post_call', 'analysis'],
  ['post_call', 'recording'],
  ['post_call', 'redaction', 'enabled'],
  ['post_call', 'redaction', 'entities'],
  ['observability', 'session_log', 'enabled'],
  ['observability', 'session_log', 'retention_days'],
];

// Which parts the server says it doesn't do yet (the validator's `unsupported`, matched by what each item names), so a
// card that is on can say so rather than promise what will not happen. Today's server lists none of them; a server that
// does is believed.
export function notDoneYet(unsupported) {
  const says = (pattern) => notApplied(unsupported, pattern).length > 0;
  return {
    summary: says(/post_call\.summary|post-call summar/i),
    questions: says(/post_call\.analysis|post-call analysis/i),
    recording: says(/post_call\.recording|call recording/i),
    redaction: says(/post_call\.redaction|redaction/i),
  };
}
// The same for one configuration. All that is left of the summary below is the model that writes it, and it is shown once summaries are on (or a
// model is already chosen for them): drawn for a summary that is not set, the form would fill in the summary's required switch as off, and the first
// change to its model would turn summaries off without a word.
const ASKED_ABOVE_NO_SUMMARY = [...ASKED_ABOVE, ['post_call', 'summary']];
export function askedAbove(config) {
  const summary = config?.post_call?.summary;
  return isObj(summary) && (summary.enabled === true || summary.llm !== undefined) ? ASKED_ABOVE : ASKED_ABOVE_NO_SUMMARY;
}
