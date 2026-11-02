import { describe, expect, it } from 'vitest';
import { putAt, setAt, unsetAt } from './path';

describe('unsetAt / putAt', () => {
  it('removes the key instead of storing undefined', () => {
    const next = unsetAt({ a: { b: 1, c: 2 } }, ['a', 'b']);
    expect(next).toEqual({ a: { c: 2 } });
    expect('b' in (next.a as object)).toBe(false);
  });

  it('leaves the object untouched when the path does not exist', () => {
    const obj = { a: { c: 2 } };
    expect(unsetAt(obj, ['a', 'x', 'y'])).toBe(obj);
  });

  it('keeps parents, even when they become empty', () => {
    expect(unsetAt({ post_call: { summary: { enabled: true } } }, ['post_call', 'summary', 'enabled'])).toEqual({ post_call: { summary: {} } });
  });

  it('putAt sets a value, and removes it for undefined', () => {
    const set = putAt({}, ['defaults', 'language', 'primary'], 'en-GB');
    expect(set).toEqual({ defaults: { language: { primary: 'en-GB' } } });
    expect(putAt(set, ['defaults', 'language', 'primary'], undefined)).toEqual({ defaults: { language: {} } });
  });

  it('does not change the original', () => {
    const obj = { a: { b: 1 } };
    setAt(obj, ['a', 'b'], 2);
    unsetAt(obj, ['a', 'b']);
    expect(obj).toEqual({ a: { b: 1 } });
  });
});
