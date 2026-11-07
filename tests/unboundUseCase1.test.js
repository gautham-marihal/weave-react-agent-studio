// Tetherfi Unbound use case 1 (demos/unbound/use-case-1): its config keeps no wording, times or plan lists typed into
// its lines, and the photo and video checks, written twice (the first try and the retry), never drift apart.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => JSON.parse(readFileSync(new URL(`../demos/unbound/use-case-1/${name}.config.json`, import.meta.url), 'utf8'));
const onboarding = read('onboarding');
const desk = read('case-desk');
const steps = onboarding.forms.find((f) => f.id === 'application').on_submit;
// a step as it is, without its condition (the retry's says "on the second try")
const same = ({ when, ...rest }) => rest;

test('the photo check and its retry ask for the same picture and read it the same way', () => {
  const asks = steps.filter((s) => s.type === 'request_image' && s.into === 'id_photo');
  const reads = steps.filter((s) => s.type === 'analyze_image' && s.images[0] === 'id_photo');
  assert.equal(asks.length, 2);
  assert.equal(reads.length, 2);
  assert.deepEqual(same(asks[1]), same(asks[0]));
  assert.deepEqual(same(reads[1]), same(reads[0]));
});

test('the video check and its retry read the frame the same way', () => {
  const reads = steps.filter((s) => s.type === 'analyze_image' && s.images[0] === 'video_frame');
  assert.equal(reads.length, 2);
  assert.deepEqual(same(reads[1]), same(reads[0]));
});

test('names, times and the plan list live in one place: the constants and the offers service', () => {
  for (const [name, config] of [
    ['onboarding', onboarding],
    ['case desk', desk],
  ]) {
    const lines = JSON.stringify({ ...config, constants: undefined, persona: undefined, meta: undefined });
    for (const word of ['Unbound Bank', 'Aria', 'working day', 'Private Wealth', 'Laddered'])
      assert.equal(lines.includes(word), false, `${name}: “${word}” typed in`);
    // and each constant is used: one nothing says would be a value that drives nothing
    for (const key of Object.keys(config.constants)) assert.ok(lines.includes(`const.${key}`), `${name}: “${key}” is used`);
  }
  assert.deepEqual(Object.keys(onboarding.constants).sort(), ['agent_name', 'bank_name', 'card_delivery', 'rm_call_window']);
  assert.deepEqual(Object.keys(desk.constants).sort(), ['bank_name', 'card_delivery', 'rm_call_window']);
  assert.equal(JSON.stringify(steps).includes('"bank card"'), false, 'a bank card is a yes/no the model answers, not a matched phrase');
});
