import { describe, expect, it } from 'vitest';
import {
  WHOLE_WORKSPACE,
  accessOf,
  addMembers,
  agentsOf,
  agentsScope,
  canDo,
  canWords,
  changeMember,
  checkInvite,
  describeGrant,
  describeScope,
  grantAgent,
  initialsOf,
  makeMember,
  normalizeScope,
  ownerFrom,
  parseEmails,
  peopleWithAccess,
  pruneScopes,
  readTeam,
  removeMember,
  revokeAgent,
  scopeProblem,
  type Member,
  type MemberStatus,
  type Scope,
  type TeamRole,
} from './team';

// Who can work in a workspace and on which agents: a role (what they may do) and a scope (the whole workspace, or the
// agents someone chose). Ported from Weave React's tests/team.test.js (without its demo team: Studio seeds no one).
const agents = [
  { id: 'a', name: 'Acme Support' },
  { id: 'b', name: 'Billing' },
  { id: 'c', name: 'Sales' },
];
const owner = ownerFrom({ name: 'Gautham', email: 'G@Acme.com' });
const person = (email: string, role: TeamRole, scope: Scope, status: MemberStatus = 'active'): Member => ({ ...makeMember({ email, role, scope, status }), status });

describe('the team', () => {
  it('gives a person a role and a scope; a role that runs the workspace cannot be limited', () => {
    expect(normalizeScope('admin', agentsScope(['a']))).toEqual(WHOLE_WORKSPACE);
    expect(normalizeScope('editor', agentsScope(['a', 'a', 'b']))).toEqual({ agents: ['a', 'b'] });
    expect(normalizeScope('viewer', WHOLE_WORKSPACE)).toEqual(WHOLE_WORKSPACE);
    expect(scopeProblem('editor', agentsScope([]))).toBe('Choose at least one agent, or give access to the whole workspace.');
    expect(scopeProblem('editor', agentsScope(['a']))).toBe('');
    expect(scopeProblem('admin', agentsScope([]))).toBe('');
  });

  it('knows which agents a member can open, and what they may do there', () => {
    const editor = person('e@x.com', 'editor', agentsScope(['a']));
    const viewer = person('v@x.com', 'viewer', WHOLE_WORKSPACE);
    expect(accessOf(editor, 'a')).toEqual({ role: 'editor', via: 'agent' });
    expect(accessOf(editor, 'b')).toBe(null);
    expect(accessOf(viewer, 'zzz')).toEqual({ role: 'viewer', via: 'workspace' });
    expect(canDo(editor, 'a', 'publish')).toBe(true);
    expect(canDo(editor, 'b', 'see')).toBe(false);
    expect(canDo(viewer, 'a', 'test')).toBe(true);
    expect(canDo(viewer, 'a', 'edit')).toBe(false);
    expect(agentsOf(editor, agents).map((x) => x.id)).toEqual(['a']);
    expect(agentsOf(viewer, agents).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('lists the people who can open an agent, the highest role first', () => {
    const members = [owner, person('v@x.com', 'viewer', agentsScope(['a'])), person('e@x.com', 'editor', WHOLE_WORKSPACE), person('other@x.com', 'editor', agentsScope(['b']))];
    expect(peopleWithAccess(members, 'a').map((x) => [x.member.email, x.role, x.via])).toEqual([
      ['g@acme.com', 'owner', 'workspace'],
      ['e@x.com', 'editor', 'workspace'],
      ['v@x.com', 'viewer', 'agent'],
    ]);
  });

  it('describes scopes and grants in plain words', () => {
    expect(describeScope(WHOLE_WORKSPACE, agents)).toBe('Whole workspace');
    expect(describeScope(agentsScope(['a']), agents)).toBe('Acme Support');
    expect(describeScope(agentsScope(['a', 'b', 'c']), agents)).toBe('Acme Support and 2 more');
    expect(describeScope(agentsScope([]), agents)).toBe('No agents');
    expect(canWords('viewer')).toBe('See and try');
    expect(canWords('editor')).toBe('See, try, change and publish');
    expect(canWords('admin')).toBe('See, try, change and publish, and manage people');
    expect(describeGrant({ role: 'editor', scope: agentsScope(['a', 'b']), agents })).toBe(
      'Editor: can see, try, change and publish 2 agents: Acme Support and Billing. Nothing else in the workspace.'
    );
    expect(describeGrant({ role: 'viewer', scope: WHOLE_WORKSPACE, agents })).toMatch(/every agent in the workspace, including agents made later/);
    expect(describeGrant({ role: 'editor', scope: agentsScope([]), agents })).toMatch(/no agent chosen yet/);
  });

  it('reads addresses from a list, once each, and names the wrong ones', () => {
    expect(parseEmails('A@x.com, b@y.org\nc@z.io; a@x.com')).toEqual({ emails: ['a@x.com', 'b@y.org', 'c@z.io'], invalid: [] });
    expect(parseEmails('nope, ok@x.com').invalid).toEqual(['nope']);
    const members = [owner];
    expect(checkInvite({ text: '', members }).ok).toBe(false);
    expect(checkInvite({ text: '', members }).problems[0]).toMatch(/at least one email/);
    expect(checkInvite({ text: 'bad', members }).problems[0]).toMatch(/“bad” is not an email address/);
    expect(checkInvite({ text: 'g@acme.com', members }).problems[0]).toMatch(/already on the team/);
    const ok = checkInvite({ text: 'new@x.com, g@acme.com', members });
    expect(ok.add).toEqual(['new@x.com']);
    expect(ok.ok).toBe(false);
  });

  it('changes access: the owner is fixed, a workspace role gets the whole workspace, an agent role needs an agent', () => {
    const e = person('e@x.com', 'editor', agentsScope(['a']));
    let members = [owner, e];
    expect(changeMember(members, 'owner', { role: 'viewer' }).problem).toBe('The owner’s access cannot be changed.');
    expect(changeMember(members, e.id, { role: 'owner' }).problem).toBe('There is one owner.');
    expect(changeMember(members, e.id, { scope: agentsScope([]) }).problem).toBe('Choose at least one agent, or give access to the whole workspace.');
    expect(changeMember(members, e.id, { role: 'admin' }).members.find((m) => m.id === e.id)?.scope).toEqual(WHOLE_WORKSPACE);
    const widened = changeMember(members, e.id, { scope: WHOLE_WORKSPACE });
    expect(widened.members.find((m) => m.id === e.id)?.scope).toEqual(WHOLE_WORKSPACE);
    members = widened.members;
    expect(changeMember(members, e.id, { scope: agentsScope(['b']) }).members.find((m) => m.id === e.id)?.scope).toEqual({ agents: ['b'] });
  });

  it('keeps someone who can manage people: the last admin cannot be demoted or removed; a waiting invite does not count', () => {
    const admin = person('ad@x.com', 'admin', WHOLE_WORKSPACE);
    const waiting = person('w@x.com', 'admin', WHOLE_WORKSPACE, 'invited');
    expect(removeMember([owner], 'owner').problem).toBe('The owner cannot be removed.');
    expect(removeMember([owner, admin], admin.id).problem).toBe('');
    const noOwnerPeople: Member[] = [{ ...owner, role: 'editor' }, admin, waiting];
    expect(removeMember(noOwnerPeople, admin.id).problem).toMatch(/keep at least one admin/);
    expect(changeMember(noOwnerPeople, admin.id, { role: 'viewer' }).problem).toMatch(/keep at least one admin/);
    expect(removeMember([owner, admin], 'missing').problem).toBe('');
  });

  it('takes one agent away and leaves the rest; someone who had only that agent leaves the team', () => {
    const two = person('t@x.com', 'editor', agentsScope(['a', 'b']));
    const one = person('o@x.com', 'viewer', agentsScope(['a']));
    const whole = person('w@x.com', 'editor', WHOLE_WORKSPACE);
    const members = [owner, two, one, whole];
    const r1 = revokeAgent(members, two.id, 'a');
    expect(r1.members.find((m) => m.id === two.id)?.scope).toEqual({ agents: ['b'] });
    expect(r1.removed).toBe(false);
    const r2 = revokeAgent(members, one.id, 'a');
    expect(r2.removed).toBe(true);
    expect(r2.members.some((m) => m.id === one.id)).toBe(false);
    expect(revokeAgent(members, whole.id, 'a').members).toBe(members);
    expect(grantAgent(members, one.id, 'c').find((m) => m.id === one.id)?.scope).toEqual({ agents: ['a', 'c'] });
    expect(grantAgent(members, whole.id, 'c')).toBe(members);
  });

  it('drops access to an agent that no longer exists', () => {
    const one = person('o@x.com', 'viewer', agentsScope(['gone']));
    const two = person('t@x.com', 'editor', agentsScope(['gone', 'a']));
    const next = pruneScopes([owner, one, two], ['a', 'b']);
    expect(next.map((m) => m.email)).toEqual(['g@acme.com', 't@x.com']);
    expect(next[1].scope).toEqual({ agents: ['a'] });
  });

  it('starts a workspace with only its owner, the person signed in (no one is made up)', () => {
    expect([owner.role, owner.status, owner.scope, owner.email, owner.name]).toEqual(['owner', 'active', WHOLE_WORKSPACE, 'g@acme.com', 'Gautham']);
    expect(addMembers([owner], [makeMember({ email: 'n@x.com' })]).members).toHaveLength(2);
    expect(makeMember({ email: ' Sam.Lee@X.com ' })).toMatchObject({ email: 'sam.lee@x.com', name: 'Sam Lee', status: 'invited', role: 'viewer' });
    expect(initialsOf({ name: 'Sam Lee', email: 's@x.com' })).toBe('SL');
  });

  it('reads the stored team, skipping anything that is not a member', () => {
    expect(readTeam(null)).toBe(null);
    expect(readTeam('nope')).toBe(null);
    expect(readTeam('{"members": 3}')).toBe(null);
    expect(readTeam(JSON.stringify({ v: 1, members: [owner, { id: 'x', email: 'x@y.z', role: 'boss' }, null] }))).toEqual([owner]);
  });
});
