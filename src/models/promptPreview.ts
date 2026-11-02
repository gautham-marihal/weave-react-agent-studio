// The prompt preview (POST /preview/prompt): the server runs the runtime's own code on the editor's config, so what it
// answers is exact. This reads its answer tolerantly (a missing or new field is left out, never an error), puts the
// looser parts in words (what runs when it takes over, what it searches, the models with secret NAMES, the state with
// sensitive values masked), builds the request from the "what if" choices and gives advice on size. There is no copy
// built in the browser: when the server can't answer, the screen says so. Pure: no network, no DOM.

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v));
const words = (s: unknown): number => (String(s ?? '').trim().match(/\S+/g) ?? []).length;
const short = (value: unknown, max = 90): string => {
  const t = typeof value === 'string' ? value : JSON.stringify(value);
  return t.length > max ? `${t.slice(0, max)}…` : t;
};
const humanize = (key: string): string =>
  String(key)
    .replace(/[_-]+/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());

// ---- the answer -----------------------------------------------------------------------------------------------------
export interface PromptSection {
  id: string;
  kind: string;
  label: string;
  text: string;
  active: boolean;
  when: string;
}
export interface PromptTool {
  name: string;
  description: string;
  parameters: unknown;
  offered: boolean;
  reason: string;
}
export interface Prompt {
  agentName: string;
  channelId: string;
  instructions: string;
  sections: PromptSection[];
  opening: string;
  greeting: string;
  onEnter: unknown[];
  tools: PromptTool[];
  knowledge: unknown;
  models: unknown;
  state: Json;
  warnings: string[];
  note: string;
  stats: { words: number; tokens: number; toolsOffered: number };
}

export function normalizePrompt(raw: unknown): Prompt {
  const r = isObj(raw) ? raw : {};
  const instructions = text(r.instructions);
  const sections = list(r.sections).map((s, i) => {
    const x = isObj(s) ? s : {};
    return { id: `${text(x.kind) || 'section'}-${i}`, kind: text(x.kind), label: text(x.label) || text(x.kind) || `Part ${i + 1}`, text: text(x.text), active: x.active !== false, when: isObj(x.when) ? JSON.stringify(x.when) : text(x.when) };
  });
  const tools = list(r.tools).map((t) => {
    const x = isObj(t) ? t : {};
    return { name: text(x.name), description: text(x.description), parameters: x.parameters, offered: x.offered !== false, reason: text(x.reason) };
  });
  const stats = isObj(r.stats) ? r.stats : {};
  const agent = r.agent;
  const channel = r.channel;
  return {
    agentName: isObj(agent) ? text(agent.name) || text(agent.id) : text(agent),
    channelId: isObj(channel) ? text(channel.id) : text(channel),
    instructions,
    sections,
    opening: text(r.opening),
    greeting: text(r.greeting),
    onEnter: Array.isArray(r.on_enter) ? r.on_enter : r.on_enter ? [r.on_enter] : [],
    tools,
    knowledge: r.knowledge ?? null,
    models: r.models ?? null,
    state: isObj(r.state) ? r.state : {},
    warnings: list(r.warnings).map((w) => (isObj(w) ? text(w.message) : text(w))).filter(Boolean),
    note: text(r.note),
    stats: {
      words: typeof stats.words === 'number' ? stats.words : words(instructions),
      tokens: typeof stats.approx_tokens === 'number' ? stats.approx_tokens : typeof stats.tokens === 'number' ? stats.tokens : 0,
      toolsOffered: typeof stats.tools_offered === 'number' ? stats.tools_offered : tools.filter((t) => t.offered).length,
    },
  };
}

/** Over these, the whole prompt (sent with every reply) costs time and money each turn, and tools get mixed up. */
export const LIMITS = { words: 1500, tools: 15 };

/** Advice about the prompt's size and tools, never errors. */
export function promptAdvice(prompt: Prompt | null): { id: string; text: string }[] {
  const advice: { id: string; text: string }[] = [];
  if (!prompt) return advice;
  if (prompt.stats.words > LIMITS.words)
    advice.push({
      id: 'long',
      text: `The instructions are ${prompt.stats.words.toLocaleString('en')} words${prompt.stats.tokens ? ` (about ${prompt.stats.tokens.toLocaleString('en')} tokens)` : ''}, and they are sent with every reply. Over ${LIMITS.words.toLocaleString('en')} words, a model follows them less closely and each turn costs more: move rarely needed detail into a knowledge base or a condition.`,
    });
  if (prompt.stats.toolsOffered > LIMITS.tools)
    advice.push({
      id: 'tools',
      text: `This agent is offered ${prompt.stats.toolsOffered} tools. Past about ${LIMITS.tools}, a model picks the wrong one more often: give each agent only the tools it needs, and split the rest across agents.`,
    });
  const dropped = prompt.tools.filter((t) => !t.offered);
  if (dropped.length)
    advice.push({
      id: 'dropped',
      text: `${dropped.length} tool${dropped.length === 1 ? '' : 's'} will not be offered to the model: ${dropped.map((t) => `${t.name}${t.reason ? ` (${t.reason})` : ''}`).join('; ')}.`,
    });
  return advice;
}

