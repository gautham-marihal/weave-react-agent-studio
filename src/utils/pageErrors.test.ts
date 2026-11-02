import { describe, expect, it } from 'vitest';
import { isStaleBuild, shouldResetBoundary, supportDetails } from './pageErrors';

describe('a page that broke', () => {
  it('knows a newer Studio was released while the tab was open', () => {
    expect(isStaleBuild(new TypeError('Failed to fetch dynamically imported module: /assets/Team-abc.js'))).toBe(true);
    expect(isStaleBuild(new Error('Loading chunk 12 failed.'))).toBe(true);
    expect(isStaleBuild(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isStaleBuild(null)).toBe(false);
  });

  it('is drawn again only when the person goes to another page', () => {
    expect(shouldResetBoundary(true, '/calls', '/agents')).toBe(true);
    expect(shouldResetBoundary(true, '/calls', '/calls')).toBe(false);
    expect(shouldResetBoundary(false, '/calls', '/agents')).toBe(false);
  });

  it('gives the error, the address and the time for support', () => {
    expect(supportDetails(new RangeError('bad'), 'http://x/calls', new Date('2026-10-30T10:00:00Z'))).toBe(
      'RangeError: bad\nhttp://x/calls\n2026-10-30T10:00:00.000Z'
    );
    expect(supportDetails('oops', 'here', new Date(0))).toBe('Error: oops\nhere\n1970-01-01T00:00:00.000Z');
  });
});
