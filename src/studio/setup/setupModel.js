// The guided setup: what each step reads from the agent's configuration and how each choice changes it. Every change
// here is complete on its own: a tool is switched on for the agent that answers, a knowledge base is attached to it, a
// voice channel gets speech models, a form gets the tool that shows it. So a person never has to visit a second place
// to make the first one work. Pure: no network, no DOM.

import { REACH_WORDS, buildChannel } from '../form/presets.js';
import { FALLBACK as CHANNEL_KINDS, infoOf } from '../form/channelTypes.js';
import { CALLBACK_MESSAGE, STARTERS, addPersonHandoff } from '../starters.ts';
import { freshId } from '../form/references.js';
import { addDefaultSpeechModels } from '../models/config.js';
import { LANGUAGES, channelName, entryAgentIndex, readSimple, setPrimaryLanguage } from '../simple/simpleModel.js';
import { baseOf } from '../form/messages.ts';
import { agentLabel, humanize } from '../agent/rowNames.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const clone = (v) => JSON.parse(JSON.stringify(v));

// ---- the steps ------------------------------------------------------------------------------------------------------------------------------------
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

const entryOf = (config) => list(config?.agents?.items)[entryAgentIndex(config)] || null;

// Applies `change` to a copy of the configuration's entry agent (the one that answers first). A configuration with no agent comes back unchanged.
function withEntry(config, change) {
  const index = entryAgentIndex(config);
  if (index < 0) return config;
  const next = clone(config);
  change(next.agents.items[index], next);
  return next;
}

// ---- where people reach it
// -------------------------------------------------------------------------------------------------------------------------
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

// Switches one way of reaching it on or off. A new channel is added as `addChannel` adds one (below). The last way that
// is on can't be switched off (an agent needs one): `{ config, refused }` says so. Every other channel that is on
// counts, of any kind, as long as conversations can arrive on it: `types` is the server's list of kinds (GET
// /channel-types), which says which kinds run today (WhatsApp, SMS and email don't yet).
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

// A channel added to the others, ready to work: it says the first line the agent already says (as text, or the same
// fixed line, so its translations come too), and one people talk to brings what a voice needs. The reach choices add
// theirs this way, and so does Add on the Channels page, so both give the same.
export function addChannel(config, channel, { providers } = {}) {
  const next = clone(config);
  const added = clone(channel);
  const say = firstLineOf(next);
  if (say !== undefined && isObj(added.greeting)) added.greeting = { ...added.greeting, say };
  next.channels = [...list(next.channels), added];
  const audio = ['input', 'output'].some((way) => list(added.modalities?.[way]).includes('audio'));
  return audio ? readyForVoice(next, providers) : next;
}

// The first line the agent already says, as the configuration has it (text, or a fixed line), from the first channel
// that says one; undefined when none does.
export const firstLineOf = (config) => list(config?.channels).find((c) => isObj(c) && isObj(c.greeting) && saysSomething(c.greeting.say))?.greeting.say;

// Gives the channel at `index` the first line the agent already says: a channel left waiting for the person to start
// can say it too. Unchanged when there is no first line to give.
export function shareFirstLine(config, index) {
  const say = firstLineOf(config);
  const channel = list(config?.channels)[index];
  if (say === undefined || !isObj(channel)) return config;
  const next = clone(config);
  next.channels[index].greeting = { ...(isObj(channel.greeting) ? channel.greeting : {}), say: clone(say) };
  return next;
}

// What a channel people talk to needs: speech models (when none are set) and the recording notice said before the greeting (when there is none).
function readyForVoice(config, providers) {
  const next = addDefaultSpeechModels(config, providers).config;
  if (next.persona?.disclosures?.recording_notice) return next;
  return { ...next, persona: { ...(next.persona || {}), disclosures: { ...(next.persona?.disclosures || {}), recording_notice: RECORDING_NOTICE } } };
}

const saysSomething = (say) => (typeof say === 'string' && say.trim() !== '') || (isObj(say) && typeof say.message === 'string' && say.message !== '');
// a kind of channel in the middle of a sentence ("WhatsApp", "SMS", "email")
const kindWord = (type) => (type === 'email' ? 'email' : channelName(type));

export const usesVoice = (config) => readSimple(config).voiceChannel;

// ---- language -------------------------------------------------------------------------------------------------------------------------------------
// The main language a new agent starts with: the first of the person's own languages (the browser's) that the studio knows, exactly or by its base
// language, else English (United States). It is shown on the language step, where it can be changed.
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

// ---- what it knows
// ----------------------------------------------------------------------------------------------------------------------------------
// The setup's knowledge base: searched on every turn ("inject") by the agent that answers, so nothing else has to be
// set for it to be used.
export const KNOWLEDGE_ID = 'knowledge';

