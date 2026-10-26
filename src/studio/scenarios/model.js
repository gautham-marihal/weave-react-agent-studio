// Test scenarios: the `tests` section of an agent's configuration is a list of conversations to check: who is talking on which channel
// (`channel`, `caller`), what the caller says turn by turn (`turns`), and what must hold afterwards (`expect`). A scenario can also carry a
// `description`, a pretend clock (`now`), starting `state`, answers for the bot's API calls (`http_mocks`) and a `model_script` that
// replaces the language model so the run is free and repeatable. This module is the editing side: the shapes, labels, sentences and
// checks for writing them. Running them is the server's job (see api.runTests); runResults.js reads what it answers.
//
// A rule this file keeps: the form NEVER blocks saving, and never calls a scenario broken, because of something it does not know. The
// schema grows (thirteen kinds of expectation today, eight more than the first version of the studio knew), so a part this file doesn't
// recognise is kept exactly as it is and shown as "edit in JSON"; only what it positively knows to be wrong is a problem.
// Pure: no network, no DOM.

import { isObj } from '../form/engine.js';

const list = (v) => (Array.isArray(v) ? v : []);

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
export const HTTP_METHODS = METHODS;

// Every kind of expectation the schema has (`tests[].expect[]` is a oneOf of these). `shape` says what the value holds.
export const EXPECT_KINDS = [
  { key: 'tool_called', label: 'A tool was called', hint: 'The agent used this tool at some point.', shape: 'tool' },
  { key: 'tool_not_called', label: 'A tool was not called', hint: 'The agent never used this tool.', shape: 'tool' },
  {
    key: 'tool_called_with',
    label: 'A tool was called with…',
    hint: 'The agent used this tool, and the arguments included these values (others are allowed).',
    shape: 'tool_args',
  },
  { key: 'state_equals', label: 'A state variable ends up as', hint: 'After the conversation, this variable has this value.', shape: 'state' },
  {
    key: 'said_matches',
    label: 'The agent said something matching',
    hint: 'A pattern (a regular expression) that some agent message matches, ignoring case.',
    shape: 'regex',
  },
  { key: 'agent_is', label: 'The conversation ends with this agent', hint: 'This agent is in charge at the end (after any handoffs).', shape: 'agent' },
  {
    key: 'http_called',
    label: 'The bot made an API request',
    hint: 'The bot made this request, whether or not a mock answered it. Leave “times” empty for at least once.',
    shape: 'http',
  },
  {
    key: 'http_not_called',
    label: 'The bot never made an API request',
    hint: 'The way to prove a guarded action (a return, a payment link) did not happen.',
    shape: 'http',
  },
  {
    key: 'task_outcome',
    label: 'A multi-step task ended a certain way',
    hint: 'A task ran and ended this way. A task skipped because it was already satisfied counts as verified. Leave the outcome empty for any.',
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
    hint: 'A scenario is far shorter than the length and silence limits, so those two are best proved with a unit test.',
    shape: 'limit',
  },
  {
    key: 'judge',
    label: 'A reviewer would agree that…',
    hint: 'A criterion in plain words, graded by a language model. It needs a live model, so it is skipped in a scenario with a model script.',
    shape: 'text',
  },
];
export const kindOfExpectation = (expectation) => (isObj(expectation) ? EXPECT_KINDS.find((kind) => kind.key in expectation)?.key || '' : '');
// An expectation this file doesn't know: kept as it is, never an error.
export const isUnknownExpectation = (expectation) => isObj(expectation) && !kindOfExpectation(expectation);

// The call limits a `limit_reached` check can name, and what an input rule may have done (the schema's enums), in words.
export const LIMIT_CHOICES = [
  { value: 'max_call_duration_s', label: 'The call ran too long' },
  { value: 'max_silence_s', label: 'There was too much silence' },
  { value: 'max_tool_calls_per_call', label: 'Too many tool uses in one call' },
  { value: 'max_handoffs_per_call', label: 'Too many hand-overs in one call' },
];
export const GUARDRAIL_ACTION_CHOICES = [
  { value: 'deflect', label: 'Declined and answered with a fixed line' },
  { value: 'redact_in_logs', label: 'Hidden in the saved records' },
  { value: 'rewrite', label: 'Rewritten before the agent read it' },
  { value: 'block', label: 'Not passed to the agent at all' },
  { value: 'end_call', label: 'Ended the call' },
];
export const TASK_OUTCOME_CHOICES = [
  { value: 'verified', label: 'It worked (verified)' },
  { value: 'failed', label: 'It failed' },
  { value: 'declined', label: 'The caller declined' },
];
const choiceLabel = (choices, value) => String(choices.find((c) => c.value === value)?.label ?? value ?? '');

