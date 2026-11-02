// More of what the Workflow edits, beside the blocks and arrows of models/workflow.ts: what an agent does as it takes
// over (on_enter), transfers to a phone number or to another agent of the workspace, an agent's own model, voice and
// interruption setting (its `overrides`), ready-made pieces (templates), the call's state variables and event hooks,
// and sticky notes (kept in this browser only: the server refuses fields it doesn't know). Every config edit writes
// only schema paths and returns a new config. Pure apart from the notes' browser storage, which may be missing.
import type { AgentConfig, AgentRole, ToolDefinition } from '../types/studio';
import type { ProvidersAnswer } from '../api/types';
import { llmProviders, providerLabels, ttsProviders } from '../data/providers';
import { VOICE_CATALOG } from '../data/voiceCatalog';
import { GOODBYE, freshId } from './setup';
import { connect, entryOf } from './workflow';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = <T = unknown,>(v: unknown): T[] => Array.isArray(v) ? v as T[] : [];
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const agentsOf = (config: AgentConfig) => list<AgentRole>(config?.agents?.items).filter((a) => isObj(a) && typeof a.id === 'string' && a.id !== '');
const agentAt = (config: AgentConfig, id: string) => list<AgentRole>(config?.agents?.items).find((a) => isObj(a) && a.id === id);
const toolAt = (config: AgentConfig, id: string) => list<Json>(config?.tools).find((t) => isObj(t) && t.id === id);
export const isBuiltin = (tool: unknown, name: string): boolean => isObj(tool) && (tool.type === 'builtin' || !tool.type && !!tool.builtin) && tool.builtin === name;
/** Every id a new tool must not take: tools, and the tool names hand-offs give the model. */
const takenToolIds = (config: AgentConfig) => [
...list<Json>(config.tools).map((t) => String(t?.id ?? '')),
...list<AgentRole>(config.agents?.items).flatMap((a) => [...list<string>(a?.tools), ...list<Json>(a?.handoffs).map((h) => String(h?.tool ?? ''))])];


// ---- what an agent does as it takes over (agents.items[].on_enter) --------------------------------------------------
export type EnterStep = Json & {type?: string;};

/** A step in a sentence: “Says “Hello””, “Remembers plan = ''”, else what kind it is. */
export function describeEnterStep(step: unknown, config: AgentConfig): string {
  if (!isObj(step)) return 'A step this panel can’t read';
  const say = (v: unknown) => {
    if (typeof v === 'string') return v;
    if (isObj(v) && typeof v.message === 'string') {
      const line = list<Json>(config.messages).find((m) => isObj(m) && m.id === v.message);
      return typeof line?.text === 'string' ? line.text : `the line “${v.message}”`;
    }
    return '';
  };
  switch (step.type) {
    case 'say':
      return `Says “${say(step.text) || '…'}”`;
    case 'set_state':{
        const values = isObj(step.values) ? Object.keys(step.values) : [];
        return values.length ? `Remembers ${values.join(', ')}` : 'Remembers a value (none chosen yet)';
      }
    case 'handoff':
      return `Passes the caller to ${agentAt(config, String(step.to))?.name || String(step.to ?? '…')}`;
    case 'return_to_entry':
      return 'Goes back to the agent that answers first';
    case 'end_call':
      return 'Ends the conversation';
    case 'transfer':
      return `Transfers the call (${String(step.transfer ?? '…')})`;
    case 'generate':
      return 'Says something the model writes';
    default:
      return typeof step.type === 'string' ? `Runs a “${step.type.replace(/_/g, ' ')}” step` : 'A step this panel can’t read';
  }
}

function pushEnter(config: AgentConfig, agentId: string, step: EnterStep): AgentConfig {
  if (!agentAt(config, agentId)) return config;
  const next = clone(config);
  const agent = agentAt(next, agentId) as AgentRole;
  agent.on_enter = [...list(agent.on_enter), step];
  return next;
}