// ---- the request ----------------------------------------------------------------------------------------------------
/** A `datetime-local` value ("2026-10-14T03:00") with the browser's offset, as the API wants a time zone. */
export function withLocalOffset(local: string, offsetMinutes: number = -new Date().getTimezoneOffset()): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(String(local || ''))) return '';
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const stamp = local.length === 16 ? `${local}:00` : local;
  return `${stamp}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

export interface WhatIf {
  agent?: string;
  channel?: string;
  state?: Json;
  /** As the API wants it, with a time zone (see withLocalOffset). */
  now?: string;
  callerPhone?: string;
}

/** The request body: the config, and only the what-ifs changed from the defaults. */
export function promptRequest(config: unknown, what: WhatIf): Json {
  const body: Json = { config };
  if (what.agent) body.agent = what.agent;
  if (what.channel) body.channel = what.channel;
  const state = isObj(what.state) ? Object.fromEntries(Object.entries(what.state).filter(([, v]) => v !== undefined && v !== '')) : {};
  if (Object.keys(state).length) body.state = state;
  if (what.now) body.now = what.now;
  if (what.callerPhone?.trim()) body.caller_phone = what.callerPhone.trim();
  return body;
}

export interface WhatIfVariable {
  name: string;
  type: string;
  default: unknown;
}
/** The state variables worth offering as "what if": a handful of simple ones, never a sensitive one. */
export function whatIfVariables(config: unknown, max = 6): WhatIfVariable[] {
  const vars = isObj(config) && isObj(config.state) && isObj(config.state.variables) ? config.state.variables : {};
  return Object.entries(vars)
    .filter(([, v]) => isObj(v) && v.sensitive !== true)
    .slice(0, max)
    .map(([name, v]) => {
      const spec = v as Json;
      return { name, type: typeof spec.type === 'string' ? spec.type : typeof spec.default === 'boolean' ? 'boolean' : typeof spec.default === 'number' ? 'number' : 'string', default: spec.default };
    });
}

/** What a person typed for a what-if, as the value it means (undefined: not set). */
export function whatIfValue(type: string, typed: string | undefined): unknown {
  if (typed === '' || typed === undefined) return undefined;
  if (type === 'boolean') return typed === 'true' ? true : typed === 'false' ? false : undefined;
  if (type === 'number' || type === 'integer') {
    const n = Number(typed);
    return Number.isNaN(n) ? undefined : n;
  }
  return typed;
}

// ---- conditions in words --------------------------------------------------------------------------------------------
const OPERATOR_WORDS: Record<string, string> = { equals: 'is', not_equals: 'is not', gte: 'is at least', lte: 'is at most', in: 'is one of' };
const show = (value: unknown): string => (Array.isArray(value) ? value.map(show).join(', ') : typeof value === 'string' ? `“${value}”` : String(value));

/** A condition in words: `{state: 'verified', equals: true}` -> "the state verified is true". */
export function describeCondition(condition: unknown): string {
  if (!isObj(condition)) return 'a condition holds';
  const subject = ['state', 'arg', 'result', 'event'].find((key) => key in condition);
  if (subject) {
    const operator = Object.keys(OPERATOR_WORDS).find((key) => key in condition);
    const label = ({ state: 'the state', arg: 'the argument', result: 'the result', event: 'the event detail' } as Record<string, string>)[subject];
    if (operator === 'not_equals' && condition[operator] === null) return `${label} ${String(condition[subject])} is set`;
    if (operator === 'equals' && condition[operator] === null) return `${label} ${String(condition[subject])} is not set`;
    return operator ? `${label} ${String(condition[subject])} ${OPERATOR_WORDS[operator]} ${show(condition[operator])}` : `${label} ${String(condition[subject])} is set`;
  }
  if ('channel' in condition) return `the channel is ${show(condition.channel)}`;
  if ('schedule' in condition) return `${String(condition.schedule)} is ${condition.open ? 'open' : 'closed'}`;
  if (Array.isArray(condition.all)) return condition.all.map(describeCondition).join(' and ');
  if (Array.isArray(condition.any)) return condition.any.map(describeCondition).join(' or ');
  if ('not' in condition) return `not (${describeCondition(condition.not)})`;
  return 'a condition holds';
}

/** The `when` of a block in the server's answer, in words: an object, its JSON, or Python's way of writing it. */
export function describeWhen(when: unknown): string {
  if (isObj(when)) return describeCondition(when);
  if (typeof when !== 'string') return '';
  const t = when.trim();
  if (t.startsWith('{')) {
    const asJson = t
      .replace(/'/g, '"')
      .replace(/\bNone\b/g, 'null')
      .replace(/\bTrue\b/g, 'true')
      .replace(/\bFalse\b/g, 'false');
    for (const candidate of [t, asJson]) {
      try {
        const parsed: unknown = JSON.parse(candidate);
        if (isObj(parsed)) return describeCondition(parsed);
      } catch {
        // not this reading; the text is shown as it is if none is one
      }
    }
  }
  return t;
}

// ---- the looser parts, in words -------------------------------------------------------------------------------------
const quote = (value: unknown) => `“${String(value)}”`;
const speech = (value: unknown) => (isObj(value) && value.message ? `the fixed line ${quote(value.message)}` : value ? quote(short(value, 60)) : 'nothing yet');

/** One on-enter action as a short sentence. */
export function describeAction(action: unknown): string {
  if (!isObj(action)) return 'Do something';
  switch (action.type) {
    case 'say':
      return `Say ${speech(action.text)}`;
    case 'generate':
      return `Have the model say something: ${quote(short(text(action.instructions) || 'no instructions yet', 60))}`;
    case 'set_state': {
      const pairs = Object.entries(isObj(action.values) ? action.values : {}).map(([key, value]) => `${key} to ${typeof value === 'string' ? quote(value) : JSON.stringify(value)}`);
      return pairs.length ? `Set ${pairs.join(', ')}` : 'Change state (nothing chosen yet)';
    }
    case 'handoff':
      return `Hand off to ${text(action.to) || 'an agent (none chosen yet)'}`;
    case 'return_to_entry':
      return 'Return to the first agent';
    case 'end_call':
      return action.say ? `Say ${speech(action.say)}, then end the call` : 'End the call';
    case 'transfer':
      return `Transfer using ${text(action.transfer) || 'a transfer (none chosen yet)'}`;
    case 'notify':
      return `Send the notification ${text(action.notification) || '(none chosen yet)'}`;
    case 'send_form':
      return `Show the form ${text(action.form) || '(none chosen yet)'}`;
    case 'http':
      return `Call ${text(action.method) || 'GET'} ${text(action.path) || '/'} on ${text(action.connection) || 'a connection (none chosen yet)'}`;
    case 'log':
      return `Write to the log: ${quote(short(text(action.message), 60))}`;
    default:
      return humanize(text(action.type) || 'something');
  }
}

/** What runs when the agent takes over, one line per action. */
export function onEnterLines(onEnter: unknown): string[] {
  return list(onEnter)
    .filter((a) => a !== null && a !== undefined)
    .map((action) => (isObj(action) ? describeAction(action) : String(action)));
}

const KNOWLEDGE_HEADINGS: Record<string, string> = {
  before_each_reply: 'Searched before every reply',
  injected: 'Searched before every reply',
  inject: 'Searched before every reply',
  searched_before_each_reply: 'Searched before every reply',
  tools: 'Searched when the model asks',
  tool: 'Searched when the model asks',
  searched_by_tools: 'Searched when the model asks',
  bases: 'Knowledge bases',
};
function describeItem(item: unknown): string {
  if (typeof item === 'string') return item;
  if (!isObj(item)) return short(item);
  const mainKey = ['name', 'id', 'tool', 'base'].find((k) => item[k] !== undefined && item[k] !== null && item[k] !== '');
  const rest = Object.entries(item)
    .filter(([k, v]) => k !== mainKey && v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${humanize(k).toLowerCase()} ${typeof v === 'object' ? short(v, 40) : String(v)}`);
  const label = mainKey ? String(item[mainKey]) : '';
  return rest.length ? `${label}${label ? ' (' : ''}${rest.join(', ')}${label ? ')' : ''}` : label;
}

