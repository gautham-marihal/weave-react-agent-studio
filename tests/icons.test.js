import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ICONS, ICON_NAMES } from '../src/ui/icons.js';

// One icon set (Lucide's, by the studio's own names). Every name draws something, the ones the studio's navigation and journey need all exist, and
// every name a page asks for is in the set (one that is not would quietly show the "info" icon instead).
test('every icon draws an outline on the 24 by 24 grid in the colour of the text around it', () => {
  assert.ok(ICON_NAMES.length >= 20);
  ICON_NAMES.forEach((name) => {
    const svg = renderToStaticMarkup(createElement(ICONS[name], { size: 18, strokeWidth: 1.75 }));
    assert.match(svg, /^<svg[^>]* width="18" height="18" viewBox="0 0 24 24"/, name);
    assert.match(svg, /stroke="currentColor"/, name);
    assert.match(svg, /stroke-width="1.75"/, name);
    assert.match(svg, /<(path|circle|rect|line|polyline|polygon|ellipse)\b/, `${name} draws something`);
  });
});

test('the icons the navigation, the journey and the cards use all exist', () => {
  [
    'home',
    'agent',
    'phone',
    'voice',
    'plug',
    'dial',
    'sliders',
    'search',
    'help',
    'build',
    'test',
    'release',
    'monitor',
    'check',
    'alert',
    'info',
    'close',
    'chevronDown',
    'chevronRight',
    'arrowRight',
    'menu',
    'records',
    'pencil',
    'tools',
    'sound',
    'globe',
    'team',
  ].forEach((name) => assert.ok(ICON_NAMES.includes(name), name));
});

test('every icon a page asks for by name is in the set', () => {
  const files = [];
  (function walk(dir) {
    readdirSync(dir).forEach((f) => {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(jsx?|tsx?)$/.test(f)) files.push(p);
    });
  })(fileURLToPath(new URL('../src', import.meta.url)));
  const asked = new Map();
  const ask = (name, file) => asked.set(name, file);
  files.forEach((file) => {
    const text = readFileSync(file, 'utf8');
    // <Icon name="x" />, or name={… ? 'x' : 'y'} (the names it can be, not what is compared to choose one)
    for (const m of text.matchAll(/<Icon\b[^>]*?\bname=(?:"([a-zA-Z]+)"|\{([^}]*)\})/g)) {
      if (m[1]) ask(m[1], file);
      else for (const q of m[2].matchAll(/[?:]\s*['"]([a-zA-Z]+)['"]/g)) ask(q[1], file);
    }
    // icon: 'x', icon="x", emptyIcon="x"
    for (const m of text.matchAll(/\b(?:icon|emptyIcon)\s*[:=]\s*['"]([a-zA-Z]+)['"]/g)) ask(m[1], file);
  });
  assert.ok(asked.size > 40, `found the names pages ask for (${asked.size})`);
  assert.deepEqual(
    [...asked].filter(([name]) => !ICON_NAMES.includes(name)).map(([name, file]) => `${name} (${file})`),
    [],
  );
});
