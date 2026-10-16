import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { $, $$, actions, setupDom, teardownDom, textOf } from './component/dom.js';

// The Provider and Model boxes of the speech, language and voice settings: a list of what the studio knows, and anything else can be typed.
const { mountForm, act } = await setupDom();
const a = actions(act);
after(() => teardownDom());

const config = {
  schema_version: '1.2',
  meta: { id: 'x', name: 'X', version: '0.1.0', status: 'draft' },
  persona: { name: 'X' },
  defaults: {
    models: {
      llm: { provider: 'openai', model: 'gpt-4.1-mini', fallbacks: [{ provider: 'anthropic', model: 'claude-sonnet-5-5' }] },
      stt: { provider: 'deepgram', model: 'nova-3' },
    },
  },
};
const optionsOf = (box) => $$(window.document.getElementById(box.getAttribute('aria-controls')), '[role=option]').map((o) => o.dataset.value);

test('the provider and the model of a model setting are boxes with a list, and the list follows the stage and the provider', async () => {
  const app = await mountForm(config);
  await a.section(app.container, 'defaults.models');
  const providers = $$(app.container, '[role=combobox][aria-label="Provider"]');
  const models = $$(app.container, '[role=combobox][aria-label="Model"]');
  assert.ok(providers.length >= 3, `a provider box for stt, llm and the fallback (${providers.length})`);
  assert.equal(providers.length, models.length);
  const llmProvider = providers.find((el) => el.value === 'openai');
  await act(async () => {
    llmProvider.focus();
    llmProvider.click();
  });
  const names = optionsOf(llmProvider);
  assert.ok(names.includes('openai') && names.includes('anthropic'), `language-model providers (${names})`);
  assert.ok(!names.includes('deepgram'), 'a speech-only provider is not offered for the language model');
  await a.click($(app.container, 'body') || app.container);
  await app.unmount();
});

test('picking from the list sets the value, and anything typed is kept as typed', async () => {
  const app = await mountForm(config);
  await a.section(app.container, 'defaults.models');
  const model = $$(app.container, '[role=combobox][aria-label="Model"]').find((el) => el.value === 'gpt-4.1-mini');
  await act(async () => {
    model.focus();
    model.click();
  });
  const ids = optionsOf(model);
  assert.ok(ids.includes('gpt-4.1') || ids.length > 1, `the OpenAI models are listed (${ids})`);
  const other = ids.find((id) => id !== 'gpt-4.1-mini');
  await act(async () => {
    window.document
      .getElementById(model.getAttribute('aria-controls'))
      .querySelector(`[data-value="${other}"]`)
      .dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });
  assert.equal($$(app.container, '[role=combobox][aria-label="Model"]').find((el) => el.value === other)?.value, other, 'the picked model is in the box');
  const again = $$(app.container, '[role=combobox][aria-label="Model"]').find((el) => el.value === other);
  await a.type(again, 'my-own-model');
  assert.equal(
    $$(app.container, '[role=combobox][aria-label="Model"]').some((el) => el.value === 'my-own-model'),
    true,
    'a value that is not in the list is saved as typed',
  );
  assert.match(textOf(window.document.getElementById(again.getAttribute('aria-controls'))), /saved as typed|Or type any other model id/);
  await app.unmount();
});
