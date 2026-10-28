// The guided setup's model: what each step reads from the configuration and how each choice changes it.
// Each change is complete on its own (a tool is given to the answering agent, a voice channel gets speech models),
// so nothing needs a second visit elsewhere. Pure: no network, no DOM.
// Its knowledge and actions parts are in setupKnowledge.js and setupActions.js (re-exported here), shared helpers in setupBasics.js.

import { REACH_WORDS, buildChannel } from '../form/presets.js';
import { FALLBACK as CHANNEL_KINDS, infoOf } from '../form/channelTypes.js';
import { STARTERS } from '../starters.ts';
import { freshId } from '../form/references.js';
import { addDefaultSpeechModels } from '../models/config.js';
import { LANGUAGES, channelName, readSimple, setPrimaryLanguage } from '../simple/simpleModel.js';
import { baseOf } from '../form/messages.ts';
import { clone, isObj, list, listWords } from './setupBasics.js';
import { knowledgeOf } from './setupKnowledge.js';
import { actionsOf } from './setupActions.js';

export {
  KNOWLEDGE_ID,
  knowledgeOf,
  readersOf,
  readersInWords,
  attachBase,
  whoReadsKnowledge,
  addKnowledgeFile,
  addKnowledgePage,
  removeKnowledge,
  cleanUrl,
} from './setupKnowledge.js';
export {
  ACTIONS,
  DETAIL_FIELDS,
  REQUEST_FIELDS,
  switchOf,
  actionsOf,
  dropLines,
  setEndCall,
  setHandOver,
  numberProblem,
  setDetails,
  setLookup,
} from './setupActions.js';

// ---- the steps
export const STEPS = [
  { id: 'start', label: 'Name and starting point' },
  { id: 'purpose', label: 'What it does', title: 'What should it do?', lead: 'Tell it what its job is, as you would brief a new colleague.' },
  { id: 'reach', label: 'Where people reach it', title: 'Where will people reach it?', lead: 'Choose one or more. You can change this later.' },
  {
    id: 'voice',
    label: 'Language and voice',
    title: 'Which language, and which voice?',
    lead: 'The language it speaks and understands, and, when people talk to it, how it sounds.',
  },
  {
    id: 'knowledge',
    label: 'What it knows',
    optional: true,
    title: 'What should it know?',
    lead: 'Add your documents or web pages. It looks up the answer there whenever someone asks.',
  },
  {
    id: 'actions',
    label: 'What it can do',
    optional: true,
    title: 'What can it do for people?',
    lead: 'Switch on what it may do during a conversation. Each one works straight away.',
  },
  { id: 'try', label: 'Try it', title: 'Try it out', lead: 'Have a conversation with it, as a customer would. Change anything, then try again.' },
  { id: 'live', label: 'Go live', title: 'Put it live', lead: 'One step: it is published and put live, ready for people to use.' },
];
export const STEP_IDS = STEPS.map((s) => s.id);
export const stepIndex = (id) => Math.max(0, STEP_IDS.indexOf(id));

// ---- where people reach it
export const REACH = [
  { type: 'web_chat', preset: 'web_chat', icon: 'chat', ...REACH_WORDS.web_chat },
  { type: 'web_voice', preset: 'web_voice', icon: 'mic', ...REACH_WORDS.web_voice },
  { type: 'sip_voice', preset: 'phone', icon: 'phone', ...REACH_WORDS.sip_voice },
];
const VOICE_TYPES = ['web_voice', 'sip_voice'];
export const RECORDING_NOTICE = 'This call may be recorded to improve our service.';

// Which ways of reaching it are on: { web_chat: true, web_voice: false, sip_voice: false }
export function reachOf(config) {
  const on = Object.fromEntries(REACH.map((r) => [r.type, false]));
  list(config?.channels).forEach((c) => {
    if (isObj(c) && c.enabled !== false && c.type in on) on[c.type] = true;
  });
  return on;
}

