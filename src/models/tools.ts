// Plain facts about tools, for the Tools page: what kind a tool is in words, whether the runtime runs it yet, which
// agents use it (and whether anything uses it at all), advice on its settings, the cards "Add a tool" offers, and the
// edits the page makes (add, delete, give to an agent). Pure: no React, no network.
import type { AgentConfig, ToolDefinition } from '../types/studio';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = <T = unknown,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ---- what kind a tool is ------------------------------------------------------------------------------------------

/** The kinds the runtime does not run yet (the validator's "unsupported" list), so "Add a tool" can say so first. */
export const UNSUPPORTED_KINDS: Record<string, string> = {
  mcp: 'MCP server tools',
  code: 'Custom code tools',
};

export function kindOfTool(tool: unknown): string {
  if (!isObj(tool)) return '';
  if (typeof tool.type === 'string' && tool.type) return tool.type;
  return tool.builtin ? 'builtin' : '';
}

/** null when the runtime can run it, otherwise what it can't. */
export function notAvailable(tool: unknown): string | null {
  return UNSUPPORTED_KINDS[kindOfTool(tool)] ?? null;
}

/** One line on what each built-in action does. */
export const BUILTIN_HELP: Record<string, string> = {
  end_call: 'Ends the conversation. It says a goodbye line first, which is done in code so it is never skipped. Give the agent this so it can hang up.',
  transfer_or_callback:
    'Hands the caller to a person, or runs its fallback (say a callback line, raise a ticket) when no one can take it: no target, closed hours, a failed transfer. Needs a phone transfer.',
  return_to_entry: 'A specialist sends the caller back to the agent that answers first, with a note of what is still needed.',
  send_dtmf: 'Sends keypad tones on the call (a phone call only).',
  collect_dtmf: 'Collects digits the caller presses (a phone call only).',
  send_form: 'Shows the caller a form. Needs a form; the channel must be able to show forms.',
  noop: 'Does nothing itself; only its rules run (change what is remembered, hand off). Use it for a tool whose whole job is a conditional hand-off.',
};

const PLAIN_KIND: Record<string, string> = {
  http: 'Looks something up',
  builtin: 'Built-in action',
  knowledge: 'Searches your knowledge',
  mcp: 'Uses another system’s tools',
  task: 'Multi-step task',
  code: 'Runs your own code',
};
const BUILTIN_WORDS: Record<string, string> = {
  end_call: 'Ends the call',
  transfer_or_callback: 'Hands over to a person',
  return_to_entry: 'Back to the first agent',
  send_form: 'Shows a form',
  collect_dtmf: 'Collects keypad digits',
  send_dtmf: 'Presses keypad tones',
  noop: 'Only runs its rules',
};
const CHANGES_THINGS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export const HTTP_WRITES = 'Sends something to your systems';

/** A web-request tool either reads (GET) or changes something (POST, PUT, PATCH, DELETE). */
export const changesSomething = (tool: unknown): boolean =>
  isObj(tool) && isObj(tool.request) && CHANGES_THINGS.has(String(tool.request.method ?? '').toUpperCase());

/** What a tool is, in words: a built-in by what it does, any other by its kind. */
export function plainToolKind(tool: unknown): string {
  if (!isObj(tool)) return '';
  const kind = kindOfTool(tool);
  if (kind === 'builtin' && typeof tool.builtin === 'string') return BUILTIN_WORDS[tool.builtin] ?? PLAIN_KIND.builtin;
  if (kind === 'http' && changesSomething(tool)) return HTTP_WRITES;
  return PLAIN_KIND[kind] ?? kind;
}

/** "billing_lookup" -> "Billing lookup". */
export const humanize = (id: unknown): string => {
  const t = String(id ?? '').replace(/[_-]+/g, ' ').trim();
  return t ? `${t[0].toUpperCase()}${t.slice(1)}` : '';
};

/** "Use when the caller asks for a person. Say …" -> "Use when the caller asks for a person." */
export const firstSentence = (text: unknown): string => (typeof text === 'string' ? (text.trim().match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text.trim()) : '');

const hostOf = (url: unknown): string => {
  try {
    return new URL(String(url ?? '').replace(/\{\{[^}]*\}\}/g, 'x')).host;
  } catch {
    return '';
  }
};

