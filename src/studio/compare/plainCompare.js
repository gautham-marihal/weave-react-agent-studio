// A comparison of two versions (what the server's diff answers with: [{ op: 'add' | 'remove' | 'change', path, before?, after? }]) put in words a person would
// use: "Changed the language model from GPT-4.1 Mini to GPT-5.4", not "defaults.models.llm.model". The settings that people change most (the models, the
// voice, the language) have their own sentences; the rest use the plain-language names the settings form already has. Pure: no React, no DOM.

import { describeChange, sectionOf } from '../assistant/diffConfig.js';
import { MODEL_OPTIONS, providerLabel } from '../models/catalog.js';
import { VOICE_CATALOG } from '../../voiceCatalog.js';
import { languageName } from '../simple/simpleModel.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const KINDS = { add: 'added', remove: 'removed', change: 'changed' };
const PART = { llm: 'language model', stt: 'speech-to-text', tts: 'text-to-speech' };
// the part of the call as a noun: "the language model", "the speech-to-text model"
const THING = { llm: 'language model', stt: 'speech-to-text model', tts: 'text-to-speech model' };
const BOOKKEEPING = new Set(['version', 'status', 'created_at', 'updated_at']);

// the server addresses an item of a list by its id as "id=billing"; the rest of the studio's wording works from { id: 'billing' }
const segment = (part) => {
  const hit = typeof part === 'string' ? /^([a-z_]+)=(.+)$/.exec(part) : null;
  return hit ? { id: hit[2] } : part;
};
export const toChange = (c) => ({ path: (c.path || []).map(segment), kind: KINDS[c.op] || 'changed', before: c.before, after: c.after });
export const isBookkeeping = (c) => c.path?.[0] === 'meta' && c.path.length === 2 && BOOKKEEPING.has(c.path[1]);
const isStudioNote = (c) => c.path?.[0] === 'builder';

// ---- values as people read them
const modelName = (part, id) => {
  for (const [stage, byProvider] of Object.entries(MODEL_OPTIONS)) {
    if (stage !== part) continue;
    for (const list of Object.values(byProvider)) {
      const hit = list.find((m) => m.id === id);
      if (hit) return hit.label;
    }
  }
  return id;
};
const voiceName = (id) => {
  const v = VOICE_CATALOG.find((x) => x.voiceId === id);
  return v ? `${v.name} (${v.provider})` : id ? 'a voice from your own account' : 'none';
};
const clip = (text, n = 70) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);
const q = (text) => `“${clip(text)}”`;
const isEmptyObject = (v) => isObj(v) && Object.keys(v).length === 0;

// What a change to the speech and language models, the voice and the language says, or null when it is some other setting.
function special(change) {
  const [a, b, c, d] = change.path;
  const { kind, before, after } = change;
  if (a === 'defaults' && b === 'models' && PART[c]) {
    const part = PART[c];
    const thing = THING[c];
    if (d === undefined) return kind === 'added' ? `Chose a ${thing}` : kind === 'removed' ? `Took away the ${thing}` : `Changed the ${thing}`;
    if (d === 'model')
      return kind === 'changed'
        ? `Changed the ${thing} from ${q(modelName(c, before))} to ${q(modelName(c, after))}`
        : kind === 'added'
          ? `Chose the ${thing} ${q(modelName(c, after))}`
          : `Took away the ${thing}`;
    if (d === 'provider')
      return kind === 'changed'
        ? `Changed the ${part} provider from ${q(providerLabel(before))} to ${q(providerLabel(after))}`
        : kind === 'added'
          ? `Chose ${q(providerLabel(after))} as the ${part} provider`
          : `Took away the ${part} provider`;
    if (d === 'voice_id')
      return kind === 'changed'
        ? `Changed the voice from ${q(voiceName(before))} to ${q(voiceName(after))}`
        : kind === 'added'
          ? `Chose the voice ${q(voiceName(after))}`
          : 'Took away the voice';
    if (d === 'api_key') return `${kind === 'removed' ? 'Took away' : 'Changed'} the key the ${part} provider is reached with`;
    if (d === 'base_url') return `${kind === 'removed' ? 'Took away' : 'Changed'} the address the ${thing} is reached at`;
    if (d === 'options')
      return kind === 'removed' || isEmptyObject(after)
        ? `Took away the extra options of the ${thing}`
        : kind === 'added'
          ? `Added extra options to the ${thing}`
          : `Changed the extra options of the ${thing}`;
  }
  // a rule in a list of rules (a style rule, a shared rule): by what it says, not by its place in the list
  if (a === 'persona' && ['style_rules', 'shared_rules'].includes(b) && typeof c === 'number') {
    const noun = b === 'style_rules' ? 'style rule' : 'shared rule';
    if (kind === 'added') return `Added the ${noun} ${q(String(after))}`;
    if (kind === 'removed') return `Removed the ${noun} ${q(String(before))}`;
    return `Changed the ${noun} from ${q(String(before))} to ${q(String(after))}`;
  }
  if (a === 'defaults' && b === 'language' && c === 'primary') {
    return kind === 'changed'
      ? `Changed the main language from ${q(languageName(before))} to ${q(languageName(after))}`
      : kind === 'added'
        ? `Chose ${q(languageName(after))} as the main language`
        : 'Took away the main language';
  }
  if (a === 'defaults' && b === 'language' && c === 'speaks') {
    const names = (v) => (Array.isArray(v) ? v.map(languageName).join(', ') : '');
    return kind === 'changed'
      ? `Changed the languages it understands from ${q(names(before) || 'none')} to ${q(names(after) || 'none')}`
      : kind === 'added'
        ? `It now understands ${q(names(after))}`
        : 'It no longer lists other languages';
  }
  return null;
}

// The group a change belongs to, with a title a person would look for.
function topic(change) {
  const [a, b] = change.path;
  if (a === 'defaults' && b === 'models') return { key: 'models', title: 'AI models and voice' };
  if (a === 'defaults' && b === 'language') return { key: 'language', title: 'Language' };
  return { key: String(a ?? ''), title: sectionOf(change) };
}

// The two values to show side by side when they are too long for the sentence (a changed set of instructions, say).
function wording(change) {
  const { before, after } = change;
  const long = (v) => typeof v === 'string' && v.length > 70;
  if (!(long(before) || long(after))) return null;
  return { before: typeof before === 'string' ? before : null, after: typeof after === 'string' ? after : null };
}

export function plainChange(raw) {
  const change = toChange(raw);
  const own = special(change);
  const base = describeChange(change);
  return { verb: base.verb, text: own || base.text, full: wording(change), key: topic(change) };
}

// { total, groups: [{ key, title, items: [{ verb, text, full }] }] } for the server's list of changes; the studio's own notes are left out.
export function plainChanges(changes) {
  const groups = new Map();
  (changes || [])
    .filter((c) => !isBookkeeping(c) && !isStudioNote(c))
    .forEach((c) => {
      const item = plainChange(c);
      const { key, title } = item.key;
      if (!groups.has(key)) groups.set(key, { key, title, items: [] });
      groups.get(key).items.push({ verb: item.verb, text: item.text, full: item.full });
    });
  const list = [...groups.values()];
  return { total: list.reduce((n, g) => n + g.items.length, 0), groups: list };
}
