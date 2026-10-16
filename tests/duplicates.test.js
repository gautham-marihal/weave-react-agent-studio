import test from 'node:test';
import assert from 'node:assert/strict';
import { describeDuplicates, findDuplicateKeys, parseJsonStrict } from '../src/studio/jsonDuplicates.js';

const line = (text) => (offset) => text.slice(0, offset).split('\n').length;

test('valid JSON with no repeats finds nothing, however it is nested', () => {
  const text = JSON.stringify({ a: 1, b: { a: 2, c: [{ a: 3 }, { a: 4 }] }, d: [1, 2, { x: null, y: true }] }, null, 2);
  assert.deepEqual(findDuplicateKeys(text), []);
  assert.deepEqual(findDuplicateKeys('{}'), []);
  assert.deepEqual(findDuplicateKeys('[]'), []);
  assert.deepEqual(findDuplicateKeys('  42  '), []);
});

test('a repeated key is found with the path of its object, its key and both positions', () => {
  const text = '{\n  "meta": {\n    "id": "a",\n    "name": "x",\n    "id": "b"\n  }\n}';
  const [dup, ...rest] = findDuplicateKeys(text);
  assert.equal(rest.length, 0);
  assert.deepEqual(dup.path, ['meta']);
  assert.equal(dup.key, 'id');
  assert.equal(line(text)(dup.firstOffset), 3);
  assert.equal(line(text)(dup.offset), 5);
  assert.equal(text.slice(dup.offset, dup.offset + 4), '"id"');
});

test('the path goes through arrays as indexes, and the same key in different objects is fine', () => {
  const text = '{"agents":{"items":[{"id":"a"},{"id":"b","id":"c"}]},"id":1}';
  const found = findDuplicateKeys(text);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].path, ['agents', 'items', 1]);
  assert.equal(found[0].key, 'id');
});

test('several repeats are all reported, in the order they appear', () => {
  const found = findDuplicateKeys('{"a":1,"a":2,"b":{"c":1,"c":2},"a":3}');
  assert.deepEqual(
    found.map((f) => [f.path.join('.'), f.key]),
    [
      ['', 'a'],
      ['b', 'c'],
      ['', 'a'],
    ],
  );
});

test('keys that look equal only after unescaping are equal, and a lookalike inside a string is not a key', () => {
  assert.equal(findDuplicateKeys('{"a\\u0062":1,"ab":2}').length, 1); // "ab" is "ab"
  assert.equal(findDuplicateKeys('{"a\\"b":1,"a\\"b":2}').length, 1); // an escaped quote inside the key
  assert.deepEqual(findDuplicateKeys('{"a":"\\"b\\":1,\\"b\\":2","b":3}'), []); // text that merely contains key-like pieces
  assert.deepEqual(findDuplicateKeys('{"a":"x,\\"a\\":1"}'), []);
});

test('text that is not valid JSON gives what was found before the problem, and never throws', () => {
  assert.equal(findDuplicateKeys('{"a":1,"a":2,').length, 1);
  assert.deepEqual(findDuplicateKeys('{not json'), []);
  assert.deepEqual(findDuplicateKeys(''), []);
  assert.doesNotThrow(() => findDuplicateKeys('{"a":'));
  assert.doesNotThrow(() => findDuplicateKeys('[[[{"a"'));
});

test('JSON.parse would have kept only the last value: this is the loss being caught', () => {
  const text = '{"timeout": 5, "timeout": 30}';
  assert.equal(JSON.parse(text).timeout, 30); // the 5 is gone without a word
  assert.equal(findDuplicateKeys(text).length, 1);
  assert.throws(() => parseJsonStrict(text), /“timeout” appears twice in the top level/);
  assert.deepEqual(parseJsonStrict('{"timeout": 5}'), { timeout: 5 });
  assert.throws(() => parseJsonStrict('{nope'), SyntaxError);
});

test('the sentence names the key, the object, both lines and how many more', () => {
  const text = '{\n"a": {\n  "x": 1,\n  "x": 2\n},\n"b": 1,\n"b": 2\n}';
  const message = describeDuplicates(findDuplicateKeys(text), line(text));
  assert.match(message, /“x” appears twice in a, on lines 3 and 4 \(and 1 more\)/);
  assert.match(message, /nothing is saved, validated or published/);
  const nested = '{"agents":{"items":[{"id":1,"id":2}]}}';
  assert.match(describeDuplicates(findDuplicateKeys(nested), line(nested)), /in agents\.items\[0\]/);
});

test('large documents are scanned quickly', () => {
  const big = JSON.stringify({ items: Array.from({ length: 20000 }, (_, i) => ({ id: `i${i}`, text: 'hello "world"', n: i })) });
  const started = Date.now();
  assert.deepEqual(findDuplicateKeys(big), []);
  assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`);
});
