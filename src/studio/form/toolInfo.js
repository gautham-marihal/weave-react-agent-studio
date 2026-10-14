// Plain facts about tools, for the tool editor: what kind a tool is, whether the runtime can run it yet, which agents use
// it, and advice on its settings. Pure: no network, no DOM.

import { isObj } from './engine.js';

// The kinds the runtime does NOT run yet (the validator reports them as "unsupported"; this is the same list, so the
// "Add tool" menu can say so before anyone builds one). Built-ins are named by `builtin`.
export const UNSUPPORTED_KINDS = {
  task: 'Task tools',
  mcp: 'MCP server tools',
  knowledge: 'Knowledge search tools',
  code: 'Custom code tools',
};
export const UNSUPPORTED_BUILTINS = { send_dtmf: 'Send keypad tones', collect_dtmf: 'Collect keypad digits' };

export function kindOfTool(tool) {
  if (!isObj(tool)) return '';
  if (tool.type) return tool.type;
  return tool.builtin ? 'builtin' : '';
}

// null when the runtime can run it, otherwise what it can't.
export function notAvailable(tool) {
  const kind = kindOfTool(tool);
  if (UNSUPPORTED_KINDS[kind]) return UNSUPPORTED_KINDS[kind];
  if (kind === 'builtin' && UNSUPPORTED_BUILTINS[tool.builtin]) return UNSUPPORTED_BUILTINS[tool.builtin];
  return null;
}

// One line on when to use each built-in action.
export const BUILTIN_HELP = {
  end_call: 'Ends the conversation. It says a goodbye line first, which is done in code so it is never skipped. Give the agent this so it can hang up.',
  transfer_or_callback: 'Hands the caller to a person, or runs its fallback (say a callback line, raise a ticket) when no one can take it: no target, closed hours, a failed transfer. Needs a transfer set up under Telephony.',
  return_to_entry: 'A specialist sends the caller back to the agent that answers first, with a note of what is still needed.',
  send_dtmf: 'Sends keypad tones on the call (not available in the runtime yet).',
  collect_dtmf: 'Collects digits the caller presses (not available in the runtime yet).',
  send_form: 'Shows the caller a form. Needs a form defined under Forms; the channel must be able to show forms.',
  noop: 'Does nothing itself; only its effects run (set state, hand off). Use it for a tool whose whole job is a conditional handoff.',
};

export function agentsUsingTool(config, toolId) {
  const items = Array.isArray(config?.agents?.items) ? config.agents.items : [];
  return items.filter((agent) => isObj(agent) && Array.isArray(agent.tools) && agent.tools.includes(toolId)).map((agent) => agent.id).filter(Boolean);
}

// Tools that no agent offers (the validator warns about the same).
export function unusedTools(config) {
  const tools = Array.isArray(config?.tools) ? config.tools : [];
  return tools.filter((tool) => isObj(tool) && tool.id && agentsUsingTool(config, tool.id).length === 0).map((tool) => tool.id);
}

// What a typical call cares about: a lookup keeps the caller waiting, so a short timeout and few retries.
export function timeoutAdvice(tool) {
  const timeout = typeof tool?.timeout_s === 'number' ? tool.timeout_s : 10; // the runtime's default
  const retries = typeof tool?.retries === 'number' ? tool.retries : 0;
  const notes = [];
  if (timeout > 8) notes.push(`${tool?.timeout_s === undefined ? 'The default of 10 s is' : `${timeout} s is`} a long time for a caller to wait on a phone call. 5–8 s suits most lookups.`);
  if (retries > 1) notes.push('Each retry makes the caller wait longer. 0 or 1 is usual. Retries only happen on network errors and server (5xx) errors, never on a 4xx.');
  return notes;
}

// Description quality: it is the text that tells the model when to reach for the tool.
export function describeAdvice(description) {
  const text = String(description || '').trim();
  if (!text) return { level: 'warn', text: 'Add a description. It is what tells the model when to use this tool.' };
  if (text.length < 25) return { level: 'warn', text: 'Very short. Say when to use the tool, not only what it does.' };
  if (!/\b(when|if|after|before|once|whenever|only)\b/i.test(text)) return { level: 'hint', text: 'Say when to use it (“when the caller asks…”), not only what it does.' };
  return { level: 'ok', text: '' };
}

// The advice for each field of the tool error message: it goes to the model, not the caller.
export const ON_ERROR_HELP = 'This text is given to the model when the call fails (a timeout, a server error, even a 404 “no such account”). It is not read to the caller. Write it as an instruction: “Tell the caller you could not fetch the bill and offer a callback.” One message covers every kind of failure.';

// `reply`: who speaks after the tool has run. Each choice has an example, because the difference is hard to guess.
export const REPLY_CHOICES = [
  { value: 'model', label: 'The model answers', help: 'After the tool runs, the model reads its result and replies. Right for lookups.', example: 'The caller asks for their bill → the tool fetches it → the model says “You owe 42.50, due on 1 November.”' },
  { value: 'none', label: 'Nothing more is said', help: 'The model stays quiet this turn. Use it when the tool’s effects already spoke or showed something (a form, a transfer, a fixed goodbye), so the model doesn’t talk over it.', example: 'The caller asks for a person → the tool’s effect says “I’m putting you through” and transfers → the model adds nothing.' },
];
