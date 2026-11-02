// Test scenarios, the editing side: shapes, labels, sentences and checks for the config's `tests` section (a channel,
// what the caller says in `turns`, what must be true afterwards in `expect`, plus an optional description, a clock
// `now`, a starting `state`, `http_mocks` and a `model_script` that makes a run free and repeatable). The server runs
// them (POST /tests/run); scenarioRuns.ts reads its answers.
//
// Nothing here blocks saving, or calls a scenario broken, over something it does not know: the schema grows, so unknown
// parts are kept as they are and shown as "edit as JSON". Pure: no network, no DOM.

import type { AgentConfig } from '../types/studio';

export type Obj = Record<string, unknown>;

/** What the caller does in one turn: says words, or presses keys on a phone keypad. */
export interface Turn {
  say?: string;
  keys?: string;
  [key: string]: unknown;
}

/** One expectation: an object with one key naming its kind (`{ tool_called: "end_call" }`). */
export type Expectation = Obj;

/** A pretend answer for a request the bot makes. */
export interface HttpMock {
  method?: string;
  path?: string;
  status?: number;
  json?: unknown;
  text?: string;
  times?: number;
  connection?: string;
  query?: Record<string, string>;
  body_contains?: Obj;
  [key: string]: unknown;
}

/** One reply of the scripted model: what it says, or the tool it calls. */
export type ScriptItem = string | { tool?: string; args?: Obj; [key: string]: unknown };

export interface ScenarioDef {
  id: string;
  channel: string;
  description?: string;
  caller?: { persona?: string; [key: string]: unknown };
  turns: Turn[];
  expect: Expectation[];
  now?: string;
  state?: Obj;
  http_mocks?: HttpMock[];
  model_script?: ScriptItem[];
  [key: string]: unknown;
}

type Config = AgentConfig | null | undefined;

export const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const list = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export type ExpectShape = 'tool' | 'tool_args' | 'state' | 'regex' | 'agent' | 'http' | 'task' | 'guardrail' | 'guardrail_rule' | 'limit' | 'text';

/** Every kind of expectation the schema has (`tests[].expect[]` is a oneOf of these). `shape` says what the value holds. */
export const EXPECT_KINDS: Array<{ key: string; label: string; hint: string; shape: ExpectShape }> = [
  { key: 'tool_called', label: 'A tool was used', hint: 'The agent used this tool at some point.', shape: 'tool' },
  { key: 'tool_not_called', label: 'A tool was not used', hint: 'The agent never used this tool.', shape: 'tool' },
  {
    key: 'tool_called_with',
    label: 'A tool was used with…',
    hint: 'The agent used this tool, and the arguments included these values (others are allowed).',
    shape: 'tool_args',
  },
  { key: 'state_equals', label: 'A remembered value ends up as', hint: 'After the conversation, this state variable has this value.', shape: 'state' },
  {
    key: 'said_matches',
    label: 'The agent said something matching',
    hint: 'A pattern (a regular expression) that some agent message matches, ignoring case.',
    shape: 'regex',
  },
  { key: 'agent_is', label: 'The conversation ends with this agent', hint: 'This agent is in charge at the end (after any hand-overs).', shape: 'agent' },
  {
    key: 'http_called',
    label: 'The agent made an API request',
    hint: 'The agent made this request, whether or not a mock answered it. Leave “times” empty for at least once.',
    shape: 'http',
  },
  {
    key: 'http_not_called',
    label: 'The agent never made an API request',
    hint: 'The way to prove a guarded action (a return, a payment link) did not happen.',
    shape: 'http',
  },
  {
    key: 'task_outcome',
    label: 'A multi-step task ended a certain way',
    hint: 'A task ran and ended this way. A task skipped because it was already done counts as verified. Leave the outcome empty for any.',
    shape: 'task',
  },
  {
    key: 'guardrail_triggered',
    label: 'A safety rule caught what the caller said',
    hint: 'One of the checks on the caller’s words matched: the way to prove a trick is refused, or a card number is caught.',
    shape: 'guardrail',
  },
  {
    key: 'guardrail_not_triggered',
    label: 'A safety rule did not match',
    hint: 'This check matched nothing: the way to prove an ordinary request is not refused by mistake.',
    shape: 'guardrail_rule',
  },
  {
    key: 'limit_reached',
    label: 'A call limit ended the call',
    hint: 'A scenario is far shorter than the length and silence limits, so those two are best proved another way.',
    shape: 'limit',
  },
  {
    key: 'judge',
    label: 'A reviewer would agree that…',
    hint: 'A criterion in plain words, graded by a language model. It needs a live model, so it is not graded in a scenario with a model script.',
    shape: 'text',
  },
];

