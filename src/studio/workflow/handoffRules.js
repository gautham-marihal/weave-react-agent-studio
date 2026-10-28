// What makes hand-overs between subagents reliable. Live tests on a front desk with eight specialists showed two ways
// they go wrong without it: the agent that answers first starts verifying or helping the caller itself instead of
// handing over, and a specialist tries to handle a request outside its role instead of sending the caller back. Three
// things fixed both: a firm rule first in the first agent's rules, a firm rule first in every specialist's rules, and a
// "back to the first agent" tool that says when to use it. Pure: no React.

import { isObj } from '../form/engine.js';
import { freshId } from '../form/references.js';

export const FIRST_AGENT_RULE =
  'When one of your subagents handles what the caller asks, hand them to it at once, in the same reply, even if you could help yourself, and also when a subagent has just sent them back to you with a new request. Do not ask for their details (an account number, a code, a PIN) or verify them yourself unless another of your rules says to: the subagent you hand them to does that.';
export const BACK_TOOL_DESCRIPTION =
  'Send the caller back to the agent that answers first. Use it at once when they ask for something outside your role, before asking for any details, or when their request is finished.';
// the description the Workflow used to give the tool; replaced by the one above, since a custom one is kept
const OLD_BACK_DESCRIPTIONS = ['', 'The caller needs something this subagent can’t help with.'];

// how earlier versions of these rules began (the first banking agents were fixed with them), so they are replaced, not
// joined by a second copy
const EARLIER_RULE_STARTS = ['Hand the caller to the specialist as soon as', 'When one of your subagents handles', 'Your job is only what your role says.'];
const isHandoffRule = (rule) => typeof rule === 'string' && EARLIER_RULE_STARTS.some((start) => rule.startsWith(start));

/** The rule for a specialist, naming the tool that sends the caller back. */
export const specialistRule = (backToolId) =>
  `Your job is only what your role says. The moment the caller asks for anything else, use ${backToolId} in that same reply: do not ask for their details, do not verify them and do not try to help with it yourself.`;

const list = (value) => (Array.isArray(value) ? value : []);
const agentsOf = (config) => list(config?.agents?.items).filter(isObj);
const isBackTool = (tool) => isObj(tool) && tool.builtin === 'return_to_entry' && (tool.type === 'builtin' || !tool.type);
const rulesOf = (agent) => list(agent?.instructions?.rules);

/** The first agent and the specialists, when the configuration hands callers between subagents; else null. */
function teamOf(config) {
  const agents = agentsOf(config);
  const entry = agents.find((agent) => agent.id === config?.agents?.entry) || agents[0];
  if (agents.length < 2 || !entry || !list(entry.handoffs).length) return null;
  return { entry, specialists: agents.filter((agent) => agent !== entry) };
}

/**
 * What is missing for reliable hand-overs, by agent: [{ agentId, missing: ('first-agent-rule' | 'specialist-rule' |
 * 'back-tool')[] }]. Empty when the configuration has one agent, or nothing is missing.
 */
export function handoffGaps(config) {
  const team = teamOf(config);
  if (!team) return [];
  const backTool = list(config.tools).find(isBackTool);
  const gaps = [];
  if (!rulesOf(team.entry).includes(FIRST_AGENT_RULE)) gaps.push({ agentId: team.entry.id, missing: ['first-agent-rule'] });
  for (const agent of team.specialists) {
    const missing = [];
    if (!backTool || !rulesOf(agent).includes(specialistRule(backTool.id))) missing.push('specialist-rule');
    if (!backTool || !list(agent.tools).includes(backTool.id)) missing.push('back-tool');
    if (missing.length) gaps.push({ agentId: agent.id, missing });
  }
  return gaps;
}

/**
 * The configuration with everything reliable hand-overs need. The rules go first in each agent's list (in testing,
 * the same rule at the end of the list was not followed). Running it again changes nothing.
 */
export function withHandoffRules(config) {
  if (!teamOf(config)) return config;
  const next = JSON.parse(JSON.stringify(config));
  const { entry, specialists } = teamOf(next);

  let backTool = list(next.tools).find(isBackTool);
  if (!backTool) {
    const taken = [...list(next.tools).map((tool) => tool?.id), ...agentsOf(next).flatMap((agent) => list(agent.tools))];
    backTool = { id: freshId(taken, 'back_to_start'), type: 'builtin', builtin: 'return_to_entry', description: BACK_TOOL_DESCRIPTION };
    next.tools = [...list(next.tools), backTool];
  } else if (OLD_BACK_DESCRIPTIONS.includes(backTool.description ?? '')) {
    backTool.description = BACK_TOOL_DESCRIPTION;
  }

  const putFirst = (agent, rule) => {
    agent.instructions = { ...(isObj(agent.instructions) ? agent.instructions : {}) };
    agent.instructions.rules = [rule, ...rulesOf(agent).filter((existing) => existing !== rule && !isHandoffRule(existing))];
  };
  putFirst(entry, FIRST_AGENT_RULE);
  for (const agent of specialists) {
    putFirst(agent, specialistRule(backTool.id));
    if (!list(agent.tools).includes(backTool.id)) agent.tools = [...list(agent.tools), backTool.id];
  }
  return next;
}

/** Takes the hand-over rules off again once the configuration no longer hands callers between subagents (in place). */
export function dropStaleHandoffRules(next) {
  if (teamOf(next)) return;
  const backTool = list(next.tools).find(isBackTool);
  const stale = (rule) => rule === FIRST_AGENT_RULE || (backTool && rule === specialistRule(backTool.id)) || isHandoffRule(rule);
  for (const agent of agentsOf(next)) {
    const rules = rulesOf(agent);
    if (!rules.some(stale)) continue;
    const kept = rules.filter((rule) => !stale(rule));
    agent.instructions = { ...agent.instructions, rules: kept };
    if (!kept.length) delete agent.instructions.rules;
  }
}
