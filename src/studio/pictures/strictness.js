// How picky a photo or camera request is, as three words a person can choose between, each a set of the picture standard's
// numbers (request_image `quality`). "Standard" is what the demo was tested with (SUGGESTED_SHARPNESS); Relaxed and Strict
// are a step either side. Sharpness decides which word a request shows; the other numbers stay as set. Pure.

import { SUGGESTED_SHARPNESS } from './pictureSteps.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

export const STRICTNESS = {
  upload: {
    relaxed: { min_sharpness: 4, min_dimension: 400 },
    standard: { min_sharpness: SUGGESTED_SHARPNESS.upload, min_dimension: 400 },
    strict: { min_sharpness: 20, min_dimension: 600 },
  },
  camera: {
    relaxed: { min_sharpness: 15, min_brightness: 30, min_dimension: 400 },
    standard: { min_sharpness: SUGGESTED_SHARPNESS.camera, min_brightness: 40, min_dimension: 400 },
    strict: { min_sharpness: 50, min_brightness: 50, min_dimension: 600 },
  },
};
export const STRICTNESS_WORDS = [
  { value: 'relaxed', label: 'Relaxed', hint: 'Lets more photos through; a blurred one may be read.' },
  { value: 'standard', label: 'Standard', hint: 'The tested setting: blurred photos are turned down, good phone photos pass.' },
  { value: 'strict', label: 'Strict', hint: 'Only sharp, large photos pass; more people are asked again.' },
];

// 'relaxed' | 'standard' | 'strict' when the sharpness is one of the presets, 'custom' for another number, null when
// sharpness isn't checked at all
export function strictnessOf(kind, quality) {
  const sharp = isObj(quality) ? quality.min_sharpness : undefined;
  if (typeof sharp !== 'number') return null;
  const presets = STRICTNESS[kind === 'camera' ? 'camera' : 'upload'];
  return Object.keys(presets).find((name) => presets[name].min_sharpness === sharp) || 'custom';
}

// the picture standard with a preset's numbers set over it (a maximum brightness and the like are kept)
export function withStrictness(kind, quality, name) {
  const preset = STRICTNESS[kind === 'camera' ? 'camera' : 'upload'][name];
  return preset ? { ...(isObj(quality) ? quality : {}), ...preset } : quality;
}
