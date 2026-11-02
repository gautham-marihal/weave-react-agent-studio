import { describe, expect, it } from 'vitest';
import {
  ACCENTS,
  DEFAULT_STYLE,
  PREVIEWS,
  STYLES,
  STYLE_KEY,
  accentAfterKey,
  accentKey,
  normalizeAccent,
  normalizeStyle,
  readAccent,
  readStyle,
  type PrefStore,
} from './styles';

const memoryStore = (seed: Record<string, string> = {}): PrefStore & { data: Record<string, string> } => {
  const data = { ...seed };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => void (data[k] = v) };
};

describe('styles and colour options', () => {
  it('seven styles, Studio first and the default, each with a name and a line about it', () => {
    expect(STYLES.map((s) => s.id)).toEqual(['studio', 'simple', 'professional', 'calm', 'premium', 'futuristic', 'vibrant']);
    expect(DEFAULT_STYLE).toBe('studio');
    STYLES.forEach((s) => expect(s.label && s.description && s.displayFont).toBeTruthy());
  });

  it('every style has five colours, none twice, each named with a two-colour swatch, and a preview in light and dark', () => {
    STYLES.forEach(({ id }) => {
      const options = ACCENTS[id];
      expect(options).toHaveLength(5);
      expect(new Set(options.map((o) => o.id)).size).toBe(5);
      options.forEach((o) => {
        expect(o.label).toBeTruthy();
        o.swatch.forEach((c) => expect(c).toMatch(/^#[0-9a-f]{6}$/i));
      });
      (['light', 'dark'] as const).forEach((mode) => Object.values(PREVIEWS[id][mode]).forEach((c) => expect(c).toMatch(/^#[0-9a-f]{6}$/i)));
    });
  });

  it('a stored style that is missing or no longer offered falls back to Studio', () => {
    expect(normalizeStyle('calm')).toBe('calm');
    expect(normalizeStyle('neon-noir')).toBe('studio');
    expect(normalizeStyle(null)).toBe('studio');
    expect(readStyle(memoryStore({ [STYLE_KEY]: 'premium' }))).toBe('premium');
    expect(readStyle(null)).toBe('studio');
    const blocked: PrefStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => undefined,
    };
    expect(readStyle(blocked)).toBe('studio');
    expect(readAccent(blocked, 'calm')).toBe('sage');
  });

  it('a colour that is no longer offered falls back to the style’s own', () => {
    expect(normalizeAccent('professional', 'crimson')).toBe('blue');
    expect(normalizeAccent('simple', 'navy')).toBe('navy');
    expect(readAccent(memoryStore({ [accentKey('professional')]: 'crimson' }), 'professional')).toBe('blue');
  });

  it('the arrow keys move through the colours and go round; Home and End jump; other keys do nothing', () => {
    expect(accentAfterKey('simple', 'navy', 'ArrowRight')).toBe('forest');
    expect(accentAfterKey('simple', 'navy', 'ArrowDown')).toBe('forest');
    expect(accentAfterKey('simple', 'mono', 'ArrowLeft')).toBe('wine');
    expect(accentAfterKey('simple', 'wine', 'ArrowRight')).toBe('mono');
    expect(accentAfterKey('simple', 'forest', 'ArrowUp')).toBe('navy');
    expect(accentAfterKey('simple', 'forest', 'Home')).toBe('mono');
    expect(accentAfterKey('simple', 'forest', 'End')).toBe('wine');
    expect(accentAfterKey('simple', 'forest', 'Enter')).toBeNull();
  });

  it('each style keeps its own colour: coming back to a style finds it as it was left', () => {
    const store = memoryStore();
    store.setItem(accentKey('simple'), 'wine');
    store.setItem(accentKey('futuristic'), 'synthwave');
    expect(readAccent(store, 'simple')).toBe('wine');
    expect(readAccent(store, 'futuristic')).toBe('synthwave');
    expect(readAccent(store, 'calm')).toBe('sage');
    expect(store.data).toEqual({ weave_accent_simple: 'wine', weave_accent_futuristic: 'synthwave' });
  });
});
