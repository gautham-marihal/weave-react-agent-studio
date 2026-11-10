// The picture steps in Build, the parts that need no screen (PictureSteps.jsx draws them): which steps are picture
// steps, the honest note on reading a photo, the sharpness scale and what its numbers mean, and whether the agent's
// web channels can take a picture at all. Pure: no network, no DOM.

import { isObj } from '../form/engine.js';

export const PICTURE_STEPS = new Set(['request_image', 'analyze_image', 'compare_values', 'discard_image']);

// what an author should know before trusting a picture step (UI_REVIEW 5 4b.5; FRONTEND_GUIDE 7.1)
export const DEMO_GRADE =
  'A language model reading a photo can misread it, and it cannot tell a real card from a good copy. For a real decision, send the picture to a verification provider with a “Call an HTTP API” step, and say so in the agent’s own words.';

// ---- the sharpness scale: 0 to thousands, so a log scale; the marks are what the numbers mean (MEDIA_PROTOCOL 3)
const MAX = 2000;
export const toScale = (v) => Math.round((Math.log10(1 + Math.max(0, v)) / Math.log10(1 + MAX)) * 1000);
export const fromScale = (p) => {
  const v = 10 ** ((p / 1000) * Math.log10(1 + MAX)) - 1;
  return v < 20 ? Math.round(v * 2) / 2 : v < 200 ? Math.round(v) : Math.round(v / 10) * 10;
};
export const MARKS = [5, 10, 25, 100, 1000];
// what the numbers mean, said once under the ticks
export const SCALE_WORDS = 'Under 5: a badly blurred upload · about 10: a blurred camera frame · hundreds: a sharp photo · thousands: a crisp card';
export const SUGGESTED_SHARPNESS = { upload: 8, camera: 25 };
// a word on the number chosen, for the kind of request: { tone: 'ok' | 'warn', text }
export function sharpnessAdvice(kind, value) {
  if (kind === 'camera' && value < 15)
    return {
      tone: 'warn',
      text: 'Too low for the camera: video lifts a blurred frame to about 10, so this would never turn blur down. 25 works.',
    };
  if (kind !== 'camera' && value < 5) return { tone: 'warn', text: 'Very low: a badly blurred upload scores under 5, so blur would get through. 8 works.' };
  if (value > 400) return { tone: 'warn', text: 'Very strict: many good phone photos score below this. Calibrate with the scores in your call records.' };
  return {
    tone: 'ok',
    text:
      kind === 'camera'
        ? 'Good for the camera: blurred frames (about 10) are turned down and a steady card passes.'
        : 'Good for an upload: blurred photos are turned down and a clear one passes.',
  };
}

// ---- can any web channel take it? (a request on a channel without `image` / `video` input can never be answered)
const WEB = new Set(['web_chat', 'web_voice']);
const webChannels = (config) => (Array.isArray(config?.channels) ? config.channels : []).filter((c) => isObj(c) && WEB.has(c.type) && c.enabled !== false);
const INPUT_OF = { upload: 'image', camera: 'video' };
export function channelGap(config, kind) {
  const want = INPUT_OF[kind] || 'image';
  const web = webChannels(config);
  if (!web.length) return { want, none: true, missing: [] };
  const missing = web.filter((c) => !(Array.isArray(c.modalities?.input) && c.modalities.input.includes(want)));
  return missing.length === web.length ? { want, none: false, missing } : null;
}
// the configuration with every enabled web channel taking that input (the fix offered beside the step), and every
// language model in play marked as reading pictures: the server refuses a channel that takes images or video unless the
// model it ends up with has `vision: true` (agent config guide 3.9), so the input alone would make the agent invalid
const seeing = (llm) => (isObj(llm) && llm.vision !== true ? { ...llm, vision: true } : llm);
const withSeeingModel = (owner) => {
  const llm = owner?.overrides?.models?.llm;
  if (!isObj(llm) || llm.vision === true) return owner;
  return { ...owner, overrides: { ...owner.overrides, models: { ...owner.overrides.models, llm: seeing(llm) } } };
};
export function withInput(config, want) {
  const next = {
    ...config,
    channels: (config.channels || []).map((c) => {
      if (!isObj(c) || !WEB.has(c.type) || c.enabled === false) return c;
      const input = Array.isArray(c.modalities?.input) ? c.modalities.input : ['text'];
      return withSeeingModel(input.includes(want) ? c : { ...c, modalities: { ...(isObj(c.modalities) ? c.modalities : {}), input: [...input, want] } });
    }),
  };
  const llm = config.defaults?.models?.llm;
  if (isObj(llm) && llm.vision !== true) next.defaults = { ...config.defaults, models: { ...config.defaults.models, llm: seeing(llm) } };
  if (Array.isArray(config.agents?.items)) next.agents = { ...config.agents, items: config.agents.items.map((a) => (isObj(a) ? withSeeingModel(a) : a)) };
  return next;
}
