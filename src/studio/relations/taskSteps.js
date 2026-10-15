// A multi-step task as a list a person can read: what is asked at each step, how the answer is checked, when a step is skipped, and what happens
// at the end. The form edits each step's fields; this is the same task read from top to bottom. Pure: no React, no DOM.

import { isObj } from '../form/engine.js';

const list = (v) => (Array.isArray(v) ? v : []);
const KINDS = { verification: 'Checks who the caller is', collect_fields: 'Collects details', confirmation: 'Asks the caller to confirm', custom: 'A task of its own' };

// A condition such as { state: 'customer', not_equals: null } in words.
function conditionText(condition) {
  if (!isObj(condition)) return '';
  const entries = Object.entries(condition);
  const subject = condition.state ? `“${condition.state}”` : condition.arg ? `“${condition.arg}”` : condition.result ? 'the result' : condition.channel ? 'the channel' : '';
  if ('equals' in condition) return `${subject || 'it'} is ${JSON.stringify(condition.equals)}`;
  if ('not_equals' in condition) return condition.not_equals === null ? `${subject || 'it'} is already known` : `${subject || 'it'} isn’t ${JSON.stringify(condition.not_equals)}`;
  if (condition.all) return list(condition.all).map(conditionText).filter(Boolean).join(' and ');
  if (condition.any) return list(condition.any).map(conditionText).filter(Boolean).join(' or ');
  return entries.length ? 'a condition holds' : '';
}

export function describeTask(task) {
  if (!isObj(task)) return { summary: '', steps: [], outcomes: [] };
  const max = Number.isInteger(task.max_attempts) ? task.max_attempts : null;
  const steps = list(task.steps).filter(isObj).map((step, index) => {
    const parts = [];
    if (step.skip_if) { const text = conditionText(step.skip_if); parts.push(text ? `skipped when ${text}` : 'sometimes skipped'); }
    if (step.requires) { const text = conditionText(step.requires); if (text) parts.push(`only when ${text}`); }
    if (isObj(step.validate) && step.validate.tool) parts.push(`checked by the tool “${step.validate.tool}”`);
    const tries = Number.isInteger(step.max_attempts) ? step.max_attempts : max;
    if (tries) parts.push(`up to ${tries} ${tries === 1 ? 'try' : 'tries'}`);
    return { number: index + 1, id: step.id || `step ${index + 1}`, ask: typeof step.ask === 'string' ? step.ask : '', notes: parts };
  });
  const outcome = (key, label) => {
    const o = task[key];
    if (!isObj(o)) return null;
    const bits = [];
    if (o.outcome) bits.push(`result “${o.outcome}”`);
    if (isObj(o.set_state) && Object.keys(o.set_state).length) bits.push(`remembers ${Object.entries(o.set_state).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(', ')}`);
    if (o.resume) bits.push(`goes back to ${o.resume === 'caller' ? 'the agent that started it' : o.resume}`);
    if (o.silent === true) bits.push('says nothing');
    return { key, label, text: bits.join(', ') || 'nothing in particular' };
  };
  return {
    summary: `${KINDS[task.kind] || 'A task'}${steps.length ? ` in ${steps.length} step${steps.length === 1 ? '' : 's'}` : ''}.`,
    steps,
    outcomes: [outcome('on_success', 'When it works'), outcome('on_failure', 'If it fails'), outcome('on_decline', 'If the caller declines')].filter(Boolean),
  };
}
