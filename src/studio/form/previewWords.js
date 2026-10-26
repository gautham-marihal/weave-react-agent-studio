// The parts of the server's prompt preview that the guide describes in a sentence rather than a shape: what runs when
// an agent takes over (`on_enter`), what is searched (`knowledge`), which models and which secret NAMES would be used
// (`models`) and the state the preview was built from (`state`, with sensitive values masked). The server's answer is
// read tolerantly: whatever its shape, every part of it is shown, in words where the studio knows the part and as
// written where it does not. Nothing is guessed and nothing is dropped. Pure: no DOM.

import { describeAction } from './effects.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const short = (value, max = 90) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
};
const humanize = (key) =>
  String(key)
    .replace(/[_-]+/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());

// ---- what runs when the agent takes over -------------------------------------------------------------------------------------------------------
export function onEnterLines(onEnter) {
  return list(onEnter)
    .filter((a) => a !== null && a !== undefined)
    .map((action) => (isObj(action) ? describeAction(action) : String(action)));
}

// ---- what is searched, and by what ----------------------------------------------------------------------------------------------------------------
const KNOWLEDGE_HEADINGS = {
  before_each_reply: 'Searched before every reply',
  injected: 'Searched before every reply',
  inject: 'Searched before every reply',
  searched_before_each_reply: 'Searched before every reply',
  tools: 'Searched when the model asks',
  tool: 'Searched when the model asks',
  searched_by_tools: 'Searched when the model asks',
  bases: 'Knowledge bases',
};
function describeItem(item) {
  if (typeof item === 'string') return item;
  if (!isObj(item)) return short(item);
  // one field names the item (a tool, else a base); the others are its details
  const mainKey = ['name', 'id', 'tool', 'base'].find((k) => item[k] !== undefined && item[k] !== null && item[k] !== '');
  const rest = Object.entries(item)
    .filter(([k, v]) => k !== mainKey && v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${humanize(k).toLowerCase()} ${typeof v === 'object' ? short(v, 40) : v}`);
  const label = mainKey ? String(item[mainKey]) : '';
  return rest.length ? `${label}${label ? ' (' : ''}${rest.join(', ')}${label ? ')' : ''}` : label;
}
// [{ heading, items: [text] }]
export function knowledgeBlocks(knowledge) {
  if (knowledge === null || knowledge === undefined || knowledge === false) return [];
  if (Array.isArray(knowledge)) return knowledge.length ? [{ heading: 'Knowledge searched', items: knowledge.map(describeItem) }] : [];
  if (typeof knowledge === 'string') return knowledge ? [{ heading: 'Knowledge searched', items: [knowledge] }] : [];
  if (!isObj(knowledge)) return [{ heading: 'Knowledge searched', items: [short(knowledge)] }];
  return Object.entries(knowledge)
    .map(([key, value]) => {
      const heading = KNOWLEDGE_HEADINGS[key] || humanize(key);
      if (Array.isArray(value)) return { heading, items: value.map(describeItem) };
      if (isObj(value)) return { heading, items: Object.entries(value).map(([k, v]) => `${humanize(k)}: ${typeof v === 'object' ? short(v) : v}`) };
      return { heading, items: [String(value)] };
    })
    .filter((block) => block.items.length > 0);
}

// ---- the models, and the names of the secrets that unlock them -----------------------------------------------------------------------------------
const STAGE_WORDS = {
  stt: 'Listening',
  llm: 'Thinking',
  tts: 'Speaking',
  realtime: 'Realtime speech',
  vad: 'Detecting speech',
  turn_detector: 'Deciding when the caller is done',
};
function secretsIn(value, out = new Set()) {
  if (isObj(value)) {
    if (typeof value.secret === 'string') out.add(value.secret);
    Object.values(value).forEach((v) => secretsIn(v, out));
  } else if (Array.isArray(value)) value.forEach((v) => secretsIn(v, out));
  return out;
}
function describeModel(model) {
  if (typeof model === 'string') return model;
  if (!isObj(model)) return short(model);
  const used = [model.provider, model.model].filter((x) => typeof x === 'string' && x).join(' ');
  const keys = [...secretsIn(model)];
  const other = Object.entries(model)
    .filter(
      ([k, v]) => !['provider', 'model', 'api_key', 'secret', 'fallbacks', 'options'].includes(k) && v !== null && v !== undefined && typeof v !== 'object',
    )
    .map(([k, v]) => `${humanize(k).toLowerCase()} ${v}`);
  const fallbacks = list(model.fallbacks)
    .map((f) => describeModel(f))
    .filter(Boolean);
  return [
    used || 'no provider set',
    other.length ? `(${other.join(', ')})` : '',
    keys.length ? `uses the secret ${keys.join(', ')}` : '',
    fallbacks.length ? `then ${fallbacks.join(', then ')}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
// [{ label, text }]
export function modelLines(models) {
  if (!models) return [];
  if (Array.isArray(models))
    return models.map((layer, i) => ({
      label: isObj(layer) && typeof layer.layer === 'string' ? humanize(layer.layer) : `Layer ${i + 1}`,
      text: isObj(layer)
        ? Object.entries(layer)
            .filter(([k]) => k !== 'layer')
            .map(([k, v]) => `${STAGE_WORDS[k] || humanize(k)}: ${describeModel(v)}`)
            .join(' · ')
        : describeModel(layer),
    }));
  if (!isObj(models)) return [{ label: 'Models', text: short(models) }];
  return Object.entries(models)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([stage, v]) => ({ label: STAGE_WORDS[stage] || humanize(stage), text: describeModel(v) }));
}

// ---- the state the preview was built from
// -----------------------------------------------------------------------------------------------------------
const MASK = /^[•*●·]{2,}$|^<?(masked|sensitive|hidden|redacted)>?$/i;
// [{ name, text, masked }]
export function stateLines(state) {
  if (!isObj(state)) return [];
  return Object.entries(state).map(([name, value]) => ({
    name,
    text: value === null || value === undefined ? 'not set' : short(value, 80),
    masked: typeof value === 'string' && MASK.test(value),
  }));
}
