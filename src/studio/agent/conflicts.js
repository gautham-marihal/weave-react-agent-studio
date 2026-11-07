// Settings that each look fine but don't work together, so a change in one place doesn't quietly undo another: the
// Build side list marks the part to look at (buildSections.js) and says why. The server's check doesn't catch these
// (each value is valid on its own). It informs and never blocks. Pure: no React, no DOM.
//   -> [{ part, text }]

import { baseOf, primaryOf } from '../form/messages.ts';
import { channelModels } from '../form/presets.js';
import { seesPictures, modelLabel } from '../models/catalog.js';
import { languageName } from '../simple/simpleModel.js';

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const clip = (text, n = 60) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);
const on = (channel) => isObj(channel) && channel.enabled !== false;
const inputsOf = (channel) => list(channel?.modalities?.input);

// every object in the config, with the key it sits under
function walk(node, visit, key = '') {
  if (Array.isArray(node)) node.forEach((item) => walk(item, visit, key));
  else if (isObj(node)) {
    visit(node, key);
    Object.entries(node).forEach(([k, v]) => walk(v, visit, k));
  }
}

// ---- a channel shares its screen without taking video
function screenWithoutVideo(config) {
  return list(config?.channels)
    .filter((c) => on(c) && c.inputs?.video?.screen_share === true && !inputsOf(c).includes('video'))
    .map((c) => ({ part: 'media', text: `Screen sharing is on for “${c.id}”, but it doesn’t take video, so nobody can share a screen there.` }));
}

// ---- pictures reach a model that can't read them
function picturesToBlindModel(config) {
  const seen = new Set();
  const out = [];
  list(config?.channels)
    .filter((c) => on(c) && (inputsOf(c).includes('image') || inputsOf(c).includes('video')))
    .forEach((channel) => {
      const own = channelModels(channel, config).llm;
      const agents = list(config?.agents?.items).map((a) => ({
        ...(isObj(own) ? own : {}),
        ...(isObj(a?.overrides?.models?.llm) ? a.overrides.models.llm : {}),
      }));
      [own, ...agents].forEach((llm) => {
        if (!isObj(llm) || seesPictures(llm.provider, llm.model) !== false) return;
        const key = `${llm.provider}/${llm.model}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({
          part: 'media',
          text: `Customers can send pictures, but ${modelLabel('llm', llm.provider, llm.model)} can’t read them. Choose a model that can.`,
        });
      });
    });
  return out;
}

// ---- the silence limit ends the call before its check-ins
function silenceBeforeCheckIns(config) {
  const q = config?.defaults?.conversation?.inactivity;
  const limit = num(config?.guardrails?.limits?.max_silence_s);
  if (!isObj(q) || q.enabled === false || limit === null) return [];
  const wait = num(q.timeout_s);
  if (wait === null) return [];
  const checks = Number.isInteger(q.max_nudges) ? q.max_nudges : list(q.nudges).length;
  if (limit <= wait)
    return [{ part: 'conversation', text: `The silence limit (${limit} s) ends the call before its first check-in (${wait} s), so the check-ins never run.` }];
  if (checks > 0 && limit < wait * (checks + 1))
    return [
      {
        part: 'conversation',
        text: `The silence limit (${limit} s) ends the call before its ${plural(checks, 'check-in')} and goodbye (${wait * (checks + 1)} s).`,
      },
    ];
  return [];
}

// ---- a form shown where a channel can't show it, with nothing to do instead
const showsForms = (channel) =>
  isObj(channel?.capabilities) && typeof channel.capabilities.forms === 'boolean'
    ? channel.capabilities.forms
    : ['web_chat', 'web_voice'].includes(channel?.type);
function formsWithoutFallback(config) {
  const blind = list(config?.channels).filter((c) => on(c) && !showsForms(c));
  if (!blind.length) return [];
  const used = new Set();
  walk(config, (node) => {
    if (node.type === 'send_form' && typeof node.form === 'string') used.add(node.form);
    if (node.builtin === 'send_form' && typeof node.params?.form === 'string') used.add(node.params.form);
  });
  const bare = list(config?.forms).filter((f) => isObj(f) && used.has(f.id) && !list(f.otherwise).length);
  if (!bare.length) return [];
  const names = bare.map((f) => `“${f.title || f.id}”`).join(', ');
  return [
    {
      part: 'connections',
      text: `${blind.map((c) => `“${c.id}”`).join(', ')} can’t show forms, and ${names} ${bare.length === 1 ? 'has' : 'have'} nothing to do instead there.`,
    },
  ];
}

// ---- hand-overs an agent never makes
function standaloneHandoffs(config) {
  return list(config?.agents?.items)
    .filter((a) => isObj(a) && a.kind === 'standalone' && list(a.handoffs).length)
    .map((a) => ({ part: 'subagents', text: `${a.name || a.id} answers on its own, so its ${plural(list(a.handoffs).length, 'hand-over')} never happen.` }));
}

// ---- listening pinned to one language while the caller's is detected
function detectButPinned(config) {
  const pinned = config?.defaults?.models?.stt?.language;
  if (config?.defaults?.language?.auto_detect !== true || typeof pinned !== 'string' || !pinned) return [];
  return [
    { part: 'agent', text: `It detects the caller’s language, but listening is fixed to ${languageName(pinned)}, so other languages aren’t heard well.` },
  ];
}

// ---- lines in English on an agent that speaks another language
const ENGLISH = new Set(
  'the you your is are to a an and i it its please thank thanks for of with will can now me my we our this that still there here what how help call again goodbye hello hi sorry i’m i’ll you’re don’t'.split(
    ' ',
  ),
);
const looksEnglish = (text) => {
  const words = String(text)
    .toLowerCase()
    .match(/[a-z’']+/g);
  if (!words || words.length < 2) return false;
  const hits = words.filter((w) => ENGLISH.has(w.replace(/'/g, '’')));
  return new Set(hits).size >= 2 && hits.length / words.length >= 0.25;
};
function englishLines(config) {
  const primary = primaryOf(config);
  if (!primary || baseOf(primary) === 'en') return [];
  const lines = [];
  walk(config, (node, key) => {
    if (key === 'messages' && typeof node.text === 'string') lines.push(node.text);
    ['say', 'announce', 'recording_notice'].forEach((k) => typeof node[k] === 'string' && lines.push(node[k]));
    if (node.type === 'say' && typeof node.text === 'string') lines.push(node.text);
    if (node.type === 'request_image' && typeof node.prompt === 'string') lines.push(node.prompt);
  });
  const english = [...new Set(lines)].filter(looksEnglish);
  if (!english.length) return [];
  return [
    {
      part: 'agent',
      text: `${plural(english.length, 'line')} ${english.length === 1 ? 'is' : 'are'} in English, but it speaks ${languageName(primary)}: “${clip(english[0], 50)}”${english.length > 1 ? ' and more' : ''}.`,
    },
  ];
}

// ---- models from LiveKit Inference, picked from lists of your own providers' names
function inferenceNames(config) {
  if (config?.runtime?.provider_mode !== 'inference') return [];
  return [
    {
      part: 'agent',
      text: 'It takes its models from LiveKit Inference, whose model names differ from the lists offered here: check each model’s name against LiveKit Inference.',
    },
  ];
}

export function settingConflicts(config) {
  if (!isObj(config)) return [];
  return [
    ...inferenceNames(config),
    ...englishLines(config),
    ...detectButPinned(config),
    ...silenceBeforeCheckIns(config),
    ...formsWithoutFallback(config),
    ...standaloneHandoffs(config),
    ...picturesToBlindModel(config),
    ...screenWithoutVideo(config),
  ];
}
