// The guided setup's knowledge part: the setup's own base of documents and web pages, who reads each base, and
// adding, attaching and removing what it knows.

import { freshId } from '../form/references.js';
import { entryAgentIndex } from '../simple/simpleModel.js';
import { agentLabel, humanize } from '../agent/rowNames.js';
import { clone, entryOf, isObj, list, together } from './setupBasics.js';

// ---- what it knows
// The setup's knowledge base: searched every turn ("inject") by the agent that answers, so nothing else needs setting.
export const KNOWLEDGE_ID = 'knowledge';

// The base under that id, if it is the setup's kind (documents and web pages, "vector_store"). A base of another kind
// under the same id (your own search service) has nothing to list, and the simple controls leave it alone.
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
  // each page once, even when the base lists it twice (or with and without a slash at the end)
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

// What uses a base: the agents that read it (every turn, or through their knowledge tool) and the tools that search it.
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

// readersOf in a sentence, e.g. "Read by Billing and Sales in every conversation." ('' when nothing uses it)
export function readersInWords(config, baseId) {
  const every = list(config?.agents?.items)
    .filter((a) => isObj(a) && list(a.knowledge).includes(baseId))
    .map((a) => agentLabel(config, a.id));
  return [every.length ? `Read by ${together(every)} in every conversation.` : '', lookedUpWith(config, baseId)].filter(Boolean).join(' ');
}

// The knowledge tools that search a base, in a sentence: "Looked up with the “Search faq” tool (Billing)." ('' if none)
export function lookedUpWith(config, baseId) {
  const toolWords = readersOf(config, baseId).tools.map((id) => {
    const users = list(config?.agents?.items).filter((a) => isObj(a) && list(a.tools).includes(id));
    const by = users.length ? ` (${together(users.map((a) => agentLabel(config, a.id)))})` : ' (no agent has it yet)';
    return `the “${humanize(id)}” tool${by}`;
  });
  return toolWords.length ? `Looked up with ${together(toolWords)}.` : '';
}

// "Let <agent> use it": gives an unused base to the agent that answers. An "inject" base goes in its knowledge; a
// "tool" base gets a knowledge tool (reusing one that already searches it). Unchanged if already read or no agent.
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
  const tool = ensureKnowledgeTool(next, baseId);
  if (list(agent.tools).includes(tool.id)) return config;
  agent.tools = [...list(agent.tools), tool.id];
  return next;
}

// The knowledge tool that searches a base, made (with a description the model can use) when there is none. Changes
// `next` itself: call it on a copy.
function ensureKnowledgeTool(next, baseId) {
  let tool = list(next.tools).find((t) => isObj(t) && t.type === 'knowledge' && t.source === baseId);
  if (!tool) {
    const taken = [...list(next.tools).map((t) => t?.id), ...list(next.agents?.items).flatMap((a) => list(a?.tools))];
    tool = {
      id: freshId(taken, `search_${baseId}`),
      type: 'knowledge',
      source: baseId,
      description: `Search ${humanize(baseId).toLowerCase()} when the caller asks something it may answer.`,
    };
    next.tools = [...list(next.tools), tool];
  }
  return tool;
}

