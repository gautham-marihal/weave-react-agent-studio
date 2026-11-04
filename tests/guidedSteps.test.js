import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStarter } from '../src/studio/starters.ts';
import { minimalConfig } from '../src/demo/demoApi.js';
import { GUIDED_IDS, guidedSteps } from '../src/studio/agent/workspace/guidedSteps.js';
import { setPrimaryLanguage, setRole } from '../src/studio/simple/simpleModel.js';
import { setTopics } from '../src/studio/agent/blocks/guardrailModel.js';

// Build's Guided view: what each of the nine steps says about the draft, and what is left to do.
const agent = () => applyStarter(minimalConfig('acme', 'Acme'), 'support');

test('nine steps in build order, ending with trying it', () => {
  assert.deepEqual(GUIDED_IDS, ['who', 'voice', 'knowledge', 'tools', 'channels', 'workflow', 'guardrails', 'aftercall', 'ready']);
  const { steps } = guidedSteps(agent());
  assert.equal(steps.at(-1).state, 'end');
});

test('a step is to do only for what an agent needs; the optional ones say so', () => {
  const config = agent();
  if (config.defaults?.language) delete config.defaults.language.primary;
  const { steps, todo, next } = guidedSteps(config);
  const of = (id) => steps.find((s) => s.id === id);
  assert.equal(of('knowledge').state, 'optional');
  assert.match(of('knowledge').answer, /optional/);
  assert.equal(of('guardrails').answer, 'Nothing set · optional');
  assert.equal(of('voice').state, 'todo', 'no main language yet');
  assert.equal(of('voice').todo, 'Choose its main language');
  assert.equal(next.id, todo[0].id);
});

test('instructions too short to work from make the first step a task', () => {
  const { steps } = guidedSteps(setRole(agent(), 'Help.'));
  assert.equal(steps[0].state, 'todo');
  assert.match(steps[0].todo, /what it should do/);
});

test('answers follow the draft', () => {
  const config = setTopics(setPrimaryLanguage(agent(), 'en-GB'), 'allowed', ['orders', 'returns']);
  const { steps } = guidedSteps(config);
  assert.equal(steps.find((s) => s.id === 'guardrails').answer, 'Keeps to 2 topics');
  assert.match(steps.find((s) => s.id === 'voice').answer, /^English \(United Kingdom\)/);
});

test('no draft: every step waits, nothing breaks', () => {
  const { steps, done } = guidedSteps(null);
  assert.equal(steps.length, 9);
  assert.equal(done, 0);
});
