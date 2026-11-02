// The design styles and their colour options. A style is a set of token values (src/styles/themes.css) applied as
// `data-style` on <html>, in light and in dark; a colour option is applied as `data-accent`. index.html applies both
// before the first paint, so its list of styles must match STYLES (styles.test.ts checks it).

export type StyleId = 'studio' | 'simple' | 'professional' | 'calm' | 'premium' | 'futuristic' | 'vibrant';

export interface StyleOption {
  id: StyleId;
  label: string;
  description: string;
  // the heading type of the style, so its card can show its name in it
  displayFont: string;
}

export interface AccentOption {
  id: string;
  label: string;
  // what the swatch shows: the colour, and the tint it sits on
  swatch: [string, string];
}

// What a preview card draws, in the current light or dark mode.
export interface StylePreview {
  page: string;
  panel: string;
  line: string;
  text: string;
  accent: string;
  primary: string;
}

export const STYLE_KEY = 'weave_style';
export const DEFAULT_STYLE: StyleId = 'studio';
export const accentKey = (style: StyleId) => `weave_accent_${style}`;

const SANS = '"Segoe UI Variable Text", "Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, system-ui, sans-serif';

export const STYLES: StyleOption[] = [
  {
    id: 'studio',
    label: 'Studio',
    description: 'Calm and precise: a light grey page, white cards, IBM Plex type, one plum accent.',
    displayFont: '"IBM Plex Sans", system-ui, sans-serif',
  },
  { id: 'simple', label: 'Simple', description: 'Quiet and neutral: black and white, nothing in the way.', displayFont: SANS },
  {
    id: 'professional',
    label: 'Professional',
    description: 'Enterprise and trustworthy: navy and crisp blue, neat corners, tidy figures.',
    displayFont: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
  },
  {
    id: 'calm',
    label: 'Calm',
    description: 'Soft and natural: sage and sand, round and airy, easy on the eyes.',
    displayFont: '"Avenir Next", Seravek, Candara, "Gill Sans", "Segoe UI", system-ui, sans-serif',
  },
  {
    id: 'premium',
    label: 'Premium',
    description: 'Tailored and calm: ivory, espresso and gold, with serif titles.',
    displayFont: '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif',
  },
  {
    id: 'futuristic',
    label: 'Futuristic',
    description: 'A control room: deep navy, neon cyan, sharp corners and technical type.',
    displayFont: 'Bahnschrift, "DIN Alternate", "D-DIN", "Segoe UI", system-ui, sans-serif',
  },
  {
    id: 'vibrant',
    label: 'Vibrant',
    description: 'Playful: candy colours, round corners and round type.',
    displayFont: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Segoe UI", system-ui, sans-serif',
  },
];