/** Adds a line the agent says as it takes over. */
export const addSay = (config: AgentConfig, agentId: string, text = 'Hello! How can I help you today?') => pushEnter(config, agentId, { type: 'say', text });

/** A value that suits a state variable's type, to start from. */
export function blankValue(variable: unknown): unknown {
  const v = isObj(variable) ? variable : {};
  switch (v.type) {
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'enum':
      return list<string>(v.values)[0] ?? '';
    case 'object':
      return {};
    case 'array':
      return [];
    default:
      return '';
  }
}

/** Adds an “update state” step, starting with the first state variable (or none when there is none yet). */
export function addUpdateState(config: AgentConfig, agentId: string): AgentConfig {
  const first = Object.entries(isObj(config?.state?.variables) ? config.state.variables as Json : {})[0];
  return pushEnter(config, agentId, { type: 'set_state', values: first ? { [first[0]]: blankValue(first[1]) } : {} });
}

/** Moves an on-enter step earlier (-1) or later (+1): the order matters (a line said before a hand-off, say). */
export function moveEnterStep(config: AgentConfig, agentId: string, index: number, delta: number): AgentConfig {
  const steps = list(agentAt(config, agentId)?.on_enter);
  const to = index + delta;
  if (index < 0 || index >= steps.length || to < 0 || to >= steps.length) return config;
  const next = clone(config);
  const agent = agentAt(next, agentId) as AgentRole;
  const own = list(agent.on_enter);
  const [step] = own.splice(index, 1);
  own.splice(to, 0, step);
  agent.on_enter = own;
  return next;
}

/** Takes an on-enter step away; an emptied list goes. */
export function removeEnterStep(config: AgentConfig, agentId: string, index: number): AgentConfig {
  const steps = list(agentAt(config, agentId)?.on_enter);
  if (index < 0 || index >= steps.length) return config;
  const next = clone(config);
  const agent = agentAt(next, agentId) as AgentRole;
  const rest = steps.filter((_, i) => i !== index);
  if (rest.length) agent.on_enter = rest;else
  delete agent.on_enter;
  return next;
}

// ---- transfers ------------------------------------------------------------------------------------------------------
const compact = (v: unknown) => String(v ?? '').replace(/[^0-9a-z]+/gi, '').toLowerCase();
const FALLBACK_LINE = 'Sorry, I can’t put you through right now. Someone will call you back.';

export interface TransferEdit {
  config: AgentConfig;
  /** The transfer tool the agent now uses ('' when nothing changed). */
  toolId: string;
  note: string;
}

function transferTool(next: AgentConfig, agentId: string, transfer: Json, description: string, base: string): string {
  const telephony = isObj(next.telephony) ? next.telephony as Json : {};
  const transfers = list<Json>(telephony.transfers);
  const transferId = freshId(transfers.map((t) => String(t?.id ?? '')), base);
  next.telephony = { ...telephony, transfers: [...transfers, { id: transferId, ...transfer }] };
  const toolId = freshId(takenToolIds(next), base.replace(/^to_/, 'transfer_to_'));
  next.tools = [...list<ToolDefinition>(next.tools), { id: toolId, type: 'builtin', builtin: 'transfer_or_callback', description, params: { transfer: transferId, fallback: [{ type: 'say', text: FALLBACK_LINE }] } }];
  const agent = agentAt(next, agentId) as AgentRole;
  agent.tools = [...list<string>(agent.tools), toolId];
  return toolId;
}

/**
 * “Transfer to a phone number”: a transfer to that number and the tool that uses it. The agent's own transfer to the
 * same number is reused, and so is one still waiting for a number (as the setup leaves it), so nothing is doubled.
 */
