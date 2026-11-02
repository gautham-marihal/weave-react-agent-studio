// "Describe it": what the AI model is told, how its answer is read, and the round of asking, checking with the server
// (POST /validate) and handing what it found back to the model to fix. The model returns the WHOLE configuration (not
// a patch) through one tool, so the server's checks can read it like a hand-made draft. Pure apart from `post` (the
// /llm route) and `validate` (the API), which callers pass in, so tests use stand-ins for both.
import type { AgentConfig, Issue } from '../types/studio';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const TOOL = {
  name: 'submit_config',
  description: 'Return the complete agent configuration that satisfies the request, with a plain-language summary.',
  input_schema: {
    type: 'object',
    required: ['config', 'summary'],
    properties: {
      config: { type: 'object', description: 'The COMPLETE agent configuration document (not a patch), valid against the schema.' },
      summary: { type: 'string', description: 'Two to four plain sentences for a non-technical reader: what you built or changed. No JSON, no field names.' },
      assumptions: { type: 'array', items: { type: 'string' }, description: 'Things you had to assume because the request did not say. Plain words.' },
      questions: { type: 'array', items: { type: 'string' }, description: 'Things you could not decide and need the person to answer. Plain words. Empty when nothing is open.' }
    }
  }
};

/** The schema without what costs tokens and teaches nothing: UI hints, examples, long prose cut short. */
export function compactSchema(schema: unknown): unknown {
  const trim = (text: string) => {
    const t = text.replace(/\s+/g, ' ').trim();
    return t.length > 220 ? `${t.slice(0, 219)}…` : t;
  };
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!isObj(value)) return value;
    const out: Json = {};
    Object.entries(value).forEach(([key, v]) => {
      if (key === 'x-ui' || key === 'examples' || key === 'example' || key === '$comment') return;
      out[key] = key === 'description' && typeof v === 'string' ? trim(v) : walk(v);
    });
    return out;
  };
  return walk(schema);
}

export const SYSTEM_RULES = `You configure voice and chat agents for a no-code studio. A person describes, in plain English, what they need; you produce the agent configuration (a JSON document) that does it. Always answer by calling the submit_config tool exactly once with the COMPLETE configuration; never answer with text alone.

How to work
- The configuration must validate against the JSON Schema below. Use only fields the schema has. Every cross-reference (an agent id in agents.entry or a hand-off, a tool id in an agent's tools, a message id, a state variable, a transfer id, a connection) must point at something that exists in the same document.
- EDIT the current draft: change only what the request needs, keep every existing id, name, value and the builder section as they are, and return the whole document. When the draft is a bare starter and the request describes a whole agent, build it fully.
- Prefer the simplest configuration that does the job. A single agent is fine; use several agents with hand-offs (agents.items[].handoffs) only when the request clearly describes different roles. Give every agent a clear, specific role in plain instructions: who it helps, what it does, what it must never do.
- Channels: honour what is asked (a phone line, a web chat, web voice). Give each channel a greeting. Only turn on input and output kinds the request implies.
- Ids are lowercase letters, digits, - and _ and start with a letter; tool names the model sees are snake_case. A hand-off id must be unique across the whole document.
- NEVER invent secrets, passwords, API keys, phone numbers or web addresses. Where one is needed and was not given, use a clearly marked placeholder the person must replace and list it in "questions". Secrets are only ever referenced by name, as {"secret": "NAME"}.
- Do not add tools that need a connection the person did not describe. A tool that ends the call or hands over to a person is fine when the request implies it.
- If the request is ambiguous, make the most reasonable choice, say so in "assumptions", and put what you really need to know in "questions". Do not refuse; always return a configuration.
- Write "summary", "assumptions" and "questions" for someone who has never seen JSON: short, concrete, no field names.

The configuration schema (JSON Schema, descriptions shortened):
`;

export const systemPrompt = (schema: unknown) => `${SYSTEM_RULES}${JSON.stringify(compactSchema(schema))}`;

/** The first message: what was asked earlier in this session, the current draft and what is wanted now. */
export function requestMessage({ request, config, earlier = [] }: {request: string;config: AgentConfig;earlier?: string[];}): string {
  const parts: string[] = [];
  if (earlier.length) parts.push(`Earlier in this session the person asked for (oldest first):\n${earlier.slice(-6).map((r, i) => `${i + 1}. ${r}`).join('\n')}`);
  parts.push(`CURRENT DRAFT (edit this; keep what the request does not touch):\n${JSON.stringify(config, null, 1)}`);
  parts.push(`REQUEST:\n${request.trim()}`);
  return parts.join('\n\n');
}

