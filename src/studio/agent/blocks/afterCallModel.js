// Model for the top of the After the call page (summary, questions, recording, hidden details). Each part is written
// back complete, and an empty part is removed so nothing unchosen is written. Pure: no React, no DOM.

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

// What is set. An unset switch is `null` ("the server decides"), never assumed off. Each question keeps `index`, its
// place in `post_call.analysis` (non-questions are skipped but still count). A missing or unknown answer kind is ''.
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
    // on when `post_call.redaction` exists and isn't switched off (`enabled` defaults to true); without it only values
    // marked sensitive are hidden, so it reads as off, as the release checklist does (readRecords)
    redaction: {
      on: isObj(pc.redaction) && pc.redaction.enabled !== false,
      entities: list(pc.redaction?.entities).filter((e) => typeof e === 'string'),
    },
  };
}

// ---- the summary ----------------------------------------------------------------------------------------------------
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

// ---- questions about each call --------------------------------------------------------------------------------------
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

// A question's id is made from its words once, when added, and never changes (other places may point at it).
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

// ---- recording ------------------------------------------------------------------------------------------------------
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

// The recording notice said before the greeting (`persona.disclosures.recording_notice`), asked only here, beside what
// is recorded.
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

// ---- hiding sensitive details ---------------------------------------------------------------------------------------
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

// change: { on?, entities? }. Switched on from nothing, it starts ticked with the kinds the agent already treats as
// sensitive, and is written as `enabled: true`. A 1.2 setting: raises schema_version as enableRedaction does.
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
    // still on with nothing ticked: keep it, written as enabled
    if (on && Object.keys(redaction).length === 0) redaction.enabled = true;
    // switched off with only the starting ticks (nobody chose them): nothing was chosen, so nothing is kept
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

// What the settings form below leaves out because the blocks above ask it (so nothing is asked twice).
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

// Which parts the server says it can't do yet (the validator's `unsupported`), so a card that is on doesn't promise
// what won't happen. Today's server lists none; one that does is believed.
export function notDoneYet(unsupported) {
  const says = (pattern) => notApplied(unsupported, pattern).length > 0;
  return {
    summary: says(/post_call\.summary|post-call summar/i),
    questions: says(/post_call\.analysis|post-call analysis/i),
    recording: says(/post_call\.recording|call recording/i),
    redaction: says(/post_call\.redaction|redaction/i),
  };
}
// The same for one config. The summary's model shows only once summaries are on (or a model is set): for an unset
// summary the form would fill its required switch as off, and the first model change would silently turn summaries off.
const ASKED_ABOVE_NO_SUMMARY = [...ASKED_ABOVE, ['post_call', 'summary']];
export function askedAbove(config) {
  const summary = config?.post_call?.summary;
  return isObj(summary) && (summary.enabled === true || summary.llm !== undefined) ? ASKED_ABOVE : ASKED_ABOVE_NO_SUMMARY;
}