/** What a tool does, in one sentence (where it passes calls, what it searches...); '' when its kind says it all. */
export function toolDoes(config: AgentConfig, tool: unknown): string {
  if (!isObj(tool)) return '';
  const params = isObj(tool.params) ? tool.params : {};
  if (tool.builtin === 'transfer_or_callback') {
    const transfer = list<Json>(config?.telephony?.transfers).find((t) => isObj(t) && t.id === params.transfer);
    if (typeof transfer?.target === 'string' && transfer.target.trim()) return `It passes calls to ${transfer.target.trim()}.`;
    if (transfer && transfer.target != null && typeof transfer.target !== 'string') return 'The number is chosen from what the caller wants (under Phone transfers).';
    return 'No number yet: callers are offered a callback instead.';
  }
  if (tool.builtin === 'send_form' && typeof params.form === 'string') return `It shows the form “${humanize(params.form)}”.`;
  if (tool.type === 'knowledge' && typeof tool.source === 'string') return `It searches “${humanize(tool.source)}” on the Knowledge page.`;
  if (tool.type === 'http') {
    const conn = typeof tool.connection === 'string' ? tool.connection : '';
    const connections = (isObj(config?.connections) ? config.connections : {}) as Record<string, Json>;
    const host = hostOf(isObj(tool.request) ? tool.request.url : '') || (conn ? hostOf(connections[conn]?.base_url) : '');
    const verb = changesSomething(tool) ? 'sends to' : 'asks';
    if (host) return `It ${verb} ${host}${conn ? `, through the “${humanize(conn)}” connection` : ''}.`;
    return conn ? `It ${verb} the “${humanize(conn)}” connection.` : '';
  }
  return '';
}

// ---- who uses it ------------------------------------------------------------------------------------------------------

export function agentsUsingTool(config: AgentConfig, toolId: string): string[] {
  return list<Json>(config?.agents?.items)
    .filter((a) => isObj(a) && list(a.tools).includes(toolId))
    .map((a) => String(a.id ?? ''))
    .filter(Boolean);
}

/**
 * Whether something besides an agent's tool list names the tool (a guardrail rule, the off-topic action, a task step's
 * check, a test). Such a tool is in use even when no agent offers it; the validator agrees.
 */
export function toolNamedElsewhere(config: AgentConfig, toolId: string): boolean {
  const g = (isObj(config?.guardrails) ? config.guardrails : {}) as Json;
  const topics = (isObj(g.topics) ? g.topics : {}) as Json;
  const offTopic = (isObj(topics.on_off_topic) ? topics.on_off_topic : {}) as Json;
  if (list<Json>(g.escalation).some((r) => isObj(r) && r.tool === toolId) || offTopic.then === toolId) return true;
  if (list<Json>(config?.tasks).some((task) => isObj(task) && list<Json>(task.steps).some((s) => isObj(s) && isObj(s.validate) && s.validate.tool === toolId))) return true;
  return list<Json>(config?.tests).some(
    (test) =>
      isObj(test) &&
      (list<Json>(test.model_script).some((m) => isObj(m) && m.tool === toolId) ||
        list<Json>(test.expect).some((e) => isObj(e) && [e.tool_called, e.tool_not_called, isObj(e.tool_called_with) ? e.tool_called_with.tool : undefined].includes(toolId)))
  );
}

/** Tools no agent offers and nothing else names: the model never uses them. */
export function unusedTools(config: AgentConfig): string[] {
  return list<Json>(config?.tools)
    .filter((t) => isObj(t) && typeof t.id === 'string' && t.id && agentsUsingTool(config, t.id).length === 0 && !toolNamedElsewhere(config, t.id))
    .map((t) => String(t.id));
}

/** "used by billing and support", "used by 4 agents", or "not used by any agent". */
export function usedByText(agentIds: string[]): string {
  const ids = Array.isArray(agentIds) ? agentIds : [];
  if (!ids.length) return 'not used by any agent';
  if (ids.length <= 2) return `used by ${ids.join(' and ')}`;
  return `used by ${ids.length} agents`;
}

/** An agent's name as it reads ("Billing"), else its id. */
export function agentName(config: AgentConfig, id: string): string {
  const agent = list<Json>(config?.agents?.items).find((a) => isObj(a) && a.id === id);
  return typeof agent?.name === 'string' && agent.name ? agent.name : humanize(id);
}

