import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Text meant to fit on one line and end in "…" (white-space: nowrap) must stay on one line. The "text-wrap" shorthand sets wrapping back on as
// well as how lines break, so a rule such as `small { text-wrap: pretty }` quietly undid every one-line text it reached: a Workflow block's words
// ran out of the block. The longhands (text-wrap-style for nicer breaks, text-wrap-mode for wrapping) say only what they mean. This reads every
// stylesheet and fails on the shorthand. e2e/fit.mjs checks the same in a real browser, on every page.
const root = new URL('../src/', import.meta.url);
const files = [];
(function walk(dir) {
  readdirSync(dir).forEach((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith('.css')) files.push(path);
  });
})(root.pathname.replace(/^\/([A-Za-z]:)/, '$1'));

test('no stylesheet uses the text-wrap shorthand (use text-wrap-style or text-wrap-mode)', () => {
  assert.ok(files.length > 10, 'the stylesheets were found');
  const found = [];
  files.forEach((file) => {
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    css.split('\n').forEach((line, i) => {
      if (/(^|[^-\w])text-wrap\s*:/.test(line)) found.push(`${file.split(/[\\/]src[\\/]/)[1]}:${i + 1}: ${line.trim()}`);
    });
  });
  assert.deepEqual(found, []);
});