export function addPhoneTransfer(config: AgentConfig, agentId: string, number: string): TransferEdit {
  const agent = agentAt(config, agentId);
  const target = String(number ?? '').trim();
  if (!agent || !target) return { config, toolId: '', note: '' };
  const transferFor = (tool: Json | undefined) => list<Json>((config.telephony as Json | undefined)?.transfers).find((t) => isObj(t) && t.id === (tool?.params as Json | undefined)?.transfer);
  const own = list<string>(agent.tools).map((id) => toolAt(config, id)).filter((t): t is Json => isBuiltin(t, 'transfer_or_callback'));
  const same = own.find((t) => compact(transferFor(t)?.target) === compact(target) && compact(target) !== '');
  if (same) return { config, toolId: String(same.id), note: `${agent.name || agent.id} already transfers to ${target}.` };
  const waiting = own.find((t) => {
    const transfer = transferFor(t);
    const blank = transfer && (transfer.target === undefined || typeof transfer.target === 'string' && !transfer.target.trim());
    return blank && agentsOf(config).filter((a) => list(a.tools).includes(t.id)).length === 1;
  });
  if (waiting) {
    const next = clone(config);
    const transfer = list<Json>((next.telephony as Json).transfers).find((t) => isObj(t) && t.id === (waiting.params as Json).transfer) as Json;
    transfer.target = target;
    return { config: next, toolId: String(waiting.id), note: `The transfer that was waiting for a number now goes to ${target}.` };
  }
  const next = clone(config);
  const digits = compact(target) || 'person';
  const toolId = transferTool(next, agentId, { description: 'Hand the caller to a person.', method: 'sip_refer', target }, 'The caller asks for a person, or you cannot help.', `to_${digits}`);
  return { config: next, toolId, note: `${agent.name || agent.id} can now transfer callers to ${target}.` };
}

/** Another agent of the workspace a call can be put through to: by one of its phone numbers. */
export interface WorkspaceAgent {
  id: string;
  name: string;
  numbers: {number: string;environment: string;}[];
}

/** GET /numbers (a list, or { numbers: [...] }) with the workspace's agents, as agents and their numbers. */
export function workspaceAgents(bots: {id: string;name?: string;}[], numbersAnswer: unknown, selfId: string): WorkspaceAgent[] {
  const rows = Array.isArray(numbersAnswer) ? numbersAnswer : isObj(numbersAnswer) && Array.isArray(numbersAnswer.numbers) ? numbersAnswer.numbers : [];
  const botOf = (n: Json) => typeof n.bot === 'string' ? n.bot : isObj(n.bot) && typeof n.bot.id === 'string' ? n.bot.id : typeof n.bot_id === 'string' ? n.bot_id : '';
  const numbers = (rows as unknown[]).filter((n): n is Json => isObj(n) && typeof n.number === 'string' && !!botOf(n)).map((n) => ({ bot: botOf(n), number: String(n.number), environment: typeof n.environment === 'string' ? n.environment : '' }));
  return bots.
  filter((b) => b.id !== selfId).
  map((b) => ({ id: b.id, name: b.name || b.id, numbers: numbers.filter((n) => n.bot === b.id).map(({ number, environment }) => ({ number, environment })) }));
}

/** “Transfer to another agent”: a transfer to that agent's first number, and the tool this agent uses for it. */
export function addTransferToAgent(config: AgentConfig, agentId: string, other: WorkspaceAgent, environment = ''): TransferEdit {
  const agent = agentAt(config, agentId);
  const number = (other.numbers.find((n) => n.environment === environment) ?? other.numbers[0])?.number;
  if (!agent || !number) return { config, toolId: '', note: '' };
  const already = list<string>(agent.tools).map((id) => toolAt(config, id)).find((t) => {
    const transfer = list<Json>((config.telephony as Json | undefined)?.transfers).find((x) => isObj(x) && x.id === ((t?.params as Json | undefined)?.transfer));
    return isBuiltin(t, 'transfer_or_callback') && compact(transfer?.target) === compact(number);
  });
  if (already) return { config, toolId: String(already.id), note: `${agent.name || agent.id} already transfers to ${other.name}.` };
  const next = clone(config);
  const toolId = transferTool(next, agentId, { description: `Transfer to ${other.name}.`, method: 'sip_refer', target: number }, `The caller needs ${other.name}.`, `to_${other.id.replace(/-/g, '_')}`);
  return { config: next, toolId, note: `${agent.name || agent.id} can now put callers through to ${other.name} (${number}).` };
}