/** Ids the answering agent offers that no tool has (shown so they can be removed). */
export function undeclaredTools(config: AgentConfig): string[] {
  const items = list<Json>(config?.agents?.items);
  const entry = items.find((a) => isObj(a) && a.id === config?.agents?.entry) ?? items[0];
  const declared = new Set(list<Json>(config?.tools).map((t) => (isObj(t) ? t.id : undefined)));
  return list<string>(entry?.tools).filter((t) => typeof t === 'string' && !declared.has(t));
}

/** A tool is named by what the model calls it: its name, else its id. */
export const modelNameOf = (tool: unknown): string => (isObj(tool) ? String((typeof tool.name === 'string' && tool.name) || tool.id || '') : '');

/** Every name the model can call, once each, hand-over tools included. */
export function toolNamesOf(config: AgentConfig): string[] {
  const names = [
    ...list(config?.tools).map(modelNameOf),
    ...list<Json>(config?.agents?.items).flatMap((a) => list<Json>(isObj(a) ? a.handoffs : []).map((h) => (isObj(h) && typeof h.tool === 'string' ? h.tool : ''))),
  ].filter(Boolean);
  return Array.from(new Set(names));
}

// ---- the page's switches ("What it can do") ---------------------------------------------------------------------

const SWITCHES: { id: string; label: string; own: string; is: (t: Json) => boolean }[] = [
  { id: 'end_call', label: 'End the conversation politely', own: 'end_call', is: (t) => t.type === 'builtin' && t.builtin === 'end_call' },
  { id: 'hand_over', label: 'Pass people to a person on your team', own: 'escalate_to_human', is: (t) => t.type === 'builtin' && t.builtin === 'transfer_or_callback' },
  {
    id: 'details',
    label: 'Take people’s contact details',
    own: 'collect_details',
    is: (t) => t.type === 'builtin' && t.builtin === 'send_form' && isOwnId(isObj(t.params) ? t.params.form : undefined, 'contact_details'),
  },
  { id: 'lookup', label: 'Look something up in your own system', own: 'look_up', is: (t) => t.type === 'http' && isOwnId(t.id, 'look_up') },
];
const isOwnId = (id: unknown, base: string) => typeof id === 'string' && (id === base || new RegExp(`^${base}_\\d+$`).test(id));
function entryTools(config: AgentConfig): string[] {
  const items = list<Json>(config?.agents?.items);
  const entry = items.find((a) => isObj(a) && a.id === config?.agents?.entry) ?? items[0];
  return list<string>(entry?.tools);
}

/** The switch above the list that stands for a tool (the first of its kind, the agent's own first), or null. */
export function switchOf(config: AgentConfig, toolId: string): { id: string; label: string; on: boolean } | null {
  if (typeof toolId !== 'string' || !toolId) return null;
  const has = entryTools(config);
  const found = SWITCHES.find((s) => {
    const rank = (t: Json) => (has.includes(String(t.id)) ? 0 : isOwnId(t.id, s.own) ? 1 : 2);
    const first = list<Json>(config?.tools)
      .filter((t) => isObj(t) && typeof t.id === 'string' && s.is(t))
      .sort((a, b) => rank(a) - rank(b))[0];
    return first?.id === toolId;
  });
  return found ? { id: found.id, label: found.label, on: has.includes(toolId) } : null;
}

// ---- advice --------------------------------------------------------------------------------------------------------

/** A lookup keeps the caller waiting: a short timeout and few retries. */
export function timeoutAdvice(tool: unknown): string[] {
  const t = (isObj(tool) ? tool : {}) as Json;
  const timeout = typeof t.timeout_s === 'number' ? t.timeout_s : 10; // the runtime's default
  const retries = typeof t.retries === 'number' ? t.retries : 0;
  const notes: string[] = [];
  if (timeout > 8) notes.push(`${t.timeout_s === undefined ? 'The default of 10 s is' : `${timeout} s is`} a long time for a caller to wait on a phone call. 5–8 s suits most lookups.`);
  if (retries > 1) notes.push('Each retry makes the caller wait longer. 0 or 1 is usual. Retries only happen on network errors and server (5xx) errors, never on a 4xx.');
  return notes;
}

export type AdviceLevel = 'warn' | 'hint' | 'ok';

