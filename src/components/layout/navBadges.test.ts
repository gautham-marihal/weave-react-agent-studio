import { describe, expect, it } from 'vitest';
import { badgeText, badgeWords, getNavBadges, setNavBadge } from './navBadges';

describe('counts beside sidebar links', () => {
  it('shows a count set by address, and nothing for none', () => {
    setNavBadge('/alerts', 3, 'danger');
    expect(getNavBadges()['/alerts']).toEqual({ count: 3, tone: 'danger' });
    setNavBadge('/alerts', 0);
    expect(getNavBadges()['/alerts']).toBeUndefined();
    setNavBadge('/calls', 2.7);
    expect(getNavBadges()['/calls']).toEqual({ count: 2, tone: 'neutral' });
    setNavBadge('/calls', null);
    setNavBadge('/calls', Number.NaN);
    expect(getNavBadges()['/calls']).toBeUndefined();
  });

  it('keeps the same object when nothing changed, so the sidebar is not drawn again', () => {
    setNavBadge('/alerts', 1, 'danger');
    const before = getNavBadges();
    setNavBadge('/alerts', 1, 'danger');
    expect(getNavBadges()).toBe(before);
    setNavBadge('/alerts', null);
  });

  it('reads short on screen and in words for a screen reader', () => {
    expect(badgeText(7)).toBe('7');
    expect(badgeText(120)).toBe('99+');
    expect(badgeWords({ count: 2, tone: 'danger' })).toBe('2 need attention');
    expect(badgeWords({ count: 1, tone: 'neutral' })).toBe('1 new');
  });
});