/** What is searched and by what: [{ heading, items }], whatever shape the server sends; nothing for nothing. */
export function knowledgeBlocks(knowledge: unknown): { heading: string; items: string[] }[] {
  if (knowledge === null || knowledge === undefined || knowledge === false) return [];
  if (Array.isArray(knowledge)) return knowledge.length ? [{ heading: 'Knowledge searched', items: knowledge.map(describeItem) }] : [];
  if (typeof knowledge === 'string') return knowledge ? [{ heading: 'Knowledge searched', items: [knowledge] }] : [];
  if (!isObj(knowledge)) return [{ heading: 'Knowledge searched', items: [short(knowledge)] }];
  return Object.entries(knowledge)
    .map(([key, value]) => {
      const heading = KNOWLEDGE_HEADINGS[key] ?? humanize(key);
      if (Array.isArray(value)) return { heading, items: value.map(describeItem) };
      if (isObj(value)) return { heading, items: Object.entries(value).map(([k, v]) => `${humanize(k)}: ${typeof v === 'object' ? short(v) : String(v)}`) };
      return { heading, items: [String(value)] };
    })
    .filter((block) => block.items.length > 0);
}

const STAGE_WORDS: Record<string, string> = {
  stt: 'Listening',
  llm: 'Thinking',
  tts: 'Speaking',
  realtime: 'Realtime speech',
  vad: 'Detecting speech',
  turn_detector: 'Deciding when the caller is done',
};
function secretsIn(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (isObj(value)) {
    if (typeof value.secret === 'string') out.add(value.secret);
    Object.values(value).forEach((v) => secretsIn(v, out));
  } else if (Array.isArray(value)) value.forEach((v) => secretsIn(v, out));
  return out;
}
function describeModel(model: unknown): string {
  if (typeof model === 'string') return model;
  if (!isObj(model)) return short(model);
  const used = [model.provider, model.model].filter((x): x is string => typeof x === 'string' && !!x).join(' ');
  const keys = [...secretsIn(model)];
  const other = Object.entries(model)
    .filter(([k, v]) => !['provider', 'model', 'api_key', 'secret', 'fallbacks', 'options'].includes(k) && v !== null && v !== undefined && typeof v !== 'object')
    .map(([k, v]) => `${humanize(k).toLowerCase()} ${String(v)}`);
  const fallbacks = list(model.fallbacks)
    .map((f) => describeModel(f))
    .filter(Boolean);
  return [used || 'no provider set', other.length ? `(${other.join(', ')})` : '', keys.length ? `uses the secret ${keys.join(', ')}` : '', fallbacks.length ? `then ${fallbacks.join(', then ')}` : '']
    .filter(Boolean)
    .join(' · ');
}

