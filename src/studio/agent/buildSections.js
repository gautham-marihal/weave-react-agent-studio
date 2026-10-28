// The seven build parts, each with its purpose and state from the draft, for Build's side list and the Overview. It
// informs and never blocks; readiness.js stays the one answer to "can it go live?". Pure: no React, no DOM.

import { languageName, readSimple } from '../simple/simpleModel.js';
import { readModels } from '../models/config.js';
import { readingState } from '../knowledge/model.js';
import { ACTIONS, REACH, actionsOf, reachOf } from '../setup/setupModel.js';
import { momentsOf, topicsOf } from './blocks/guardrailModel.js';
import { afterCallOf } from './blocks/afterCallModel.js';
import { agentLabel } from './rowNames.js';
import { PAGE_GROUPS } from './pages.js';

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const words = (text) => (String(text || '').match(/\S+/g) || []).length;
const clip = (text, n) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);
const joinAnd = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0] || '');

// What each part is for, in a sentence a newcomer can act on
export const PURPOSE = {
  agent: 'Who it is, what it should do, what it says first, and its language and voice.',
  knowledge: 'The documents and web pages it answers from.',
  tools: 'What it can do besides talk, like taking requests or passing people to your team.',
  workflow: 'Who answers first, and how a conversation moves between agents.',
  channels: 'Where people reach it: by phone, or by chat or talk on your website.',
  guardrails: 'Topics it keeps to or avoids, and when it hands over or ends the call.',
  aftercall: 'What happens when a conversation ends: a summary, questions about it, what is kept.',
};

// What a part's documents still need, the worst first (the words of readiness.js)
const READING = {
  failed: 'Reading its documents failed',
  missing: 'A document it lists is not on the server',
  unsaved: 'Its documents are not saved yet',
  changed: 'Its documents changed since they were read',
  unread: 'Its documents are not read yet',
  reading: 'Its documents are being read',
};

function agentPart(config) {
  const read = readSimple(config);
  const voice = readModels(config).tts?.voiceId;
  // the same rules as readiness.js: instructions, a greeting, a language, and a voice when it talks
  const missing = [
    words(read.role) < 8 && 'what it should do',
    !read.greeting && 'what it says first',
    !read.primaryLanguage && 'its language',
    read.voiceChannel && !voice && 'its voice',
  ].filter(Boolean);
  if (missing.length) return { state: 'todo', status: `Still to choose: ${joinAnd(missing)}.` };
  const languages = [...new Set([read.primaryLanguage, ...read.speaks].filter(Boolean).map((c) => languageName(c).replace(/ \(.*\)$/, '')))];
  return {
    state: 'done',
    status: [`Says “${clip(read.greeting, 48)}”`, joinAnd(languages), read.voiceChannel ? 'voice chosen' : ''].filter(Boolean).join(' · '),
  };
}

function knowledgePart(config, knowledgeRead) {
  const bases = list(config?.knowledge).filter((b) => isObj(b) && b.type === 'vector_store');
  const sources = bases.flatMap((b) => list(b.sources).filter(isObj));
  if (!sources.length) return { state: 'optional', status: 'No documents yet: it answers from its instructions only.' };
  const files = sources.filter((s) => s.type === 'file').length;
  const pages = sources.length - files;
  const what = [files && plural(files, 'document'), pages && plural(pages, 'web page')].filter(Boolean).join(' and ');
  const states = knowledgeRead
    ? bases.map((b) => readingState(list(knowledgeRead.bases).find((s) => s.id === b.id) || null, { draftSources: list(b.sources) }).state)
    : [];
  const worst = Object.keys(READING).find((s) => states.includes(s));
  if (worst) return { state: worst === 'reading' ? 'done' : 'attention', status: `${what} · ${READING[worst].toLowerCase()}.` };
  return { state: 'done', status: knowledgeRead ? `${what} · read and ready to answer from.` : `${what}.` };
}

function toolsPart(config) {
  const actions = actionsOf(config);
  const said = {
    end_call: 'ends politely',
    hand_over: actions.hand_over.number ? `passes people to your team (${actions.hand_over.number})` : 'passes people to your team (no number yet)',
    details: 'takes requests',
    lookup: 'looks things up in your system',
  };
  const on = ACTIONS.map((a) => a.id).filter((id) => actions[id]?.on);
  // tools set up by hand (not one of the switches): counted, not named
  const switched = new Set(['end_call', 'transfer_or_callback', 'send_form']);
  const others = list(config?.tools).filter((t) => isObj(t) && !switched.has(t.builtin) && t.id !== 'look_up').length;
  const parts = [...on.map((id) => said[id]), others ? `${plural(others, 'other tool')}` : ''].filter(Boolean);
  if (!parts.length) return { state: 'optional', status: 'Nothing switched on: it can only talk.' };
  const text = parts.join(' · ');
  return { state: 'done', status: `${text.charAt(0).toUpperCase()}${text.slice(1)}.` };
}

