import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { $, setupDom, teardownDom, textOf } from './component/dom.js';

// An agent's state, drawn: one pill with one of six names.
const { mountScreen } = await setupDom();
after(() => teardownDom());
const show = (tab, props = {}) => mountScreen('statepill', {}, { props: { tab, ...props }, ready: '.stPill' });

test('an agent’s state is one pill with one of six names', async () => {
  const app = await show('config', { state: { deployed: { production: '1.0.0' } } });
  assert.equal(textOf($(app.container, '.stPill')), 'Live in Production');
  assert.equal($(app.container, '.stPill').getAttribute('data-state'), 'production');
  await app.unmount();
});