// Which agents read a base, and setting them, the one way its mode allows (agent config guide 2.11; the server's check
// refuses the other way): an "inject" base is in the agent's own `knowledge` list and no knowledge tool may search it;
// a "tool" base is searched through a knowledge tool in the agent's `tools` and is not in its `knowledge` list.
export const baseReaders = (config, baseId) => readersOf(config, baseId).agents;
export function setBaseReaders(config, baseId, agentIds) {
  const base = list(config?.knowledge).find((b) => isObj(b) && b.id === baseId);
  if (!base || !isObj(config?.agents)) return config;
  const next = clone(config);
  const inject = (base.mode || 'tool') === 'inject';
  const searching = new Set(
    list(next.tools)
      .filter((t) => isObj(t) && t.type === 'knowledge' && t.source === baseId)
      .map((t) => t.id),
  );
  const tool = !inject && agentIds.length ? ensureKnowledgeTool(next, baseId) : null;
  next.agents.items = list(next.agents.items).map((agent) => {
    if (!isObj(agent)) return agent;
    const wanted = agentIds.includes(agent.id);
    const knowledge = list(agent.knowledge).filter((k) => k !== baseId);
    if (wanted && inject) knowledge.push(baseId);
    // an agent that already searches it through a tool of its own keeps that tool
    const hasOwn = list(agent.tools).some((t) => searching.has(t));
    let tools = list(agent.tools);
    if (inject || !wanted) tools = tools.filter((t) => !searching.has(t) && t !== tool?.id);
    else if (!hasOwn) tools = [...tools, tool.id];
    const changed = { ...agent, knowledge, tools };
    if (!knowledge.length) delete changed.knowledge;
    if (!tools.length && !('tools' in agent)) delete changed.tools;
    return changed;
  });
  // a knowledge tool on an "inject" base is refused by the server's check: it goes (the agents' lists were cleared above)
  if (inject) next.tools = list(next.tools).filter((t) => !(isObj(t) && searching.has(t.id)));
  if (!list(next.tools).length && !Array.isArray(config.tools)) delete next.tools;
  return next;
}
// Changing how a base is searched keeps the same agents reading it, moved to the way the new mode allows.
export function setBaseMode(config, baseId, mode) {
  const at = list(config?.knowledge).findIndex((b) => isObj(b) && b.id === baseId);
  if (at < 0) return config;
  const readers = baseReaders(config, baseId);
  const next = clone(config);
  if (mode === undefined || mode === '') delete next.knowledge[at].mode;
  else next.knowledge[at].mode = mode;
  return setBaseReaders(next, baseId, readers);
}

// Who reads the documents and pages, for the Knowledge page: the agent that answers (or will answer), else the agents
// that do (with several agents, or a base given to another one in the Workflow).
export function whoReadsKnowledge(config) {
  const entryId = entryOf(config)?.id;
  const { agents } = usesOf(config);
  if (!agents.length || (agents.length === 1 && agents[0] === entryId)) return 'The agent that answers reads them in every conversation.';
  const words = together(agents.map((id) => (id === entryId ? 'the agent that answers' : agentLabel(config, id))));
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} ${agents.length === 1 ? 'reads' : 'read'} them in every conversation.`;
}

// Why the last document or page must stay ('' when it can go). With none left the base goes, so it stays while another
// agent reads it or a tool searches it (they'd point at nothing), or while it has its own settings (they'd be lost).
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
    // a base nobody reads yet is given to the agent that answers; one already read (maybe by another agent), or made
    // elsewhere, keeps its setup
    if (agent && base.mode === 'inject' && !usesOf(next).agents.length) agent.knowledge = [...list(agent.knowledge), KNOWLEDGE_ID];
  } else {
    // with no sources left the base goes, and so does the agent's use of it (removeKnowledge checks nothing else does)
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
//   linked: also read the pages it links to (one step away, on any site); re-adding a page takes the new choice
export const addKnowledgePage = (config, url, { linked = false } = {}) =>
  setSources(config, (sources) => [...sources.filter((s) => !sameSource('url', url)(s)), { type: 'url', url, crawl_depth: linked ? 1 : 0 }]);
// Takes a document or page out: `{ config, refused }`. Removing the last one removes the base too, unless something
// else needs it: then it stays and `refused` says why.
export function removeKnowledge(config, kind, value) {
  const match = sameSource(kind, value);
  const refused = ownBase(config) && list(ownBase(config).sources).every(match) ? whyLastStays(config) : '';
  if (refused) return { config, refused };
  return { config: setSources(config, (sources) => sources.filter((s) => !match(s))), refused: '' };
}

// A typed web address made whole ("example.com/help" → "https://example.com/help"), or '' when it isn't one: a dotted
// name ending in a word ("example.com", not "-.com"), or a full numeric address ("1.2" would become 1.0.0.2).
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
