// An approximate preview of what an agent is told. The real prompt is built by the runtime; this puts together what the
// configuration says it is made of (the persona, the agent's role, opening, rules and conditional blocks, the channel's
// addition, and the tools it may use) in that order, so an author can read it as one piece. It is labelled approximate
// wherever it is shown: the runtime's wording, ordering and conditional blocks are its own, and an exact preview needs the
// runtime itself (a `POST /preview-prompt` the API doesn't have yet).
// Pure: no network, no DOM.

import { isObj } from './engine.js';
import { wordCount } from './templates.js';

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const list = (value) => (Array.isArray(value) ? value : []);

// A condition in words: `{state: 'verified', equals: true}` -> "state verified is true".
const OPERATOR_WORDS = { equals: 'is', not_equals: 'is not', gte: 'is at least', lte: 'is at most', in: 'is one of' };
const show = (value) => (Array.isArray(value) ? value.map(show).join(', ') : typeof value === 'string' ? `“${value}”` : String(value));

export function describeCondition(condition) {
  if (!isObj(condition)) return 'a condition holds';
  const subject = ['state', 'arg', 'result', 'event'].find((key) => key in condition);
  if (subject) {
    const operator = Object.keys(OPERATOR_WORDS).find((key) => key in condition);
    const label = { state: 'the state', arg: 'the argument', result: 'the result', event: 'the event detail' }[subject];
    return operator ? `${label} ${condition[subject]} ${OPERATOR_WORDS[operator]} ${show(condition[operator])}` : `${label} ${condition[subject]} is set`;
  }
  if ('channel' in condition) return `the channel is ${show(condition.channel)}`;
  if ('schedule' in condition) return `${condition.schedule} is ${condition.open ? 'open' : 'closed'}`;
  if (Array.isArray(condition.all)) return condition.all.map(describeCondition).join(' and ');
  if (Array.isArray(condition.any)) return condition.any.map(describeCondition).join(' or ');
  if ('not' in condition) return `not (${describeCondition(condition.not)})`;
  return 'a condition holds';
}

// Fills in the template names the configuration knows. A state variable shows its starting value, a constant its value; names
// that only exist during a call (a tool's arguments or result, the caller…) stay as ‹placeholders›, and the result lists them.
export function renderTemplate(source, config) {
  const unresolved = [];
  const variables = isObj(config?.state?.variables) ? config.state.variables : {};
  const constants = isObj(config?.constants) ? config.constants : {};
  const out = String(source ?? '').replace(/\{\{([^{}]*)\}\}/g, (whole, expr) => {
    const [head, ...filters] = expr.split('|').map((part) => part.trim());
    const [root, name] = head.split('.');
    let value;
    if (root === 'state' && name in variables) {
      const variable = variables[name];
      value = variable?.sensitive === true ? undefined : variable?.default;
      if (variable?.sensitive === true) { unresolved.push(head); return '‹sensitive: not shown›'; }
    } else if (root === 'const' && name in constants) value = constants[name];
    const empty = value === undefined || value === null || value === '';
    const fallback = filters.map((f) => /^default\((.*)\)$/.exec(f)).find(Boolean);
    if (empty && fallback) return String(fallback[1]).replace(/^['"]|['"]$/g, '');
    if (empty) { unresolved.push(head); return `‹${head}›`; }
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  });
  return { text: out, unresolved };
}

// -> { sections: [{ id, title, note, text, words, conditional? }], words, conditionalWords, unresolved: [names] } or null.
export function assemblePrompt(config, agentId, { channelId } = {}) {
  const agents = list(config?.agents?.items);
  const agent = agents.find((item) => item?.id === agentId) || null;
  if (!agent) return null;
  const persona = isObj(config.persona) ? config.persona : {};
  const instructions = isObj(agent.instructions) ? agent.instructions : {};
  const unresolved = new Set();
  const sections = [];
  const add = (id, title, note, body, extra = {}) => {
    const rendered = renderTemplate(body, config);
    rendered.unresolved.forEach((name) => unresolved.add(name));
    if (!rendered.text.trim()) return;
    sections.push({ id, title, note, text: rendered.text, words: wordCount(rendered.text), ...extra });
  };

  const who = [];
  if (text(persona.name)) who.push(`Your name is ${text(persona.name)}${text(persona.company) ? `, from ${text(persona.company)}` : ''}.`);
  if (text(persona.tone)) who.push(`Tone: ${text(persona.tone)}.`);
  const style = list(persona.style_rules).map(text).filter(Boolean);
  if (style.length) who.push(`Style:\n${style.map((rule) => `- ${rule}`).join('\n')}`);
  add('persona', 'Who the agent is', 'From the persona', who.join('\n\n'));
  const shared = list(persona.shared_rules).map(text).filter(Boolean);
  add('shared', 'Rules for every agent', 'persona.shared_rules, added to every agent’s prompt', shared.map((rule) => `- ${rule}`).join('\n'));

  add('role', 'Its role', 'instructions.role', instructions.role);
  add('opening', 'When it takes over', 'instructions.opening, applied once when this agent takes over', instructions.opening);
  const rules = list(instructions.rules).map(text).filter(Boolean);
  add('rules', 'Its rules', 'instructions.rules', rules.map((rule) => `- ${rule}`).join('\n'));
  list(instructions.conditional).forEach((block, index) => {
    add(`conditional-${index}`, `Only while ${describeCondition(block?.when)}`, 'instructions.conditional, added only while its condition holds', block?.append, { conditional: true });
  });

  const channel = list(config.channels).find((item) => item?.id === channelId);
  if (channel) add('channel', `Added on ${channel.id}`, 'The channel’s instructions_append', channel.instructions_append);

  // The tools it may call (the model sees each by name, with its description and the arguments it fills in).
  const tools = list(config.tools);
  const lines = [];
  list(agent.tools).forEach((id) => {
    const tool = tools.find((item) => item?.id === id);
    if (!tool) { lines.push(`- ${id} (not defined)`); return; }
    const args = Object.keys(isObj(tool.parameters?.properties) ? tool.parameters.properties : {});
    lines.push(`- ${tool.name || tool.id}(${args.join(', ')})${text(tool.description) ? `: ${text(tool.description)}` : ''}`);
  });
  list(agent.handoffs).forEach((handoff) => {
    if (isObj(handoff)) lines.push(`- ${handoff.tool}(): ${text(handoff.description)}${handoff.to ? ` (hands the caller to ${handoff.to})` : ''}`);
  });
  if (lines.length) add('tools', 'Tools it can use', 'The tools it offers, and its handoffs', lines.join('\n'));

  const always = sections.filter((section) => !section.conditional);
  return {
    agent,
    sections,
    words: always.reduce((sum, section) => sum + section.words, 0),
    conditionalWords: sections.filter((section) => section.conditional).reduce((sum, section) => sum + section.words, 0),
    unresolved: [...unresolved],
  };
}
