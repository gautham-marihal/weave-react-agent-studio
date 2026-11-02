import { describe, expect, it } from 'vitest';
import { isSampleMember, sampleTeam } from './sampleTeam';
import { ownerFrom, readTeam, removeMember, scopeAgents } from '../models/team';

describe('the sample team', () => {
  const owner = ownerFrom({ name: 'Test Person', email: 'test.person@example.com' }, 0);
  const team = sampleTeam(owner, ['front-desk', 'acme-support'], 10 * 86_400_000);

  it('is the owner and three people marked as samples: an admin, an editor on one agent, an invitation waiting', () => {
    expect(team[0]).toBe(owner);
    expect(team.filter(isSampleMember).map((m) => [m.name, m.role, m.status])).toEqual([
      ['Priya Shah', 'admin', 'active'],
      ['Marco Rossi', 'editor', 'active'],
      ['Dana Lee', 'viewer', 'invited'],
    ]);
    expect(isSampleMember(owner)).toBe(false);
    expect(team.every((m) => m === owner || m.invitedBy === 'test.person@example.com')).toBe(true);
  });

  it('gives the editor the usual sample agent, else the first there is', () => {
    expect(scopeAgents(team[2].scope)).toEqual(['acme-support']);
    expect(scopeAgents(sampleTeam(owner, ['bookings'])[2].scope)).toEqual(['bookings']);
    expect(scopeAgents(sampleTeam(owner, [])[2].scope)).toEqual(['acme-support']);
  });

  it('is stored and read back like any team, and a sample person can be removed', () => {
    expect(readTeam(JSON.stringify({ v: 1, members: team }))).toEqual(team);
    expect(removeMember(team, 'sample_a').members.map((m) => m.id)).toEqual(['owner', 'sample_b', 'sample_c']);
  });
});