/** What to say when the server's checks found problems with the answer. */
export function repairMessage(errors: Issue[]): string {
  const lines = errors.slice(0, 25).map((e) => `- ${Array.isArray(e.path) && e.path.length ? e.path.join('.') : '(whole document)'}: ${e.message}`);
  return `The validator found problems with the configuration you returned:\n${lines.join('\n')}\n\nFix every one of them and call submit_config again with the complete corrected configuration. Change nothing else.`;
}

/** One reply of the Messages API, as far as it is read here. */
export interface ModelReply {
  content?: Array<Json & {type?: string;}>;
  stop_reason?: string;
  usage?: {input_tokens?: number;output_tokens?: number;cache_read_input_tokens?: number;};
}

export interface Answer {
  config: AgentConfig;
  summary: string;
  assumptions: string[];
  questions: string[];
  toolUseId: string;
}

/** The tool call out of a reply. Throws an Error with a sentence a person can read. */
export function readAnswer(reply: unknown): Answer {
  const r = reply as ModelReply;
  if (!isObj(reply) || !Array.isArray(r.content)) throw new Error('The AI service answered in a way Studio does not understand.');
  const call = r.content.find((block) => block.type === 'tool_use' && block.name === TOOL.name);
  if (!call) {
    if (r.stop_reason === 'max_tokens') throw new Error('The answer was cut off because the agent is very large. Ask for part of it at a time.');
    if (r.stop_reason === 'refusal') throw new Error('The AI model declined this request. Try saying it another way.');
    const said = r.content.filter((b) => b.type === 'text').map((b) => String(b.text ?? '')).join(' ').trim();
    throw new Error(said ? `The assistant replied with words instead of a configuration: “${said.slice(0, 240)}”` : 'The assistant did not return a configuration.');
  }
  const input = call.input;
  if (!isObj(input) || !isObj(input.config)) throw new Error('The assistant returned something that is not a configuration.');
  const texts = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim()) : [];
  return {
    config: input.config as AgentConfig,
    summary: typeof input.summary === 'string' ? input.summary.trim() : '',
    assumptions: texts(input.assumptions),
    questions: texts(input.questions),
    toolUseId: String(call.id ?? '')
  };
}

/** The ids the Workflow saves a place for (models/workflow.ts nodeId): agents bare, the rest with a prefix. */
function blockIds(config: AgentConfig): Set<string> {
  const ids = new Set<string>();
  const each = (items: unknown, prefix: string) => (Array.isArray(items) ? items : []).forEach((x) => {
    if (isObj(x) && typeof x.id === 'string' && x.id) ids.add(`${prefix}${x.id}`);
  });
  each(config.agents?.items, '');
  each(config.channels, 'channel::');
  each(config.tools, 'tool::');
  each(config.knowledge, 'kb::');
  return ids;
}

/**
 * The studio's own notes (where Workflow blocks are drawn) are never the model's to lose: kept from the draft when the
 * answer dropped them, and a place saved for a block that no longer exists is dropped.
 */
export function keepStudioNotes(before: AgentConfig, after: AgentConfig): AgentConfig {
  let next = after;
  if (!isObj(after.builder) && isObj(before.builder)) next = { ...after, builder: clone(before.builder) };
  const places = next.builder?.ui?.graph_positions;
  if (!isObj(places)) return next;
  const keep = blockIds(next);
  const kept = Object.fromEntries(Object.entries(places).filter(([id]) => keep.has(id)));
  if (Object.keys(kept).length === Object.keys(places).length) return next;
  next = clone(next);
  const builder = next.builder as Json;
  const ui = builder.ui as Json;
  if (Object.keys(kept).length) ui.graph_positions = kept;else
  {
    delete ui.graph_positions;
    if (!Object.keys(ui).length) delete builder.ui;
    if (!Object.keys(builder).length) delete next.builder;
  }
  return next;
}

export type Step = 'thinking' | 'checking' | 'fixing';

export interface Proposal extends Answer {
  /** What the server's checks still say about the proposal (after the last repair). */
  issues: {errors: Issue[];warnings: Issue[];};
  repairs: number;
  usage: {input: number;output: number;cached: number;};
}