/** How well a description tells the model when to use the tool. */
export function describeAdvice(description: unknown): { level: AdviceLevel; text: string } {
  const text = String(description ?? '').trim();
  if (!text) return { level: 'warn', text: 'Add a description. It is what tells the model when to use this tool.' };
  if (text.length < 25) return { level: 'warn', text: 'Very short. Say when to use the tool, not only what it does.' };
  if (!/\b(when|if|after|before|once|whenever|only)\b/i.test(text)) return { level: 'hint', text: 'Say when to use it (“when the caller asks…”), not only what it does.' };
  return { level: 'ok', text: '' };
}

export const ON_ERROR_SEARCH_HELP =
  'Given to the model when the search fails (the search service is down, it timed out, or no index was built yet). It is not read to the caller. Write it as an instruction: “Say you can’t look that up right now and offer to take a message.”';
export const ON_ERROR_HELP =
  'Given to the model when the request fails (a timeout, a server error, even a 404 “no such account”). It is not read to the caller. Write it as an instruction: “Tell the caller you could not fetch the bill and offer a callback.”';

/** `reply`: who speaks after the tool has run. Each choice has an example, because the difference is hard to guess. */
export const REPLY_CHOICES: { value: 'model' | 'none'; label: string; help: string; example: string }[] = [
  {
    value: 'model',
    label: 'The model answers',
    help: 'After the tool runs, the model reads its result and replies. Right for lookups.',
    example: 'The caller asks for their bill → the tool fetches it → the model says “You owe 42.50, due on 1 November.”',
  },
  {
    value: 'none',
    label: 'Nothing more is said',
    help: 'The model stays quiet this turn. Use it when the tool’s rules already spoke or showed something (a form, a transfer, a goodbye).',
    example: 'The caller asks for a person → a rule says “I’m putting you through” and transfers → the model adds nothing.',
  },
];

// ---- finding a tool in a long list ----------------------------------------------------------------------------------
export const TOOL_KIND_LABEL: Record<string, string> = { http: 'HTTP', builtin: 'Built-in', task: 'Task', mcp: 'MCP', knowledge: 'Knowledge', code: 'Code' };