// The base under that id, and whether it is the setup's: only one of documents and web pages ("vector_store") is. One
// of another kind under the same id (your own search service) has nothing to list, and the simple controls leave it as
// it is.
const knowledgeBase = (config) => list(config?.knowledge).find((b) => isObj(b) && b.id === KNOWLEDGE_ID) || null;
const ownBase = (config) => {
  const base = knowledgeBase(config);
  return base?.type === 'vector_store' ? base : null;
};
// One page however it was typed: "https://example.com" and "https://example.com/" are the same address.
const pageKey = (url) => {
  try {
    return new URL(url).href;
  } catch {
    return String(url);
  }
};
const isPage = (s) => isObj(s) && s.type === 'url' && typeof s.url === 'string' && s.url !== '';
const sameSource = (kind, value) => (s) =>
  isObj(s) && (kind === 'file' ? s.type === 'file' && s.file_id === value : isPage(s) && pageKey(s.url) === pageKey(value));

export function knowledgeOf(config) {
  const sources = list(ownBase(config)?.sources).filter(isObj);
  // each page once, also when the base lists one twice (or once with a slash at the end and once without)
  const pages = sources.filter(isPage).filter((s, i, all) => all.findIndex((other) => pageKey(other.url) === pageKey(s.url)) === i);
  return {
    files: [...new Set(sources.filter((s) => s.type === 'file' && s.file_id).map((s) => s.file_id))],
    pages: pages.map((s) => s.url),
    // how far each page is followed: 0 the page alone, 1 the pages it links to as well
    depths: Object.fromEntries(pages.map((s) => [s.url, Number(s.crawl_depth) || 0])),
    attached: list(entryOf(config)?.knowledge).includes(KNOWLEDGE_ID),
  };
}

// What uses the setup's base: the agents that read it on every turn, and the knowledge tools that search it (by id).
function usesOf(config) {
  return {
    agents: list(config?.agents?.items)
      .filter((a) => isObj(a) && list(a.knowledge).includes(KNOWLEDGE_ID))
      .map((a) => a.id),
    tools: list(config?.tools)
      .filter((t) => isObj(t) && t.type === 'knowledge' && t.source === KNOWLEDGE_ID)
      .map((t) => t.id),
  };
}
// "Billing", "Billing and Sales", "Billing, Sales and Support"
const together = (words) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words[0] || '');

// What uses any base in the draft: the agents that read it (on every turn, or through a knowledge tool they have) and the knowledge tools that search
// it, by id.
export function readersOf(config, baseId) {
  const tools = list(config?.tools).filter((t) => isObj(t) && t.type === 'knowledge' && t.source === baseId);
  const toolIds = tools.map((t) => t.id);
  return {
    agents: list(config?.agents?.items)
      .filter((a) => isObj(a) && (list(a.knowledge).includes(baseId) || list(a.tools).some((id) => toolIds.includes(id))))
      .map((a) => a.id),
    tools: toolIds,
  };
}

// The same in a sentence: "Read by Billing and Sales in every conversation. Searched by the “Search policies” tool." ('' when nothing uses it)
export function readersInWords(config, baseId) {
  const { tools } = readersOf(config, baseId);
  const every = list(config?.agents?.items)
    .filter((a) => isObj(a) && list(a.knowledge).includes(baseId))
    .map((a) => agentLabel(config, a.id));
  const toolWords = tools.map((id) => {
    const users = list(config?.agents?.items).filter((a) => isObj(a) && list(a.tools).includes(id));
    const by = users.length ? ` (${together(users.map((a) => agentLabel(config, a.id)))})` : ' (no agent has it yet)';
    return `the “${humanize(id)}” tool${by}`;
  });
  return [every.length ? `Read by ${together(every)} in every conversation.` : '', toolWords.length ? `Looked up with ${together(toolWords)}.` : '']
    .filter(Boolean)
    .join(' ');
}

// "Let <agent> use it": a base nothing reads is given to the agent that answers. One read on every turn ("inject") goes
// in its knowledge; one searched when needed ("tool") gets a knowledge tool (a tool that already searches it is reused)
// and the agent is given that tool. Unchanged when it already reads it, or when there is no agent.
export function attachBase(config, baseId) {
  const base = list(config?.knowledge).find((b) => isObj(b) && b.id === baseId);
  const index = entryAgentIndex(config);
  if (!base || index < 0) return config;
  const next = clone(config);
  const agent = next.agents.items[index];
  if ((base.mode || 'tool') === 'inject') {
    if (list(agent.knowledge).includes(baseId)) return config;
    agent.knowledge = [...list(agent.knowledge), baseId];
    return next;
  }
  let tool = list(next.tools).find((t) => isObj(t) && t.type === 'knowledge' && t.source === baseId);
  if (!tool) {
    const taken = [...list(next.tools).map((t) => t?.id), ...list(next.agents.items).flatMap((a) => list(a?.tools))];
    tool = {
      id: freshId(taken, `search_${baseId}`),
      type: 'knowledge',
      source: baseId,
      description: `Search ${humanize(baseId).toLowerCase()} when the caller asks something it may answer.`,
    };
    next.tools = [...list(next.tools), tool];
  }
  if (list(agent.tools).includes(tool.id)) return config;
  agent.tools = [...list(agent.tools), tool.id];
  return next;
}

