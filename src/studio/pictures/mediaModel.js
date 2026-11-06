// Images & Videos, gathered for their own Build part: every picture step wherever it is (a form's steps, a tool's
// effects, an event…), which channels can take a photo or the camera, whether the AI can see pictures, and whether the
// pictures are forgotten after the check. Every change writes the same configuration the steps and channels already
// use. Pure: no React, no DOM.

import { PICTURE_STEPS } from './pictureSteps.js';
import { STRICTNESS, withStrictness } from './strictness.js';
import { freshId, placeLabel } from '../form/references.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const WEB = new Set(['web_chat', 'web_voice']);

// the words for the list a step sits in, by its key
const LIST_WORDS = {
  on_submit: 'when it is sent',
  effects: 'what it does after',
  do: 'what it does',
  on_timeout: 'if nothing comes in time',
  on_success: 'when it succeeds',
  on_failure: 'when it fails',
  on_decline: 'when it is declined',
  then: 'then',
  otherwise: 'otherwise',
};
const listWords = (key) => LIST_WORDS[key] || String(key).replace(/_/g, ' ');

// Every picture step in the draft: [{ path, step, list, index }], `list` being the path of the list it is in, in the
// order they appear
export function pictureSteps(config) {
  const found = [];
  const visit = (node, path) => {
    if (Array.isArray(node))
      node.forEach((item, i) => {
        if (isObj(item) && PICTURE_STEPS.has(item.type)) found.push({ path: [...path, i], step: item, list: path, index: i });
        visit(item, [...path, i]);
      });
    else if (isObj(node)) Object.entries(node).forEach(([key, value]) => visit(value, [...path, key]));
  };
  visit(config, []);
  return found;
}

// The picture steps by the list they are in, each list named in words ("form “application” · when it is sent")
export function pictureGroups(config) {
  const groups = [];
  for (const hit of pictureSteps(config)) {
    const key = hit.list.join('.');
    let group = groups.find((g) => g.key === key);
    if (!group) {
      // a form by the title people see; anything else by its kind and name ("tool “lookup”")
      const form = hit.list[0] === 'forms' && isObj(config.forms?.[hit.list[1]]) ? config.forms[hit.list[1]] : null;
      const where = form ? `Form “${form.title || form.id}”` : placeLabel(config, hit.list);
      group = { key, list: hit.list, name: `${where} · ${listWords(hit.list.at(-1))}`, steps: [] };
      groups.push(group);
    }
    group.steps.push(hit);
  }
  return groups;
}

// How many of each, for the part's summary and its state in the side list
export function pictureCounts(config) {
  const steps = pictureSteps(config).map((h) => h.step);
  return {
    photo: steps.filter((s) => s.type === 'request_image' && s.kind !== 'camera').length,
    video: steps.filter((s) => s.type === 'request_image' && s.kind === 'camera').length,
    read: steps.filter((s) => s.type === 'analyze_image').length,
    compare: steps.filter((s) => s.type === 'compare_values').length,
    forget: steps.filter((s) => s.type === 'discard_image').length,
  };
}

// Each channel and what it can take: { index, channel, web, photo, camera }
export function channelPictures(config) {
  return (Array.isArray(config?.channels) ? config.channels : []).map((channel, index) => {
    const input = Array.isArray(channel?.modalities?.input) ? channel.modalities.input : [];
    const web = isObj(channel) && WEB.has(channel.type);
    return { index, channel, web, on: channel?.enabled !== false, photo: web && input.includes('image'), camera: web && input.includes('video') };
  });
}

// Whether the AI that answers can see pictures (the default model, and any subagent's own)
export function aiSeesPictures(config) {
  const llm = config?.defaults?.models?.llm;
  const own = (Array.isArray(config?.agents?.items) ? config.agents.items : []).map((a) => a?.overrides?.models?.llm).filter(isObj);
  return { set: isObj(llm), sees: isObj(llm) && llm.vision === true && own.every((m) => m.vision === true) };
}

