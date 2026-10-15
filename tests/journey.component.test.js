import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { $, $$, actions, byText, setupDom, teardownDom, textOf } from './component/dom.js';

// The journey, drawn: the tabs in their four stages, the stage you are in marked, every tab one click away, and a "Next" that walks the whole path.
const { mountScreen, act } = await setupDom();
const a = actions(act);
after(() => teardownDom());
const show = (tab, props = {}) => mountScreen('journey', {}, { props: { tab, ...props }, ready: '.stJourney' });

test('the tabs are in four stages, each naming its question, and every old tab is still a button', async () => {
  const app = await show('config');
  const stages = $$(app.container, '.stStage');
  assert.deepEqual(stages.map((s) => s.getAttribute('data-stage')), ['build', 'test', 'release', 'monitor']);
  assert.deepEqual($$(app.container, '.stStageTabs button').map(textOf), ['Config', 'Knowledge', 'Test', 'Scenarios', 'Checks', 'Versions', 'Deploy', 'Calls']);
  assert.match(stages[0].getAttribute('aria-label'), /^Build: What is it, and what can it do\?$/);
  assert.equal($$(app.container, '.stStage.current').length, 1);
  assert.equal($(app.container, '.stStage.current').getAttribute('data-stage'), 'build');
  assert.equal($(app.container, '.stStageTabs button[aria-current=page]').textContent, 'Config');
  await app.unmount();
});

test('the stage of the open tab is the one marked, and a running test conversation shows a dot on Test', async () => {
  const app = await show('deploy', { live: true });
  assert.equal($(app.container, '.stStage.current').getAttribute('data-stage'), 'release');
  assert.ok($(byText(app.container, '.stStageTabs button', 'Test'), '.stTLiveDot'));
  await app.unmount();
});

test('pressing a tab goes to it, and "Next" walks from Build to Monitor and then stops', async () => {
  window.location.hash = '#/bots/acme';
  const app = await show('config');
  await a.click(byText(app.container, '.stStageTabs button', 'Deploy'));
  assert.equal(window.location.hash, '#/bots/acme/deploy');
  const walked = [];
  let tab = 'config';
  for (let i = 0; i < 9; i += 1) {
    await app.unmount();
    const here = await show(tab);
    walked.push(tab);
    const next = $(here.container, '.stNext .primaryCta');
    if (!next) { assert.match(textOf($(here.container, '.stNext')), /That is the whole path/); await here.unmount(); break; }
    await a.click(next);
    tab = window.location.hash.split('/').pop();
    await here.unmount();
  }
  assert.deepEqual(walked, ['config', 'test', 'scenarios', 'checks', 'versions', 'deploy', 'calls']);
});

test('an agent’s state is one pill with one of six names', async () => {
  const app = await show('config', { state: { deployed: { production: '1.0.0' } } });
  assert.equal(textOf($(app.container, '.stPill')), 'Live in Production');
  assert.equal($(app.container, '.stPill').getAttribute('data-state'), 'production');
  await app.unmount();
});
