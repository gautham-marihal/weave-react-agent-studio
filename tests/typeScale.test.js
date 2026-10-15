import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The look is a system, not a pile of numbers: one set of type sizes, defined once in tokens.css, and nothing a person has to read is smaller than 12 px.
// This reads every stylesheet and fails on a font size that is not one of the tokens (or inherited), so a new stylesheet can't quietly bring back a
// ninth size, or a 9 px caption.
const root = new URL('../src/', import.meta.url);
const files = [];
(function walk(dir) {
  readdirSync(dir).forEach((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path); else if (name.endsWith('.css')) files.push(path);
  });
})(root.pathname.replace(/^\/([A-Za-z]:)/, '$1'));

const tokens = readFileSync(files.find((f) => /tokens\.css$/.test(f)), 'utf8');
const sizeTokens = [...tokens.matchAll(/--fs-([a-z0-9]+):\s*([^;]+);/g)].map((m) => ({ name: m[1], value: m[2].trim() }));

test('the type scale is six interface sizes and two display sizes, none below 12 px', () => {
  assert.deepEqual(sizeTokens.map((t) => t.name), ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'display']);
  const px = sizeTokens.slice(0, 7).map((t) => Number(t.value.replace('px', '')));
  assert.deepEqual(px.slice(0, 6), [12, 13, 14, 16, 20, 28]);
  px.forEach((n) => assert.ok(n >= 12, `${n}px is readable`));
  assert.match(sizeTokens.at(-1).value, /^clamp\(/, 'the display size scales with the window');
});

test('every font size in every stylesheet is one of the tokens', () => {
  const known = new Set(sizeTokens.map((t) => `var(--fs-${t.name})`));
  const bad = [];
  let count = 0;
  files.filter((f) => !/tokens\.css$/.test(f)).forEach((file) => {
    const css = readFileSync(file, 'utf8');
    for (const m of css.matchAll(/font-size:\s*([^;}]+)/g)) {
      count += 1;
      const value = m[1].replace(/\s*!important/, '').trim();
      if (!known.has(value) && value !== 'inherit') bad.push(`${file.split(/[\\/]src[\\/]/)[1]}: font-size: ${value}`);
    }
    for (const m of css.matchAll(/font:\s*([^;}]+)/g)) {
      const size = m[1].match(/(?:^|\s)((?:var\(--fs-[a-z0-9]+\))|(?:[\d.]+(?:px|rem|em)))/);
      count += 1;
      if (size && !known.has(size[1])) bad.push(`${file.split(/[\\/]src[\\/]/)[1]}: font: ${m[1].slice(0, 40)}`);
    }
  });
  assert.ok(count > 800, `a lot of declarations were checked (${count})`);
  assert.deepEqual(bad.slice(0, 20), [], `${bad.length} font sizes are not tokens`);
});

test('density is a token too: compact tightens the spacing the tokens name, and comfortable is the default', () => {
  assert.match(tokens, /--row-gap:14px/);
  assert.match(tokens, /html\[data-density="compact"\]\{[^}]*--row-gap:8px/);
});
