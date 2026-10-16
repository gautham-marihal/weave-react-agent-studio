// What the AI is told, and how its answer is read. Pure: no network, no DOM.
//
// The assistant is asked for the WHOLE configuration back (not a patch), through one tool, so the answer has a shape that can be checked: the same
// validator that checks a hand-made draft checks this one, and what it finds is handed back to the model to fix. Nothing here knows which provider answers.

import { isObj } from '../form/engine.js';

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
      questions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Things you could not decide and need the person to answer. Plain words. Empty when nothing is open.',
      },
    },
  },
};

// The schema without what costs tokens and teaches nothing: UI hints, examples, long prose cut to its first sentences.
export function compactSchema(schema) {
  const trim = (text) => {
    const t = String(text).replace(/\s+/g, ' ').trim();
    return t.length > 220 ? `${t.slice(0, 219)}…` : t;
  };
  const walk = (value) => {
    if (Array.isArray(value)) return value.map(walk);
    if (!isObj(value)) return value;
    const out = {};
    Object.entries(value).forEach(([key, v]) => {
      if (key === 'x-ui' || key === 'examples' || key === 'example' || key === '$comment') return;
      out[key] = key === 'description' && typeof v === 'string' ? trim(v) : walk(v);
    });
    return out;
  };
  return walk(schema);
}

export const SYSTEM_RULES = `You configure voice and chat agents for a no-code studio. A person describes, in plain English, what they need; you produce the agent configuration (a JSON document) that does it. You do this by calling the submit_config tool exactly once with the COMPLETE configuration.

How to work
- The configuration must validate against the JSON Schema below. Use only fields the schema has. Every cross-reference (an agent id in agents.entry or a hand-over, a tool id in an agent's tools, a message id, a state variable, a transfer id, a connection) must point at something that exists in the same document.
- When there is a current draft, EDIT it: change only what the request needs, keep every existing id, name, value and the builder section as they are, and return the whole document. When the draft is empty or a bare starter and the request describes a whole agent, build it fully.
- Prefer the simplest configuration that does the job. A single agent is fine; use several agents with hand-overs (agents.items[].handoffs) only when the request clearly describes different roles. Give every agent a clear, specific role in plain instructions, written to the agent as you would brief a person: who it helps, what it does, what it must never do.
- Channels: honour what is asked (a phone line, a web chat, web voice). Give each channel a greeting. Only turn on input and output kinds the request implies.
- Ids are lowercase letters, digits, - and _ and start with a letter; tool names the model sees are snake_case.
- A hand-over id (agents.items[].handoffs[].id) must be unique across the whole document.
- NEVER invent secrets, passwords, API keys, phone numbers or web addresses. Where one is needed and was not given, use a clearly marked placeholder the person must replace and list it in "questions". Secrets are only ever referenced by name, as {"secret": "NAME"}.
- Do not add tools that need a connection the person did not describe. A tool that ends the call or hands over to a person is fine when the request implies it.
- If the request is ambiguous, make the most reasonable choice, say so in "assumptions", and put what you really need to know in "questions". Do not refuse; always return a configuration.
- Write "summary", "assumptions" and "questions" for someone who has never seen JSON: short, concrete, no field names.

The configuration schema (JSON Schema, descriptions shortened):
`;

export function systemPrompt(schema) {
  return `${SYSTEM_RULES}${JSON.stringify(compactSchema(schema))}`;
}

const asText = (value) => JSON.stringify(value, null, 1);

// The first message: the current draft and what is wanted. `earlier` is what the person asked before in this session, for context.
export function requestMessage({ request, config, earlier = [] }) {
  const parts = [];
  if (earlier.length)
    parts.push(
      `Earlier in this session the person asked for (oldest first):\n${earlier
        .slice(-6)
        .map((r, i) => `${i + 1}. ${r}`)
        .join('\n')}`,
    );
  parts.push(`CURRENT DRAFT (edit this; keep what the request does not touch):\n${asText(config)}`);
  parts.push(`REQUEST:\n${request.trim()}`);
  return parts.join('\n\n');
}

// What to say when the validator found problems with the answer.
export function repairMessage(errors) {
  const lines = errors.slice(0, 25).map((e) => `- ${Array.isArray(e.path) && e.path.length ? e.path.join('.') : '(whole document)'}: ${e.message}`);
  return `The validator found problems with the configuration you returned:\n${lines.join('\n')}\n\nFix every one of them and call submit_config again with the complete corrected configuration. Change nothing else.`;
}

// The tool call out of a provider reply (Anthropic Messages shape). Throws an Error with a sentence a person can read.
export function readAnswer(reply) {
  if (!reply || !Array.isArray(reply.content)) throw new Error('The AI service answered in a way the studio does not understand.');
  const call = reply.content.find((block) => block.type === 'tool_use' && block.name === TOOL.name);
  if (!call) {
    if (reply.stop_reason === 'max_tokens') throw new Error('The answer was cut off because the agent is very large. Ask for part of it at a time.');
    const said = reply.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .trim();
    throw new Error(
      said ? `The assistant replied with words instead of a configuration: “${said.slice(0, 240)}”` : 'The assistant did not return a configuration.',
    );
  }
  const input = call.input;
  if (!isObj(input) || !isObj(input.config)) throw new Error('The assistant returned something that is not a configuration.');
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []);
  return {
    config: input.config,
    summary: typeof input.summary === 'string' ? input.summary.trim() : '',
    assumptions: list(input.assumptions),
    questions: list(input.questions),
    toolUseId: call.id,
    usage: reply.usage || null,
  };
}
