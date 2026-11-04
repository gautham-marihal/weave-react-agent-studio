// Plain facts about tools, for the tool editor: what kind a tool is, whether the runtime can run it yet, which agents
// use it, and advice on its settings. Pure: no network, no DOM.

import { isObj } from './engine.js';

// The kinds the runtime does not run yet (the validator's "unsupported" list, checked on 2026-10-16), so "Add tool" can
// say so before anyone builds one. Built-ins are named by `builtin`.
export const UNSUPPORTED_KINDS = {
  mcp: 'MCP server tools',
  code: 'Custom code tools',
};
export const UNSUPPORTED_BUILTINS = {};

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
  transfer_or_callback:
    'Hands the caller to a person, or runs its fallback (say a callback line, raise a ticket) when no one can take it: no target, closed hours, a failed transfer. Needs a transfer set up under Telephony.',
  return_to_entry: 'A specialist sends the caller back to the agent that answers first, with a note of what is still needed.',
  send_dtmf: 'Sends keypad tones on the call (a phone call only).',
  collect_dtmf: 'Collects digits the caller presses (a phone call only).',
  send_form: 'Shows the caller a form. Needs a form defined under Forms; the channel must be able to show forms.',
  noop: 'Does nothing itself; only its effects run (set state, hand off). Use it for a tool whose whole job is a conditional handoff.',
};

export function agentsUsingTool(config, toolId) {
  const items = Array.isArray(config?.agents?.items) ? config.agents.items : [];
  return items
    .filter((agent) => isObj(agent) && Array.isArray(agent.tools) && agent.tools.includes(toolId))
    .map((agent) => agent.id)
    .filter(Boolean);
}

// Whether something besides an agent's tool list names the tool (a guardrail rule, the off-topic action, a task step's
// check, a test). Such a tool is in use even when no agent offers it; the validator agrees.
export function toolNamedElsewhere(config, toolId) {
  const list = (v) => (Array.isArray(v) ? v : []);
  const guardrails = config?.guardrails;
  if (list(guardrails?.escalation).some((r) => isObj(r) && r.tool === toolId) || guardrails?.topics?.on_off_topic?.then === toolId) return true;
  if (list(config?.tasks).some((task) => list(task?.steps).some((step) => step?.validate?.tool === toolId))) return true;
  return list(config?.tests).some(
    (test) =>
      list(test?.model_script).some((m) => m?.tool === toolId) ||
      list(test?.expect).some((e) => isObj(e) && [e.tool_called, e.tool_not_called, e.tool_called_with?.tool].includes(toolId)),
  );
}

export function unusedTools(config) {
  const tools = Array.isArray(config?.tools) ? config.tools : [];
  return tools
    .filter((tool) => isObj(tool) && tool.id && agentsUsingTool(config, tool.id).length === 0 && !toolNamedElsewhere(config, tool.id))
    .map((tool) => tool.id);
}

// What a typical call cares about: a lookup keeps the caller waiting, so a short timeout and few retries.
export function timeoutAdvice(tool) {
  const timeout = typeof tool?.timeout_s === 'number' ? tool.timeout_s : 10; // the runtime's default
  const retries = typeof tool?.retries === 'number' ? tool.retries : 0;
  const notes = [];
  if (timeout > 8)
    notes.push(
      `${tool?.timeout_s === undefined ? 'The default of 10 s is' : `${timeout} s is`} a long time for a caller to wait on a phone call. 5–8 s suits most lookups.`,
    );
  if (retries > 1)
    notes.push('Each retry makes the caller wait longer. 0 or 1 is usual. Retries only happen on network errors and server (5xx) errors, never on a 4xx.');
  return notes;
}

// Description quality: it is the text that tells the model when to reach for the tool.
export function describeAdvice(description) {
  const text = String(description || '').trim();
  if (!text) return { level: 'warn', text: 'Add a description. It is what tells the model when to use this tool.' };
  if (text.length < 25) return { level: 'warn', text: 'Very short. Say when to use the tool, not only what it does.' };
  if (!/\b(when|if|after|before|once|whenever|only)\b/i.test(text))
    return { level: 'hint', text: 'Say when to use it (“when the caller asks…”), not only what it does.' };
  return { level: 'ok', text: '' };
}

// The advice for each field of the tool error message: it goes to the model, not the caller.
export const ON_ERROR_SEARCH_HELP =
  'This text is given to the model when the search fails (the search service is down, it timed out, or no index was built yet). It is not read to the caller. Write it as an instruction: “Say you can’t look that up right now and offer to take a message.”';
export const ON_ERROR_HELP =
  'This text is given to the model when the call fails (a timeout, a server error, even a 404 “no such account”). It is not read to the caller. Write it as an instruction: “Tell the caller you could not fetch the bill and offer a callback.” One message covers every kind of failure.';

// `reply`: who speaks after the tool has run. Each choice has an example, because the difference is hard to guess.
export const REPLY_CHOICES = [
  {
    value: 'model',
    label: 'The model answers',
    help: 'After the tool runs, the model reads its result and replies. Right for lookups.',
    example: 'The caller asks for their bill → the tool fetches it → the model says “You owe 42.50, due on 1 November.”',
  },
  {
    value: 'none',
    label: 'Nothing more is said',
    help: 'The model stays quiet this turn. Use it when the tool’s effects already spoke or showed something (a form, a transfer, a fixed goodbye), so the model doesn’t talk over it.',
    example: 'The caller asks for a person → the tool’s effect says “I’m putting you through” and transfers → the model adds nothing.',
  },
];

// ---- finding a tool in a long list ----------------------------------------------------------------------------------
const TOOL_KIND_LABEL = { http: 'HTTP', builtin: 'Built-in', task: 'Task', mcp: 'MCP', knowledge: 'Knowledge', code: 'Code' };

// How many of each kind there are: [{ kind, label, count }], the most common first.
export function toolKindCounts(tools) {
  const counts = new Map();
  (Array.isArray(tools) ? tools : []).forEach((tool) => {
    const kind = kindOfTool(tool) || 'other';
    counts.set(kind, (counts.get(kind) || 0) + 1);
  });
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, label: TOOL_KIND_LABEL[kind] || kind, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

// Does this tool match the typed words, the chosen kind and "only the unused"? Every word must appear (any order, any
// case) in its id, name, description, kind or built-in.
export function toolMatches(tool, { query = '', kind = '', unusedOnly = false } = {}, unused = new Set()) {
  if (!isObj(tool)) return !query && !kind && !unusedOnly;
  if (kind && (kindOfTool(tool) || 'other') !== kind) return false;
  if (unusedOnly && !unused.has(tool.id)) return false;
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = [tool.id, tool.name, tool.description, kindOfTool(tool), TOOL_KIND_LABEL[kindOfTool(tool)], tool.builtin]
    .filter((v) => typeof v === 'string')
    .join(' ')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

// "used by billing and support", "used by 4 agents", or "not used by any agent".
export function usedByText(agentIds) {
  const ids = Array.isArray(agentIds) ? agentIds : [];
  if (!ids.length) return 'not used by any agent';
  if (ids.length <= 2) return `used by ${ids.join(' and ')}`;
  return `used by ${ids.length} agents`;
}
