// The `x-ui` hints a schema may carry to steer the form without a UI release. The vocabulary (what the backend may write, what the form
// understands):
//   widget    textarea | template | jsonpath | phone | url | duration | secret-picker   how to draw the field (an unknown one is ignored)
//   label     a human name, instead of the key made readable
//   help      one line saying what the setting is for, in plain words (it leads the help text, ahead of the catalogue's own)
//   example   a value that makes it clear
//   audience  guided | detailed | expert: how often someone needs it (expert ones sit under "Advanced")
//   group     a heading the field is listed under, with the others of the same group
//   order     a number: lower first (fields without one follow, in schema order)
//   advanced  true: kept under an "Advanced" fold, out of the way until needed
// Pure: no network, no DOM.

import { isObj } from './engine.js';

export const AUDIENCES = ['guided', 'detailed', 'expert'] as const;
export const XUI_WIDGETS = ['textarea', 'template', 'jsonpath', 'phone', 'url', 'duration', 'secret-picker'] as const;

export type Audience = (typeof AUDIENCES)[number];
export type XuiWidget = (typeof XUI_WIDGETS)[number];
export type Xui = {
  widget?: XuiWidget;
  label?: string;
  help?: string;
  example?: string;
  audience?: Audience;
  group?: string;
  order?: number;
  advanced: boolean;
};
type HintsOf = (key: string) => Partial<Xui>;

// The hints of one schema, cleaned: only well-formed values survive.
export function readXui(shape: unknown): Xui {
  const hints = (shape as Record<string, unknown> | null | undefined)?.['x-ui'];
  const raw: Record<string, unknown> = isObj(hints) ? (hints as Record<string, unknown>) : {};
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
  return {
    widget: (XUI_WIDGETS as readonly unknown[]).includes(raw.widget) ? (raw.widget as XuiWidget) : undefined,
    label: text(raw.label),
    help: text(raw.help),
    example: text(raw.example),
    audience: (AUDIENCES as readonly unknown[]).includes(raw.audience) ? (raw.audience as Audience) : undefined,
    group: text(raw.group),
    order: typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : undefined,
    advanced: raw.advanced === true,
  };
}

// Keys in the order the hints ask for: those with an `order` first (lowest first, ties in schema order), then the rest as they were.
export function orderKeys(keys: string[], hintsOf: HintsOf): string[] {
  const indexed = keys.map((key, index) => ({ key, index, order: hintsOf(key).order }));
  const ranked = indexed
    .filter((item): item is { key: string; index: number; order: number } => item.order !== undefined)
    .sort((a, b) => a.order - b.order || a.index - b.index);
  return [...ranked, ...indexed.filter((item) => item.order === undefined)].map((item) => item.key);
}

// Keys cut into runs under their group heading. The first run has no heading when its keys have no group; a group's keys are kept
// together at the place the group first appears.
export function groupKeys(keys: string[], hintsOf: HintsOf): { group: string; keys: string[] }[] {
  const sections: { group: string; keys: string[] }[] = [];
  keys.forEach((key) => {
    const group = hintsOf(key).group || '';
    let section = sections.find((s) => s.group === group);
    if (!section) {
      section = { group, keys: [] };
      sections.push(section);
    }
    section.keys.push(key);
  });
  return sections;
}

// Splits keys into the ones shown straight away and the ones under "Advanced".
export function splitAdvanced(keys: string[], hintsOf: HintsOf): { main: string[]; advanced: string[] } {
  return { main: keys.filter((key) => !hintsOf(key).advanced), advanced: keys.filter((key) => hintsOf(key).advanced) };
}

// A phone number as people write it: digits, spaces, dashes, brackets, a leading +. At least 5 digits.
export const looksLikePhone = (text: unknown): boolean => /^\+?[0-9 ()\-.]+$/.test(String(text)) && String(text).replace(/\D/g, '').length >= 5;
export const looksLikeUrl = (text: unknown): boolean => {
  try {
    const url = new URL(String(text));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};
