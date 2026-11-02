import { describe, expect, it } from 'vitest';
import { parseJsonStrict, readFreeValue, repeatedKey, showFreeValue } from './freeValue';

// Ported from Weave React's freeValue.component test: typed JSON is applied as a value, except JSON with a key written
// twice, which is held back with the reason. An object that merely has a key called "repeated" is an ordinary value.
describe('free value box', () => {
  it('JSON is applied as a value', () => {
    expect(readFreeValue('{"limit": 5}')).toEqual({ value: { limit: 5 } });
    expect(readFreeValue('42')).toEqual({ value: 42 });
    expect(readFreeValue('true')).toEqual({ value: true });
    expect(readFreeValue('hello there')).toEqual({ value: 'hello there' });
    expect(readFreeValue('{not json')).toEqual({ value: '{not json' });
  });

  it('a key written twice is not applied, and the reason is said', () => {
    const read = readFreeValue('{"limit": 5, "limit": 9}');
    expect('problem' in read && read.problem).toMatch(/“limit” appears twice/);
    expect(() => parseJsonStrict('{"a": {"b": 1, "b": 2}}')).toThrow(/appears twice/);
    expect(repeatedKey('[{"a": 1}, {"a": 2}]')).toBe(null);
    expect(repeatedKey('{"a": "x\\"a\\":", "b": 1}')).toBe(null);
  });

  it('an object with a key called "repeated" is applied like any other', () => {
    expect(readFreeValue('{"repeated": "x"}')).toEqual({ value: { repeated: 'x' } });
  });

  it('text that would read as something else is shown quoted, so it stays text', () => {
    expect(showFreeValue('42')).toBe('"42"');
    expect(showFreeValue('plain')).toBe('plain');
    expect(showFreeValue({ a: 1 })).toBe('{"a":1}');
    expect(showFreeValue(undefined)).toBe('');
  });
});
