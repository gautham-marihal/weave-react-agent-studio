// Test scenarios: the `tests` section of an agent's configuration is a list of conversations to check: who is talking on which channel
// (`channel`, `caller`), what the caller says turn by turn (`turns`), and what must hold afterwards (`expect`: a tool was or wasn't
// called, a state variable ended up as stated, something the agent said matches a pattern, or a free-text criterion a model would grade).
// This module is the editing side: the shapes, labels, sentences and checks for writing them. Running them is runner.js.
// Pure: no network, no DOM.

import { isObj } from '../form/engine.js';

const list = (v) => (Array.isArray(v) ? v : []);

export const EXPECT_KINDS = [
  { key: 'tool_called', label: 'A tool was called', hint: 'The agent used this tool at some point.' },
  { key: 'tool_not_called', label: 'A tool was not called', hint: 'The agent never used this tool.' },
  { key: 'state_equals', label: 'A state variable ends up as', hint: 'After the conversation, this variable has this value.' },
  { key: 'said_matches', label: 'The agent said something matching', hint: 'A pattern (a regular expression) that some agent message matches.' },
  { key: 'judge', label: 'A reviewer would agree that…', hint: 'A criterion in plain words, graded by a language model. It can’t be checked in a simulation.' },
];
export const kindOfExpectation = (expectation) => (isObj(expectation) ? EXPECT_KINDS.find((kind) => kind.key in expectation)?.key || '' : '');

// An expectation in words.
export function describeExpectation(expectation) {
  switch (kindOfExpectation(expectation)) {
    case 'tool_called': return `the tool “${expectation.tool_called}” is called`;
    case 'tool_not_called': return `the tool “${expectation.tool_not_called}” is not called`;
    case 'state_equals': return `${expectation.state_equals?.state || 'a state variable'} ends up as ${JSON.stringify(expectation.state_equals?.value)}`;
    case 'said_matches': return `the agent says something matching /${expectation.said_matches}/`;
    case 'judge': return `a reviewer agrees that ${expectation.judge}`;
    default: return 'something is expected';
  }
}

export const slugId = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^[^a-z]+/, '').replace(/_+$/, '').slice(0, 64);
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

// Valid regular expression? ('' when fine, else why not)
export function regexProblem(source) {
  try { new RegExp(source); return ''; } catch (error) { return error.message.replace(/^Invalid regular expression: /, ''); }
}

// What is wrong with a scenario, by where: { id, channel, turns, expect: ['…'] } (an empty object when it is fine).
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
  else if (turns.some((t) => !isObj(t) || !String(t.say ?? '').trim())) out.turns = 'Every turn needs some words.';
  const expect = list(scenario.expect);
  const problems = [];
  if (!expect.length) problems.push('Add at least one thing that must be true afterwards.');
  const toolIds = [...list(config?.tools).map((t) => t?.id), ...list(config?.agents?.items).flatMap((a) => list(a?.handoffs).map((h) => h?.tool))].filter(Boolean);
  const stateNames = Object.keys(isObj(config?.state?.variables) ? config.state.variables : {});
  expect.forEach((e, index) => {
    const kind = kindOfExpectation(e);
    const where = `Expectation ${index + 1}: `;
    if (!kind) problems.push(`${where}choose what to check.`);
    else if (kind === 'tool_called' || kind === 'tool_not_called') { if (!e[kind]) problems.push(`${where}choose a tool.`); else if (!toolIds.includes(e[kind])) problems.push(`${where}there is no tool “${e[kind]}”.`); }
    else if (kind === 'state_equals') { if (!e.state_equals?.state) problems.push(`${where}choose a state variable.`); else if (!stateNames.includes(e.state_equals.state)) problems.push(`${where}there is no state variable “${e.state_equals.state}”.`); }
    else if (kind === 'said_matches') { const why = !e.said_matches ? 'write a pattern.' : regexProblem(e.said_matches); if (why) problems.push(`${where}${why === 'write a pattern.' ? why : `not a valid pattern (${why}).`}`); }
    else if (kind === 'judge' && !String(e.judge || '').trim()) problems.push(`${where}write the criterion.`);
  });
  if (problems.length) out.expect = problems;
  return out;
}

export const hasProblems = (problems) => Object.keys(problems).length > 0;

// Pasted JSON -> { scenarios, problems: [string] }. Accepts a list, or an object with a `tests` list. Ids that clash are renamed.
export function parseImport(text, config) {
  let value;
  try { value = JSON.parse(text); } catch (error) { return { scenarios: [], problems: [`That isn’t valid JSON (${error.message}).`] }; }
  const items = Array.isArray(value) ? value : isObj(value) && Array.isArray(value.tests) ? value.tests : isObj(value) ? [value] : null;
  if (!items) return { scenarios: [], problems: ['Paste a list of scenarios, or one scenario.'] };
  const taken = [...list(config?.tests)];
  const scenarios = []; const problems = [];
  items.forEach((item, index) => {
    if (!isObj(item)) { problems.push(`Item ${index + 1} isn’t a scenario.`); return; }
    const scenario = { ...item, id: taken.some((s) => s?.id === item.id) || !item.id ? freshScenarioId(taken, item.id || slugId(`scenario ${index + 1}`) || 'scenario') : item.id };
    const found = scenarioProblems(scenario, config, taken);
    const flat = Object.values(found).flat();
    if (flat.length) { problems.push(`${scenario.id}: ${flat.join(' ')}`); return; }
    taken.push(scenario); scenarios.push(scenario);
  });
  return { scenarios, problems };
}

// Turns a typed value into the JSON it means (true, 3, null, "text") for a state value.
export function parseValue(text) {
  const value = String(text ?? '').trim();
  if (value === '') return '';
  try { return JSON.parse(value); } catch { return value; }
}
export const showValue = (value) => (typeof value === 'string' ? value : JSON.stringify(value));