// ---- an agent's own settings (agents.items[].overrides, merged over the defaults by the runtime) --------------------
const own = (agent: AgentRole): Json => isObj(agent?.overrides) ? agent.overrides as Json : {};
const ownSlot = (agent: AgentRole, stage: 'llm' | 'tts'): Json => {
  const models = own(agent).models;
  return isObj(models) && isObj(models[stage]) ? models[stage] as Json : {};
};

/** The agent with one override set (or removed when `value` is undefined), dropping any parts left empty. */
export function withOverride(agent: AgentRole, path: string[], value: unknown): AgentRole {
  const next = clone(agent);
  const root: Json = isObj(next.overrides) ? next.overrides as Json : {};
  next.overrides = root;
  let at = root;
  const trail = [root];
  path.slice(0, -1).forEach((key) => {
    at[key] = isObj(at[key]) ? at[key] : {};
    at = at[key] as Json;
    trail.push(at);
  });
  const last = path[path.length - 1];
  if (value === undefined) delete at[last];else
  at[last] = value;
  for (let i = path.length - 2; i >= 0; i -= 1) {
    const parent = trail[i];
    if (!Object.keys(parent[path[i]] as Json).length) delete parent[path[i]];
  }
  if (!Object.keys(root).length) delete next.overrides;
  return next;
}

const PROVIDER_KEYS = ['provider', 'api_key', 'base_url', 'options'];
const without = (slot: Json, keys: string[]) => {
  const next = { ...slot };
  keys.forEach((k) => delete next[k]);
  return next;
};
const providerName = (id: string) => providerLabels[id] ?? id;
const secretFor = (provider: string, answer: ProvidersAnswer | null, catalogue: {id: string;secret: string;}[]) =>
answer?.providers?.find((p) => p.name === provider)?.default_secret || catalogue.find((p) => p.id === provider)?.secret || '';

export interface OverrideOption {
  value: string;
  label: string;
  group: string;
}

/** The agent's own AI model as "provider|model", '' while it uses the default. */
export function llmChoice(agent: AgentRole, config: AgentConfig): string {
  const llm = ownSlot(agent, 'llm');
  return typeof llm.model === 'string' && llm.model ? `${String(llm.provider ?? config.defaults?.models?.llm?.provider ?? '')}|${llm.model}` : '';
}
export function defaultLlm(config: AgentConfig): string {
  const { provider = '', model = '' } = config.defaults?.models?.llm ?? {};
  const label = llmProviders.find((p) => p.id === provider)?.models.find((m) => m.id === model)?.label ?? model;
  return model ? `${label} (${providerName(provider)})` : 'Not chosen yet';
}
/** Catalogue models of the providers the server can run (every one while it hasn't said); the agent's own choice stays. */
export function llmOptions(agent: AgentRole, answer: ProvidersAnswer | null, config: AgentConfig): OverrideOption[] {
  const known = answer?.providers;
  const runnable = (id: string) => !known?.length || known.some((p) => p.name === id && p.stages.includes('llm') && p.installed !== false);
  const options = llmProviders.filter((p) => p.models.length && runnable(p.id)).flatMap((p) => p.models.map((m) => ({ value: `${p.id}|${m.id}`, label: m.label, group: providerName(p.id) })));
  const mine = llmChoice(agent, config);
  if (mine && !options.some((o) => o.value === mine)) {
    const [provider, model] = mine.split('|');
    options.unshift({ value: mine, label: model, group: providerName(provider) });
  }
  return options;
}
/** Sets (or, with '', removes) the agent's own model; another provider brings its own key, its own settings stay. */
export function setLlm(agent: AgentRole, value: string, config: AgentConfig, answer: ProvidersAnswer | null = null): AgentRole {
  const slot = ownSlot(agent, 'llm');
  if (!value) {
    const rest = without(slot, [...PROVIDER_KEYS, 'model']);
    return withOverride(agent, ['models', 'llm'], Object.keys(rest).length ? rest : undefined);
  }
  const [provider, model] = value.split('|');
  const fallback = config.defaults?.models?.llm?.provider ?? '';
  const before = String(slot.provider ?? fallback);
  let next: Json = { ...slot, model };
  if (provider !== before) {
    next = without(next, PROVIDER_KEYS);
    if (provider !== fallback) {
      next.provider = provider;
      const secret = secretFor(provider, answer, llmProviders);
      if (secret) next.api_key = { secret };
    }
  }
  return withOverride(agent, ['models', 'llm'], next);
}