/** How many of each kind there are, the most common first. */
export function toolKindCounts(tools: unknown): { kind: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  list(tools).forEach((tool) => {
    const kind = kindOfTool(tool) || 'other';
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  });
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, label: TOOL_KIND_LABEL[kind] ?? kind, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Every typed word must appear (any order, any case) in its id, name, description, kind or built-in. */
export function toolMatches(tool: unknown, { query = '', kind = '', unusedOnly = false }: { query?: string; kind?: string; unusedOnly?: boolean } = {}, unused: Set<string> = new Set()): boolean {
  if (!isObj(tool)) return !query && !kind && !unusedOnly;
  if (kind && (kindOfTool(tool) || 'other') !== kind) return false;
  if (unusedOnly && !unused.has(String(tool.id))) return false;
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const k = kindOfTool(tool);
  const haystack = [tool.id, tool.name, tool.description, k, TOOL_KIND_LABEL[k], tool.builtin]
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .toLowerCase();
  return words.every((w) => haystack.includes(w));
}

// ---- adding a tool: cards named by the job they do ------------------------------------------------------------------

export interface ToolCard {
  id: string;
  group: string;
  label: string;
  help: string;
  kind: string;
  builtin?: string;
  base: string;
  /** What the runtime can't run yet, said on the card. */
  unavailable?: string;
  /** Merged over the tool's starting value. */
  seed?: Json;
}

export const TOOL_CARDS: ToolCard[] = [
  {
    id: 'hand_over',
    group: 'Pass the caller on',
    label: 'Hand over to a person',
    help: 'Pass the caller to someone on your team, or take a callback when nobody is free. It needs a phone transfer.',
    kind: 'builtin',
    builtin: 'transfer_or_callback',
    base: 'hand_over',
    seed: { description: 'Use when the caller asks for a person, or you cannot help them.' },
  },
  {
    id: 'back_to_start',
    group: 'Pass the caller on',
    label: 'Send the caller back to the first agent',
    help: 'For a specialist agent: return the caller to the agent who answers first, with a note of what is still needed.',
    kind: 'builtin',
    builtin: 'return_to_entry',
    base: 'back_to_start',
    seed: { description: 'Use when the caller needs something this agent cannot help with.' },
  },
  {
    id: 'end_call',
    group: 'During the call',
    label: 'End the call',
    help: 'Say goodbye and hang up. Give the agent this so it can finish a call by itself.',
    kind: 'builtin',
    builtin: 'end_call',
    base: 'end_call',
    seed: { description: 'Ends the conversation. Use it after saying goodbye, when the person has nothing more to ask.' },
  },
  {
    id: 'show_form',
    group: 'During the call',
    label: 'Show the caller a form',
    help: 'Collect details such as a name and number on screen. It needs a form, and a channel that can show forms.',
    kind: 'builtin',
    builtin: 'send_form',
    base: 'show_form',
    seed: { description: 'Use when you need several details from the caller at once.' },
  },
  {
    id: 'lookup',
    group: 'Look something up',
    label: 'Look something up in your systems',
    help: 'Ask a web service you already have, such as an order or billing system, and tell the agent what came back.',
    kind: 'http',
    base: 'lookup',
  },
  {
    id: 'search',
    group: 'Look something up',
    label: 'Search your knowledge',
    help: 'Answer from your documents and web pages. Set the knowledge up first.',
    kind: 'knowledge',
    base: 'search_knowledge',
  },
  {
    id: 'keypad_collect',
    group: 'Keypad',
    label: 'Collect digits the caller presses',
    help: 'Take a PIN or an account number from the keypad.',
    kind: 'builtin',
    builtin: 'collect_dtmf',
    base: 'collect_digits',
    seed: { description: 'Use when you need digits the caller types on the keypad.' },
  },
  {
    id: 'keypad_send',
    group: 'Keypad',
    label: 'Press keypad tones',
    help: 'Press digits on a call, for example to get through a menu.',
    kind: 'builtin',
    builtin: 'send_dtmf',
    base: 'send_tones',
    seed: { description: 'Use to press keypad digits on the call.' },
  },
  {
    id: 'task',
    group: 'Connect other things',
    label: 'Run a multi-step task',
    help: 'Walk the caller through several steps, such as checking who they are and then asking for a code.',
    kind: 'task',
    base: 'task',
  },
  {
    id: 'server',
    group: 'Connect other things',
    label: 'Use another system’s tools',
    help: 'Offer the tools another system publishes (an MCP server) to the agent.',
    kind: 'mcp',
    base: 'server_tools',
    unavailable: UNSUPPORTED_KINDS.mcp,
  },
  {
    id: 'code',
    group: 'Connect other things',
    label: 'Run your own code',
    help: 'For an engineer: call a function you wrote when nothing else fits.',
    kind: 'code',
    base: 'custom_code',
    unavailable: UNSUPPORTED_KINDS.code,
  },
  {
    id: 'rules_only',
    group: 'Other',
    label: 'Only run rules',
    help: 'No action of its own: only its rules run (change what is remembered, hand off). For a conditional hand-off.',
    kind: 'builtin',
    builtin: 'noop',
    base: 'rules_only',
    seed: { description: 'Use when the caller’s request needs only the rules attached to this tool.' },
  },
];

/** Ending the call and passing to a person need one tool each: a card for one that exists opens it instead. */
const ONE_OF: Record<string, string> = { end_call: 'end_call', hand_over: 'transfer_or_callback' };

/** The index of the tool a card would open instead of adding a second, or -1. */
export function existingFor(config: AgentConfig, card: ToolCard): number {
  const builtin = ONE_OF[card.id];
  if (!builtin) return -1;
  return list<Json>(config?.tools).findIndex((t) => isObj(t) && t.type === 'builtin' && t.builtin === builtin);
}

/** The plain id when it is free (end_call), else numbered (end_call_2). */
export function freeToolId(taken: string[], base: string): string {
  const clean =
    String(base || 'tool')
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^[^a-z]+/, '')
      .replace(/_+$/, '') || 'tool';
  if (!taken.includes(clean)) return clean;
  let n = 2;
  while (taken.includes(`${clean}_${n}`)) n++;
  return `${clean}_${n}`;
}