export const kindOfExpectation = (expectation: unknown): string =>
  isObj(expectation) ? (EXPECT_KINDS.find((kind) => kind.key in expectation)?.key ?? '') : '';
/** An expectation this file does not know: kept as it is, never an error. */
export const isUnknownExpectation = (expectation: unknown): boolean => isObj(expectation) && !kindOfExpectation(expectation);

export interface Choice {
  value: string;
  label: string;
  description?: string;
}

/** The call limits a `limit_reached` check can name, and what an input rule may have done (the schema's enums). */
export const LIMIT_CHOICES: Choice[] = [
  { value: 'max_call_duration_s', label: 'The call ran too long' },
  { value: 'max_silence_s', label: 'There was too much silence' },
  { value: 'max_tool_calls_per_call', label: 'Too many tool uses in one call' },
  { value: 'max_handoffs_per_call', label: 'Too many hand-overs in one call' },
];
export const GUARDRAIL_ACTION_CHOICES: Choice[] = [
  { value: 'deflect', label: 'Declined and answered with a fixed line' },
  { value: 'redact_in_logs', label: 'Hidden in the saved records' },
  { value: 'rewrite', label: 'Rewritten before the agent read it' },
  { value: 'block', label: 'Not passed to the agent at all' },
  { value: 'end_call', label: 'Ended the call' },
];
export const TASK_OUTCOME_CHOICES: Choice[] = [
  { value: 'verified', label: 'It worked (verified)' },
  { value: 'failed', label: 'It failed' },
  { value: 'declined', label: 'The caller declined' },
];
const choiceLabel = (choices: Choice[], value: unknown): string => String(choices.find((c) => c.value === value)?.label ?? value ?? '');

/** The ids of the checks on what the caller says (`guardrails.input`), for the pickers. */
export const inputRuleIdsOf = (config: Config): string[] =>
  list<Obj>(config?.guardrails?.input)
    .map((rule) => str(rule?.id))
    .filter(Boolean);
/** The ids of the multi-step tasks. */
export const taskIdsOf = (config: Config): string[] =>
  list<Obj>(config?.tasks)
    .map((task) => str(task?.id))
    .filter(Boolean);
/** A task's outcome names: verified / failed / declined, plus those its on_success / on_failure / on_decline give. */
export function outcomeNamesOf(config: Config, taskId: string | undefined): string[] {
  const task = list<Obj>(config?.tasks).find((t) => t?.id === taskId);
  const own = ['on_success', 'on_failure', 'on_decline']
    .map((k) => (isObj(task?.[k]) ? (task?.[k] as Obj).outcome : undefined))
    .filter((n): n is string => typeof n === 'string' && !!n);
  return [...new Set([...TASK_OUTCOME_CHOICES.map((c) => c.value), ...own])];
}
export const stateNamesOf = (config: Config): string[] => Object.keys(isObj(config?.state?.variables) ? config?.state?.variables : {});
export const agentIdsOf = (config: Config): string[] =>
  list<Obj>(config?.agents?.items)
    .map((a) => str(a?.id))
    .filter(Boolean);