const lower = (v: unknown) => String(v ?? '').toLowerCase();
/** The agent's own voice as "engine|voiceId", '' while it uses the default. */
export function voiceChoice(agent: AgentRole, config: AgentConfig): string {
  const tts = ownSlot(agent, 'tts');
  return typeof tts.voice_id === 'string' && tts.voice_id ? `${lower(tts.provider ?? config.defaults?.models?.tts?.provider)}|${tts.voice_id}` : '';
}
export function defaultVoice(config: AgentConfig): string {
  const tts = config.defaults?.models?.tts;
  const voice = VOICE_CATALOG.find((v) => v.voiceId === tts?.voice_id);
  return voice ? `${voice.name} (${voice.provider})` : tts?.voice_id || 'Not chosen yet';
}
export function voiceOptions(agent: AgentRole, config: AgentConfig): OverrideOption[] {
  const options = VOICE_CATALOG.map((v) => ({ value: `${lower(v.provider)}|${v.voiceId}`, label: `${v.name}, ${v.style.toLowerCase()}`, group: v.provider }));
  const mine = voiceChoice(agent, config);
  if (mine && !options.some((o) => o.value === mine)) options.unshift({ value: mine, label: mine.split('|')[1], group: providerName(mine.split('|')[0]) });
  return options;
}
/** Sets (or removes) the agent's own voice; another engine brings that engine's first model and its key. */
export function setVoice(agent: AgentRole, value: string, config: AgentConfig, answer: ProvidersAnswer | null = null): AgentRole {
  const slot = ownSlot(agent, 'tts');
  if (!value) {
    const rest = without(slot, [...PROVIDER_KEYS, 'model', 'voice_id']);
    return withOverride(agent, ['models', 'tts'], Object.keys(rest).length ? rest : undefined);
  }
  const [engine, voiceId] = value.split('|');
  const fallback = lower(config.defaults?.models?.tts?.provider);
  const before = lower(slot.provider ?? fallback);
  let next: Json = { ...slot, voice_id: voiceId };
  if (engine !== before) {
    next = without(next, [...PROVIDER_KEYS, 'model']);
    if (engine !== fallback) {
      next.provider = engine;
      const model = ttsProviders.find((p) => p.id === engine)?.models[0]?.id;
      if (model) next.model = model;
      const secret = secretFor(engine, answer, ttsProviders);
      if (secret) next.api_key = { secret };
    }
  }
  return withOverride(agent, ['models', 'tts'], next);
}

const INTERRUPTION = ['conversation', 'turn_handling', 'interruption', 'enabled'];
/** Whether a caller can interrupt this agent: its own yes or no, undefined while it follows the default. */
export function interruptChoice(agent: AgentRole): boolean | undefined {
  const conversation = own(agent).conversation as Json | undefined;
  const value = ((conversation?.turn_handling as Json | undefined)?.interruption as Json | undefined)?.enabled;
  return typeof value === 'boolean' ? value : undefined;
}
export const defaultInterrupt = (config: AgentConfig) => config?.defaults?.conversation?.turn_handling?.interruption?.enabled !== false;
export const setInterrupt = (agent: AgentRole, value: boolean | undefined) => withOverride(agent, INTERRUPTION, value);

