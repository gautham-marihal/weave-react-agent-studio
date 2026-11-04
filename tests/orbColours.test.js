import test from 'node:test';
import assert from 'node:assert/strict';
import { standOut } from '../src/studio/preview/orbPainter.js';

// The voice orb's threads take the style's colours, made to stand out on the page: every style's orb colours (light
// and dark, the pale ones included) must keep enough contrast against white, and glow on a dark page.
const luminance = (c) => {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const hex = (h) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
// the orb colours of the styles (themes.css, preview.css), the pale ones first
const COLOURS = [
  '#ecd3a5',
  '#f1dcaa',
  '#b9e0cf',
  '#e8b98a',
  '#a5b4fc',
  '#c9a052',
  '#6fae8c',
  '#22c3ee',
  '#3b6cff',
  '#8b5cf6',
  '#f472b6',
  '#18e0ff',
  '#00f5c4',
  '#ff9f43',
  '#2563eb',
];

test('on a light page every orb colour has at least 3:1 contrast against white', () => {
  COLOURS.forEach((c) => {
    const ratio = 1.05 / (luminance(standOut(hex(c), false)) + 0.05);
    assert.ok(ratio >= 3, `${c} → ${ratio.toFixed(2)}:1`);
  });
});

test('on a dark page every orb colour is bright enough to glow, and a dark one is lifted', () => {
  COLOURS.forEach((c) => assert.ok(luminance(standOut(hex(c), true)) >= 0.3, c));
  assert.ok(luminance(standOut(hex('#2563eb'), true)) > luminance(hex('#2563eb')));
});

test('a colour that already stands out is left as it is', () => {
  assert.deepEqual(standOut(hex('#3b2a8f'), false), hex('#3b2a8f'));
  assert.deepEqual(standOut(hex('#a5f3fc'), true), hex('#a5f3fc'));
});