/** The models it would use, with the NAMES of the secrets (never values): [{ label, text }]. */
export function modelLines(models: unknown): { label: string; text: string }[] {
  if (!models) return [];
  if (Array.isArray(models))
    return models.map((layer, i) => ({
      label: isObj(layer) && typeof layer.layer === 'string' ? humanize(layer.layer) : `Layer ${i + 1}`,
      text: isObj(layer)
        ? Object.entries(layer)
            .filter(([k]) => k !== 'layer')
            .map(([k, v]) => `${STAGE_WORDS[k] ?? humanize(k)}: ${describeModel(v)}`)
            .join(' · ')
        : describeModel(layer),
    }));
  if (!isObj(models)) return [{ label: 'Models', text: short(models) }];
  return Object.entries(models)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([stage, v]) => ({ label: STAGE_WORDS[stage] ?? humanize(stage), text: describeModel(v) }));
}

const MASK = /^[•*●·]{2,}$|^<?(masked|sensitive|hidden|redacted)>?$/i;
/** The state the preview was built from; sensitive values stay masked and are marked: [{ name, text, masked }]. */
export function stateLines(state: unknown): { name: string; text: string; masked: boolean }[] {
  if (!isObj(state)) return [];
  return Object.entries(state).map(([name, value]) => ({
    name,
    text: value === null || value === undefined ? 'not set' : short(value, 80),
    masked: typeof value === 'string' && MASK.test(value),
  }));
}

/** The tools that take arguments, each with its parameters (name, type, required), for "What it gives each tool". */
export function toolParameters(tools: PromptTool[]): { name: string; params: { name: string; type: string; required: boolean }[] }[] {
  return tools
    .map((tool) => {
      const p = isObj(tool.parameters) ? tool.parameters : {};
      const props = isObj(p.properties) ? p.properties : {};
      const required = list(p.required);
      return {
        name: tool.name,
        params: Object.entries(props).map(([name, spec]) => {
          const type = isObj(spec) ? spec.type : undefined;
          return { name, type: Array.isArray(type) ? type.join(' or ') : typeof type === 'string' ? type : '', required: required.includes(name) };
        }),
      };
    })
    .filter((t) => t.params.length > 0);
}