// Switches one way of reaching it on or off. The last working channel can't be switched off (an agent needs one):
// `refused` says why. `types` (GET /channel-types) says which kinds run today (WhatsApp, SMS and email don't yet).
export function setReach(config, type, on, { providers, botId, types = CHANNEL_KINDS } = {}) {
  if (!on && reachOf(config)[type]) {
    const others = list(config?.channels).filter((c) => isObj(c) && c.enabled !== false && c.type !== type);
    if (!others.some((c) => infoOf(types, c.type)?.runsToday !== false)) {
      const waiting = [...new Set(others.map((c) => kindWord(c.type)))];
      const refused = waiting.length
        ? `It needs at least one way for people to reach it, and ${listWords(waiting)} can’t take conversations yet.`
        : 'It needs at least one way for people to reach it.';
      return { config, refused };
    }
  }
  let next = clone(config);
  const channels = list(next.channels);
  const mine = channels.filter((c) => isObj(c) && c.type === type);
  if (!on) {
    mine.forEach((c) => (c.enabled = false));
    return { config: next, refused: '' };
  }
  if (mine.length) {
    mine.forEach((c) => (c.enabled = true));
    if (VOICE_TYPES.includes(type)) next = readyForVoice(next, providers);
  } else {
    const option = REACH.find((r) => r.type === type);
    next = addChannel(next, buildChannel(option.preset, { taken: channels.map((c) => c?.id).filter(Boolean), botId }), { providers });
  }
  return { config: next, refused: '' };
}

// Adds a channel ready to work: it says the agent's existing first line (the same fixed line, so translations come
// too), and a voice channel gets speech models. The reach choices and Add on the Channels page share it, to match.
export function addChannel(config, channel, { providers } = {}) {
  const next = clone(config);
  const added = clone(channel);
  const say = firstLineOf(next);
  if (say !== undefined && isObj(added.greeting)) added.greeting = { ...added.greeting, say };
  next.channels = [...list(next.channels), added];
  const audio = ['input', 'output'].some((way) => list(added.modalities?.[way]).includes('audio'));
  return audio ? readyForVoice(next, providers) : next;
}

// The agent's existing first line (text or a fixed line), from the first channel that says one; else undefined.
export const firstLineOf = (config) => list(config?.channels).find((c) => isObj(c) && isObj(c.greeting) && saysSomething(c.greeting.say))?.greeting.say;

// Gives the channel at `index` the agent's existing first line, so a channel waiting for the person can say it too.
export function shareFirstLine(config, index) {
  const say = firstLineOf(config);
  const channel = list(config?.channels)[index];
  if (say === undefined || !isObj(channel)) return config;
  const next = clone(config);
  next.channels[index].greeting = { ...(isObj(channel.greeting) ? channel.greeting : {}), say: clone(say) };
  return next;
}

// What a voice channel needs: speech models (when none are set) and a recording notice before the greeting.
function readyForVoice(config, providers) {
  const next = addDefaultSpeechModels(config, providers).config;
  if (next.persona?.disclosures?.recording_notice) return next;
  return { ...next, persona: { ...(next.persona || {}), disclosures: { ...(next.persona?.disclosures || {}), recording_notice: RECORDING_NOTICE } } };
}

const saysSomething = (say) => (typeof say === 'string' && say.trim() !== '') || (isObj(say) && typeof say.message === 'string' && say.message !== '');
// a kind of channel in the middle of a sentence ("WhatsApp", "SMS", "email")
const kindWord = (type) => (type === 'email' ? 'email' : channelName(type));

export const usesVoice = (config) => readSimple(config).voiceChannel;

// ---- language
// The main language for a new agent: the first browser language the studio knows (exactly or by base language),
// else English (United States). The language step shows it so it can be changed.
export function defaultLanguage(preferred = []) {
  const known = LANGUAGES.map(([code]) => code);
  for (const raw of list(preferred)) {
    const code = String(raw || '').toLowerCase();
    if (!code) continue;
    const found = known.find((c) => c.toLowerCase() === code) || known.find((c) => baseOf(c) === baseOf(code));
    if (found) return found;
  }
  return 'en-US';
}

// An agent with no main language is given that one; an agent that has one keeps it.
export const withMainLanguage = (config, preferred) => (readSimple(config).primaryLanguage ? config : setPrimaryLanguage(config, defaultLanguage(preferred)));

// ---- where each step stands
const DEFAULT_ROLE = /^You are a helpful assistant\. Answer briefly and politely\.$/;
const norm = (text) =>
  String(text || '')
    .replace(/\s+/g, ' ')
    .trim();

// Whether the instructions are still a starter's untouched words: they work but say nothing about this business,
// so the step asks for more.
export const isStarterRole = (role) => {
  const text = norm(role);
  return !!text && STARTERS.some((s) => s.role && norm(s.role) === text);
};