export const channelIdsOf = (config: Config): string[] =>
  list<Obj>(config?.channels)
    .map((c) => str(c?.id))
    .filter(Boolean);
/** The connections a mock can be limited to (HTTP ones). */
export const httpConnectionsOf = (config: Config): string[] =>
  Object.entries(isObj(config?.connections) ? (config?.connections as Obj) : {})
    .filter(([, c]) => isObj(c) && c.type === 'http')
    .map(([id]) => id);

// ---- turns: what the caller says, or the keys they press (a phone line only)
export const KEYS_PATTERN = /^[0-9*#A-Da-d]+$/;
export const isKeysTurn = (turn: unknown): boolean => isObj(turn) && typeof turn.keys === 'string' && turn.say === undefined;
/** A turn in words. The digits of a keys turn are never repeated: they may be a PIN. */
export const describeTurn = (turn: unknown): string => (isKeysTurn(turn) ? 'presses keys on the keypad' : `“${isObj(turn) ? str(turn.say) : ''}”`);
export const channelTypeOf = (config: Config, id: string | undefined): string => str(list<Obj>(config?.channels).find((c) => c?.id === id)?.type);

const shortJson = (value: unknown, max = 80): string => {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
};
const httpWords = (e: Obj): string => `${e.method ? `${String(e.method)} ` : ''}${str(e.path) || '(a path)'}`;
const part = (e: Obj, key: string): Obj => (isObj(e[key]) ? (e[key] as Obj) : {});

/** An expectation in words. */
export function describeExpectation(expectation: unknown): string {
  const e = isObj(expectation) ? expectation : {};
  switch (kindOfExpectation(expectation)) {
    case 'tool_called':
      return `the tool “${String(e.tool_called)}” is used`;
    case 'tool_not_called':
      return `the tool “${String(e.tool_not_called)}” is not used`;
    case 'tool_called_with': {
      const v = part(e, 'tool_called_with');
      return `the tool “${str(v.tool) || '…'}” is used with ${shortJson(v.args ?? {})}`;
    }
    case 'state_equals': {
      const v = part(e, 'state_equals');
      return `${str(v.state) || 'a state variable'} ends up as ${JSON.stringify(v.value) ?? 'nothing'}`;
    }
    case 'said_matches':
      return `the agent says something matching /${String(e.said_matches)}/`;
    case 'agent_is':
      return `the conversation ends with the agent “${String(e.agent_is)}”`;
    case 'http_called': {
      const v = part(e, 'http_called');
      const times = typeof v.times === 'number' ? v.times : 0;
      return `the agent calls ${httpWords(v)}${times ? ` ${times} time${times === 1 ? '' : 's'}` : ''}`;
    }
    case 'http_not_called':
      return `the agent never calls ${httpWords(part(e, 'http_not_called'))}`;
    case 'task_outcome': {
      const v = part(e, 'task_outcome');
      return `the task “${str(v.task) || '…'}” ends ${v.outcome ? `as “${String(v.outcome)}”` : 'in any way'}`;
    }
    case 'guardrail_triggered': {
      const v = part(e, 'guardrail_triggered');
      return `the safety rule “${str(v.rule) || '…'}” catches what the caller says${v.action ? ` (${choiceLabel(GUARDRAIL_ACTION_CHOICES, v.action).toLowerCase()})` : ''}`;
    }
    case 'guardrail_not_triggered':
      return `the safety rule “${str(e.guardrail_not_triggered) || '…'}” does not match`;
    case 'limit_reached':
      return `the call ends because: ${choiceLabel(LIMIT_CHOICES, e.limit_reached).toLowerCase()}`;
    case 'judge':
      return `a reviewer agrees that ${String(e.judge)}`;
    default:
      return isObj(expectation) ? `something else is expected (${shortJson(expectation, 60)})` : 'something is expected';
  }
}

/** "Can I speak to someone?" -> "can_i_speak_to_someone" (a scenario id). */
export const slugId = (text: string): string =>
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+$/, '')
    .slice(0, 64);