/** The config with one agent replaced (by id). */
export function replaceAgent(config: AgentConfig, agent: AgentRole): AgentConfig {
  const next = clone(config);
  const items = list<AgentRole>(next.agents?.items);
  const i = items.findIndex((a) => isObj(a) && a.id === agent.id);
  if (i < 0) return config;
  items[i] = agent;
  return next;
}

// ---- templates: ready-made pieces, each made of the same edits as the canvas ------------------------------------------
export const DEFAULT_ROLE = 'Describe what this agent does for the caller, and how it should talk.';

/** A new specialist that `fromId` hands callers to when `when` holds; returns its id. */
export function addSubagent(config: AgentConfig, fromId: string, { name = 'New agent', when = '', role = DEFAULT_ROLE }: {name?: string;when?: string;role?: string;} = {}): {config: AgentConfig;id: string;} {
  const next = clone(config);
  const items = list<AgentRole>(next.agents?.items);
  const id = freshId(items.map((a) => isObj(a) ? a.id : undefined), name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'agent');
  next.agents = { ...(next.agents ?? {}), items: [...items, { id, name, kind: 'specialist', instructions: { role }, tools: [] }] };
  if (!next.agents.entry) next.agents.entry = id;
  if (!agentAt(next, fromId) || fromId === id) return { config: next, id };
  const linked = connect(next, fromId, id);
  if (linked.refused) return { config: next, id };
  const from = agentAt(linked.config, fromId) as AgentRole;
  const handoffs = list<Json>(from.handoffs);
  if (when && handoffs.length) handoffs[handoffs.length - 1].description = when;
  return { config: linked.config, id };
}

/** Whether `from` can already pass the caller back to `to`: a hand-off, the “back to the start” tool, a tool's rules. */
function goesBack(config: AgentConfig, from: string, to: string): boolean {
  const agent = agentAt(config, from);
  if (!agent) return false;
  if (list<Json>(agent.handoffs).some((h) => h?.to === to)) return true;
  return list<string>(agent.tools).some((id) => {
    const tool = toolAt(config, id);
    if (isBuiltin(tool, 'return_to_entry') && to === entryOf(config)) return true;
    return JSON.stringify(tool?.effects ?? []).includes(`"to":"${to}"`);
  });
}

const canEnd = (config: AgentConfig, agent: AgentRole) => list<string>(agent.tools).some((id) => isBuiltin(toolAt(config, id), 'end_call'));

/** Lets an agent end the conversation, reusing the agent's one end-call tool when there is one. */
export function addEnd(config: AgentConfig, agentId: string): AgentConfig {
  const agent = agentAt(config, agentId);
  if (!agent || canEnd(config, agent)) return config;
  const next = clone(config);
  let tool = list<Json>(next.tools).find((t) => isBuiltin(t, 'end_call'));
  if (!tool) {
    if (!list<Json>(next.messages).some((m) => m?.id === GOODBYE.id)) next.messages = [...list<Json>(next.messages), { ...GOODBYE }];
    tool = { id: freshId(takenToolIds(next), 'end_call'), type: 'builtin', builtin: 'end_call', description: 'Ends the conversation. Use it after saying goodbye, when the person has nothing more to ask.', params: { say: { message: GOODBYE.id } } };
    next.tools = [...list<ToolDefinition>(next.tools), tool as unknown as ToolDefinition];
  }
  const target = agentAt(next, agentId) as AgentRole;
  target.tools = [...list<string>(target.tools), String(tool.id)];
  return next;
}

export interface Template {
  id: 'specialists' | 'back' | 'end';
  title: string;
  description: string;
  /** Why it would add nothing here ('' when it can be used). */
  unavailable: (config: AgentConfig) => string;
  apply: (config: AgentConfig) => {config: AgentConfig;select: string | null;note: string;};
}

