import { useCallback, useSyncExternalStore } from 'react';

// A choice one person makes about how the studio looks or behaves, kept in this browser (localStorage). Every part of the page that reads
// the same key sees a change at once, and so does another tab. When storage is blocked the choice still holds until the page is closed.
const listeners = new Set();
const memory = new Map();

function read(key, fallback) {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored !== null) return stored;
  } catch {
    /* storage unavailable */
  }
  return memory.has(key) ? memory.get(key) : fallback;
}

// the value now, for code that is not a component
export const getPref = (key, fallback) => read(key, fallback);

export function setPref(key, value) {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((listener) => listener());
}

const subscribe = (listener) => {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
};

// [value, set] for a string preference.
export function usePref(key, fallback) {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key, fallback),
    () => fallback,
  );
  const set = useCallback((next) => setPref(key, next), [key]);
  return [value, set];
}

// "Show technical names": off, a customer sees plain labels only; on, every setting also shows the name the configuration file uses for it,
// and can copy its path or open it in the JSON.
export const TECHNICAL_NAMES_KEY = 'weave_tech_names';
export function useTechnicalNames() {
  const [value, set] = usePref(TECHNICAL_NAMES_KEY, '0');
  const setOn = useCallback((on) => set(on ? '1' : '0'), [set]);
  return [value === '1', setOn];
}

// Density: "comfortable" (the default) or "compact", for people who live in the tool all day. It is a preference of the person, kept in this browser, and
// applied as an attribute of the page so one set of tokens (tokens.css) changes the spacing everywhere.
export const DENSITY_KEY = 'weave_density';
export const DENSITIES = ['comfortable', 'compact'];
export function useDensity() {
  const [value, set] = usePref(DENSITY_KEY, 'comfortable');
  const density = DENSITIES.includes(value) ? value : 'comfortable';
  return [density, set];
}

// The design style, on top of light or dark: the colours, the accent, the corners and the headings of the whole site. A preference of the person, kept in
// this browser, applied as `data-style` on the page (see src/themes.css); index.html applies it before the first paint so nothing flashes.
export const STYLE_KEY = 'weave_style';
export const STYLES = [
  { id: 'simple', label: 'Simple', description: 'Quiet and neutral: black and white, nothing in the way.' },
  { id: 'professional', label: 'Professional', description: 'Enterprise and trustworthy: a navy bar, crisp blue, neat lines.' },
  { id: 'calm', label: 'Calm', description: 'Soft and natural: sage and sand, round and airy, easy on the eyes.' },
  { id: 'premium', label: 'Premium', description: 'Tailored and calm: ivory, espresso and gold, with serif titles.' },
  { id: 'futuristic', label: 'Futuristic', description: 'A heads-up display: a glowing grid, glass panels, neon readouts.' },
  { id: 'vibrant', label: 'Vibrant', description: 'Playful: candy colours, round type, a colour for every place.' },
];
export function useStyle() {
  const [value, set] = usePref(STYLE_KEY, 'simple');
  const style = STYLES.some((s) => s.id === value) ? value : 'simple';
  return [style, set];
}

// The colour options of each style (src/accents.css): only colours that keep the style's character (Simple's are quiet and deep, Premium's are metals
// and jewels, Futuristic's are screen neons, Vibrant's are bright gradients). The first is the style's own palette. `swatch` is what the picker shows: one colour, or two
// for a pair or a gradient. The choice is kept per style, so going back to a style finds its colour as it was left.
export const ACCENTS = {
  simple: [
    { id: 'mono', label: 'Black and white', swatch: ['#0b0b0d', '#ffffff'] },
    { id: 'slate', label: 'Slate', swatch: ['#334155', '#ffffff'] },
    { id: 'navy', label: 'Navy', swatch: ['#1e3a8a', '#ffffff'] },
    { id: 'forest', label: 'Forest', swatch: ['#14532d', '#ffffff'] },
    { id: 'wine', label: 'Wine', swatch: ['#7f1d1d', '#ffffff'] },
  ],
  professional: [
    { id: 'blue', label: 'Blue', swatch: ['#0f1f3d', '#1f5fd6'] },
    { id: 'teal', label: 'Teal', swatch: ['#0b2a2b', '#0f766e'] },
    { id: 'indigo', label: 'Indigo', swatch: ['#1e1b4b', '#4338ca'] },
    { id: 'graphite', label: 'Graphite', swatch: ['#1f2328', '#6b7280'] },
    { id: 'green', label: 'Green', swatch: ['#062a20', '#047857'] },
  ],
  calm: [
    { id: 'sage', label: 'Sage', swatch: ['#3e6b4a', '#e1ecdc'] },
    { id: 'sea', label: 'Sea', swatch: ['#2b6777', '#dcebee'] },
    { id: 'lavender', label: 'Lavender', swatch: ['#5f5590', '#e8e5f3'] },
    { id: 'terracotta', label: 'Terracotta', swatch: ['#9a4f30', '#f4e3da'] },
    { id: 'slate', label: 'Slate', swatch: ['#4a5866', '#e3e8ec'] },
  ],
  premium: [
    { id: 'gold', label: 'Gold', swatch: ['#f2d998', '#b98a33'] },
    { id: 'rose', label: 'Rose gold', swatch: ['#f5cdbd', '#b06f5a'] },
    { id: 'platinum', label: 'Platinum', swatch: ['#eef0f3', '#8e939c'] },
    { id: 'emerald', label: 'Emerald', swatch: ['#b9e6cf', '#2f7d5a'] },
    { id: 'sapphire', label: 'Sapphire', swatch: ['#c3d3f5', '#3f5fae'] },
  ],
  futuristic: [
    { id: 'neon', label: 'Neon', swatch: ['#18e0ff', '#b36dff'] },
    { id: 'matrix', label: 'Matrix', swatch: ['#3dff8f', '#00c2a8'] },
    { id: 'synthwave', label: 'Synthwave', swatch: ['#ff4fd8', '#ff9e3d'] },
    { id: 'ice', label: 'Ice', swatch: ['#7cc4ff', '#e3f2ff'] },
    { id: 'amber', label: 'Amber', swatch: ['#ffb020', '#ff6a2b'] },
  ],
  vibrant: [
    { id: 'candy', label: 'Candy', swatch: ['#7c3aed', '#db2777'] },
    { id: 'sunset', label: 'Sunset', swatch: ['#c2410c', '#db2777'] },
    { id: 'ocean', label: 'Ocean', swatch: ['#1d4ed8', '#0f766e'] },
    { id: 'fresh', label: 'Fresh', swatch: ['#15803d', '#0e7490'] },
    { id: 'berry', label: 'Berry', swatch: ['#9d174d', '#6d28d9'] },
  ],
};
export const accentKey = (style) => `weave_accent_${style}`;
// [the colour option of a style, set]
export function useAccent(style) {
  const options = ACCENTS[style] || ACCENTS.simple;
  const [value, set] = usePref(accentKey(style), options[0].id);
  return [options.some((o) => o.id === value) ? value : options[0].id, set];
}
