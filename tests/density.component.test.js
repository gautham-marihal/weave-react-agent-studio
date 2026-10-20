import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { $$, actions, setupDom, teardownDom } from './component/dom.js';
import { createEngine } from '../src/studio/form/engine.js';
import { corpus } from './corpus/corpus.js';

// How much is on a screen when it is first opened. The brief: a screen should not show everything at once, and nothing should show more than
// about 40 inputs before the person opens something. This counts the controls a screen draws as it opens (groups as they open on their own,
// the Advanced fold shut) for every screen of every config in the corpus, the biggest included.
const { mountForm, mountScreen, act } = await setupDom();
const a = actions(act);
after(() => teardownDom());

const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
const engine = createEngine(schema);
const entries = corpus(engine);
const LIMIT = 40;

const visibleControls = (root) =>
  $$(root, '.stFSection input, .stFSection select, .stFSection textarea, .stFSection [role=combobox], .stFSection [role=switch]').filter(
    (el) => !el.closest('details:not([open])') && el.type !== 'hidden' && el.type !== 'radio',
  ).length;

// a chain of tasks like a real multi-step flow (the review's card-activation bot has one): 3 tasks of 4 steps each
const chain = JSON.parse(JSON.stringify(entries.find((e) => e.source === 'example').config));
chain.tasks = ['verify_card', 'set_pin', 'activate'].map((id) => ({
  ...JSON.parse(JSON.stringify(chain.tasks[0])),
  id,
  steps: ['a', 'b', 'c', 'd'].map((x) => ({
    id: `${id}_${x}`,
    ask: `Ask for ${x}.`,
    skip_if: { state: 'customer', not_equals: null },
    validate: { type: 'tool', tool: 'lookup_account' },
    max_attempts: 3,
  })),
}));
const measured = [...entries, { source: 'chain', name: 'a chain of 3 tasks with 4 steps each', config: chain }];

// `dir` entries are real bots a customer brought (CONFORMANCE_DIR): the budget is for them too
for (const entry of measured.filter((e) => ['example', 'scaled', 'stress', 'dir', 'chain'].includes(e.source))) {
  test(`${entry.name}: no screen of “All settings” opens with more than ${LIMIT} inputs`, async () => {
    const app = await mountForm(entry.config);
    const counts = [];
    for (const group of $$(app.container, '.stFNavGroups [role=tab]')) {
      await a.click(group);
      for (const chip of $$(app.container, '.stFChipBtn')) {
        await a.click(chip);
        counts.push([chip.getAttribute('data-section'), visibleControls(app.container)]);
      }
    }
    const over = counts.filter(([, n]) => n > LIMIT);
    assert.deepEqual(over, [], `screens that open with too many inputs (limit ${LIMIT}); all: ${counts.map(([id, n]) => `${id}=${n}`).join(' ')}`);
    await app.unmount();
  });
}

// ---- the other acceptance measures that can be counted on screen
test('every card of the Simple view opens with at most 20 inputs, on the biggest sample agents', async () => {
  const biggest = entries.filter((e) => ['example', 'scaled', 'stress'].includes(e.source));
  for (const entry of biggest) {
    const app = await mountScreen('simple', entry.config, { ready: '.smView' });
    const counts = [];
    for (const head of $$(app.container, '.smHead')) {
      await a.click(head);
      const card = head.closest('.smCard');
      const n = $$(card, '.smBody input, .smBody select, .smBody textarea, .smBody [role=combobox], .smBody [role=switch]').filter(
        (el) => el.type !== 'hidden' && el.type !== 'radio' && el.type !== 'checkbox',
      ).length;
      counts.push([card.getAttribute('data-card'), n]);
      await a.click(head);
    }
    assert.deepEqual(
      counts.filter(([, n]) => n > 20),
      [],
      `${entry.name}: cards over 20 inputs; all: ${counts.map(([id, n]) => `${id}=${n}`).join(' ')}`,
    );
    await app.unmount();
  }
});

test('no native drop-down on any screen has more than 8 choices: a longer list is searchable', async () => {
  const big = entries.filter((e) => ['example', 'stress'].includes(e.source));
  const over = [];
  for (const entry of big) {
    const app = await mountForm(entry.config);
    for (const group of $$(app.container, '.stFNavGroups [role=tab]')) {
      await a.click(group);
      for (const chip of $$(app.container, '.stFChipBtn')) {
        await a.click(chip);
        for (let pass = 0; pass < 4; pass += 1) {
          const closed = $$(document.body, '.stFGroupToggle[aria-expanded=false]');
          if (!closed.length) break;
          for (const t of closed) await a.click(t);
        }
        $$(document.body, 'select').forEach((sel) => {
          const choices = [...sel.options].filter((o) => o.value !== '').length;
          if (choices > 8) over.push(`${entry.name} › ${chip.getAttribute('data-section')}: ${sel.getAttribute('aria-label') || sel.className} (${choices})`);
        });
      }
    }
    await app.unmount();
  }
  assert.deepEqual(over, [], 'native selects with more than 8 options');
});

test('a chain of tasks does not open its steps one after another: its screen stays well under the limit', async () => {
  const chainEntry = measured.find((e) => e.source === 'chain');
  const app = await mountForm(chainEntry.config);
  for (const group of $$(app.container, '.stFNavGroups [role=tab]')) {
    await a.click(group);
    const chip = $$(app.container, '.stFChipBtn').find((c) => c.getAttribute('data-section') === 'tasks');
    if (!chip) continue;
    await a.click(chip);
    const open = visibleControls(app.container);
    assert.ok(open <= 20, `the Tasks screen opens with ${open} inputs (3 tasks of 4 steps)`);
  }
  await app.unmount();
});