// 'done' | 'todo' | 'optional' for each step.
//   progress: what the setup remembers (`tried`)
//   summary: the agent as listed (what is live where)
export function stepStates(config, { progress = {}, summary = null } = {}) {
  const simple = readSimple(config);
  const knowledge = knowledgeOf(config);
  const actions = actionsOf(config);
  const tts = config?.defaults?.models?.tts;
  return {
    start: 'done',
    purpose: simple.role.trim().length >= 20 && !DEFAULT_ROLE.test(simple.role.trim()) && !isStarterRole(simple.role) ? 'done' : 'todo',
    reach: Object.values(reachOf(config)).some(Boolean) ? 'done' : 'todo',
    voice: simple.primaryLanguage && (!simple.voiceChannel || (isObj(tts) && tts.voice_id)) ? 'done' : 'todo',
    knowledge: knowledge.files.length || knowledge.pages.length ? 'done' : 'optional',
    actions: Object.values(actions).some((a) => a.on) ? 'done' : 'optional',
    try: progress.tried ? 'done' : 'todo',
    live: Object.values(summary?.deployed || {}).some(Boolean) ? 'done' : 'todo',
  };
}

// The setup step a problem from the checks belongs to, by its configuration path; '' when no step asks for it.
export function stepForPath(path) {
  const [key, sub] = Array.isArray(path) ? path : [];
  if (key === 'agents' && (sub === 'items' || sub === undefined)) return 'purpose';
  if (key === 'persona' || key === 'messages') return 'purpose';
  if (key === 'channels') return 'reach';
  if (key === 'defaults' && (sub === 'language' || sub === 'models')) return 'voice';
  if (key === 'knowledge') return 'knowledge';
  if (['tools', 'forms', 'connections', 'telephony'].includes(key)) return 'actions';
  return '';
}

// ---- the language step: its fixed lines in the other languages it speaks
// The first lines (one per distinct greeting: phone and chat may differ) and the goodbye, each as
// { key, label, text: { [base language]: words } }. setTranslation writes them; Fixed lines is the full editor.
const greetsWith = (channel) => isObj(channel) && channel.enabled !== false && isObj(channel.greeting) && ![undefined, ''].includes(channel.greeting.say);
const messageById = (config, id) => list(config?.messages).find((m) => isObj(m) && m.id === id);
const perLanguage = (text, config) => (isObj(text) ? text : { [baseOf(readSimple(config).primaryLanguage) || 'en']: typeof text === 'string' ? text : '' });
export function linesToTranslate(config) {
  const greetings = [];
  list(config?.channels).forEach((channel) => {
    if (!greetsWith(channel)) return;
    const say = channel.greeting.say;
    const found = greetings.find((g) => JSON.stringify(g.say) === JSON.stringify(say));
    if (found) found.channels.push(channelName(channel.type));
    else greetings.push({ say, channels: [channelName(channel.type)] });
  });
  const lines = greetings.map((g, i) => {
    const message = isObj(g.say) && typeof g.say.message === 'string' ? messageById(config, g.say.message) : null;
    return {
      key: message ? `message:${message.id}` : `greeting:${i}`,
      label: greetings.length > 1 ? `What it says first (${g.channels.join(', ')})` : 'What it says first',
      text: perLanguage(message ? message.text : g.say, config),
    };
  });
  const goodbye = messageById(config, 'goodbye');
  if (goodbye && !lines.some((l) => l.key === 'message:goodbye'))
    lines.push({ key: 'message:goodbye', label: 'Its goodbye', text: perLanguage(goodbye.text, config) });
  return lines;
}
// Writes one of those lines in a language. A greeting typed into its channels becomes a fixed line (so it can have a
// text per language), and every channel that said it now says that line.
export function setTranslation(config, key, language, words) {
  const next = clone(config);
  const lang = baseOf(language);
  const write = (message) => {
    const text = { ...perLanguage(message.text, next) };
    if (words) text[lang] = words;
    else delete text[lang];
    message.text = text;
  };
  if (key.startsWith('message:')) {
    const message = messageById(next, key.slice('message:'.length));
    if (message) write(message);
    return next;
  }
  const index = Number(key.slice('greeting:'.length));
  const said = [];
  list(next.channels).forEach((c) => {
    if (greetsWith(c) && !said.some((s) => JSON.stringify(s) === JSON.stringify(c.greeting.say))) said.push(c.greeting.say);
  });
  const say = said[index];
  if (typeof say !== 'string') return next;
  const id = freshId(
    list(next.messages).map((m) => m?.id),
    'greeting',
  );
  const message = { id, text: say };
  write(message);
  next.messages = [...list(next.messages), message];
  list(next.channels).forEach((c) => {
    if (greetsWith(c) && c.greeting.say === say) c.greeting = { ...c.greeting, say: { message: id } };
  });
  return next;
}