// The ids of the checks on what the caller says (`guardrails.input`), and of the multi-step tasks, for the pickers.
export const inputRuleIdsOf = (config) =>
  list(config?.guardrails?.input)
    .map((rule) => rule?.id)
    .filter(Boolean);
export const taskIdsOf = (config) =>
  list(config?.tasks)
    .map((task) => task?.id)
    .filter(Boolean);
// The outcome names a task can end with: verified / failed / declined, and the names its own on_success / on_failure / on_decline blocks give.
export function outcomeNamesOf(config, taskId) {
  const task = list(config?.tasks).find((t) => t?.id === taskId);
  const own = ['on_success', 'on_failure', 'on_decline'].map((k) => task?.[k]?.outcome).filter((n) => typeof n === 'string' && n);
  return [...new Set([...TASK_OUTCOME_CHOICES.map((c) => c.value), ...own])];
}

// ---- turns: what the caller says, or the keys they press (a phone line only) ---------------------------------------------------------------
export const KEYS_PATTERN = /^[0-9*#A-Da-d]+$/;
export const isKeysTurn = (turn) => isObj(turn) && typeof turn.keys === 'string' && turn.say === undefined;
export const describeTurn = (turn) => (isKeysTurn(turn) ? 'presses keys on the keypad' : `“${isObj(turn) ? (turn.say ?? '') : ''}”`);
export const channelTypeOf = (config, id) => list(config?.channels).find((c) => c?.id === id)?.type || '';

const shortJson = (value, max = 80) => {
  const text = JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
};
const httpWords = (e) => `${e.method ? `${e.method} ` : ''}${e.path || '(a path)'}`;

// An expectation in words.
export function describeExpectation(expectation) {
  switch (kindOfExpectation(expectation)) {
    case 'tool_called':
      return `the tool “${expectation.tool_called}” is called`;
    case 'tool_not_called':
      return `the tool “${expectation.tool_not_called}” is not called`;
    case 'tool_called_with':
      return `the tool “${expectation.tool_called_with?.tool || '…'}” is called with ${shortJson(expectation.tool_called_with?.args ?? {})}`;
    case 'state_equals':
      return `${expectation.state_equals?.state || 'a state variable'} ends up as ${JSON.stringify(expectation.state_equals?.value)}`;
    case 'said_matches':
      return `the agent says something matching /${expectation.said_matches}/`;
    case 'agent_is':
      return `the conversation ends with the agent “${expectation.agent_is}”`;
    case 'http_called': {
      const e = expectation.http_called || {};
      return `the bot calls ${httpWords(e)}${e.times ? ` ${e.times} time${e.times === 1 ? '' : 's'}` : ''}`;
    }
    case 'http_not_called':
      return `the bot never calls ${httpWords(expectation.http_not_called || {})}`;
    case 'task_outcome': {
      const e = expectation.task_outcome || {};
      return `the task “${e.task || '…'}” ends ${e.outcome ? `as “${e.outcome}”` : 'in any way'}`;
    }
    case 'guardrail_triggered': {
      const e = expectation.guardrail_triggered || {};
      return `the safety rule “${e.rule || '…'}” catches what the caller says${e.action ? ` (${choiceLabel(GUARDRAIL_ACTION_CHOICES, e.action).toLowerCase()})` : ''}`;
    }
    case 'guardrail_not_triggered':
      return `the safety rule “${expectation.guardrail_not_triggered || '…'}” does not match`;
    case 'limit_reached':
      return `the call ends because: ${choiceLabel(LIMIT_CHOICES, expectation.limit_reached).toLowerCase()}`;
    case 'judge':
      return `a reviewer agrees that ${expectation.judge}`;
    default:
      return isObj(expectation) ? `something else is expected (${shortJson(expectation, 60)})` : 'something is expected';
  }
}

export const slugId = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+$/, '')
    .slice(0, 64);