// One channel taking photos (`image`) or the camera (`video`), or not. Turning one on also marks the AI as seeing
// pictures (the default model, the channel's own and every subagent's), as the server needs; turning it off leaves the AI
// as it is.
const seeing = (llm) => (isObj(llm) && llm.vision !== true ? { ...llm, vision: true } : llm);
const seeingOwner = (owner) => {
  const llm = owner?.overrides?.models?.llm;
  if (!isObj(llm) || llm.vision === true) return owner;
  return { ...owner, overrides: { ...owner.overrides, models: { ...owner.overrides.models, llm: seeing(llm) } } };
};
export function setChannelInput(config, index, want, on) {
  const channel = config.channels?.[index];
  if (!isObj(channel)) return config;
  const input = Array.isArray(channel.modalities?.input) ? channel.modalities.input : ['text'];
  const nextInput = on ? (input.includes(want) ? input : [...input, want]) : input.filter((m) => m !== want);
  const changed = { ...channel, modalities: { ...(isObj(channel.modalities) ? channel.modalities : {}), input: nextInput } };
  const next = { ...config, channels: config.channels.map((c, i) => (i === index ? (on ? seeingOwner(changed) : changed) : c)) };
  if (!on) return next;
  const llm = config.defaults?.models?.llm;
  if (isObj(llm) && llm.vision !== true) next.defaults = { ...config.defaults, models: { ...config.defaults.models, llm: seeing(llm) } };
  if (Array.isArray(config.agents?.items)) next.agents = { ...config.agents, items: config.agents.items.map((a) => (isObj(a) ? seeingOwner(a) : a)) };
  return next;
}

// Every photo (or camera) request held to one of the three standards at once
export function setAllStrictness(config, kind, name) {
  let next = config;
  for (const hit of pictureSteps(config)) {
    if (hit.step.type !== 'request_image' || (hit.step.kind === 'camera') !== (kind === 'camera')) continue;
    next = setAt(next, [...hit.path, 'quality'], withStrictness(kind, hit.step.quality, name));
  }
  return next;
}
// the one word every request of that kind shares, or '' when they differ (or there are none)
export function sharedStrictness(config, kind, strictnessOf) {
  const words = pictureSteps(config)
    .filter((h) => h.step.type === 'request_image' && (h.step.kind === 'camera') === (kind === 'camera'))
    .map((h) => strictnessOf(kind, h.step.quality) || 'none');
  return words.length && words.every((w) => w === words[0]) ? words[0] : '';
}

// Are the pictures forgotten? { asked, forgotten } counted by the picture variables asked for and the ones a step forgets
export function forgetting(config) {
  const hits = pictureSteps(config);
  const asked = [...new Set(hits.filter((h) => h.step.type === 'request_image' && h.step.into).map((h) => h.step.into))];
  const gone = new Set(hits.filter((h) => h.step.type === 'discard_image').flatMap((h) => (Array.isArray(h.step.images) ? h.step.images : [])));
  return { asked, forgotten: asked.filter((v) => gone.has(v)) };
}

// The lists of steps a new photo request can go in: every form's "when it is sent" (made if it has none yet)
export function addTargets(config) {
  return (Array.isArray(config?.forms) ? config.forms : [])
    .map((form, i) =>
      isObj(form)
        ? { value: `forms.${i}.on_submit`, label: `Form “${form.title || form.id || i + 1}” · when it is sent`, path: ['forms', i, 'on_submit'] }
        : null,
    )
    .filter(Boolean);
}

// A new photo or camera request at the end of a list, with its own remembered value to keep the picture in
export function addPictureRequest(config, listPath, kind = 'upload') {
  const vars = isObj(config?.state?.variables) ? config.state.variables : {};
  const into = freshId(Object.keys(vars), kind === 'camera' ? 'video_frame' : 'photo').replace(/-/g, '_');
  const step = {
    type: 'request_image',
    kind,
    into,
    prompt: kind === 'camera' ? 'Hold your card up to the camera' : 'A clear photo of the front of your card',
    timeout_s: kind === 'camera' ? 90 : 180,
    quality: { ...STRICTNESS[kind === 'camera' ? 'camera' : 'upload'].standard },
  };
  let next = setAt(config, ['state', 'variables', into], { type: 'string', nullable: true, default: null });
  const list = getAt(next, listPath);
  next = setAt(next, listPath, [...(Array.isArray(list) ? list : []), step]);
  return { config: next, path: [...listPath, Array.isArray(list) ? list.length : 0] };
}

// ---- the library: the sample pictures of the test scenarios (schema 1.2 `tests[].images`), the pictures an agent is
// tried with. Each is a card drawn from lines of text (with faults), a picture of the author's own (`data_url` /
// `base64`), a file in the agent's fixtures folder, or a file that is not a picture.

