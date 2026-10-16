import test from 'node:test';
import assert from 'node:assert/strict';
import { plainChange, plainChanges } from '../src/studio/compare/plainCompare.js';

// A comparison of two versions in words: the server's list of changes, as sentences a person would use.
const texts = (changes) => plainChanges(changes).groups.flatMap((g) => g.items.map((i) => i.text));

test('the three changes of a real comparison read as sentences, not paths', () => {
  const changes = [
    { op: 'change', path: ['defaults', 'models', 'llm', 'model'], before: 'gpt-4.1-mini', after: 'gpt-5.4' },
    { op: 'remove', path: ['defaults', 'models', 'stt', 'options'], before: {} },
    { op: 'change', path: ['defaults', 'models', 'tts', 'voice_id'], before: 'Z8dg0fyk7p6js7cQ7lgi', after: 'EXAVITQu4vr4xnSDxMaL' },
  ];
  const plain = plainChanges(changes);
  assert.equal(plain.total, 3);
  assert.deepEqual(
    plain.groups.map((g) => g.title),
    ['AI models and voice'],
  );
  assert.deepEqual(texts(changes), [
    'Changed the language model from “GPT-4.1 Mini” to “GPT-5.4”',
    'Took away the extra options of the speech-to-text model',
    'Changed the voice from “a voice from your own account” to “Sarah (ElevenLabs)”',
  ]);
  texts(changes).forEach((t) => assert.ok(!/defaults|\.|voice_id|llm|stt|tts/.test(t.replace(/GPT-4\.1|GPT-5\.4/g, '')), `no code words in: ${t}`));
});

test('the language and the languages it understands', () => {
  assert.deepEqual(texts([{ op: 'change', path: ['defaults', 'language', 'primary'], before: 'en-US', after: 'es-MX' }]), [
    'Changed the main language from “English (United States)” to “Spanish (Mexico)”',
  ]);
  assert.deepEqual(texts([{ op: 'change', path: ['defaults', 'language', 'speaks'], before: ['en'], after: ['en', 'fr'] }]), [
    'Changed the languages it understands from “English” to “English, French”',
  ]);
});

test('items of a list are named by their id, and other settings use the names the form uses', () => {
  const t = texts([
    { op: 'add', path: ['tools', 'id=lookup_order'], after: { id: 'lookup_order', name: 'Look up an order' } },
    { op: 'remove', path: ['agents', 'items', 'id=billing'], before: { id: 'billing' } },
    { op: 'change', path: ['persona', 'tone'], before: 'warm', after: 'formal' },
  ]);
  assert.match(t[0], /Added the tool “Look up an order”/);
  assert.match(t[1], /Removed/);
  assert.match(t[2], /Changed .*from “warm” to “formal”/);
});

test('a long text keeps its full wording for "Show the wording"; a short one does not', () => {
  const long = 'You are a helpful agent. '.repeat(10);
  const withText = plainChange({ op: 'change', path: ['agents', 'items', 'id=main', 'instructions'], before: long, after: `${long}Be kind.` });
  assert.ok(withText.full && withText.full.before === long && withText.full.after.endsWith('Be kind.'));
  assert.equal(plainChange({ op: 'change', path: ['persona', 'tone'], before: 'warm', after: 'formal' }).full, null);
});

test('the server’s own bookkeeping and the studio’s notes are not counted as changes', () => {
  const changes = [
    { op: 'change', path: ['meta', 'version'], before: '1.0.0', after: '1.0.1' },
    { op: 'change', path: ['meta', 'updated_at'], before: 'a', after: 'b' },
    { op: 'change', path: ['builder', 'layout'], before: 1, after: 2 },
    { op: 'change', path: ['persona', 'tone'], before: 'warm', after: 'formal' },
  ];
  assert.equal(plainChanges(changes).total, 1);
  assert.deepEqual(plainChanges([]), { total: 0, groups: [] });
});

test('a rule added to a list of rules is named by what it says, not by its place in the list', () => {
  assert.deepEqual(texts([{ op: 'add', path: ['persona', 'style_rules', 1], after: 'Keep answers short.' }]), ['Added the style rule “Keep answers short.”']);
  assert.deepEqual(texts([{ op: 'remove', path: ['persona', 'shared_rules', 0], before: 'Be kind.' }]), ['Removed the shared rule “Be kind.”']);
  assert.deepEqual(texts([{ op: 'change', path: ['persona', 'style_rules', 0], before: 'Be kind.', after: 'Be brief.' }]), [
    'Changed the style rule from “Be kind.” to “Be brief.”',
  ]);
});
