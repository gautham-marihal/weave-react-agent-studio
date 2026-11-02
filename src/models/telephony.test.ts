import { describe, expect, it } from 'vitest';
import { LIVE_NOT_OFFERED, TELEPHONY_SECTIONS, isTelephonySection, telephonyHref, telephonySection } from './telephony';

// Ported from Weave React's workspaceRoutes.test.js ("each part of Telephony has its own address, and an unknown part
// opens Simulated calls"); Live opens on the phone numbers instead, the one part the API has.
describe('the Telephony page’s parts', () => {
  it('each has its own address, and reading it back gives the same part', () => {
    expect(TELEPHONY_SECTIONS.map((s) => s.id)).toEqual(['calls', 'dispatch', 'numbers', 'trunks']);
    TELEPHONY_SECTIONS.forEach((s) => {
      expect(telephonyHref(s.id)).toBe(`/telephony/${s.id}`);
      expect(telephonySection(s.id, true)).toBe(s.id);
      expect(telephonySection(s.id, false)).toBe(s.id);
    });
  });

  it('an unknown or missing part opens the test calls in Sandbox and the phone numbers in Live', () => {
    expect(telephonySection(undefined, true)).toBe('calls');
    expect(telephonySection('nope', true)).toBe('calls');
    expect(telephonySection(undefined, false)).toBe('numbers');
    expect(telephonySection('nope', false)).toBe('numbers');
    expect(isTelephonySection('trunks')).toBe(true);
    expect(isTelephonySection('Trunks')).toBe(false);
  });

  it('Live says plainly which parts the API does not offer, and nothing made up', () => {
    expect(Object.keys(LIVE_NOT_OFFERED).sort()).toEqual(['calls', 'dispatch', 'trunks']);
    Object.values(LIVE_NOT_OFFERED).forEach((w) => {
      expect(w.title).toMatch(/aren’t offered yet/);
      expect(w.body).toMatch(/Agent Builder API has no/);
    });
  });
});
