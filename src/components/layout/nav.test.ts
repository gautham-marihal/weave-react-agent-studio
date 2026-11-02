import { describe, expect, it } from 'vitest';
import { NAV_GROUPS, agentIdOfPath, sidebarFolded } from './nav';

describe('the sidebar', () => {
  it('groups the workspace’s pages, the library, then the people and settings, each page once', () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(['Workspace', 'Library', 'Team and settings']);
    const all = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.to));
    expect(new Set(all).size).toBe(all.length);
    expect(all).toEqual(expect.arrayContaining(['/', '/agents', '/calls', '/library', '/telephony', '/team', '/settings']));
    NAV_GROUPS.forEach((g) => g.items.forEach((i) => expect(i.label).toMatch(/^[A-Z]/)));
  });

  it('has no Banking page: banking lives inside the agents (Build › Banking, Test)', () => {
    const all = NAV_GROUPS.flatMap((g) => g.items);
    expect(all.some((i) => i.to === '/banking' || /banking/i.test(i.label))).toBe(false);
  });

  it('knows when an address is inside an agent', () => {
    expect(agentIdOfPath('/agents/acme-support/build/tools')).toBe('acme-support');
    expect(agentIdOfPath('/agents/acme%20x')).toBe('acme x');
    expect(agentIdOfPath('/agents')).toBe(null);
    expect(agentIdOfPath('/calls/c1')).toBe(null);
  });

  it('folds by itself inside an agent, and keeps the person’s choice elsewhere', () => {
    expect(sidebarFolded({ inAgent: true, remembered: false, agentChoice: null })).toBe(true);
    expect(sidebarFolded({ inAgent: true, remembered: false, agentChoice: false })).toBe(false);
    expect(sidebarFolded({ inAgent: false, remembered: false, agentChoice: true })).toBe(false);
    expect(sidebarFolded({ inAgent: false, remembered: true, agentChoice: null })).toBe(true);
  });
});
