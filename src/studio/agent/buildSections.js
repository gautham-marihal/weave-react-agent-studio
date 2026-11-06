// The seven build parts, each with its purpose and state from the draft, for Build's side list and the Overview. It
// informs and never blocks; readiness.js stays the one answer to "can it go live?". Pure: no React, no DOM.

import { languageName, readSimple } from '../simple/simpleModel.js';
import { readModels } from '../models/config.js';
import { readingState } from '../knowledge/model.js';
import { ACTIONS, REACH, actionsOf, handOverCases, reachOf } from '../setup/setupModel.js';
import { momentsOf, topicsOf } from './blocks/guardrailModel.js';
import { afterCallOf } from './blocks/afterCallModel.js';
import { agentLabel } from './rowNames.js';
import { PAGE_GROUPS } from './pages.js';
import { aiSeesPictures, channelPictures, pictureCounts } from '../pictures/mediaModel.js';

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
  conversation: 'How it behaves during a call: taking turns, silent callers, what it remembers and reacts to.',
  connections: 'What its tools reach: the systems it calls, phone transfers, forms, messages and tasks.',
  media: 'Photos and the camera: where customers can send them, what it asks for, how picky the checks are and what happens to the pictures.',
  subagents: 'Who answers first, what each subagent does, and who passes callers to whom.',
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
    hand_over:
      handOverCases(config).length > 1
        ? `passes people to your team in ${handOverCases(config).length} cases`
        : actions.hand_over.number
          ? `passes people to your team (${actions.hand_over.number})`
          : 'passes people to your team (no number yet)',
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
    after.redaction.on && 'hides personal details in what is kept',
  ].filter(Boolean);
  if (!parts.length) return { state: 'optional', status: 'Nothing set: the server’s defaults apply.' };
  const text = parts.join(' · ');
  return { state: 'done', status: `${text.charAt(0).toUpperCase()}${text.slice(1)}.` };
}

// How it behaves during a call: what is set beyond the defaults.
function conversationPart(config) {
  const conv = isObj(config?.defaults?.conversation) ? config.defaults.conversation : {};
  const variables = isObj(config?.state?.variables) ? Object.keys(config.state.variables).length : 0;
  const events = list(config?.events).filter(isObj).length;
  const rules = list(conv.speech?.pronunciation).length;
  const parts = [
    conv.inactivity?.enabled && 'nudges silent callers',
    conv.turn_handling?.interruption?.enabled === false && 'can’t be interrupted',
    variables && `remembers ${plural(variables, 'value')}`,
    events && `reacts to ${plural(events, 'event')}`,
    rules && `${plural(rules, 'pronunciation rule')}`,
  ].filter(Boolean);
  if (!parts.length) return { state: 'optional', status: 'Nothing set: the usual way of taking turns.' };
  const text = parts.join(' · ');
  return { state: 'done', status: `${text.charAt(0).toUpperCase()}${text.slice(1)}.` };
}

// What its tools reach: how many of each.
function connectionsPart(config) {
  const count = (v) => (Array.isArray(v) ? v.filter(isObj).length : isObj(v) ? Object.keys(v).length : 0);
  const parts = [
    [count(config?.connections), 'connection'],
    [count(config?.telephony?.transfers), 'phone transfer'],
    [count(config?.forms), 'form'],
    [count(config?.notifications), 'message'],
    [count(config?.tasks), 'task'],
  ]
    .filter(([n]) => n)
    .map(([n, word]) => plural(n, word));
  if (!parts.length) return { state: 'optional', status: 'None yet: its tools reach nothing outside the conversation.' };
  return { state: 'done', status: `${parts.join(' · ')}.` };
}

// Who answers and who passes callers on.
function subagentsPart(config) {
  const agents = list(config?.agents?.items).filter(isObj);
  const handoffs = agents.reduce((n, a) => n + list(a.handoffs).length, 0);
  const first = agents.find((a) => a.id === config?.agents?.entry) || agents[0];
  if (agents.length <= 1) return { state: 'done', status: `${first ? agentLabel(config, first.id) : 'One agent'} answers every conversation.` };
  return { state: 'done', status: `${plural(agents.length, 'subagent')} · ${plural(handoffs, 'hand-over')} · ${agentLabel(config, first.id)} answers first.` };
}

const READERS = {
  agent: (c) => agentPart(c),
  conversation: (c) => conversationPart(c),
  connections: (c) => connectionsPart(c),
  subagents: (c) => subagentsPart(c),
  knowledge: (c, k) => knowledgePart(c, k),
  tools: (c) => toolsPart(c),
  workflow: (c) => workflowPart(c),
  channels: (c) => channelsPart(c),
  guardrails: (c) => guardrailsPart(c),
  aftercall: (c) => afterCallPart(c),
  media: (c) => mediaSection(c),
};
// Images & Videos: optional until it asks for one; then every picture needs a channel that takes it and an AI that
// sees it
function mediaSection(config) {
  const n = pictureCounts(config);
  const asks = n.photo + n.video;
  if (!asks && !n.read) return { state: 'optional', status: 'Not used: it doesn’t ask for photos or the camera.' };
  const reach = channelPictures(config);
  const photoOk = !n.photo || reach.some((c) => c.on && c.photo);
  const cameraOk = !n.video || reach.some((c) => c.on && c.camera);
  if (!photoOk || !cameraOk)
    return { state: 'attention', status: `It asks for ${!photoOk ? 'photos' : 'the camera'}, but no web channel takes ${!photoOk ? 'them' : 'it'}.` };
  if (!aiSeesPictures(config).sees) return { state: 'attention', status: 'It asks for pictures, but the AI isn’t marked as seeing them.' };
  const parts = [n.photo && plural(n.photo, 'photo request'), n.video && plural(n.video, 'video check'), n.compare && plural(n.compare, 'comparison')].filter(
    Boolean,
  );
  return { state: 'done', status: `${parts.join(' · ')}.` };
}

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