// Who reads the documents and pages, for the Knowledge page: the agent that answers (or, before there are any, the agent that will), else the agents
// that do (several agents, and the base given to another one in the Workflow).
export function whoReadsKnowledge(config) {
  const entryId = entryOf(config)?.id;
  const { agents } = usesOf(config);
  if (!agents.length || (agents.length === 1 && agents[0] === entryId)) return 'The agent that answers reads them in every conversation.';
  const words = together(agents.map((id) => (id === entryId ? 'the agent that answers' : agentLabel(config, id))));
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} ${agents.length === 1 ? 'reads' : 'read'} them in every conversation.`;
}

// Why the last document or page has to stay, or '' when it can go. A base needs one, so with none left the base goes:
// not while another agent reads it or a tool searches it (they would point at nothing), nor when it has settings
// someone chose for it (they would be lost with it).
const SETUP_KEYS = ['id', 'type', 'mode', 'sources'];
function whyLastStays(config) {
  const entryId = entryOf(config)?.id;
  const { agents, tools } = usesOf(config);
  const others = agents.filter((id) => id !== entryId);
  if (others.length)
    return `${together(others.map((id) => agentLabel(config, id)))} ${others.length === 1 ? 'answers' : 'answer'} from these, so the last one can’t be removed: add another first.`;
  if (tools.length)
    return `The ${together(tools.map(humanize))} tool${tools.length === 1 ? ' searches' : 's search'} these, so the last one can’t be removed: add another first.`;
  if (Object.keys(ownBase(config) || {}).some((key) => !SETUP_KEYS.includes(key)))
    return 'These have their own search settings, so the last one can’t be removed: add another first, or delete the base under Settings.';
  return '';
}

function setSources(config, change) {
  // the id is taken by a base of another kind: nothing here can hold documents or pages
  if (knowledgeBase(config) && !ownBase(config)) return config;
  const next = clone(config);
  const all = list(next.knowledge);
  let base = ownBase(next);
  if (!base) {
    base = { id: KNOWLEDGE_ID, type: 'vector_store', mode: 'inject', sources: [] };
    all.push(base);
  }
  base.sources = change(list(base.sources));
  const index = entryAgentIndex(next);
  const agent = index >= 0 ? next.agents.items[index] : null;
  if (base.sources.length) {
    next.knowledge = all;
    // a base no agent reads yet is read by the agent that answers; one an agent already reads (with several agents, maybe another one), or one made
    // elsewhere, keeps how it was set up
    if (agent && base.mode === 'inject' && !usesOf(next).agents.length) agent.knowledge = [...list(agent.knowledge), KNOWLEDGE_ID];
  } else {
    // a base needs a source: with none left it goes, and so does the agent's use of it (removeKnowledge first makes sure nothing else uses it)
    next.knowledge = all.filter((b) => b !== base);
    if (!next.knowledge.length) delete next.knowledge;
    if (agent && Array.isArray(agent.knowledge)) {
      agent.knowledge = agent.knowledge.filter((id) => id !== KNOWLEDGE_ID);
      if (!agent.knowledge.length) delete agent.knowledge;
    }
  }
  return next;
}

export const addKnowledgeFile = (config, name) =>
  setSources(config, (sources) => (sources.some(sameSource('file', name)) ? sources : [...sources, { type: 'file', file_id: name }]));
//   linked: also read the pages it links to (one step away, on any site it
//   links to); added again (however it is typed), the page takes the new choice
export const addKnowledgePage = (config, url, { linked = false } = {}) =>
  setSources(config, (sources) => [...sources.filter((s) => !sameSource('url', url)(s)), { type: 'url', url, crawl_depth: linked ? 1 : 0 }]);
// Takes a document or page out: `{ config, refused }`. With none left the base goes too, unless something else needs it: then the last one stays, and
// `refused` says why.
export function removeKnowledge(config, kind, value) {
  const match = sameSource(kind, value);
  const refused = ownBase(config) && list(ownBase(config).sources).every(match) ? whyLastStays(config) : '';
  if (refused) return { config, refused };
  return { config: setSources(config, (sources) => sources.filter((s) => !match(s))), refused: '' };
}

// A web address a person typed, made whole ("example.com/help" → "https://example.com/help"), or '' when it isn't one:
// a name with a dot, made of letters, digits and hyphens and ending in a word ("example.com", not "example..com" or
// "-.com"), or a numeric address typed in full ("10.0.0.5", not "1.2", which the browser reads as 1.0.0.2).
export function cleanUrl(value) {
  const typed = String(value || '').trim();
  if (!typed) return '';
  const withScheme = /^https?:\/\//i.test(typed) ? typed : `https://${typed}`;
  try {
    const url = new URL(withScheme);
    const host = url.hostname.replace(/\.$/, '');
    const parts = host.split('.');
    const named = parts.length > 1 && parts.every((part) => /^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?$/i.test(part)) && /[a-z]/i.test(parts[parts.length - 1]);
    const numeric = /^\d+(\.\d+){3}$/.test(host) && withScheme.includes(host);
    return named || numeric ? url.href : '';
  } catch {
    return '';
  }
}

