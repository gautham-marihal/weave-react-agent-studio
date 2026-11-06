// Effects in plain words: a tool's `effects` are rules ("when this holds, do these in order"). This names the action
// kinds and writes a rule as a sentence. Pure: no network, no DOM.

import { isObj } from './engine.js';
import { describeCondition } from './promptPreview.js';

// In the order the "Add a step" menu offers them, in groups: speaking first, then state and flow, pictures, then the
// rest. `hint` is the grey line under each in the menu.
export const ACTION_KINDS = [
  { type: 'say', label: 'Say a line', group: 'Talk', hint: 'Exact words' },
  { type: 'generate', label: 'Say something the model writes', group: 'Talk', hint: 'From your instructions' },
  { type: 'send_form', label: 'Show a form', group: 'Talk', hint: 'Fields on the screen' },
  { type: 'play_sound', label: 'Play a sound', group: 'Talk', hint: 'A short sound' },
  { type: 'set_state', label: 'Change state', group: 'State and flow', hint: 'Remember something' },
  { type: 'handoff', label: 'Hand off to another agent', group: 'State and flow', hint: 'Another agent takes over' },
  { type: 'return_to_entry', label: 'Return to the first agent', group: 'State and flow', hint: 'Back to who answered first' },
  { type: 'end_call', label: 'End the call', group: 'State and flow', hint: 'Optionally with a last line' },
  { type: 'transfer', label: 'Transfer to a person', group: 'State and flow', hint: 'A number or a queue' },
  { type: 'request_image', label: 'Ask for a picture', group: 'Pictures', hint: 'An upload or the camera' },
  { type: 'analyze_image', label: 'Read a picture', group: 'Pictures', hint: 'Named values, by the vision model' },
  { type: 'compare_values', label: 'Compare values', group: 'Pictures', hint: 'Names, codes, dates, in code' },
  { type: 'discard_image', label: 'Forget pictures', group: 'Pictures', hint: 'As soon as they are used' },
  { type: 'notify', label: 'Send a notification (SMS or email)', group: 'Other systems', hint: 'To your team or the caller' },
  { type: 'wrapup', label: 'Start a closing message', group: 'Other systems', hint: 'Wait for a reply, then close if none comes' },
  { type: 'http', label: 'Call an HTTP API', group: 'Other systems', hint: 'Read or send to your systems' },
  { type: 'collect_dtmf', label: 'Collect keypad digits', group: 'Other systems', hint: 'A phone line only' },
  { type: 'log', label: 'Write a log line', group: 'Other systems', hint: 'For the call record' },
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

// One action as a short sentence: what it does, and when it runs if it has a condition (schema 1.2).
export function describeAction(action) {
  const what = describeWhat(action);
  return isObj(action) && action.when !== undefined ? `${what}, only when ${describeCondition(action.when)}` : what;
}

function describeWhat(action) {
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
      return `Start the closing message ${action.wrapup || '(none chosen yet)'}`;
    case 'play_sound':
      return `Play the sound ${action.sound || '(none chosen yet)'}`;
    case 'http':
      return `Call ${action.method || 'GET'} ${action.path || '/'} on ${action.connection || 'a connection (none chosen yet)'}`;
    case 'collect_dtmf':
      return `Collect keypad digits into ${action.into || 'a state variable (none chosen yet)'}`;
    case 'log':
      return `Write to the log: ${quote(shortText(action.message))}`;
    // pictures (schema 1.2)
    case 'request_image':
      return `Ask for ${action.kind === 'camera' ? 'the camera' : 'a photo upload'}${action.into ? `, keep it in ${action.into}` : ''}`;
    case 'analyze_image': {
      const fields = Object.keys(isObj(action.fields) ? action.fields : {});
      const pics = Array.isArray(action.images) ? action.images.filter(Boolean) : [];
      return `Read ${fields.length ? fields.join(', ') : 'values (none named yet)'} from ${pics.length ? pics.join(' and ') : 'a picture (none chosen yet)'}`;
    }
    case 'compare_values': {
      const pairs = (Array.isArray(action.pairs) ? action.pairs : []).filter(isObj);
      const words = pairs.map((p) => `${p.left || '…'} with ${p.right || '…'}`);
      return pairs.length ? `Compare ${words.join(', ')}` : 'Compare values (no pairs yet)';
    }
    case 'discard_image': {
      const pics = Array.isArray(action.images) ? action.images.filter(Boolean) : [];
      return pics.length ? `Forget ${pics.join(' and ')}` : 'Forget pictures (none chosen yet)';
    }
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
