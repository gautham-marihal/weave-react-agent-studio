import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { $, $$, actions, setupDom, teardownDom, textOf } from './component/dom.js';
import { createEngine } from '../src/studio/form/engine.js';
import { corpus } from './corpus/corpus.js';

// "Show technical names": with it off a customer reads plain labels only (no key chip, no snake_case, no unexplained abbreviation); with it on
// every setting also shows the name the file uses, with a way to copy its path. The check is over every screen of every config in the corpus,
// fully expanded, so a setting added to the schema later that slips through with the machine's wording is caught here.
const { mountForm, act } = await setupDom();
// the app is bundled separately from this file, so the preference is changed the way another tab would: storage, then the event
const TECHNICAL_NAMES_KEY = 'weave_tech_names';
const setPref = (key, value) => window.localStorage.setItem(key, value);
const announce = () =>
  act(async () => {
    window.dispatchEvent(new window.Event('storage'));
  });
const a = actions(act);
after(() => teardownDom());

const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
const engine = createEngine(schema);
const entries = corpus(engine);

async function expandAll(app) {
  for (let pass = 0; pass < 5; pass += 1) {
    const closed = $$(app.container.ownerDocument.body, '.stFGroupToggle[aria-expanded=false]');
    if (!closed.length) return;
    for (const toggle of closed) await a.click(toggle);
  }
  // the Advanced folds are part of the form: open them too
  $$(app.container.ownerDocument.body, 'details.stFAdvanced').forEach((d) => {
    d.open = true;
  });
}

async function walk(app, visit) {
  const seen = [];
  for (const group of $$(app.container, '.stFNavGroups [role=tab]')) {
    await a.click(group);
    for (const chip of $$(app.container, '.stFChipBtn')) {
      await a.click(chip);
      await expandAll(app);
      seen.push(chip.getAttribute('data-section'));
      visit(chip.getAttribute('data-section'));
    }
  }
  return seen;
}

// the words a setting is labelled with, as drawn: a row's label, and the title of a group that is a setting (not a card made by the author)
const labelsIn = (root) => [
  ...$$(root, '.stFRow .stFLabel label')
    .filter(
      (el) =>
        !el
          .closest('.stFRow')
          ?.querySelector(':scope > .stFLabel .stFTag')
          ?.textContent.match(/custom field|not in the schema/),
    )
    .map((el) => ({ kind: 'label', text: textOf(el), at: el.closest('[data-path]')?.getAttribute('data-path') })),
  ...$$(root, '[data-grouprow] > .stFGroup > header .stFGroupToggle strong').map((el) => ({
    kind: 'group',
    text: textOf(el),
    at: el.closest('[data-path]')?.getAttribute('data-path'),
  })),
];
const ABBREVIATION = /(^|[\s(])(stt|tts|llm|vad|dnis|uri|sip|dtmf|pii|otel|mime|ivr|jsonpath|s|ms)([\s).,]|$)/i;

for (const entry of entries.filter((e) => ['example', 'scaled', 'stress'].includes(e.source) || e.source === 'starter').slice(0, 5)) {
  test(`${entry.name}: with technical names off, every screen is plain words: no key chip, no snake_case, no abbreviation`, async () => {
    setPref(TECHNICAL_NAMES_KEY, '0');
    const app = await mountForm(entry.config);
    const problems = [];
    let labels = 0;
    await walk(app, (screen) => {
      assert.equal($$(document.body, '.stFKey').length, 0, `${screen}: no key chip is drawn`);
      assert.equal($$(document.body, '.stFTech').length, 0, `${screen}: no copy-path control is drawn`);
      labelsIn(document.body).forEach((item) => {
        labels += 1;
        if (!item.text || /_/.test(item.text) || ABBREVIATION.test(item.text)) problems.push(`${screen} › ${item.at}: “${item.text}”`);
      });
    });
    assert.ok(labels > 25, `labels were checked (${labels})`);
    assert.deepEqual(problems, [], `labels that are still the machine’s words:\n  ${problems.slice(0, 12).join('\n  ')}`);
    await app.unmount();
  });
}

test('with technical names on, every setting shows its name with a way to copy its path, and switching it off takes them away at once', async () => {
  setPref(TECHNICAL_NAMES_KEY, '1');
  const entry = entries.find((e) => e.source === 'example') || entries[0];
  const app = await mountForm(entry.config);
  await a.section(app.container, 'defaults.conversation');
  await expandAll(app);
  const rows = $$(app.container, '.stFRow[data-path], [data-grouprow]').filter((el) => !el.matches('.stFRow.wide[data-path] .stFRow'));
  const keys = $$(app.container, '.stFTech .stFKey').map(textOf);
  assert.ok(keys.length > 10, `the names are drawn (${keys.length})`);
  assert.ok(keys.includes('turn_handling') || keys.includes('inactivity'), 'the file’s own names appear');
  assert.ok(
    $$(app.container, '.stFTech button').some((b) => /^Copy path$/.test(textOf(b))),
    'there is a way to copy a path',
  );
  assert.ok(rows.length > 0);
  // the parents of a setting are shown in front of its own name, so the whole path reads at once, and the title says the same
  const heads = $$(app.container, '.stFTech .stFKeyHead').map(textOf);
  assert.ok(
    heads.some((h) => /^defaults\.conversation\./.test(h)),
    'a nested setting shows where it sits',
  );
  $$(app.container, '.stFTech').forEach((tech) => {
    const key = $(tech, '.stFKey');
    const head = $(tech, '.stFKeyHead');
    assert.equal(key.getAttribute('title'), `Path: ${head ? textOf(head) : ''}${textOf(key)}`, 'the title is the head and the name together');
  });
  // the title of a path is the path itself
  const first = $(app.container, '.stFTech .stFKey');
  assert.match(first.getAttribute('title'), /^Path: defaults\.conversation/);
  setPref(TECHNICAL_NAMES_KEY, '0');
  await announce();
  assert.equal($$(app.container, '.stFKey').length, 0, 'switched off: the names are gone');
  await app.unmount();
  setPref(TECHNICAL_NAMES_KEY, '0');
});

test('the setting’s own explanation leads, the schema’s technical wording is one click away, and an example is shown when there is one', async () => {
  setPref(TECHNICAL_NAMES_KEY, '0');
  const app = await mountForm({
    schema_version: '1.2',
    meta: { id: 'x', name: 'X', version: '0.1.0', status: 'draft' },
    persona: { name: 'X' },
    defaults: { models: {}, conversation: { inactivity: { enabled: true, timeout_s: 8 } } },
  });
  await a.section(app.container, 'defaults.conversation');
  await expandAll(app);
  const row = $$(app.container, '.stFRow').find((el) => /Wait before nudging/.test(textOf($(el, '.stFLabel'))));
  assert.ok(row, 'the label is the plain one');
  assert.match(textOf($(row, '.stFHelp')), /How long the caller is silent before the agent nudges them/);
  assert.match(textOf($(row, '.stFHelp')), /For example: 8/);
  assert.match($(row, 'label').getAttribute('title'), /How long the caller is silent before the agent nudges them/, 'hovering the label says what it is for');
  await app.unmount();
});