function workflowPart(config) {
  const agents = list(config?.agents?.items).filter(isObj);
  if (agents.length <= 1) return { state: 'done', status: 'One agent answers every conversation.' };
  const entry = agents.find((a) => a.id === config.agents.entry) || agents[0];
  const handoffs = list(entry.handoffs).filter(isObj).length;
  return {
    state: 'done',
    status: `${agents.length} agents · ${agentLabel(config, entry.id)} answers first${handoffs ? ` and hands over to ${handoffs}` : ''}.`,
  };
}

function channelsPart(config) {
  const on = reachOf(config);
  const named = REACH.filter((r) => on[r.type]).map((r, i) => (i ? `${r.label.charAt(0).toLowerCase()}${r.label.slice(1)}` : r.label));
  const others = list(config?.channels).filter((c) => isObj(c) && c.enabled !== false && !(c.type in on)).length;
  const all = [...named, others ? plural(others, 'other channel') : ''].filter(Boolean);
  if (!all.length) return { state: 'attention', status: 'No way to reach it is switched on.' };
  return { state: 'done', status: `${joinAnd(all)}.` };
}

function guardrailsPart(config) {
  const topics = topicsOf(config);
  const moments = Object.values(momentsOf(config)).filter((m) => m?.on).length;
  const checks = list(config?.guardrails?.input).length + list(config?.guardrails?.output).length;
  const parts = [
    topics.allowed.length && `keeps to ${plural(topics.allowed.length, 'topic')}`,
    topics.blocked.length && `avoids ${plural(topics.blocked.length, 'topic')}`,
    moments && `${plural(moments, 'moment')} it acts on`,
    checks && `${plural(checks, 'safety check')}`,
  ].filter(Boolean);
  if (!parts.length) return { state: 'optional', status: 'None set: it follows its instructions.' };
  const text = parts.join(' · ');
  return { state: 'done', status: `${text.charAt(0).toUpperCase()}${text.slice(1)}.` };
}

function afterCallPart(config) {
  const after = afterCallOf(config);
  const summary = after.summary.on === true ? 'Writes a summary' : after.summary.on === false ? 'No summary' : '';
  const parts = [
    summary,
    after.questions.length && `answers ${plural(after.questions.length, 'question')}`,
    after.recording.days && `keeps recordings ${after.recording.days} days`,
  ].filter(Boolean);
  if (!parts.length) return { state: 'optional', status: 'Nothing set: the server’s defaults apply.' };
  const text = parts.join(' · ');
  return { state: 'done', status: `${text.charAt(0).toUpperCase()}${text.slice(1)}.` };
}

const READERS = {
  agent: (c) => agentPart(c),
  knowledge: (c, k) => knowledgePart(c, k),
  tools: (c) => toolsPart(c),
  workflow: (c) => workflowPart(c),
  channels: (c) => channelsPart(c),
  guardrails: (c) => guardrailsPart(c),
  aftercall: (c) => afterCallPart(c),
};
const BUILD_PAGES = PAGE_GROUPS.find((g) => g.id === 'build').pages;

// -> [{ id, label, icon, purpose, state: 'done' | 'todo' | 'attention' | 'optional', status }], in the menu's order.
//   errorsByPage: what the checks found, by page (a page with errors needs attention, whatever it holds)
//   knowledgeRead: what the server has read of the documents (useKnowledge's data); if absent, documents count as there
export function buildSections({ config, errorsByPage = {}, knowledgeRead = null } = {}) {
  if (!isObj(config)) return [];
  return BUILD_PAGES.map((page) => {
    const part = READERS[page.id](config, knowledgeRead);
    const errors = errorsByPage[page.id] || 0;
    return {
      id: page.id,
      label: page.label,
      icon: page.icon,
      purpose: PURPOSE[page.id],
      ...part,
      ...(errors ? { state: 'attention', status: `${plural(errors, 'problem')} to fix · ${part.status}` } : {}),
    };
  });
}