// what a sample picture is: 'card' | 'photo' | 'file' | 'text' | 'empty'
export function pictureKind(image) {
  if (!isObj(image)) return 'card';
  if (image.empty) return 'empty';
  if (typeof image.text === 'string') return 'text';
  if (image.data_url || image.base64) return 'photo';
  if (image.file) return 'file';
  return 'card';
}
// the picture as an address the browser can draw (a picture of their own), else ''
export function pictureSrc(image) {
  if (!isObj(image)) return '';
  if (typeof image.data_url === 'string') return image.data_url;
  if (typeof image.base64 === 'string') return `data:image/${image.format === 'jpg' ? 'jpeg' : image.format || 'png'};base64,${image.base64}`;
  return '';
}
// its size in bytes, for a picture of their own (from the length of its base64)
export function pictureBytes(image) {
  const src = pictureSrc(image);
  const b64 = src.split(',')[1] || '';
  return b64 ? Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0) : 0;
}

// Every sample picture: [{ key, scenario (index), scenarioId, name, image, kind, uses: [words] }]
export function pictureLibrary(config) {
  const tests = Array.isArray(config?.tests) ? config.tests : [];
  const out = [];
  tests.forEach((t, si) => {
    if (!isObj(t) || !isObj(t.images)) return;
    for (const [name, image] of Object.entries(t.images)) {
      const uses = [];
      if (t.camera === name) uses.push('the camera shows it from the start');
      (Array.isArray(t.turns) ? t.turns : []).forEach((turn, ti) => {
        if (isObj(turn) && turn.upload === name) uses.push(`sent as a photo at turn ${ti + 1}`);
        if (isObj(turn) && turn.camera === name) uses.push(`shown to the camera at turn ${ti + 1}`);
      });
      out.push({ key: `${si}:${name}`, scenario: si, scenarioId: t.id, scenarioWords: t.description || t.id, name, image, kind: pictureKind(image), uses });
    }
  });
  return out;
}

const withImages = (config, si, images) => setAt(config, ['tests', si, 'images'], Object.keys(images).length ? images : undefined);
export function setPicture(config, si, name, image) {
  const images = isObj(config.tests?.[si]?.images) ? config.tests[si].images : {};
  return withImages(config, si, { ...images, [name]: image });
}
// renamed here and in the turns and the camera that name it
export function renamePicture(config, si, from, to) {
  const t = config.tests?.[si];
  if (!isObj(t) || !isObj(t.images) || from === to || to in t.images) return config;
  const images = Object.fromEntries(Object.entries(t.images).map(([k, v]) => [k === from ? to : k, v]));
  const turns = (Array.isArray(t.turns) ? t.turns : []).map((turn) =>
    isObj(turn) && turn.upload === from ? { upload: to } : isObj(turn) && turn.camera === from ? { camera: to } : turn,
  );
  return setAt(config, ['tests', si], { ...t, images, turns, ...(t.camera === from ? { camera: to } : {}) });
}
// removed, only when nothing uses it (a turn naming a missing picture would break the scenario)
export function removePicture(config, si, name) {
  const t = config.tests?.[si];
  if (!isObj(t) || !isObj(t.images)) return config;
  const { [name]: _gone, ...rest } = t.images;
  return withImages(config, si, rest);
}
// added under a fresh name made from `base`; -> { config, name }
export function addPicture(config, si, image, base = 'picture') {
  const images = isObj(config.tests?.[si]?.images) ? config.tests[si].images : {};
  const clean =
    String(base || 'picture')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^[^a-z]+/, '')
      .slice(0, 30) || 'picture';
  let name = clean;
  let n = 2;
  while (name in images) {
    name = `${clean}_${n}`;
    n += 1;
  }
  return { config: setPicture(config, si, name, image), name };
}

// ---- small path helpers (copies; the draft is never changed in place)
function getAt(obj, path) {
  return path.reduce((node, key) => (node == null ? undefined : node[key]), obj);
}
function setAt(obj, path, value) {
  if (!path.length) return value;
  const [key, ...rest] = path;
  const base = Array.isArray(obj) ? [...obj] : isObj(obj) ? { ...obj } : typeof key === 'number' ? [] : {};
  base[key] = setAt(base[key], rest, value);
  return base;
}