const ID = /^[a-z][a-z0-9_-]{0,63}$/;

export function freshScenarioId(scenarios, base = 'scenario') {
  const taken = new Set(list(scenarios).map((s) => s?.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

// A new scenario on the first enabled channel, with one turn and one expectation to fill in (so it starts valid).
export function newScenario(config, id) {
  const channels = list(config?.channels).filter((c) => isObj(c) && c.id);
  const channel = (channels.find((c) => c.enabled !== false) || channels[0])?.id || '';
  return { id: id || freshScenarioId(config?.tests, 'scenario'), channel, turns: [{ say: 'Hello' }], expect: [{ said_matches: '.+' }] };
}

// A fresh expectation of a kind, filled with something that makes sense in this config.
export function newExpectation(kind, config) {
  const tools = toolNamesOf(config);
  const states = Object.keys(isObj(config?.state?.variables) ? config.state.variables : {});
  const agents = list(config?.agents?.items)
    .map((a) => a?.id)
    .filter(Boolean);
  switch (kind) {
    case 'tool_called':
      return { tool_called: tools[0] || '' };
    case 'tool_not_called':
      return { tool_not_called: tools[0] || '' };
    case 'tool_called_with':
      return { tool_called_with: { tool: tools[0] || '', args: {} } };
    case 'state_equals':
      return { state_equals: { state: states[0] || '', value: '' } };
    case 'said_matches':
      return { said_matches: '' };
    case 'agent_is':
      return { agent_is: config?.agents?.entry || agents[0] || '' };
    case 'http_called':
      return { http_called: { method: 'GET', path: '' } };
    case 'http_not_called':
      return { http_not_called: { method: 'POST', path: '' } };
    case 'task_outcome':
      return { task_outcome: { task: taskIdsOf(config)[0] || '' } };
    case 'guardrail_triggered':
      return { guardrail_triggered: { rule: inputRuleIdsOf(config)[0] || '' } };
    case 'guardrail_not_triggered':
      return { guardrail_not_triggered: inputRuleIdsOf(config)[0] || '' };
    case 'limit_reached':
      return { limit_reached: 'max_tool_calls_per_call' };
    case 'judge':
      return { judge: '' };
    default:
      return { said_matches: '' };
  }
}

// What the model calls a tool: its `name`, which defaults to its id. A check says "the tool X is called" by THIS name,
// because it is what the runner records (a voice variant and a chat variant of one tool may share a name while their
// ids differ).
export const modelNameOf = (tool) => (isObj(tool) ? String(tool.name || tool.id || '') : '');

// The names a `tool_called` can use: each tool's model-facing name, and the handoff tools of the agents (the schema's `tool_names`).
export function toolNamesOf(config) {
  const tools = list(config?.tools).map(modelNameOf);
  const handoffs = list(config?.agents?.items).flatMap((a) => list(a?.handoffs).map((h) => h?.tool));
  return [...new Set([...tools, ...handoffs].filter(Boolean))];
}

// The same names for a picker: each once, and, when a name is not simply one tool's id, which tools it stands for.
export function toolChoices(config) {
  const byName = new Map();
  list(config?.tools).forEach((tool) => {
    const name = modelNameOf(tool);
    if (!name) return;
    byName.set(name, [...(byName.get(name) || []), tool.id]);
  });
  return toolNamesOf(config).map((name) => {
    const ids = byName.get(name) || [];
    const plain = ids.length === 1 && ids[0] === name;
    return plain || !ids.length
      ? { value: name, label: name }
      : { value: name, label: name, description: ids.length === 1 ? `the tool ${ids[0]}` : `the tools ${ids.join(' and ')}` };
  });
}

// Valid regular expression? ('' when fine, else why not)
export function regexProblem(source) {
  try {
    new RegExp(source);
    return '';
  } catch (error) {
    return error.message.replace(/^Invalid regular expression: /, '');
  }
}

// "2026-10-14T03:00:00+08:00": the pattern the schema asks of `now` (a date and time WITH a time zone).
export const NOW_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
export const nowProblem = (text) =>
  text && !NOW_PATTERN.test(text) ? 'Write a date and time with a time zone, like 2026-10-14T03:00:00+08:00 or 2026-10-14T03:00Z.' : '';

// What is wrong with one expectation, by what this file KNOWS. An unknown kind is never wrong, only "edit in JSON".
function expectationProblem(e, index, config) {
  const where = `Expectation ${index + 1}: `;
  if (!isObj(e)) return `${where}this isn’t an object.`;
  const kind = kindOfExpectation(e);
  if (!kind) return '';
  const toolNames = toolNamesOf(config);
  const stateNames = Object.keys(isObj(config?.state?.variables) ? config.state.variables : {});
  const agentIds = list(config?.agents?.items).map((a) => a?.id);
  switch (kind) {
    case 'tool_called':
    case 'tool_not_called':
      if (!e[kind]) return `${where}choose a tool.`;
      return toolNames.includes(e[kind]) ? '' : `${where}there is no tool “${e[kind]}”.`;
    case 'tool_called_with': {
      const v = e.tool_called_with;
      if (!isObj(v) || !v.tool) return `${where}choose a tool.`;
      if (!toolNames.includes(v.tool)) return `${where}there is no tool “${v.tool}”.`;
      return isObj(v.args) ? '' : `${where}the arguments must be an object.`;
    }
    case 'state_equals': {
      const v = e.state_equals;
      if (!isObj(v) || !v.state) return `${where}choose a state variable.`;
      return stateNames.includes(v.state) ? '' : `${where}there is no state variable “${v.state}”.`;
    }
    case 'said_matches': {
      if (!e.said_matches) return `${where}write a pattern.`;
      const why = regexProblem(e.said_matches);
      return why ? `${where}not a valid pattern (${why}).` : '';
    }
    case 'agent_is':
      if (!e.agent_is) return `${where}choose an agent.`;
      return agentIds.includes(e.agent_is) ? '' : `${where}there is no agent “${e.agent_is}”.`;
    case 'http_called':
    case 'http_not_called': {
      const v = e[kind];
      if (!isObj(v) || !String(v.path || '').trim()) return `${where}write the request path (a * matches anything).`;
      if (v.method && !METHODS.includes(v.method)) return `${where}the method must be one of ${METHODS.join(', ')}.`;
      if (kind === 'http_called' && v.times !== undefined && (!Number.isInteger(v.times) || v.times < 1))
        return `${where}“times” must be a whole number of 1 or more, or empty.`;
      return '';
    }
    case 'task_outcome': {
      const v = e.task_outcome;
      if (!isObj(v) || !v.task) return `${where}choose a task.`;
      return taskIdsOf(config).includes(v.task) ? '' : `${where}there is no task “${v.task}”.`;
    }
    case 'guardrail_triggered': {
      const v = e.guardrail_triggered;
      if (!isObj(v) || !v.rule) return `${where}choose a safety rule.`;
      if (!inputRuleIdsOf(config).includes(v.rule)) return `${where}there is no check on what the caller says called “${v.rule}”.`;
      return v.action === undefined || GUARDRAIL_ACTION_CHOICES.some((c) => c.value === v.action)
        ? ''
        : `${where}“${v.action}” is not something a safety rule does.`;
    }
    case 'guardrail_not_triggered':
      if (!e.guardrail_not_triggered) return `${where}choose a safety rule.`;
      return inputRuleIdsOf(config).includes(e.guardrail_not_triggered)
        ? ''
        : `${where}there is no check on what the caller says called “${e.guardrail_not_triggered}”.`;
    case 'limit_reached':
      return LIMIT_CHOICES.some((c) => c.value === e.limit_reached) ? '' : `${where}choose which limit.`;
    case 'judge':
      return String(e.judge || '').trim() ? '' : `${where}write the criterion.`;
    default:
      return '';
  }
}

// What is wrong with one mock, or ''.
export function mockProblem(mock, index) {
  const where = `Mock ${index + 1}: `;
  if (!isObj(mock)) return `${where}this isn’t an object.`;
  if (!String(mock.path || '').trim()) return `${where}write the request path it answers (a * matches anything).`;
  if (mock.method && !METHODS.includes(mock.method)) return `${where}the method must be one of ${METHODS.join(', ')}.`;
  if (mock.status !== undefined && (!Number.isInteger(mock.status) || mock.status < 100 || mock.status > 599))
    return `${where}the status must be a number from 100 to 599.`;
  if (mock.times !== undefined && (!Number.isInteger(mock.times) || mock.times < 1)) return `${where}“times” must be a whole number of 1 or more, or empty.`;
  if (mock.query !== undefined && !(isObj(mock.query) && Object.values(mock.query).every((v) => typeof v === 'string')))
    return `${where}the query must be text values.`;
  if (mock.body_contains !== undefined && !isObj(mock.body_contains)) return `${where}“body contains” must be an object.`;
  return '';
}

// What is wrong with a model script item, or ''.
export function scriptProblem(item, index) {
  const where = `Model reply ${index + 1}: `;
  if (typeof item === 'string') return item.trim() ? '' : `${where}write what the model says.`;
  if (isObj(item))
    return item.tool ? (item.args === undefined || isObj(item.args) ? '' : `${where}the arguments must be an object.`) : `${where}choose the tool it calls.`;
  return `${where}it must be a message or a tool call.`;
}

// What is wrong with a scenario, by where: { id, channel, turns, expect: ['…'], now, state, mocks: ['…'], script: ['…']
// } (an empty object when fine).
export function scenarioProblems(scenario, config, others = []) {
  const out = {};
  if (!isObj(scenario)) return { id: 'A scenario is an object.' };
  if (!ID.test(String(scenario.id || ''))) out.id = 'Start with a lowercase letter, then lowercase letters, digits, - or _.';
  else if (others.some((s) => s !== scenario && s?.id === scenario.id)) out.id = 'Another scenario has this id.';
  const channelIds = list(config?.channels).map((c) => c?.id);
  if (!scenario.channel) out.channel = 'Choose a channel.';
  else if (!channelIds.includes(scenario.channel)) out.channel = `There is no channel “${scenario.channel}”.`;
  const turns = list(scenario.turns);
  if (!turns.length) out.turns = 'Add at least one thing the caller says.';
  else if (turns.some((t) => !isObj(t) || (isKeysTurn(t) ? !KEYS_PATTERN.test(t.keys) : !String(t.say ?? '').trim())))
    out.turns = 'Every turn needs some words, or keys (digits, * or #, for example 4821#).';
  else if (turns.some(isKeysTurn) && !out.channel && channelTypeOf(config, scenario.channel) !== 'sip_voice')
    out.turns = 'Keys can only be pressed on a phone line. Choose a phone channel, or say it in words.';
  const expect = list(scenario.expect);
  const problems = [];
  if (!expect.length) problems.push('Add at least one thing that must be true afterwards.');
  expect.forEach((e, index) => {
    const why = expectationProblem(e, index, config);
    if (why) problems.push(why);
  });
  if (problems.length) out.expect = problems;
  if (scenario.now !== undefined && typeof scenario.now === 'string') {
    const why = nowProblem(scenario.now);
    if (why) out.now = why;
  }
  if (scenario.state !== undefined && !isObj(scenario.state)) out.state = 'The starting state must be an object, like {"verified": true}.';
  const mocks = list(scenario.http_mocks).map(mockProblem).filter(Boolean);
  if (mocks.length) out.mocks = mocks;
  // a script is a list of one reply or more (the schema's minItems): an empty one would be refused, so it is said here rather than by the server
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

export const hasProblems = (problems) => Object.keys(problems).length > 0;

// Pasted JSON -> { scenarios, problems: [string], rejected: [the pasted items that were not added], already: [ids] }.
// Accepts a list, or an object with a `tests` list. Ids that clash are renamed; a scenario the draft already has as
// pasted (under its id, or the new id an earlier paste gave it) is not added again (`already`), so pasting the same
// text twice adds nothing twice.
export function parseImport(text, config) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { scenarios: [], problems: [`That isn’t valid JSON (${error.message}).`], rejected: null, already: [] };
  }
  const items = Array.isArray(value) ? value : isObj(value) && Array.isArray(value.tests) ? value.tests : isObj(value) ? [value] : null;
  if (!items) return { scenarios: [], problems: ['Paste a list of scenarios, or one scenario.'], rejected: null, already: [] };
  const taken = [...list(config?.tests)];
  const scenarios = [];
  const problems = [];
  const rejected = [];
  const already = [];
  items.forEach((item, index) => {
    if (!isObj(item)) {
      problems.push(`Item ${index + 1} isn’t a scenario.`);
      rejected.push(item);
      return;
    }
    // the same scenario, or the copy an earlier paste added under a new id ("billing_2" for a pasted "billing")
    const sameAs = (s) =>
      isObj(s) &&
      (JSON.stringify(s) === JSON.stringify(item) ||
        (String(s.id).startsWith(`${item.id}_`) && JSON.stringify({ ...s, id: item.id }) === JSON.stringify(item)));
    if (taken.some(sameAs)) {
      already.push(item.id);
      return;
    }
    const scenario = {
      ...item,
      id: taken.some((s) => s?.id === item.id) || !item.id ? freshScenarioId(taken, item.id || slugId(`scenario ${index + 1}`) || 'scenario') : item.id,
    };
    const found = scenarioProblems(scenario, config, taken);
    const flat = Object.values(found).flat();
    if (flat.length) {
      problems.push(`${scenario.id}: ${flat.join(' ')}`);
      rejected.push(item);
      return;
    }
    taken.push(scenario);
    scenarios.push(scenario);
  });
  return { scenarios, problems, rejected, already };
}

// Turns a typed value into the JSON it means (true, 3, null, "text") for a state value.
export function parseValue(text) {
  const value = String(text ?? '').trim();
  if (value === '') return '';
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
export const showValue = (value) => (typeof value === 'string' ? value : JSON.stringify(value));

// "{...}" typed by a person -> { value } or { error }. An empty box means "no object".
export function parseObject(text) {
  const source = String(text ?? '').trim();
  if (!source) return { value: undefined };
  try {
    const value = JSON.parse(source);
    return isObj(value) ? { value } : { error: 'This must be a JSON object, like {"verified": true}.' };
  } catch (error) {
    return { error: `Not valid JSON (${error.message}).` };
  }
}

// ---- mocks ---------------------------------------------------------------------------------------------------------------------------
// A starting mock for a request the bot made and nothing answered (`unmocked` in a run): the same method and path, answering 200 with an
// empty JSON object for the author to fill in. Added to the scenario's own list; nothing else about it changes.
export function stubMock(request, existing = []) {
  const mock = { path: String(request?.path || '/'), status: 200, json: {} };
  if (request?.method) mock.method = String(request.method).toUpperCase();
  if (request?.connection) mock.connection = request.connection;
  if (isObj(request?.query) && Object.keys(request.query).length) mock.query = request.query;
  // the same mock twice would never be reached (the first match wins), so a duplicate is not added
  const same = list(existing).some(
    (m) => isObj(m) && m.path === mock.path && (m.method || '') === (mock.method || '') && JSON.stringify(m.query || {}) === JSON.stringify(mock.query || {}),
  );
  return same ? null : mock;
}

export function addMockTo(scenario, request) {
  const mock = stubMock(request, scenario?.http_mocks);
  return mock ? { ...scenario, http_mocks: [...list(scenario?.http_mocks), mock] } : scenario;
}

// ---- turning a test conversation into a scenario (the "Save as scenario" button on a finished Test conversation) ---------------------------
// `records` are the call's events in order (user_said, agent_said, tool_called, state_changed…), `finalState` the state at the end.
// It is a starting point the author edits: the caller's turns, a `tool_called` for every tool used, and `state_equals` for the final
// state. Nothing is invented: only what the conversation shows.
export function scenarioFromConversation(config, { id, channel, messages = [], tools = [], finalState = {} } = {}) {
  const turns = messages
    .filter((m) => m.role === 'user' || m.role === 'caller')
    .map((m) => ({ say: String(m.text || '').trim() }))
    .filter((t) => t.say);
  const expect = [];
  [...new Set(tools.filter(Boolean))].forEach((tool) => expect.push({ tool_called: tool }));
  const variables = isObj(config?.state?.variables) ? config.state.variables : {};
  Object.entries(isObj(finalState) ? finalState : {}).forEach(([state, value]) => {
    if (state in variables && value !== undefined && value !== null && value !== '' && JSON.stringify(value) !== JSON.stringify(variables[state]?.initial))
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