export const TEMPLATES: Template[] = [
{
  id: 'specialists',
  title: 'Front desk with specialists',
  description: 'The agent that answers first greets callers and passes them to Sales or Support.',
  unavailable: (config) => agentsOf(config).length ? '' : 'Add the first agent first.',
  apply(config) {
    const from = entryOf(config);
    const sales = addSubagent(config, from, {
      name: 'Sales',
      when: 'The caller wants to buy something, or asks about prices or plans.',
      role: 'You help callers choose and buy. Answer questions about prices and plans, and take orders. Keep answers short and friendly.'
    });
    const support = addSubagent(sales.config, from, {
      name: 'Support',
      when: 'The caller has a problem with something they already have.',
      role: 'You help callers fix problems with what they already have. Ask what is wrong, then go through it with them step by step.'
    });
    return { config: support.config, select: sales.id, note: 'Added Sales and Support. The agent that answers first passes callers to them.' };
  }
},
{
  id: 'back',
  title: 'Back to the first agent',
  description: 'Each agent a caller is passed to can pass them back when they need something else.',
  unavailable(config) {
    const entry = entryOf(config);
    if (agentsOf(config).length < 2) return 'There is only one agent.';
    return agentsOf(config).some((a) => a.id !== entry && !goesBack(config, a.id, entry)) ? '' : 'Every agent can already pass callers back.';
  },
  apply(config) {
    const entry = entryOf(config);
    let next = config;
    agentsOf(config).
    filter((a) => a.id !== entry && !goesBack(config, a.id, entry)).
    forEach((a) => {
      const linked = connect(next, a.id, entry);
      if (linked.refused) return;
      next = linked.config;
      const from = agentAt(next, a.id) as AgentRole;
      const handoffs = list<Json>(from.handoffs);
      handoffs[handoffs.length - 1].description = 'The caller needs something this agent can’t help with.';
    });
    return { config: next, select: null, note: `Every agent can now pass callers back to ${agentAt(config, entry)?.name || entry}.` };
  }
},
{
  id: 'end',
  title: 'Every agent can end the conversation',
  description: 'Each agent can say goodbye and end the conversation when the caller has nothing more to ask.',
  unavailable: (config) => agentsOf(config).some((a) => !canEnd(config, a)) ? '' : 'Every agent can already end the conversation.',
  apply(config) {
    let next = config;
    agentsOf(config).filter((a) => !canEnd(config, a)).forEach((a) => {
      next = addEnd(next, a.id);
    });
    return { config: next, select: null, note: 'Every agent can now end the conversation.' };
  }
}];


// ---- state variables and event hooks ----------------------------------------------------------------------------------
export const STATE_TYPES = ['string', 'integer', 'number', 'boolean', 'enum', 'object', 'array'] as const;
export const EVENT_KINDS: {value: string;label: string;}[] = [
{ value: 'call_started', label: 'When a call starts' },
{ value: 'call_ended', label: 'When a call ends' },
{ value: 'handoff', label: 'On a hand-off' },
{ value: 'tool_error', label: 'When a tool fails' },
{ value: 'session_error', label: 'On a session error' },
{ value: 'escalation', label: 'On an escalation' },
{ value: 'inactivity', label: 'When the caller is quiet too long' },
{ value: 'transfer_succeeded', label: 'When a transfer works' },
{ value: 'transfer_failed', label: 'When a transfer fails' },
{ value: 'state_changed', label: 'When a remembered value changes' },
{ value: 'guardrail_triggered', label: 'When a guardrail matches' },
{ value: 'limit_reached', label: 'When a call limit is reached' }];


/** Why a name can't be a state variable ('' when it can): the schema's pattern, and not one already there. */
export function stateNameProblem(config: AgentConfig, name: string): string {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(name)) return 'Use lowercase letters, digits and underscores, starting with a letter.';
  if (isObj(config.state?.variables) && name in (config.state?.variables as Json)) return 'There is already a value with that name.';
  return '';
}

/** Adds a state variable of a type (an enum starts with one value, which the schema needs). */
export function addStateVariable(config: AgentConfig, name: string, type: string): AgentConfig {
  if (stateNameProblem(config, name)) return config;
  const next = clone(config);
  const state = isObj(next.state) ? next.state as Json : {};
  const variables = isObj(state.variables) ? state.variables as Json : {};
  variables[name] = type === 'enum' ? { type, values: ['first'] } : { type };
  next.state = { ...state, variables };
  return next;
}

