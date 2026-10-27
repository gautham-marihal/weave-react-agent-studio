// Effects in plain words: a tool's `effects` are rules ("when this holds, do these in order"). This names the action
// kinds and writes a rule as a sentence. Pure: no network, no DOM.

import { isObj } from './engine.js';
import { describeCondition } from './promptPreview.js';

// In the order the "Add an action" menu offers them: speaking first, then state and flow, then the rest.
export const ACTION_KINDS = [
  { type: 'say', label: 'Say a line' },
  { type: 'generate', label: 'Say something the model writes' },
  { type: 'set_state', label: 'Change state' },
  { type: 'handoff', label: 'Hand off to another agent' },
  { type: 'return_to_entry', label: 'Return to the first agent' },
  { type: 'end_call', label: 'End the call' },
  { type: 'transfer', label: 'Transfer to a person' },
  { type: 'notify', label: 'Send a notification (SMS or email)' },
  { type: 'send_form', label: 'Show a form' },
  { type: 'wrapup', label: 'Start a wrap-up' },
  { type: 'play_sound', label: 'Play a sound' },
  { type: 'http', label: 'Call an HTTP API' },
  { type: 'collect_dtmf', label: 'Collect keypad digits' },
  { type: 'log', label: 'Write a log line' },
];

export const kindLabel = (type) => ACTION_KINDS.find((kind) => kind.type === type)?.label || String(type || 'Something');

const quote = (value) => `“${String(value)}”`;
const shortText = (value, max = 60) => {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
};
const speech = (value) => (isObj(value) && value.message ? `the message ${quote(value.message)}` : value ? quote(shortText(value)) : 'nothing yet');
const show = (value) => (typeof value === 'string' ? quote(value) : JSON.stringify(value));

// One action as a short sentence.
export function describeAction(action) {
  if (!isObj(action)) return 'Do something';
  switch (action.type) {
    case 'say':
      return `Say ${speech(action.text)}`;
    case 'generate':
      return `Have the model say something: ${quote(shortText(action.instructions) || 'no instructions yet')}`;
    case 'set_state': {
      const pairs = Object.entries(isObj(action.values) ? action.values : {}).map(([key, value]) => `${key} to ${show(value)}`);
      return pairs.length ? `Set ${pairs.join(', ')}` : 'Change state (nothing chosen yet)';
    }
    case 'handoff':
      return `Hand off to ${action.to || 'an agent (none chosen yet)'}`;
    case 'return_to_entry':
      return 'Return to the first agent';
    case 'end_call':
      return action.say ? `Say ${speech(action.say)}, then end the call` : 'End the call';
    case 'transfer':
      return `Transfer using ${action.transfer || 'a transfer (none chosen yet)'}`;
    case 'notify':
      return `Send the notification ${action.notification || '(none chosen yet)'}`;
    case 'send_form':
      return `Show the form ${action.form || '(none chosen yet)'}`;
    case 'wrapup':
      return `Start the wrap-up ${action.wrapup || '(none chosen yet)'}`;
    case 'play_sound':
      return `Play the sound ${action.sound || '(none chosen yet)'}`;
    case 'http':
      return `Call ${action.method || 'GET'} ${action.path || '/'} on ${action.connection || 'a connection (none chosen yet)'}`;
    case 'collect_dtmf':
      return `Collect keypad digits into ${action.into || 'a state variable (none chosen yet)'}`;
    case 'log':
      return `Write to the log: ${quote(shortText(action.message))}`;
    default:
      return kindLabel(action.type);
  }
}

// A rule as one sentence: "When the result status is “ok”: say “Done”, then end the call."
export function describeRule(rule) {
  if (!isObj(rule)) return 'A rule';
  const steps = (Array.isArray(rule.do) ? rule.do : []).map((action) => describeAction(action).replace(/^./, (c) => c.toLowerCase()));
  const lead = rule.when === undefined ? 'Always' : `When ${describeCondition(rule.when)}`;
  if (!steps.length) return `${lead}: nothing yet`;
  return `${lead}: ${steps.join(', then ')}.`;
}

// A copy of a list with one item moved (out-of-range moves leave it as it is).
export function moveItem(list, from, to) {
  if (!Array.isArray(list) || to < 0 || to >= list.length || from < 0 || from >= list.length || from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
