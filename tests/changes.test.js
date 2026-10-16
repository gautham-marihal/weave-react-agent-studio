import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changesSince, revertSection } from '../src/studio/changes/sinceRelease.js';

const published = { meta: { id: 'a', name: 'A', version: '0.1.0', status: 'published' }, persona: { tone: 'warm' }, tools: { items: [{ id: 'end_call', description: 'Ends it' }] }, builder: { ui: { graph_positions: { x: 1 } } } };
const copy = (value) => JSON.parse(JSON.stringify(value));

test('no changes: nothing to review', () => {
  const r = changesSince(published, copy(published));
  assert.equal(r.total, 0); assert.deepEqual(r.groups, []);
});

test('server bookkeeping and the studio notes are not changes', () => {
  const draft = copy(published);
  draft.meta.version = '0.1.1'; draft.meta.status = 'draft'; draft.builder.ui.graph_positions.x = 99;
  assert.equal(changesSince(published, draft).total, 0);
});

test('changes are grouped by part, with plain wording', () => {
  const draft = copy(published);
  draft.persona.tone = 'brisk'; draft.meta.name = 'B';
  const r = changesSince(published, draft);
  assert.equal(r.total, 2);
  assert.deepEqual(r.groups.map((g) => g.key).sort(), ['meta', 'persona']);
  assert.ok(r.groups.every((g) => g.items.every((i) => i.text && i.verb)));
});

test('putting a part back restores it and leaves the rest alone', () => {
  const draft = copy(published);
  draft.persona.tone = 'brisk'; draft.meta.name = 'B';
  const next = revertSection(draft, published, 'persona');
  assert.equal(next.persona.tone, 'warm'); assert.equal(next.meta.name, 'B');
  assert.equal(draft.persona.tone, 'brisk', 'the draft itself is not mutated');
});

test('a part that was not published is removed when put back', () => {
  const draft = { ...copy(published), guardrails: { items: [] } };
  const next = revertSection(draft, published, 'guardrails');
  assert.equal('guardrails' in next, false);
});

test('a missing published version yields no changes', () => {
  assert.equal(changesSince(null, published).total, 0);
});
