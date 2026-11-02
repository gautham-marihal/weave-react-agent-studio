import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACCENTS, STYLES, type StyleId } from '../models/styles';

// The design styles (themes.css over index.css): every style has its colours in light and in dark, every colour option
// has a block in both, index.html applies the same styles before the first paint, and every pair of text and
// background the studio puts together can be read (at least 4.5:1), in every style, mode and colour.
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const themes = read('./themes.css');
const index = read('../index.css');
const html = read('../../index.html');

type Tokens = Record<string, string>;
const esc = (s: string) => s.replace(/[[\]{}()"]/g, (c) => `\\${c}`);
const vars = (body: string): Tokens => Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const block = (src: string, selector: string): Tokens | null => {
  const found = [...src.matchAll(new RegExp(`(?:^|\\n)${esc(selector)} \\{([^}]*)\\}`, 'g'))];
  return found.length ? Object.assign({}, ...found.map((m) => vars(m[1]))) : null;
};
const studioBase = (theme: 'light' | 'dark'): Tokens => ({
  ...block(index, ':root'),
  ...(theme === 'dark' ? block(index, '[data-theme="dark"],\n.dark') : {}),
});
const styleBlock = (style: StyleId, theme: string) => block(themes, `html[data-style="${style}"][data-theme="${theme}"]`);
const accentBlock = (style: StyleId, accent: string, theme: string) =>
  block(themes, `html[data-style="${style}"][data-accent="${accent}"][data-theme="${theme}"]`);
// what the page ends up with for a style, a mode and a colour option
const tokens = (style: StyleId, theme: 'light' | 'dark', accent?: string): Tokens => ({
  ...studioBase(theme),
  ...(style === 'studio' ? {} : styleBlock(style, theme)),
  ...(accent ? accentBlock(style, accent, theme) : {}),
});

const rgb = (value: string) => value.split(/\s+/).map(Number);
const lum = (c: number[]) => {
  const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// text-on-background pairs the studio's components use (text-muted on bg-subtle, bg-accent with text-accent-ink…)
const SURFACES = ['canvas', 'surface', 'subtle'];
const PAIRS: [string, string][] = [
  ...['ink', 'ink-soft', 'muted', 'accent', 'success', 'warning', 'danger', 'info'].flatMap((fg) => SURFACES.map((bg) => [fg, bg] as [string, string])),
  ['accent', 'accent-soft'],
  ['accent-strong', 'accent-soft'],
  ['ink', 'accent-soft'],
  ['accent-ink', 'accent'],
  ['primary-ink', 'primary'],
  ['primary-ink', 'primary-strong'],
  ['danger-ink', 'danger'],
  ['success', 'success-soft'],
  ['warning', 'warning-soft'],
  ['danger', 'danger-soft'],
  ['info', 'info-soft'],
];
const NEEDED = ['canvas', 'surface', 'subtle', 'ink', 'ink-soft', 'muted', 'line', 'line-strong', 'primary', 'primary-strong', 'primary-soft', 'primary-ink', 'accent', 'accent-strong', 'accent-soft', 'accent-ink', 'success', 'success-soft', 'warning', 'warning-soft', 'danger', 'danger-soft', 'danger-ink', 'info', 'info-soft'];

const unreadable = (t: Tokens) =>
  PAIRS.map(([fg, bg]) => [fg, bg, contrast(t[fg], t[bg])] as const)
    .filter(([, , ratio]) => ratio < 4.5)
    .map(([fg, bg, ratio]) => `${fg} on ${bg}: ${ratio.toFixed(2)}`);

describe('design styles', () => {
  it('index.html applies the same styles before the first paint, with the colour kept per style', () => {
    const listed = html.match(/\[('studio'[^\]]*)\]\.indexOf/)?.[1] ?? '';
    expect(listed, 'index.html lists the styles').toBeTruthy();
    expect(listed.split(',').map((s) => s.trim().replace(/'/g, ''))).toEqual(STYLES.map((s) => s.id));
    expect(html).toMatch(/weave_accent_/);
    expect(html).toMatch(/prefers-color-scheme: dark/);
  });

  it('Studio stays the default look: it is index.css itself, with no colour block of its own', () => {
    expect(styleBlock('studio', 'light')).toBeNull();
    expect(styleBlock('studio', 'dark')).toBeNull();
    expect(studioBase('light').accent).toBe('114 48 143');
    expect(studioBase('dark').accent).toBe('196 155 237');
  });

  for (const style of STYLES.map((s) => s.id)) {
    for (const theme of ['light', 'dark'] as const) {
      it(`${style} in ${theme}: every colour is defined and every text can be read`, () => {
        if (style !== 'studio') expect(styleBlock(style, theme), `a ${theme} block for ${style}`).not.toBeNull();
        const t = tokens(style, theme);
        NEEDED.forEach((name) => expect(t[name], `--${name}`).toMatch(/^\d+ \d+ \d+$/));
        expect(unreadable(t)).toEqual([]);
      });

      it(`${style} in ${theme}: each of its colour options can be read`, () => {
        const low = ACCENTS[style].slice(1).flatMap((option) => {
          const own = accentBlock(style, option.id, theme);
          if (!own) return [`${option.id}: no block`];
          return unreadable(tokens(style, theme, option.id)).map((p) => `${option.id}: ${p}`);
        });
        expect(low).toEqual([]);
      });
    }
  }

  it('the first colour of each style is its own palette, so it has no block', () => {
    STYLES.forEach((s) => expect(accentBlock(s.id, ACCENTS[s.id][0].id, 'light')).toBeNull());
  });
});
