import { describe, expect, it } from 'vitest';
import { cleanUser, forwardedUser, MAX_USER_LENGTH } from './forwardedUser';

describe('cleanUser', () => {
  it('keeps a name or an email, trimmed', () => {
    expect(cleanUser('  priya@example.com ')).toBe('priya@example.com');
    expect(cleanUser('+441234567890')).toBe('+441234567890');
  });

  it('takes the first value of a repeated header', () => {
    expect(cleanUser(['a@example.com', 'b@example.com'])).toBe('a@example.com');
  });

  it('rejects empty, too long, and control characters', () => {
    expect(cleanUser(undefined)).toBeUndefined();
    expect(cleanUser('   ')).toBeUndefined();
    expect(cleanUser('x'.repeat(MAX_USER_LENGTH + 1))).toBeUndefined();
    expect(cleanUser('a\r\nX-Injected: 1')).toBeUndefined();
    expect(cleanUser('tab\there')).toBeUndefined();
  });

  it('accepts exactly the maximum length', () => {
    expect(cleanUser('x'.repeat(MAX_USER_LENGTH))).toHaveLength(MAX_USER_LENGTH);
  });
});

describe('forwardedUser', () => {
  it('prefers the signed-in user from the browser', () => {
    expect(forwardedUser('priya@example.com', 'ops@example.com')).toBe('priya@example.com');
  });

  it('falls back to the configured user when the browser sent none or a bad one', () => {
    expect(forwardedUser(undefined, 'ops@example.com')).toBe('ops@example.com');
    expect(forwardedUser('bad\nvalue', 'ops@example.com')).toBe('ops@example.com');
  });

  it('sends nothing when neither is usable', () => {
    expect(forwardedUser(undefined, '')).toBeUndefined();
    expect(forwardedUser('', undefined)).toBeUndefined();
  });
});
