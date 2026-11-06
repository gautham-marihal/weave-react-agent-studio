// Small words for Build's item rows (Detailed.jsx ItemRows): counts, a clipped sentence, and what a list of steps
// does, picture and video requests named, since those are what a person looks for. Pure: no React, no DOM.

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
export const clip = (text, n = 140) => {
  const s = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
};
export const joinAnd = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0] || '');

// the step types the schema has (its `action` and the actions it lists), so a form's questions are never taken for steps
export const STEP_TYPES = new Set([
  'say',
  'generate',
  'play_sound',
  'http',
  'collect_dtmf',
  'request_image',
  'analyze_image',
  'compare_values',
  'discard_image',
  'log',
  'set_state',
  'handoff',
  'return_to_entry',
  'end_call',
  'transfer',
  'notify',
  'send_form',
  'wrapup',
]);
export const isStepList = (value) => Array.isArray(value) && value.length > 0 && value.every((item) => isObj(item) && STEP_TYPES.has(item.type));

// Every step in a list of steps, the ones nested under a step's own outcomes too (on_timeout, then, otherwise…)
export function countSteps(steps) {
  const out = { total: 0, top: Array.isArray(steps) ? steps.length : 0, photo: 0, video: 0, read: 0, compare: 0, call: 0, transfer: 0, say: 0 };
  const visit = (node) => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (isObj(node)) {
      if (STEP_TYPES.has(node.type)) {
        out.total += 1;
        if (node.type === 'request_image') out[node.kind === 'camera' ? 'video' : 'photo'] += 1;
        if (node.type === 'analyze_image') out.read += 1;
        if (node.type === 'compare_values') out.compare += 1;
        if (node.type === 'http') out.call += 1;
        if (node.type === 'transfer') out.transfer += 1;
        if (node.type === 'say') out.say += 1;
      }
      Object.values(node).forEach(visit);
    }
  };
  visit(steps);
  return out;
}

// "12 steps, with 1 photo request, 1 video check and 3 comparisons" ('' for none)
export function stepsWords(steps) {
  const n = countSteps(steps);
  if (!n.top) return '';
  const extras = [
    n.photo && plural(n.photo, 'photo request'),
    n.video && plural(n.video, 'video check'),
    n.read && plural(n.read, 'picture reading', 'picture readings'),
    n.compare && plural(n.compare, 'comparison'),
    n.call && plural(n.call, 'call to a system', 'calls to systems'),
    n.transfer && plural(n.transfer, 'hand-over to a person', 'hand-overs to a person'),
  ].filter(Boolean);
  return `${plural(n.top, 'step')}${extras.length ? `, with ${joinAnd(extras)}` : ''}`;
}
