import { useEffect, useSyncExternalStore } from 'react';

// Counts shown beside a sidebar link (a red number on Alerts, say). Any part of the app sets one by the link's
// address, whether or not that page is open:
//   setNavBadge('/alerts', 3, 'danger')   or, from a component, useNavBadgeCount('/alerts', count, 'danger')
// A count of 0 (or null) shows nothing.

export type NavBadgeTone = 'danger' | 'neutral';

export interface NavBadge {
  count: number;
  tone: NavBadgeTone;
}

let badges: Record<string, NavBadge> = {};
const listeners = new Set<() => void>();

export function setNavBadge(to: string, count: number | null | undefined, tone: NavBadgeTone = 'neutral'): void {
  const next = { ...badges };
  if (!count || count < 0 || !Number.isFinite(count)) delete next[to];
  else next[to] = { count: Math.floor(count), tone };
  const same = JSON.stringify(next[to] ?? null) === JSON.stringify(badges[to] ?? null);
  if (same) return;
  badges = next;
  listeners.forEach((listener) => listener());
}

export const getNavBadges = (): Record<string, NavBadge> => badges;

/** "3", or "99+" when there are more than fit. */
export const badgeText = (count: number): string => (count > 99 ? '99+' : String(count));

/** The words a screen reader hears after the link's name. */
export const badgeWords = (badge: NavBadge): string => `${badge.count} ${badge.tone === 'danger' ? 'need attention' : 'new'}`;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Every badge, kept up to date (the sidebar reads this). */
export function useNavBadges(): Record<string, NavBadge> {
  return useSyncExternalStore(subscribe, getNavBadges, getNavBadges);
}

/** Shows `count` on the link to `to` while the calling component is mounted. */
export function useNavBadgeCount(to: string, count: number | null | undefined, tone: NavBadgeTone = 'neutral'): void {
  useEffect(() => {
    setNavBadge(to, count, tone);
  }, [to, count, tone]);
  useEffect(() => () => setNavBadge(to, null), [to]);
}