// Each style's five colour options; the first is the style's own palette. The choice is kept per style.
export const ACCENTS: Record<StyleId, AccentOption[]> = {
  studio: [
    { id: 'plum', label: 'Plum', swatch: ['#72308f', '#f5ebfa'] },
    { id: 'indigo', label: 'Indigo', swatch: ['#4338ca', '#eef0fe'] },
    { id: 'teal', label: 'Teal', swatch: ['#0f766e', '#e3f5f2'] },
    { id: 'blue', label: 'Blue', swatch: ['#175cd3', '#ebf2fe'] },
    { id: 'graphite', label: 'Graphite', swatch: ['#101828', '#eef0f3'] },
  ],
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

// The colours each card draws, taken from the style's own tokens in themes.css.
export const PREVIEWS: Record<StyleId, Record<'light' | 'dark', StylePreview>> = {
  studio: {
    light: { page: '#f6f7f9', panel: '#ffffff', line: '#d0d5dd', text: '#101828', accent: '#72308f', primary: '#72308f' },
    dark: { page: '#0f172a', panel: '#1e293b', line: '#475569', text: '#f8fafc', accent: '#c49bed', primary: '#c49bed' },
  },
  simple: {
    light: { page: '#ffffff', panel: '#ffffff', line: '#e0e0e4', text: '#0b0b0d', accent: '#0b0b0d', primary: '#0b0b0d' },
    dark: { page: '#0b0b0c', panel: '#111113', line: '#2e2e33', text: '#fafafa', accent: '#fafafa', primary: '#fafafa' },
  },
  professional: {
    light: { page: '#f3f5f8', panel: '#ffffff', line: '#c8d1dd', text: '#0b1526', accent: '#1a52bd', primary: '#1f5fd6' },
    dark: { page: '#0b111c', panel: '#111a28', line: '#2c3b55', text: '#f2f6fb', accent: '#7cb0ff', primary: '#2563eb' },
  },
  calm: {
    light: { page: '#f1f3ec', panel: '#fbfcf8', line: '#cdd6c2', text: '#152012', accent: '#355f41', primary: '#3e6b4a' },
    dark: { page: '#0e1410', panel: '#141c16', line: '#314136', text: '#f0f5ec', accent: '#acd4b1', primary: '#9cc9a3' },
  },
  premium: {
    light: { page: '#f5f0e6', panel: '#fffcf6', line: '#d3c4a7', text: '#1a140d', accent: '#7a5513', primary: '#1d1710' },
    dark: { page: '#0b0907', panel: '#14110c', line: '#3d3324', text: '#fbf3e1', accent: '#e8c77e', primary: '#d9b264' },
  },
  futuristic: {
    light: { page: '#edf3fb', panel: '#fbfdff', line: '#b7cbe5', text: '#06142a', accent: '#0b6580', primary: '#0e7490' },
    dark: { page: '#02050c', panel: '#07101f', line: '#1f4775', text: '#effbff', accent: '#62ecff', primary: '#18e0ff' },
  },
  vibrant: {
    light: { page: '#fbf8ff', panel: '#ffffff', line: '#dcd2f7', text: '#17123a', accent: '#6d28d9', primary: '#7c3aed' },
    dark: { page: '#110a24', panel: '#1a1135', line: '#3e2e74', text: '#fbf9ff', accent: '#d4c8ff', primary: '#7c3aed' },
  },
};

export const isStyleId = (value: unknown): value is StyleId => typeof value === 'string' && STYLES.some((s) => s.id === value);

// A stored style, or the default when it is missing or no longer offered.
export const normalizeStyle = (value: unknown): StyleId => (isStyleId(value) ? value : DEFAULT_STYLE);

// A stored colour of a style, or the style's own when it is missing or no longer offered.
export function normalizeAccent(style: StyleId, value: unknown): string {
  const options = ACCENTS[style];
  return options.some((o) => o.id === value) ? (value as string) : options[0].id;
}

export const styleLabel = (style: StyleId) => STYLES.find((s) => s.id === style)?.label ?? style;

// The colour an arrow key moves to in the radio group: right/down the next, left/up the previous, going round.
// Home and End go to the first and last. Any other key leaves it where it is (null).
export function accentAfterKey(style: StyleId, current: string, key: string): string | null {
  const options = ACCENTS[style];
  const i = Math.max(0, options.findIndex((o) => o.id === current));
  if (key === 'Home') return options[0].id;
  if (key === 'End') return options[options.length - 1].id;
  const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[key];
  if (!step) return null;
  return options[(i + step + options.length) % options.length].id;
}

// The few calls the theme needs from browser storage, so the logic can be tried without a browser.
export interface PrefStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readStyle(store: PrefStore | null): StyleId {
  try {
    return normalizeStyle(store?.getItem(STYLE_KEY));
  } catch {
    return DEFAULT_STYLE;
  }
}

export function readAccent(store: PrefStore | null, style: StyleId): string {
  try {
    return normalizeAccent(style, store?.getItem(accentKey(style)));
  } catch {
    return ACCENTS[style][0].id;
  }
}