const ID = /^[a-z][a-z0-9_-]{0,63}$/;

/** `base`, or `base_2`, `base_3`… whichever no scenario has yet. */
export function freshScenarioId(scenarios: unknown, base = 'scenario'): string {
  const taken = new Set(list<Obj>(scenarios).map((s) => s?.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

/** The scenarios in a config, objects only. */
export const scenariosOf = (config: Config): ScenarioDef[] => list(config?.tests).filter(isObj) as ScenarioDef[];

/** A scenario is scripted (free, repeatable) when it has a model script with at least one reply; else it is live. */
export const isScripted = (scenario: unknown): boolean => isObj(scenario) && Array.isArray(scenario.model_script) && scenario.model_script.length > 0;

/** A new scenario on the first enabled channel, with one turn and one expectation to fill in (so it starts valid). */
export function newScenario(config: Config, id?: string): ScenarioDef {
  const channels = list<Obj>(config?.channels).filter((c) => isObj(c) && c.id);
  const channel = str((channels.find((c) => c.enabled !== false) ?? channels[0])?.id);
  return { id: id || freshScenarioId(config?.tests, 'scenario'), channel, turns: [{ say: 'Hello' }], expect: [{ said_matches: '.+' }] };
}

/** What the model calls a tool: its `name`, else its id. Checks use this name because the runner records it. */
export const modelNameOf = (tool: unknown): string => (isObj(tool) ? String(tool.name || tool.id || '') : '');

/** Names a `tool_called` can use: each tool's model-facing name and the agents' hand-over tools. */
export function toolNamesOf(config: Config): string[] {
  const tools = list(config?.tools).map(modelNameOf);
  const handoffs = list<Obj>(config?.agents?.items).flatMap((a) => list<Obj>(a?.handoffs).map((h) => str(h?.tool)));
  return [...new Set([...tools, ...handoffs].filter(Boolean))];
}

/** The same names for a picker: each once and, when a name is not simply one tool's id, which tools it stands for. */
export function toolChoices(config: Config): Choice[] {
  const byName = new Map<string, string[]>();
  list<Obj>(config?.tools).forEach((tool) => {
    const name = modelNameOf(tool);
    if (!name) return;
    byName.set(name, [...(byName.get(name) ?? []), str(tool.id)]);
  });
  return toolNamesOf(config).map((name) => {
    const ids = byName.get(name) ?? [];
    const plain = ids.length === 1 && ids[0] === name;
    return plain || !ids.length
      ? { value: name, label: name }
      : { value: name, label: name, description: ids.length === 1 ? `the tool ${ids[0]}` : `the tools ${ids.join(' and ')}` };
  });
}

/** A fresh expectation of a kind, filled with something that makes sense in this config. */
export function newExpectation(kind: string, config: Config): Expectation {
  const tools = toolNamesOf(config);
  const states = stateNamesOf(config);
  const agents = agentIdsOf(config);
  switch (kind) {
    case 'tool_called':
      return { tool_called: tools[0] ?? '' };
    case 'tool_not_called':
      return { tool_not_called: tools[0] ?? '' };
    case 'tool_called_with':
      return { tool_called_with: { tool: tools[0] ?? '', args: {} } };
    case 'state_equals':
      return { state_equals: { state: states[0] ?? '', value: '' } };
    case 'said_matches':
      return { said_matches: '' };
    case 'agent_is':
      return { agent_is: str(config?.agents?.entry) || agents[0] || '' };
    case 'http_called':
      return { http_called: { method: 'GET', path: '' } };
    case 'http_not_called':
      return { http_not_called: { method: 'POST', path: '' } };
    case 'task_outcome':
      return { task_outcome: { task: taskIdsOf(config)[0] ?? '' } };
    case 'guardrail_triggered':
      return { guardrail_triggered: { rule: inputRuleIdsOf(config)[0] ?? '' } };
    case 'guardrail_not_triggered':
      return { guardrail_not_triggered: inputRuleIdsOf(config)[0] ?? '' };
    case 'limit_reached':
      return { limit_reached: 'max_tool_calls_per_call' };
    case 'judge':
      return { judge: '' };
    default:
      return { said_matches: '' };
  }
}

/** Is this a valid regular expression? '' when it is, else why not. */
export function regexProblem(source: string): string {
  try {
    new RegExp(source);
    return '';
  } catch (error) {
    return (error instanceof Error ? error.message : String(error)).replace(/^Invalid regular expression: /, '');
  }
}

/** "2026-10-14T03:00:00+08:00": the pattern the schema asks of `now` (a date and time WITH a time zone). */
export const NOW_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
export const nowProblem = (text: string): string =>
  text && !NOW_PATTERN.test(text) ? 'Write a date and time with a time zone, like 2026-10-14T03:00:00+08:00 or 2026-10-14T03:00Z.' : '';

const isWhole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

// What is wrong with one expectation, by what this file KNOWS. An unknown kind is never wrong, only "edit as JSON".
function expectationProblem(e: unknown, index: number, config: Config): string {
  const where = `Expectation ${index + 1}: `;
  if (!isObj(e)) return `${where}this isn’t an object.`;
  const kind = kindOfExpectation(e);
  if (!kind) return '';
  const toolNames = toolNamesOf(config);
  switch (kind) {
    case 'tool_called':
    case 'tool_not_called': {
      const name = str(e[kind]);
      if (!name) return `${where}choose a tool.`;
      return toolNames.includes(name) ? '' : `${where}there is no tool “${name}”.`;
    }
    case 'tool_called_with': {
      const v = e.tool_called_with;
      if (!isObj(v) || !v.tool) return `${where}choose a tool.`;
      if (!toolNames.includes(str(v.tool))) return `${where}there is no tool “${String(v.tool)}”.`;
      return isObj(v.args) ? '' : `${where}the arguments must be an object.`;
    }
    case 'state_equals': {
      const v = e.state_equals;
      if (!isObj(v) || !v.state) return `${where}choose a state variable.`;
      return stateNamesOf(config).includes(str(v.state)) ? '' : `${where}there is no state variable “${String(v.state)}”.`;
    }
    case 'said_matches': {
      const pattern = str(e.said_matches);
      if (!pattern) return `${where}write a pattern.`;
      const why = regexProblem(pattern);
      return why ? `${where}not a valid pattern (${why}).` : '';
    }
    case 'agent_is': {
      const id = str(e.agent_is);
      if (!id) return `${where}choose an agent.`;
      return agentIdsOf(config).includes(id) ? '' : `${where}there is no agent “${id}”.`;
    }
    case 'http_called':
    case 'http_not_called': {
      const v = e[kind];
      if (!isObj(v) || !str(v.path).trim()) return `${where}write the request path (a * matches anything).`;
      if (v.method && !HTTP_METHODS.includes(str(v.method))) return `${where}the method must be one of ${HTTP_METHODS.join(', ')}.`;
      if (kind === 'http_called' && v.times !== undefined && (!isWhole(v.times) || v.times < 1))
        return `${where}“times” must be a whole number of 1 or more, or empty.`;
      return '';
    }
    case 'task_outcome': {
      const v = e.task_outcome;
      if (!isObj(v) || !v.task) return `${where}choose a task.`;
      return taskIdsOf(config).includes(str(v.task)) ? '' : `${where}there is no task “${String(v.task)}”.`;
    }
    case 'guardrail_triggered': {
      const v = e.guardrail_triggered;
      if (!isObj(v) || !v.rule) return `${where}choose a safety rule.`;
      if (!inputRuleIdsOf(config).includes(str(v.rule))) return `${where}there is no check on what the caller says called “${String(v.rule)}”.`;
      return v.action === undefined || GUARDRAIL_ACTION_CHOICES.some((c) => c.value === v.action)
        ? ''
        : `${where}“${String(v.action)}” is not something a safety rule does.`;
    }
    case 'guardrail_not_triggered': {
      const rule = str(e.guardrail_not_triggered);
      if (!rule) return `${where}choose a safety rule.`;
      return inputRuleIdsOf(config).includes(rule) ? '' : `${where}there is no check on what the caller says called “${rule}”.`;
    }
    case 'limit_reached':
      return LIMIT_CHOICES.some((c) => c.value === e.limit_reached) ? '' : `${where}choose which limit.`;
    case 'judge':
      return str(e.judge).trim() ? '' : `${where}write the criterion.`;
    default:
      return '';
  }
}

/** What is wrong with one mock, or ''. */
export function mockProblem(mock: unknown, index: number): string {
  const where = `Mock ${index + 1}: `;
  if (!isObj(mock)) return `${where}this isn’t an object.`;
  if (!str(mock.path).trim()) return `${where}write the request path it answers (a * matches anything).`;
  if (mock.method && !HTTP_METHODS.includes(str(mock.method))) return `${where}the method must be one of ${HTTP_METHODS.join(', ')}.`;
  if (mock.status !== undefined && (!isWhole(mock.status) || mock.status < 100 || mock.status > 599))
    return `${where}the status must be a number from 100 to 599.`;
  if (mock.times !== undefined && (!isWhole(mock.times) || mock.times < 1)) return `${where}“times” must be a whole number of 1 or more, or empty.`;
  if (mock.query !== undefined && !(isObj(mock.query) && Object.values(mock.query).every((v) => typeof v === 'string')))
    return `${where}the query must be text values.`;
  if (mock.body_contains !== undefined && !isObj(mock.body_contains)) return `${where}“body contains” must be an object.`;
  return '';
}

/** What is wrong with one reply of a model script, or ''. */
export function scriptProblem(item: unknown, index: number): string {
  const where = `Model reply ${index + 1}: `;
  if (typeof item === 'string') return item.trim() ? '' : `${where}write what the model says.`;
  if (isObj(item))
    return item.tool ? (item.args === undefined || isObj(item.args) ? '' : `${where}the arguments must be an object.`) : `${where}choose the tool it uses.`;
  return `${where}it must be a message or a tool use.`;
}

export interface ScenarioProblems {
  id?: string;
  channel?: string;
  turns?: string;
  expect?: string[];
  now?: string;
  state?: string;
  mocks?: string[];
  script?: string[];
}

/** What is wrong with a scenario, by where (an empty object when nothing is). */
export function scenarioProblems(scenario: unknown, config: Config, others: unknown[] = []): ScenarioProblems {
  const out: ScenarioProblems = {};
  if (!isObj(scenario)) return { id: 'A scenario is an object.' };
  if (!ID.test(str(scenario.id))) out.id = 'Start with a lowercase letter, then lowercase letters, digits, - or _.';
  else if (others.some((s) => s !== scenario && isObj(s) && s.id === scenario.id)) out.id = 'Another scenario has this id.';
  const channel = str(scenario.channel);
  if (!channel) out.channel = 'Choose a channel.';
  else if (!channelIdsOf(config).includes(channel)) out.channel = `There is no channel “${channel}”.`;
  const turns = list(scenario.turns);
  if (!turns.length) out.turns = 'Add at least one thing the caller says.';
  else if (turns.some((t) => !isObj(t) || (isKeysTurn(t) ? !KEYS_PATTERN.test(str(t.keys)) : !str(t.say).trim())))
    out.turns = 'Every turn needs some words, or keys (digits, * or #, for example 4821#).';
  else if (turns.some(isKeysTurn) && !out.channel && channelTypeOf(config, channel) !== 'sip_voice')
    out.turns = 'Keys can only be pressed on a phone line. Choose a phone channel, or say it in words.';
  const expect = list(scenario.expect);
  const problems: string[] = [];
  if (!expect.length) problems.push('Add at least one thing that must be true afterwards.');
  expect.forEach((e, index) => {
    const why = expectationProblem(e, index, config);
    if (why) problems.push(why);
  });
  if (problems.length) out.expect = problems;
  if (typeof scenario.now === 'string') {
    const why = nowProblem(scenario.now);
    if (why) out.now = why;
  }
  if (scenario.state !== undefined && !isObj(scenario.state)) out.state = 'The starting state must be an object, like {"verified": true}.';
  const mocks = list(scenario.http_mocks).map(mockProblem).filter(Boolean);
  if (mocks.length) out.mocks = mocks;
  // A script needs at least one reply (the schema's minItems): said here rather than refused by the server.
  const script =
    scenario.model_script === undefined
      ? []
      : !Array.isArray(scenario.model_script)
        ? ['The model script must be a list of replies.']
        : !scenario.model_script.length
          ? ['The model script is empty: add what the model says, or remove the script to run it with a real model.']
          : scenario.model_script.map(scriptProblem).filter(Boolean);
  if (script.length) out.script = script;
  return out;
}

export const hasProblems = (problems: ScenarioProblems): boolean => Object.keys(problems).length > 0;
export const problemList = (problems: ScenarioProblems): string[] =>
  Object.values(problems)
    .flat()
    .filter((p): p is string => typeof p === 'string' && !!p);

export interface ImportResult {
  scenarios: ScenarioDef[];
  problems: string[];
  /** What was not added, to put back in the box; null when the text could not be read at all. */
  rejected: unknown[] | null;
  /** Ids of pasted scenarios the draft already has. */
  already: string[];
}

/** Pasted JSON (a list, an object with `tests`, or one scenario) checked and ready to add. Clashing ids are renamed. */
export function parseImport(text: string, config: Config): ImportResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { scenarios: [], problems: [`That isn’t valid JSON (${error instanceof Error ? error.message : String(error)}).`], rejected: null, already: [] };
  }
  const items = Array.isArray(value) ? value : isObj(value) && Array.isArray(value.tests) ? value.tests : isObj(value) ? [value] : null;
  if (!items) return { scenarios: [], problems: ['Paste a list of scenarios, or one scenario.'], rejected: null, already: [] };
  const taken: unknown[] = [...list(config?.tests)];
  const scenarios: ScenarioDef[] = [];
  const problems: string[] = [];
  const rejected: unknown[] = [];
  const already: string[] = [];
  items.forEach((item: unknown, index: number) => {
    if (!isObj(item)) {
      problems.push(`Item ${index + 1} isn’t a scenario.`);
      rejected.push(item);
      return;
    }
    // The same scenario, or the copy an earlier paste added under a new id ("billing_2" for a pasted "billing").
    const sameAs = (s: unknown) =>
      isObj(s) &&
      (JSON.stringify(s) === JSON.stringify(item) ||
        (String(s.id).startsWith(`${String(item.id)}_`) && JSON.stringify({ ...s, id: item.id }) === JSON.stringify(item)));
    if (taken.some(sameAs)) {
      already.push(String(item.id));
      return;
    }
    const clash = taken.some((s) => isObj(s) && s.id === item.id);
    const scenario = {
      ...item,
      id: clash || !item.id ? freshScenarioId(taken, str(item.id) || slugId(`scenario ${index + 1}`) || 'scenario') : item.id,
    } as ScenarioDef;
    const found = problemList(scenarioProblems(scenario, config, taken));
    if (found.length) {
      problems.push(`${scenario.id}: ${found.join(' ')}`);
      rejected.push(item);
      return;
    }
    taken.push(scenario);
    scenarios.push(scenario);
  });
  return { scenarios, problems, rejected, already };
}

/** A typed value as the JSON it means (true, 3, null, "text"), for a state value. */
export function parseValue(text: string): unknown {
  const value = String(text ?? '').trim();
  if (value === '') return '';
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
export const showValue = (value: unknown): string => (typeof value === 'string' ? value : (JSON.stringify(value) ?? ''));

/** "{...}" typed by a person -> { value } or { error }. An empty box means "no object". */
export function parseObject(text: string): { value?: Obj; error?: string } {
  const source = String(text ?? '').trim();
  if (!source) return { value: undefined };
  try {
    const value: unknown = JSON.parse(source);
    return isObj(value) ? { value } : { error: 'This must be a JSON object, like {"verified": true}.' };
  } catch (error) {
    return { error: `Not valid JSON (${error instanceof Error ? error.message : String(error)}).` };
  }
}

// ---- mocks

export interface RequestSeen {
  method?: string;
  path: string;
  connection?: string;
  query?: unknown;
  [key: string]: unknown;
}

/**
 * A starting mock for a request nothing answered (`unmocked` in a run): the same method and path, answering 200 with
 * an empty JSON object to fill in. Null when the scenario already has that mock (the first match wins, so a second one
 * would never be reached).
 */
export function stubMock(request: RequestSeen, existing: unknown = []): HttpMock | null {
  const mock: HttpMock = { path: String(request?.path || '/'), status: 200, json: {} };
  if (request?.method) mock.method = String(request.method).toUpperCase();
  if (request?.connection) mock.connection = String(request.connection);
  if (isObj(request?.query) && Object.keys(request.query).length) mock.query = request.query as Record<string, string>;
  const same = list(existing).some(
    (m) => isObj(m) && m.path === mock.path && str(m.method) === (mock.method ?? '') && JSON.stringify(m.query ?? {}) === JSON.stringify(mock.query ?? {}),
  );
  return same ? null : mock;
}

/** The scenario with a starting mock for this request added (the same object when it has one already). */
export function addMockTo<T extends Obj>(scenario: T, request: RequestSeen): T {
  const mock = stubMock(request, scenario?.http_mocks);
  return mock ? { ...scenario, http_mocks: [...list(scenario?.http_mocks), mock] } : scenario;
}

// ---- a test conversation made into a scenario

export interface ConversationFacts {
  id?: string;
  channel?: string;
  /** The conversation in order; `user`/`caller` lines are what the caller said. */
  messages?: Array<{ role?: string; from?: string; text?: string }>;
  /** The tools used, by the name the model knows them by. */
  tools?: string[];
  finalState?: Obj;
}

/**
 * A starting point to edit, made only of what the conversation showed: the caller's turns, a `tool_called` for each
 * tool used and a `state_equals` for each state variable that ended up set. Nothing is invented.
 */
export function scenarioFromConversation(config: Config, { id, channel, messages = [], tools = [], finalState = {} }: ConversationFacts = {}): ScenarioDef {
  const turns = messages
    .filter((m) => ['user', 'caller'].includes(m.role ?? m.from ?? ''))
    .map((m) => ({ say: String(m.text || '').trim() }))
    .filter((t) => t.say);
  const expect: Expectation[] = [];
  [...new Set(tools.filter(Boolean))].forEach((tool) => expect.push({ tool_called: tool }));
  const variables: Obj = isObj(config?.state?.variables) ? (config?.state?.variables as Obj) : {};
  Object.entries(isObj(finalState) ? finalState : {}).forEach(([state, value]) => {
    const declared = variables[state];
    const initial = isObj(declared) ? (declared.initial ?? declared.default) : undefined;
    if (state in variables && value !== undefined && value !== null && value !== '' && JSON.stringify(value) !== JSON.stringify(initial))
      expect.push({ state_equals: { state, value } });
  });
  if (!expect.length) expect.push({ said_matches: '.+' });
  return {
    id: id || freshScenarioId(config?.tests, 'from_a_test'),
    channel: channel || newScenario(config).channel,
    description: 'Made from a test conversation: edit what it checks.',
    turns: turns.length ? turns : [{ say: 'Hello' }],
    expect,
  };
}
