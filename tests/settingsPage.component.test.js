import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { $$, actions, setupDom, teardownDom, textOf } from './component/dom.js';
import { applyStarter } from '../src/studio/starters.ts';
import { minimalConfig } from '../src/demo/demoApi.js';

// The Settings page of an agent asks for what only it has: what the Agent page and the Tests page already ask is not asked again.
const { mountScreen, act } = await setupDom();
const a = actions(act);
after(() => teardownDom());

const agent = () => applyStarter(minimalConfig('acme', 'Acme'), 'support');
const until = async (app, check, tries = 100) => {
  for (let i = 0; i < tries && !check(); i += 1) await app.wait(60);
  return check();
};
const fieldLabels = (root) =>
  $$(root, 'label, legend, .stFLabel, .stFFieldLabel')
    .map((el) =>
      textOf(el)
        .replace(/\*|Delete|set by the server/g, '')
        .trim(),
    )
    .filter(Boolean);

test('Settings has no screen for the test scenarios, and its screens are the ones only it has', async () => {
  const app = await mountScreen('settingsform', agent(), { ready: '.stForm' });
  await until(app, () => $$(app.container, '[data-section]').length > 0);
  const screens = $$(app.container, '[data-section]').map((el) => el.getAttribute('data-section'));
  assert.ok(!screens.includes('tests'), 'the test scenarios are on the Tests page');
  assert.ok(screens.includes('meta') && screens.includes('runtime'));
  await app.unmount();
});

test('Settings does not ask for the name again, since the Agent page does', async () => {
  const app = await mountScreen('settingsform', agent(), { ready: '.stForm' });
  await a.section(app.container, 'meta');
  await until(app, () => fieldLabels(app.container).length > 0);
  const labels = fieldLabels(app.container).map((l) => l.toLowerCase());
  assert.ok(
    labels.some((l) => l.startsWith('description')),
    'the description is still here',
  );
  assert.ok(!labels.some((l) => l === 'name'), `no “Name” field, got: ${labels.join(' | ')}`);
  await app.unmount();
});

test('Settings has no Language screen at all, and does not ask for each model’s provider and model, since the Agent page does', async () => {
  const app = await mountScreen('settingsform', agent(), { ready: '.stForm' });
  await until(app, () => $$(app.container, '[data-section]').length > 0);
  assert.ok(!$$(app.container, '[data-section]').some((el) => el.getAttribute('data-section') === 'defaults.language'), 'no Language screen');
  await a.section(app.container, 'defaults.models');
  await until(app, () => fieldLabels(app.container).length > 0);
  const models = fieldLabels(app.container).join(' | ').toLowerCase();
  assert.ok(/access key/.test(models), 'the key of the model is still here');
  assert.ok(!/(^| \| )(provider|model|voice)( \||$)/.test(models), `neither provider, model nor voice: ${models}`);
  await app.unmount();
});
