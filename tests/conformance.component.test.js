import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { $$, actions, setupDom, teardownDom, textOf } from './component/dom.js';
import { createEngine } from '../src/studio/form/engine.js';
import { corpus } from './corpus/corpus.js';

// Conformance, drawn: every section of every config in the corpus is opened with everything expanded, with NO server report, so any red mark
// on screen comes from the studio's own checks. On a config the server calls valid, every such mark is a false alarm (the review found 117 of
// 138 paths and dozens of "required" tags wrong this way). The test fails on the first, and says which field. Nothing about the config may
// change by looking at it, and nothing may log an error. See corpus/corpus.js and conformance.test.js.
const { mountForm, act } = await setupDom();
const a = actions(act);
after(() => teardownDom());

const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
const engine = createEngine(schema);
const entries = corpus(engine);

// what the form paints red: an error message, a "required, not set" or "not in the schema" tag, an invalid input, an error badge or dot
const RED = '.stFErr, .stFTag.bad, [aria-invalid="true"], .stFDot.err, .stFBadge:not(.warn), .stFRow.missing';
const describeMark = (el) => {
  const row = el.closest('[data-path]');
  return `${el.className || el.tagName} at ${row?.getAttribute('data-path') || '?'}: “${textOf(el).slice(0, 90) || el.getAttribute('aria-label') || ''}”`;
};

async function expandAll(app) {
  for (let pass = 0; pass < 5; pass += 1) {
    const closed = $$(app.container, '.stFGroupToggle[aria-expanded=false]');
    if (!closed.length) return;
    for (const toggle of closed) await a.click(toggle);
  }
}

async function walk(app, visit) {
  const seen = [];
  for (const group of $$(app.container, '.stFNavGroups [role=tab]')) {
    await a.click(group);
    for (const chip of $$(app.container, '.stFChipBtn')) {
      await a.click(chip);
      await expandAll(app);
      const name = chip.getAttribute('data-section');
      seen.push(name);
      visit(name);
    }
  }
  return seen;
}

for (const entry of entries) {
  test(`${entry.name}: every section draws, nothing changes, nothing logs an error${entry.valid ? ', and not one red mark is drawn' : ''}`, async () => {
    const errors = [];
    const original = console.error;
    console.error = (...args) => {
      errors.push(args.map(String).join(' ').slice(0, 300));
    };
    try {
      const app = await mountForm(entry.config);
      const marks = [];
      const seen = await walk(app, (name) => {
        if (entry.valid) $$(app.container, RED).forEach((el) => marks.push(`${name} › ${describeMark(el)}`));
      });
      assert.ok(seen.length >= 20, `the sections were walked (${seen.length})`);
      assert.deepEqual(marks, [], `a red mark on a config the server calls valid is a false alarm:\n  ${marks.slice(0, 8).join('\n  ')}`);
      assert.deepEqual(app.config, entry.config, 'looking at everything changed nothing');
      await app.unmount();
    } finally {
      console.error = original;
    }
    assert.deepEqual(errors, [], 'nothing was logged as an error (a React warning is one)');
  });
}

test('findability: every section of the schema can be reached from the form, so a layout can change without losing a setting', async () => {
  const app = await mountForm(entries.find((e) => e.source === 'starter').config);
  const reachable = await walk(app, () => {});
  const skipped = new Set(['$schema', 'schema_version']);
  const wanted = Object.keys(schema.properties).filter((key) => !skipped.has(key));
  const missing = wanted.filter((key) => !reachable.some((id) => id === key || id.startsWith(`${key}.`)));
  assert.deepEqual(missing, [], 'every top-level section has a screen in some group');
  await app.unmount();
});
