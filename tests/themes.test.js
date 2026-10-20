import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACCENTS, STYLES } from '../src/studio/usePref.js';
import { sentenceCase } from '../src/ui/text.js';

// The design styles (src/themes.css): every style but Simple defines its colours for light and for dark, the names match what index.html applies before
// the first paint, and every pair of text and background colours a style defines can be read (at least 4.5:1).
const css = readFileSync(new URL('../src/themes.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const block = (style, theme) => {
  const m = css.match(new RegExp(`html\\[data-style="${style}"\\]\\[data-theme="${theme}"\\] body \\{([^}]*)\\}`));
  return m ? Object.fromEntries([...m[1].matchAll(/--([\w-]+):\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()])) : null;
};
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const NEEDED = [
  'page',
  'panel',
  'surface2',
  'line',
  'line2',
  'text',
  'textStrong',
  'muted',
  'dim',
  'ink',
  'on-ink',
  'accent',
  'accent-text',
  'accent-soft',
  'focus',
];

test('the styles are the ones the page applies before it is drawn', () => {
  assert.deepEqual(
    STYLES.map((s) => s.id),
    ['simple', 'professional', 'calm', 'premium', 'futuristic', 'vibrant'],
  );
  const listed = html.match(/\[('simple'[^\]]*)\]\.indexOf/)?.[1];
  assert.ok(listed, 'index.html applies the style before the first paint');
  assert.deepEqual(
    listed.split(',').map((s) => s.trim().replace(/'/g, '')),
    STYLES.map((s) => s.id),
  );
  STYLES.forEach((s) => {
    assert.ok(s.label && s.description, `${s.id} has a name and a line about it`);
  });
});

for (const style of STYLES.filter((s) => s.id !== 'simple').map((s) => s.id)) {
  for (const theme of ['light', 'dark']) {
    test(`${style} in ${theme}: every colour is defined, and text on every surface can be read`, () => {
      const t = block(style, theme);
      assert.ok(t, `a ${theme} block for ${style}`);
      NEEDED.forEach((name) => assert.ok(t[name], `--${name}`));
      const low = [];
      ['text', 'textStrong', 'muted', 'dim', 'accent-text'].forEach((fg) =>
        ['page', 'panel', 'surface2'].forEach((bg) => {
          const ratio = contrast(t[fg], t[bg]);
          if (ratio < 4.5) low.push(`${fg} on ${bg}: ${ratio.toFixed(2)}`);
        }),
      );
      [['accent-text', 'accent-soft'], ['on-ink', 'ink'], ...(t.ink2 && t.ink2.startsWith('#') ? [['on-ink', 'ink2']] : [])].forEach(([fg, bg]) => {
        const ratio = contrast(t[fg], t[bg]);
        if (ratio < 4.5) low.push(`${fg} on ${bg}: ${ratio.toFixed(2)}`);
      });
      assert.deepEqual(low, []);
    });
  }
}

test('labels written in capitals are shown in sentence case, short abbreviations kept', () => {
  assert.equal(sentenceCase('TOTAL CALL DURATION'), 'Total call duration');
  assert.equal(sentenceCase('AVG. LLM TOKENS / SESSION'), 'Avg. LLM tokens / session');
  assert.equal(sentenceCase('SIP URI'), 'SIP URI');
  assert.equal(sentenceCase('AGENT ID'), 'Agent ID');
  assert.equal(sentenceCase('Already written normally'), 'Already written normally');
  assert.equal(sentenceCase(''), '');
});

// ---- colour options (src/accents.css) ------------------------------------------------------------------------------------------------------------
const accentsCss = readFileSync(new URL('../src/accents.css', import.meta.url), 'utf8');
const appLook = readFileSync(new URL('../src/appLook.css', import.meta.url), 'utf8');
const vars = (body) => Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()]));
const accentBlock = (style, accent, theme) => {
  const m = accentsCss.match(new RegExp(`html\\[data-style="${style}"\\]\\[data-accent="${accent}"\\]\\[data-theme="${theme}"\\] body \\{([^}]*)\\}`));
  return m ? vars(m[1]) : null;
};
// the palette a colour option sits on: the style's own (Simple's is the global look in appLook.css)
const basePalette = (style, theme) => {
  if (style !== 'simple') return block(style, theme);
  const m = appLook.match(new RegExp(`html\\[data-theme="${theme}"\\] body \\{([^}]*)\\}`));
  return m ? vars(m[1]) : null;
};
const hexes = (value) => String(value).match(/#[0-9a-fA-F]{6}\b/g) || [];

test('every style has five colour options, the first being its own palette, each named, with a swatch', () => {
  STYLES.forEach((s) => {
    const options = ACCENTS[s.id];
    assert.equal(options?.length, 5, `${s.id} has five`);
    assert.equal(new Set(options.map((o) => o.id)).size, 5, `${s.id}: no option twice`);
    options.forEach((o) => {
      assert.ok(o.label && Array.isArray(o.swatch) && o.swatch.every((c) => /^#[0-9a-f]{6}$/i.test(c)), `${s.id}/${o.id}`);
      if (o === options[0]) assert.equal(accentBlock(s.id, o.id, 'light'), null, `${s.id}/${o.id} is the style's own palette, not a block`);
      else ['light', 'dark'].forEach((theme) => assert.ok(accentBlock(s.id, o.id, theme), `${s.id}/${o.id} has a ${theme} block`));
    });
  });
  assert.match(html, /weave_accent_/, 'index.html applies the colour before the first paint');
});

for (const style of STYLES.map((s) => s.id)) {
  for (const option of ACCENTS[style].slice(1)) {
    for (const theme of ['light', 'dark']) {
      test(`${style} · ${option.label} in ${theme}: its text, buttons and labels can be read`, () => {
        const t = { ...basePalette(style, theme), ...accentBlock(style, option.id, theme) };
        const low = [];
        const check = (fg, bg, what, min = 4.5) => {
          const ratio = contrast(fg, bg);
          if (ratio < min) low.push(`${what}: ${ratio.toFixed(2)}`);
        };
        ['page', 'panel', 'surface2'].forEach((bg) => check(t['accent-text'], t[bg], `accent-text on ${bg}`));
        check(t['accent-text'], t['accent-soft'], 'accent-text on accent-soft');
        check(t['on-ink'], t.ink, 'on-ink on ink');
        if (t.ink2?.startsWith('#')) check(t['on-ink'], t.ink2, 'on-ink on ink2');
        if (t.label?.startsWith('#')) ['page', 'panel'].forEach((bg) => check(t.label, t[bg], `label on ${bg}`));
        // what sits on the style's own coloured parts
        if (style === 'vibrant') hexes(t.candy).forEach((c) => check('#ffffff', c, `white on the candy ${c}`));
        if (style === 'futuristic' && theme === 'dark') [t['btn-mid'], t['btn-end']].forEach((c) => check(t['on-ink'], c, `on-ink on the button's ${c}`));
        if (style === 'futuristic' && theme === 'light') [t['btn-mid'], t['btn-end']].forEach((c) => check('#ffffff', c, `white on the button's ${c}`));
        if (style === 'futuristic') check(t.readout, t.page, 'readout on page');
        if (style === 'premium' && theme === 'light') ['#2b2118', '#16100a'].forEach((c) => check(t['metal-ink'], c, `metal letters on espresso ${c}`));
        if (style === 'premium' && theme === 'dark')
          [t['metal-hi'], t['metal-mid'], t['metal-lo']].forEach((c) => check(t['on-ink'], c, `on-ink on metal ${c}`));
        if (style === 'premium') check(t['metal-text'], '#1c160f', 'metal text in the espresso sidebar');
        if (style === 'premium') check(t['metal-pale'], '#1c160f', 'the open page in the espresso sidebar');
        if (style === 'professional') check('#ffffff', t.bar, 'the bar', 7);
        assert.deepEqual(low, []);
      });
    }
  }
}

// A row a colour option highlights (the open call, the one under the pointer) is its accent-soft, and the words on it include the ones that say how
// something went (Ended, Failed, Slow…). Where a style doesn't set those colours, the app's own apply (styles.css over tokens.css).
const stylesCss = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const tokensCss = readFileSync(new URL('../src/tokens.css', import.meta.url), 'utf8');
const esc = (s) => s.replace(/[[\]{}()]/g, (c) => `\\${c}`);
const blocksOf = (src, selector) => Object.assign({}, ...[...src.matchAll(new RegExp(`${esc(selector)} \\{([^}]*)\\}`, 'g'))].map((m) => vars(m[1])));
const appDefaults = (theme) => ({
  ...(theme === 'dark' ? blocksOf(tokensCss, ':root') : blocksOf(tokensCss, 'html[data-theme="light"]')),
  ...blocksOf(stylesCss, `html[data-theme="${theme}"]`),
});
const resolve = (t, value) => {
  let v = value;
  for (let k = 0; k < 4 && /^var\(--/.test(v || ''); k += 1) v = t[v.match(/var\(--([\w-]+)/)[1]];
  return v;
};

for (const style of STYLES.map((s) => s.id)) {
  for (const theme of ['light', 'dark']) {
    test(`${style} in ${theme}: on a row any of its colour options highlights, the words and the status words can be read`, () => {
      const low = [];
      ACCENTS[style].forEach((option, i) => {
        const t = { ...appDefaults(theme), ...basePalette(style, theme), ...(i ? accentBlock(style, option.id, theme) : {}) };
        const soft = resolve(t, t['accent-soft']);
        assert.match(String(soft), /^#[0-9a-f]{6}$/i, `${option.id}: --accent-soft is a colour`);
        ['text', 'muted', 'good-text', 'warn-text', 'danger-text'].forEach((fg) => {
          const c = resolve(t, t[fg]);
          assert.match(String(c), /^#[0-9a-f]{6}$/i, `${option.id}: --${fg} is a colour`);
          const ratio = contrast(c, soft);
          if (ratio < 4.5) low.push(`${option.id}: ${fg} on accent-soft ${ratio.toFixed(2)}`);
        });
      });
      assert.deepEqual(low, []);
    });
  }
}