// ---- what it can do
// ---------------------------------------------------------------------------------------------------------------------------------
export const ACTIONS = [
  {
    id: 'end_call',
    icon: 'endCall',
    label: 'End the conversation politely',
    text: 'It says goodbye and ends the conversation when the person has nothing more to ask.',
  },
  { id: 'hand_over', icon: 'phoneTransfer', label: 'Pass people to a person on your team', text: 'When someone asks for a person, or it can’t help.' },
  { id: 'details', icon: 'records', label: 'Take people’s contact details', text: 'A short form in chat; on the phone it asks for them in conversation.' },
  {
    id: 'lookup',
    icon: 'plug',
    label: 'Look something up in your own system',
    text: 'For example an order’s status, from a web address your system answers on.',
  },
];
export const DETAIL_FIELDS = [
  { name: 'name', label: 'Name', type: 'text' },
  { name: 'phone', label: 'Phone number', type: 'phone' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'message', label: 'Message', type: 'textarea' },
];

const IDS = { end_call: 'end_call', hand_over: 'escalate_to_human', details: 'collect_details', lookup: 'look_up' };
const TRANSFER_ID = 'human_support';
const FORM_ID = 'contact_details';
const CONNECTION_ID = 'your_system';
const GOODBYE = { id: 'goodbye', text: 'Thank you for getting in touch. Goodbye!' };

// Something a switch made: its own id, or that id with a number when the plain one was already taken by something else ("end_call_2").
const isOwn = (id, base) => typeof id === 'string' && (id === base || new RegExp(`^${base}_\\d+$`).test(id));
const toolIds = (config) => list(config?.tools).map((t) => t?.id);

// The tools each switch stands for. Ending the conversation and passing to a person are any tool of that kind; the contact details and the lookup are
// only the switch's own (a form or a web service set up for something else is not taken over).
const IS_TOOL = {
  end_call: (t) => t.type === 'builtin' && t.builtin === 'end_call',
  hand_over: (t) => t.type === 'builtin' && t.builtin === 'transfer_or_callback',
  // the one that shows the switch's own form: a tool that shows a form of the person's own is theirs, whatever it is called
  details: (t) => t.type === 'builtin' && t.builtin === 'send_form' && isOwn(t.params?.form, FORM_ID),
  lookup: (t) => t.type === 'http' && isOwn(t.id, IDS.lookup),
};
// Those the agent that answers has come first, then the switch's own.
function toolsFor(config, action) {
  const has = list(entryOf(config)?.tools);
  const rank = (t) => (has.includes(t.id) ? 0 : isOwn(t.id, IDS[action]) ? 1 : 2);
  return list(config?.tools)
    .filter((t) => isObj(t) && typeof t.id === 'string' && IS_TOOL[action](t))
    .sort((a, b) => rank(a) - rank(b));
}
const offered = (config, id) => !!id && list(entryOf(config)?.tools).includes(id);

// The switch at the top of the Tools page that stands for a tool (the one whose tool it is: the first of its kind, the agent's own first), as
// { id, label, on }, or null for a tool no switch shows.
export function switchOf(config, toolId) {
  if (typeof toolId !== 'string' || !toolId) return null;
  const action = ACTIONS.find((a) => toolsFor(config, a.id)[0]?.id === toolId);
  return action ? { id: action.id, label: action.label, on: offered(config, toolId) } : null;
}

// The parts of the configuration that point at an id, by the field that holds it: a tool in an agent's list or a rule's
// `tool` (a guardrail, a task step, a test), a transfer, a form or a connection by its own field (a tool's, or an
// action's anywhere), a fixed line by `{ message }`. Returns the top-level sections they are in ('agents',
// 'guardrails'...). A switch never deletes what one of them still uses.
const POINTERS = {
  tools: ['tool', 'then', 'tool_called', 'tool_not_called'],
  transfers: ['transfer'],
  forms: ['form'],
  connections: ['connection', 'server', 'via'],
  messages: ['message'],
};
function usedIn(config, kind, id) {
  const keys = POINTERS[kind];
  const found = new Set();
  const visit = (node, key, section) => {
    if (Array.isArray(node)) {
      if (kind === 'tools' && key === 'tools' && node.includes(id)) found.add(section);
      node.forEach((item) => visit(item, key, section));
    } else if (isObj(node))
      Object.entries(node).forEach(([k, v]) => {
        if (typeof v !== 'string') visit(v, k, section || k);
        else if (keys.includes(k) && v === id) found.add(section || k);
      });
  };
  visit(config, '', '');
  return [...found];
}
// The same, in words: "a rule under Guardrails"
const PLACES = { agents: 'another agent', guardrails: 'a rule under Guardrails', tasks: 'a multi-step task', tests: 'a test' };
const placesOf = (sections) => [...new Set(sections.map((s) => PLACES[s] || 'another part of the agent'))];