/** A new tool of a card's kind, with what the schema needs filled with empty starting values (never invented ones). */
export function makeTool(card: ToolCard, taken: string[]): ToolDefinition {
  const id = freeToolId(taken, card.base);
  const base: Json = { id, type: card.kind };
  if (card.kind === 'builtin') base.builtin = card.builtin;
  if (card.builtin === 'transfer_or_callback') base.params = { transfer: '' };
  if (card.builtin === 'send_form') base.params = { form: '' };
  if (card.kind === 'http') {
    // no connection until one is chosen: an empty one would read as a connection that is not declared
    Object.assign(base, { description: '', request: { method: 'GET', path: '' }, parameters: { type: 'object', properties: {} } });
  }
  if (card.kind === 'knowledge') Object.assign(base, { description: '', source: '' });
  if (card.kind === 'task') base.task = '';
  if (card.kind === 'mcp') Object.assign(base, { description: '', server: '', allow: [] });
  if (card.kind === 'code') Object.assign(base, { description: '', handler: '', parameters: { type: 'object', properties: {} } });
  return { ...base, ...clone(card.seed ?? {}) } as ToolDefinition;
}

/** The config with a new tool at the end, offered by the agent that answers first. */
export function addTool(config: AgentConfig, tool: ToolDefinition): { config: AgentConfig; index: number } {
  const next = clone(config);
  next.tools = [...list<ToolDefinition>(next.tools), tool];
  const items = list<Json>(next.agents?.items);
  const at = Math.max(
    0,
    items.findIndex((a) => isObj(a) && a.id === next.agents?.entry)
  );
  const agent = items[at];
  if (isObj(agent) && !list(agent.tools).includes(tool.id)) agent.tools = [...list<string>(agent.tools), tool.id];
  return { config: next, index: next.tools.length - 1 };
}

/** The config without the tool at `index`, and without it in every agent's list (nothing points at an id that is gone). */
export function deleteTool(config: AgentConfig, index: number): AgentConfig {
  const next = clone(config);
  const tool = list<ToolDefinition>(next.tools)[index];
  if (!tool) return config;
  next.tools = list<ToolDefinition>(next.tools).filter((_, i) => i !== index);
  if (next.agents?.items)
    next.agents.items = next.agents.items.map((a) => (isObj(a) && Array.isArray(a.tools) && a.tools.includes(tool.id) ? { ...a, tools: a.tools.filter((t) => t !== tool.id) } : a));
  return next;
}

/** Gives the tool to an agent, or takes it away. */
export function setToolAgent(config: AgentConfig, toolId: string, agentId: string, on: boolean): AgentConfig {
  const next = clone(config);
  if (!next.agents?.items) return config;
  next.agents.items = next.agents.items.map((a) => {
    if (!isObj(a) || a.id !== agentId) return a;
    const tools = list<string>(a.tools).filter((t) => t !== toolId);
    return { ...a, tools: on ? [...tools, toolId] : tools };
  });
  return next;
}

/** A copy of an object with `key` set, or taken out when the value is undefined or ''. */
export function withKey<T extends Json>(obj: T, key: string, value: unknown): T {
  const next = { ...obj } as Json;
  if (value === undefined || value === '') delete next[key];
  else next[key] = value;
  return next as T;
}

// ---- the ids a tool can point at -------------------------------------------------------------------------------------

export type RefKind = 'agents' | 'transfers' | 'notifications' | 'forms' | 'wrapups' | 'http_connections' | 'state_vars' | 'messages' | 'knowledge' | 'tasks';

/** The ids of one kind of thing this config has, for a choice box (a tool's transfer, a step's form...). */
export function refIds(config: AgentConfig, kind: RefKind): string[] {
  const c = (isObj(config) ? config : {}) as Json;
  const ids = (items: unknown) => list<Json>(items).map((x) => (isObj(x) && typeof x.id === 'string' ? x.id : '')).filter(Boolean);
  switch (kind) {
    case 'agents':
      return ids(isObj(c.agents) ? c.agents.items : []);
    case 'transfers':
      return ids(isObj(c.telephony) ? c.telephony.transfers : []);
    case 'http_connections':
      return Object.entries(isObj(c.connections) ? c.connections : {})
        .filter(([, v]) => isObj(v) && v.type === 'http')
        .map(([k]) => k);
    case 'state_vars':
      return Object.keys(isObj(c.state) && isObj(c.state.variables) ? c.state.variables : {});
    default:
      return ids(c[kind]);
  }
}