export interface AskOptions {
  request: string;
  config: AgentConfig;
  schema: unknown;
  model: string;
  post: (body: Json, signal?: AbortSignal) => Promise<unknown>;
  validate: (config: AgentConfig, signal?: AbortSignal) => Promise<{errors?: Issue[];warnings?: Issue[];}>;
  signal?: AbortSignal;
  onStep?: (step: Step) => void;
  earlier?: string[];
  maxRepairs?: number;
}

/** Asks for a proposal, checks it with the server, and hands what the checks found back to the model (twice at most). */
export async function askAssistant({ request, config, schema, model, post, validate, signal, onStep, earlier = [], maxRepairs = 2 }: AskOptions): Promise<Proposal> {
  if (!request.trim()) throw new Error('Say what you need first.');
  const system = [{ type: 'text', text: systemPrompt(schema), cache_control: { type: 'ephemeral' } }];
  const messages: Json[] = [{ role: 'user', content: requestMessage({ request, config, earlier }) }];
  const usage = { input: 0, output: 0, cached: 0 };
  let answer: Answer | null = null;
  let issues: Proposal['issues'] = { errors: [], warnings: [] };
  let repairs = 0;
  for (let round = 0; round <= maxRepairs; round += 1) {
    onStep?.(round === 0 ? 'thinking' : 'fixing');
    const reply = (await post({ model, max_tokens: 24000, system, messages, tools: [TOOL], tool_choice: { type: 'auto' } }, signal)) as ModelReply;
    answer = readAnswer(reply);
    usage.input += reply.usage?.input_tokens ?? 0;
    usage.output += reply.usage?.output_tokens ?? 0;
    usage.cached += reply.usage?.cache_read_input_tokens ?? 0;
    answer.config = keepStudioNotes(config, answer.config);
    onStep?.('checking');
    const checked = await validate(answer.config, signal);
    issues = { errors: checked?.errors ?? [], warnings: checked?.warnings ?? [] };
    if (!issues.errors.length || round === maxRepairs) break;
    repairs += 1;
    messages.push(
      { role: 'assistant', content: reply.content },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: answer.toolUseId, is_error: true, content: repairMessage(issues.errors) }] }
    );
  }
  return { ...(answer as Answer), issues, repairs, usage };
}

/** Why a call to the model failed, in a sentence for a person. */
export function explainFailure(status: number, body: unknown): string {
  const b = isObj(body) ? body : {};
  const said = typeof b.error === 'string' ? b.error : isObj(b.error) && typeof b.error.message === 'string' ? b.error.message : '';
  if (status === 503) return 'No AI model is set up on this server. Whoever runs Studio adds ANTHROPIC_API_KEY to its environment and restarts it.';
  if (status === 401 || status === 403) return 'The AI service did not accept the key set on this server. Whoever runs Studio should check ANTHROPIC_API_KEY.';
  if (status === 429) return 'The AI service is busy or its limit was reached. Wait a moment and try again.';
  if (status === 413) return 'The agent is too large to send. Ask for part of it at a time.';
  if (status === 529 || status >= 500) return `The AI service is having trouble${said ? ` (${said})` : ''}. Try again in a moment.`;
  return said || `The AI service refused the request (${status}).`;
}

type FetchLike = (url: string, init?: {method?: string;headers?: Record<string, string>;body?: string;signal?: AbortSignal;}) => Promise<{ok: boolean;status: number;text: () => Promise<string>;json: () => Promise<unknown>;}>;

/** The call to the model through Studio's /llm route (the key is added there, never here). */
export async function postToModel(body: Json, signal?: AbortSignal, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<unknown> {
  let res;
  try {
    res = await fetchImpl('/llm/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  } catch (error) {
    if ((error as {name?: string;})?.name === 'AbortError') throw error;
    throw new Error('Studio could not reach the AI service. Is the Studio server running?');
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON: said below
  }
  if (!res.ok) throw new Error(explainFailure(res.status, json));
  if (!json) throw new Error('The AI service answered with something that is not JSON.');
  return json;
}

export interface LlmStatus {
  configured: boolean;
  model?: string;
  models?: string[];
  provider?: string;
}

/** GET /llm/status; anything else (no route, an error) reads as not configured. Never throws. */
export async function loadStatus(fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<LlmStatus> {
  try {
    const res = await fetchImpl('/llm/status', { headers: { accept: 'application/json' } });
    if (!res.ok) return { configured: false };
    const json = await res.json();
    return isObj(json) && typeof json.configured === 'boolean' ? json as unknown as LlmStatus : { configured: false };
  } catch {
    return { configured: false };
  }
}