// What is switched on, and the details each one has. An action counts as on when the agent that answers is given its
// tool. Switched off, `kept` says why its tool is still there (something else uses it); it is only there when it says
// something.
export function actionsOf(config) {
  const [end, hand, form, lookup] = ['end_call', 'hand_over', 'details', 'lookup'].map((a) => toolsFor(config, a)[0] || null);
  const transfer = list(config?.telephony?.transfers).find((t) => isObj(t) && t.id === hand?.params?.transfer);
  const formDef = list(config?.forms).find((f) => isObj(f) && f.id === (form?.params?.form || FORM_ID));
  const state = (action, tool) => {
    const on = offered(config, tool?.id);
    const places = on ? [] : placesOf(toolsFor(config, action).flatMap((t) => usedIn(config, 'tools', t.id)));
    const words = together(places);
    return { on, ...(words ? { kept: `${words[0].toUpperCase()}${words.slice(1)} still ${places.length > 1 ? 'use' : 'uses'} it, so it is kept.` } : {}) };
  };
  return {
    end_call: state('end_call', end),
    hand_over: {
      ...state('hand_over', hand),
      number: typeof transfer?.target === 'string' ? transfer.target : '',
      // the number is chosen by what the caller wants (a lookup): it is changed under Phone transfers, not here
      ...(transfer && transfer.target != null && typeof transfer.target !== 'string' ? { numberElsewhere: true } : {}),
    },
    details: {
      ...state('details', form),
      fields: list(formDef?.fields)
        .map((f) => f?.name)
        .filter(Boolean),
    },
    lookup: { ...state('lookup', lookup), ...lookupDetails(config, lookup) },
  };
}

// Takes the switch's tools away from the agent that answers. One the switch made also goes out of the configuration
// once nothing uses it any more (no other agent, guardrail rule, task step or test), with what only it used (`extra`,
// and the fixed lines it said); one made by hand stays in the list of tools, for the person to delete there.
function dropTools(config, action, extra = () => {}) {
  const ids = toolsFor(config, action).map((t) => t.id);
  if (!ids.length) return config;
  return withEntry(config, (agent, next) => {
    agent.tools = list(agent.tools).filter((id) => !ids.includes(id));
    ids
      .filter((id) => isOwn(id, IDS[action]) && !usedIn(next, 'tools', id).length)
      .forEach((id) => {
        const tool = list(next.tools).find((t) => t?.id === id);
        next.tools = list(next.tools).filter((t) => t !== tool);
        dropLines(next, tool);
        extra(next, tool);
      });
  });
}
const giveTool = (config, id) =>
  withEntry(config, (agent) => {
    if (!list(agent.tools).includes(id)) agent.tools = [...list(agent.tools), id];
  });

// The fixed lines a removed tool said (its goodbye, its callback line) go with it while nothing else says them and they
// still read as the studio wrote them. A line the person reworded or translated stays, and is said again when the
// switch is turned back on.
const STUDIO_LINES = [GOODBYE.text, CALLBACK_MESSAGE.text, ...STARTERS.map((s) => s.goodbye).filter(Boolean)];
const untouched = (line) => Object.keys(line).every((k) => k === 'id' || k === 'text') && STUDIO_LINES.includes(line.text);
export function dropLines(next, tool) {
  const ids = [];
  const visit = (node) => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (isObj(node)) Object.entries(node).forEach(([k, v]) => (k === 'message' && typeof v === 'string' ? ids.push(v) : visit(v)));
  };
  visit(tool);
  ids.forEach((id) => {
    const line = list(next.messages).find((m) => isObj(m) && m.id === id);
    if (!line || !untouched(line) || usedIn(next, 'messages', id).length) return;
    next.messages = list(next.messages).filter((m) => m !== line);
    if (!next.messages.length) delete next.messages;
  });
}

export function setEndCall(config, on) {
  if (!on) return dropTools(config, 'end_call');
  const existing = toolsFor(config, 'end_call')[0];
  if (existing) return giveTool(config, existing.id);
  const next = clone(config);
  if (!list(next.messages).some((m) => m?.id === GOODBYE.id)) next.messages = [...list(next.messages), { ...GOODBYE }];
  const id = freshId(toolIds(next), IDS.end_call);
  next.tools = [
    ...list(next.tools),
    {
      id,
      type: 'builtin',
      builtin: 'end_call',
      description: 'Ends the conversation. Use it after saying goodbye, when the person has nothing more to ask.',
      params: { say: { message: GOODBYE.id } },
    },
  ];
  return giveTool(next, id);
}