/** Takes a state variable away; the section goes when nothing is left. */
export function removeStateVariable(config: AgentConfig, name: string): AgentConfig {
  const variables = config.state?.variables;
  if (!isObj(variables) || !(name in variables)) return config;
  const next = clone(config);
  const vars = (next.state as Json).variables as Json;
  delete vars[name];
  if (!Object.keys(vars).length) delete next.state;
  return next;
}

/** Adds an event hook with nothing to do yet (the checks say what it still needs). */
export function addEvent(config: AgentConfig, on: string): AgentConfig {
  const next = clone(config);
  next.events = [...list<Json>(next.events), { on, do: [] }];
  return next;
}

// ---- sticky notes (this browser only) ---------------------------------------------------------------------------------
export interface StickyNote {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  color: NoteColor;
}
export type NoteColor = 'yellow' | 'blue' | 'green' | 'pink' | 'grey';
export const NOTE_COLORS: NoteColor[] = ['yellow', 'blue', 'green', 'pink', 'grey'];
export const NOTE_SIZE = { w: 240, h: 150 };
// A note's id never matches a block's (block ids have no "::note::"), so the canvas can hold both.
const NOTE_PREFIX = '::note::';
export const isNoteId = (id: string) => id.startsWith(NOTE_PREFIX);
const noteKey = (botId: string) => `weave_workflow_notes:${botId}`;
const isNote = (n: unknown): n is StickyNote =>
isObj(n) && typeof n.id === 'string' && [n.x, n.y, n.w, n.h].every((v) => Number.isFinite(v)) && typeof n.text === 'string';

/** The notes kept in this browser for an agent ([] when there are none or storage is unavailable). */
export function readNotes(botId: string): StickyNote[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(noteKey(botId)) || '[]');
    return Array.isArray(parsed) ? parsed.filter(isNote).map((n) => ({ ...n, id: isNoteId(n.id) ? n.id : `${NOTE_PREFIX}${n.id}`, color: NOTE_COLORS.includes(n.color) ? n.color : 'yellow' })) : [];
  } catch {
    return [];
  }
}
export function writeNotes(botId: string, notes: StickyNote[]): void {
  try {
    if (notes.length) window.localStorage.setItem(noteKey(botId), JSON.stringify(notes));else
    window.localStorage.removeItem(noteKey(botId));
  } catch {
    // storage unavailable or full: the notes last until the page is closed
  }
}
/** A new note centred on `at` (the middle of the view), with an unused id. */
export function newNote(notes: StickyNote[], at: {x: number;y: number;}): StickyNote {
  let n = notes.length + 1;
  while (notes.some((x) => x.id === `${NOTE_PREFIX}${n}`)) n += 1;
  return { id: `${NOTE_PREFIX}${n}`, x: Math.round(at.x - NOTE_SIZE.w / 2), y: Math.round(at.y - NOTE_SIZE.h / 2), w: NOTE_SIZE.w, h: NOTE_SIZE.h, text: '', color: 'yellow' };
}

// ---- where a new block goes ------------------------------------------------------------------------------------------
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The nearest place at or below `want` (then to either side) where a block of `size` covers none of `taken`. */
export function freePlace(want: {x: number;y: number;}, size: {w: number;h: number;}, taken: Box[], gap = 24): {x: number;y: number;} {
  const hit = (x: number, y: number) => taken.some((b) => x < b.x + b.w + gap && x + size.w + gap > b.x && y < b.y + b.h + gap && y + size.h + gap > b.y);
  for (let k = 0; k < 12; k += 1) {
    const x = want.x + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * (size.w + gap);
    for (let row = 0; row < 30; row += 1) {
      const y = want.y + row * (size.h + gap);
      if (!hit(x, y)) return { x, y };
    }
  }
  return want;
}