// The number goes on the transfer the hand-over uses; with no number it still works, and says the callback line instead. A transfer that is missing
// (deleted under Phone transfers) is made again, so the switch never reads on over a hand-over with nowhere to go. A number chosen by what the caller
// wants (a lookup) is not replaced from here.
export function setHandOver(config, on, { number } = {}) {
  if (!on)
    return dropTools(config, 'hand_over', (next, tool) => {
      const transfer = tool?.params?.transfer;
      if (!isOwn(transfer, TRANSFER_ID) || usedIn(next, 'transfers', transfer).length || !isObj(next.telephony)) return;
      next.telephony.transfers = list(next.telephony.transfers).filter((t) => t?.id !== transfer);
      if (!next.telephony.transfers.length) delete next.telephony.transfers;
      if (!Object.keys(next.telephony).length) delete next.telephony;
    });
  const existing = toolsFor(config, 'hand_over')[0];
  const next = clone(existing ? giveTool(config, existing.id) : addPersonHandoff(config, { id: freshId(toolIds(config), IDS.hand_over) }));
  const tool = toolsFor(next, 'hand_over')[0];
  if (!tool) return next;
  tool.params = isObj(tool.params) ? tool.params : {};
  if (!tool.params.transfer) tool.params.transfer = TRANSFER_ID;
  const telephony = isObj(next.telephony) ? next.telephony : {};
  let transfer = list(telephony.transfers).find((t) => isObj(t) && t.id === tool.params.transfer);
  if (!transfer) {
    transfer = {
      id: tool.params.transfer,
      description: 'A person to take over. Add the number to transfer to; until then the callers hear the fallback line.',
      method: 'sip_refer',
      target: '',
    };
    next.telephony = { ...telephony, transfers: [...list(telephony.transfers), transfer] };
  }
  if (number !== undefined && (transfer.target == null || typeof transfer.target === 'string')) transfer.target = String(number).trim();
  return next;
}

// A phone call has no screen: the agent asks for the same details in conversation, in this sentence.
const askInWords = (fields) => `Could you tell me your ${listWords(fields.map((f) => String(f.label || f.name).toLowerCase()))}?`;
const detailField = (f) => ({ name: f.name, label: f.label, type: f.type, ...(f.name === 'name' ? { required: true } : {}) });

// What is wrong with a number to pass calls to, in a sentence ('' when it looks dialable): with its country code ("+65 6123 4567"), or an address of
// the phone system ("sip:desk@pbx.example.com"). Spaces, dashes, dots and brackets are fine; they are how people write numbers.
export function numberProblem(typed) {
  const value = String(typed || '').trim();
  if (!value || /^sips?:\S+@\S+$/i.test(value)) return '';
  const digits = value.replace(/[\s().-]/g, '');
  if (/^\+[1-9]\d{6,14}$/.test(digits)) return '';
  return digits.startsWith('+')
    ? 'This doesn’t look like a whole number: check the digits after the country code.'
    : 'Write it with the country code, for example +65 6123 4567, or calls can’t be passed on.';
}

// The contact details: a form, and the tool that shows it. `fields` are the details it asks for (names from
// DETAIL_FIELDS). When the form is already there, only a detail ticked or unticked changes: its other fields, its
// wording and what happens when it is sent stay as they are.
export function setDetails(config, on, { fields } = {}) {
  if (!on)
    return dropTools(config, 'details', (next, tool) => {
      const formId = tool?.params?.form;
      if (!isOwn(formId, FORM_ID) || usedIn(next, 'forms', formId).length) return;
      next.forms = list(next.forms).filter((f) => f?.id !== formId);
      if (!next.forms.length) delete next.forms;
    });
  const existing = toolsFor(config, 'details')[0];
  const next = clone(config);
  const formId = existing?.params?.form || FORM_ID;
  const form = list(next.forms).find((f) => isObj(f) && f.id === formId);
  if (!form) {
    const chosen = DETAIL_FIELDS.filter((f) => (fields && fields.length ? fields : ['name', 'phone']).includes(f.name));
    next.forms = [
      ...list(next.forms),
      { id: formId, title: 'Your details', fields: chosen.map(detailField), submit_label: 'Send', otherwise: [{ type: 'say', text: askInWords(chosen) }] },
    ];
  } else if (fields && fields.length) {
    const had = list(form.fields).filter(isObj);
    const known = DETAIL_FIELDS.map((f) => f.name);
    const kept = had.filter((f) => !known.includes(f.name) || fields.includes(f.name));
    const added = DETAIL_FIELDS.filter((f) => fields.includes(f.name) && !had.some((h) => h.name === f.name)).map(detailField);
    // a form needs a field: the last one stays
    if (kept.length + added.length) {
      const said = list(form.otherwise);
      // the sentence said on the phone follows the fields, while it is still the one written for them
      if (said.length === 1 && isObj(said[0]) && said[0].type === 'say' && said[0].text === askInWords(had))
        form.otherwise = [{ ...said[0], text: askInWords([...kept, ...added]) }];
      form.fields = [...kept, ...added];
    }
  }
  let id = existing?.id;
  if (!id) {
    id = freshId(toolIds(next), IDS.details);
    next.tools = [
      ...list(next.tools),
      {
        id,
        type: 'builtin',
        builtin: 'send_form',
        description: 'Use when you need the person’s contact details, for example to arrange a callback.',
        params: { form: formId },
      },
    ];
  }
  return giveTool(next, id);
}

const listWords = (words) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0] || 'details');
const paramName = (words) =>
  String(words || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 40) || 'value';

// The lookup as the setup asks for it: the web address (with the person's answer in {curly brackets}), what it finds,
// and what it needs from the person. Read back from the tool and its connection, the query included, so the step shows
// what was set and saving it unchanged writes the same request.
//   param: the name the answer is sent under
function readLookup(config, tool) {
  if (!tool) return { url: '', finds: '', needs: '', param: '' };
  const connection = isObj(config?.connections) ? config.connections[tool.connection] : null;
  const param = Object.keys(tool.parameters?.properties || {})[0] || '';
  const needs = String(tool.parameters?.properties?.[param]?.description || param).replace(/^The /, '');
  const answer = new RegExp(`\\{\\{\\s*args\\.${param}\\s*\\}\\}`, 'g');
  const slot = (text) => (param ? String(text).replace(answer, `{${needs}}`) : String(text));
  const base = String(connection?.base_url || '').replace(/\/$/, '');
  // a "%" in the path stands for itself: written as %25, it reads back the same
  const path = slot(String(tool.request?.path || '').replace(/%/g, '%25'));
  const query = Object.entries(isObj(tool.request?.query) ? tool.request.query : {});
  const elsewhere = answer.test(String(tool.request?.path || '')) || query.some(([k, v]) => k !== param && String(v).match(answer));
  // the answer added at the end because the address had no {curly brackets} is not shown: saving adds it again
  const shown = query.filter(([k, v]) => elsewhere || k !== param || String(v).trim() !== `{{args.${param}}}`);
  const encode = (text) => String(text).replace(/[%&=#+]/g, encodeURIComponent);
  const search = shown.map(([k, v]) => `${encode(k)}=${encode(slot(v))}`).join('&');
  const finds = String(tool.description || '').match(/^Looks up (.*?)\. /)?.[1] || '';
  return { url: `${base}${path}${search ? `?${search}` : ''}`, finds, needs, param };
}
function lookupDetails(config, tool) {
  const { url, finds, needs } = readLookup(config, tool);
  return { url, finds, needs };
}

// An address with its base cut off, when it starts with that base ("https://crm.example.com/api/v1" + "/bookings/…"), else null.
function pathUnder(base, address) {
  let start = String(base || '').replace(/\/+$/, '');
  try {
    const u = new URL(start);
    start = `${u.origin}${decodeURI(u.pathname).replace(/\/+$/, '')}`;
  } catch {
    // not a plain address (a value filled in at run time): compared as written
  }
  if (!start) return null;
  if (address === start) return '/';
  return address.startsWith(`${start}/`) ? address.slice(start.length) : null;
}

// "https://shop.example.com/orders/{order number}" → connection base https://shop.example.com, path
// /orders/{{args.order_number}}. No curly brackets: the answer is sent as a query value. `{ config, problem }`: problem
// is set (and the configuration unchanged) when the address isn't usable. A lookup that is there is changed only where
// the answers changed: its connection keeps its sign-in and headers, its request its method, body and headers; an
// address on a connection it already has keeps that connection, and one that other tools share is never moved.
export function setLookup(config, on, { url, finds, needs } = {}) {
  if (!on)
    return {
      config: dropTools(config, 'lookup', (next, tool) => {
        const id = tool?.connection;
        if (!isOwn(id, CONNECTION_ID) || !isObj(next.connections) || usedIn(next, 'connections', id).length) return;
        delete next.connections[id];
        if (!Object.keys(next.connections).length) delete next.connections;
      }),
      problem: '',
    };
  const existing = toolsFor(config, 'lookup')[0] || null;
  const was = readLookup(config, existing);
  const same = (a, b) => String(a || '').trim() === String(b || '').trim();
  const typed = String(url || '').trim();
  // nothing changed: the tool stays exactly as it is (it may hold more than these three answers show)
  if (existing && same(typed, was.url) && same(finds, was.finds) && same(needs, was.needs)) return { config: giveTool(config, existing.id), problem: '' };
  if (!String(needs || '').trim()) return { config, problem: 'Say what it needs from the person, for example “order number”.' };
  const param = existing && same(needs, was.needs) && was.param ? was.param : paramName(needs);
  const next = clone(config);
  const tool = existing ? list(next.tools).find((t) => t?.id === existing.id) : { id: freshId(toolIds(next), IDS.lookup), type: 'http' };
  const request = isObj(tool.request) ? tool.request : { method: 'GET' };
  if (!existing || !same(typed, was.url)) {
    // {{templates}} written by hand stay as they are; each {answer} becomes the person's answer
    const kept = [];
    const marked = typed.replace(/\{\{[^{}]*\}\}/g, (t) => `__keep${kept.push(t) - 1}__`);
    const hasSlot = /\{[^{}]*\}/.test(marked);
    const withSlots = marked.replace(/\{[^{}]*\}/g, `__${param}__`);
    if (!cleanUrl(withSlots)) return { config, problem: 'Type the web address your system answers on, starting with https://.' };
    const parsed = new URL(/^https?:\/\//i.test(withSlots) ? withSlots : `https://${withSlots}`);
    if (/__keep\d+__/.test(parsed.origin) || parsed.origin.includes(`__${param}__`))
      return { config, problem: 'Put the curly brackets after the site’s name, for example https://shop.example.com/orders/{order number}.' };
    let pathname;
    try {
      pathname = decodeURI(parsed.pathname);
    } catch {
      return { config, problem: 'There is a stray “%” in the web address. Check it and try again.' };
    }
    const restore = (text) => text.replaceAll(`__${param}__`, `{{args.${param}}}`).replace(/__keep(\d+)__/g, (m, n) => kept[Number(n)] ?? m);
    const address = restore(`${parsed.origin}${pathname}`);
    const query = Object.fromEntries([...parsed.searchParams.entries()].map(([k, v]) => [restore(k), restore(v)]));
    if (!hasSlot) query[param] = `{{args.${param}}}`;
    // the connection: one it already has that the address starts with, or another web service set up for this address; else its own, moved to the new
    // address when nothing else uses it; else a new one
    const connections = isObj(next.connections) ? next.connections : {};
    const http = (id) => isObj(connections[id]) && connections[id].type === 'http';
    const candidates = [tool.connection, ...Object.keys(connections).filter((id) => id !== tool.connection)].filter((id) => id && http(id));
    let connectionId = candidates.find((id) => pathUnder(connections[id].base_url, address) !== null);
    let path = connectionId ? pathUnder(connections[connectionId].base_url, address) : restore(pathname) || '/';
    if (!connectionId) {
      const others = { ...next, tools: list(next.tools).filter((t) => t !== tool) };
      if (http(tool.connection) && !usedIn(others, 'connections', tool.connection).length) {
        connectionId = tool.connection;
        connections[connectionId] = { ...connections[connectionId], base_url: parsed.origin };
      } else {
        connectionId = freshId(Object.keys(connections), CONNECTION_ID);
        connections[connectionId] = { type: 'http', base_url: parsed.origin };
      }
      path = restore(pathname) || '/';
    }
    next.connections = connections;
    tool.connection = connectionId;
    request.path = path;
    if (Object.keys(query).length) request.query = query;
    else delete request.query;
  }
  // a new name for the answer is used wherever the request sends it
  if (was.param && was.param !== param) {
    const from = new RegExp(`\\{\\{\\s*args\\.${was.param}\\s*\\}\\}`, 'g');
    const rename = (node) =>
      typeof node === 'string'
        ? node.replace(from, `{{args.${param}}}`)
        : Array.isArray(node)
          ? node.map(rename)
          : isObj(node)
            ? Object.fromEntries(Object.entries(node).map(([k, v]) => [k, rename(v)]))
            : node;
    Object.assign(request, rename(request));
  }
  tool.request = { ...request, method: request.method || 'GET' };
  if (!existing || !same(finds, was.finds) || !same(needs, was.needs))
    tool.description = `Looks up ${String(finds || 'what the person asks about').trim()}. Use it when the person asks, once you have their ${String(needs).trim()}.`;
  const properties = isObj(tool.parameters?.properties) ? { ...tool.parameters.properties } : {};
  const before = isObj(properties[was.param]) ? properties[was.param] : {};
  delete properties[was.param];
  delete properties[param];
  tool.parameters = {
    ...(isObj(tool.parameters) ? tool.parameters : {}),
    type: 'object',
    required: [param, ...list(tool.parameters?.required).filter((r) => r !== was.param && r !== param)],
    // the answer first: it is the one the switch reads back
    properties: {
      [param]: { type: 'string', ...before, description: same(needs, was.needs) && before.description ? before.description : `The ${String(needs).trim()}` },
      ...properties,
    },
  };
  if (!existing) next.tools = [...list(next.tools), tool];
  return { config: giveTool(next, tool.id), problem: '' };
}

// ---- where each step stands
// --------------------------------------------------------------------------------------------------------------------------
const DEFAULT_ROLE = /^You are a helpful assistant\. Answer briefly and politely\.$/;
const norm = (text) =>
  String(text || '')
    .replace(/\s+/g, ' ')
    .trim();

// Whether the instructions are still a starter's own words, untouched: they work, but say nothing about this business, so the step asks for more.
export const isStarterRole = (role) => {
  const text = norm(role);
  return !!text && STARTERS.some((s) => s.role && norm(s.role) === text);
};

// 'done' | 'todo' | 'optional' for each step. `progress`: what the setup remembers (`tried`); `summary`: the agent as listed (what is live where).
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

// The step a problem the checks found belongs to, by where it is in the configuration; '' when no step of the setup asks for it.
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
