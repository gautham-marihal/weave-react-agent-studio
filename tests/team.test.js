import test from 'node:test';
import assert from 'node:assert/strict';
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
  demoTeam,
  describeGrant,
  describeScope,
  grantAgent,
  makeMember,
  normalizeScope,
  ownerFrom,
  parseEmails,
  peopleWithAccess,
  pruneScopes,
  removeMember,
  revokeAgent,
  scopeProblem,
} from '../src/studio/team/teamModel.js';

// Who can work in a workspace and on which agents: a role (what they may do) and a scope (the whole workspace, or the agents someone chose).
const agents = [
  { id: 'a', name: 'Acme Support' },
  { id: 'b', name: 'Billing' },
  { id: 'c', name: 'Sales' },
];
const owner = ownerFrom({ fullName: 'Gautham', email: 'G@Acme.com' });
const person = (email, role, scope, status = 'active') => ({ ...makeMember({ email, role, scope, status }), status });

test('a person gets a role and a scope: the whole workspace, or the agents chosen; a role that runs the workspace cannot be limited', () => {
  assert.deepEqual(normalizeScope('admin', agentsScope(['a'])), WHOLE_WORKSPACE, 'an admin has the whole workspace');
  assert.deepEqual(normalizeScope('editor', agentsScope(['a', 'a', 'b'])), { agents: ['a', 'b'] });
  assert.deepEqual(normalizeScope('viewer', WHOLE_WORKSPACE), WHOLE_WORKSPACE);
  assert.equal(scopeProblem('editor', agentsScope([])), 'Choose at least one agent, or give access to the whole workspace.');
  assert.equal(scopeProblem('editor', agentsScope(['a'])), '');
  assert.equal(scopeProblem('admin', agentsScope([])), '', 'an admin is never "no agents"');
});

test('which agents a member can open, and what they may do there', () => {
  const editor = person('e@x.com', 'editor', agentsScope(['a']));
  const viewer = person('v@x.com', 'viewer', WHOLE_WORKSPACE);
  assert.deepEqual(accessOf(editor, 'a'), { role: 'editor', via: 'agent' });
  assert.equal(accessOf(editor, 'b'), null);
  assert.deepEqual(accessOf(viewer, 'zzz'), { role: 'viewer', via: 'workspace' }, 'the whole workspace includes agents made later');
  assert.equal(canDo(editor, 'a', 'publish'), true);
  assert.equal(canDo(editor, 'b', 'see'), false);
  assert.equal(canDo(viewer, 'a', 'test'), true);
  assert.equal(canDo(viewer, 'a', 'edit'), false);
  assert.deepEqual(
    agentsOf(editor, agents).map((x) => x.id),
    ['a'],
  );
  assert.deepEqual(
    agentsOf(viewer, agents).map((x) => x.id),
    ['a', 'b', 'c'],
  );
});

test('the people who can open an agent, the highest role first, and how they can', () => {
  const members = [
    owner,
    person('v@x.com', 'viewer', agentsScope(['a'])),
    person('e@x.com', 'editor', WHOLE_WORKSPACE),
    person('other@x.com', 'editor', agentsScope(['b'])),
  ];
  const list = peopleWithAccess(members, 'a');
  assert.deepEqual(
    list.map((x) => [x.member.email, x.role, x.via]),
    [
      ['g@acme.com', 'owner', 'workspace'],
      ['e@x.com', 'editor', 'workspace'],
      ['v@x.com', 'viewer', 'agent'],
    ],
  );
});

test('scopes and grants are described in plain words', () => {
  assert.equal(describeScope(WHOLE_WORKSPACE, agents), 'Whole workspace');
  assert.equal(describeScope(agentsScope(['a']), agents), 'Acme Support');
  assert.equal(describeScope(agentsScope(['a', 'b', 'c']), agents), 'Acme Support and 2 more');
  assert.equal(describeScope(agentsScope([]), agents), 'No agents');
  assert.equal(canWords('viewer'), 'See and try');
  assert.equal(canWords('editor'), 'See, try, change and publish');
  assert.equal(canWords('admin'), 'See, try, change and publish, and manage people');
  assert.equal(
    describeGrant({ role: 'editor', scope: agentsScope(['a', 'b']), agents }),
    'Editor: can see, try, change and publish 2 agents: Acme Support and Billing. Nothing else in the workspace.',
  );
  assert.match(describeGrant({ role: 'viewer', scope: WHOLE_WORKSPACE, agents }), /every agent in the workspace, including agents made later/);
  assert.match(describeGrant({ role: 'editor', scope: agentsScope([]), agents }), /no agent chosen yet/);
});

test('email addresses are read from a list, once each, and the wrong ones are named', () => {
  assert.deepEqual(parseEmails('A@x.com, b@y.org\nc@z.io; a@x.com'), { emails: ['a@x.com', 'b@y.org', 'c@z.io'], invalid: [] });
  assert.deepEqual(parseEmails('nope, ok@x.com').invalid, ['nope']);
  const members = [owner];
  assert.equal(checkInvite({ text: '', members }).ok, false);
  assert.match(checkInvite({ text: '', members }).problems[0], /at least one email/);
  assert.match(checkInvite({ text: 'bad', members }).problems[0], /“bad” is not an email address/);
  assert.match(checkInvite({ text: 'g@acme.com', members }).problems[0], /already on the team/);
  const ok = checkInvite({ text: 'new@x.com, g@acme.com', members });
  assert.deepEqual(ok.add, ['new@x.com']);
  assert.equal(ok.ok, false, 'someone already on the team is a problem to read, even when others are fine');
});

test('changing a person’s access: the owner is fixed, a role that needs the whole workspace gets it, and an agent role needs an agent', () => {
  const e = person('e@x.com', 'editor', agentsScope(['a']));
  let members = [owner, e];
  assert.equal(changeMember(members, 'owner', { role: 'viewer' }).problem, 'The owner’s access cannot be changed.');
  assert.equal(changeMember(members, e.id, { role: 'owner' }).problem, 'There is one owner.');
  assert.equal(changeMember(members, e.id, { scope: agentsScope([]) }).problem, 'Choose at least one agent, or give access to the whole workspace.');
  const promoted = changeMember(members, e.id, { role: 'admin' });
  assert.deepEqual(promoted.members.find((m) => m.id === e.id).scope, WHOLE_WORKSPACE);
  const widened = changeMember(members, e.id, { scope: WHOLE_WORKSPACE });
  assert.deepEqual(widened.members.find((m) => m.id === e.id).scope, WHOLE_WORKSPACE);
  members = widened.members;
  const narrowed = changeMember(members, e.id, { scope: agentsScope(['b']) });
  assert.deepEqual(narrowed.members.find((m) => m.id === e.id).scope, { agents: ['b'] });
});

test('someone has to be able to manage people: the last admin cannot be demoted or removed; an invite that is waiting does not count', () => {
  const admin = person('ad@x.com', 'admin', WHOLE_WORKSPACE);
  const waiting = person('w@x.com', 'admin', WHOLE_WORKSPACE, 'invited');
  assert.equal(removeMember([owner], 'owner').problem, 'The owner cannot be removed.');
  assert.equal(removeMember([owner, admin], admin.id).problem, '', 'the owner still manages people');
  const noOwnerPeople = [{ ...owner, role: 'editor' }, admin, waiting];
  assert.match(removeMember(noOwnerPeople, admin.id).problem, /keep at least one admin/);
  assert.match(changeMember(noOwnerPeople, admin.id, { role: 'viewer' }).problem, /keep at least one admin/);
  assert.equal(removeMember([owner, admin], 'missing').problem, '');
});

test('taking an agent away from someone leaves them with the rest; someone who had only that agent leaves the team', () => {
  const two = person('t@x.com', 'editor', agentsScope(['a', 'b']));
  const one = person('o@x.com', 'viewer', agentsScope(['a']));
  const whole = person('w@x.com', 'editor', WHOLE_WORKSPACE);
  const members = [owner, two, one, whole];
  const r1 = revokeAgent(members, two.id, 'a');
  assert.deepEqual(r1.members.find((m) => m.id === two.id).scope, { agents: ['b'] });
  assert.equal(r1.removed, false);
  const r2 = revokeAgent(members, one.id, 'a');
  assert.equal(r2.removed, true);
  assert.ok(!r2.members.some((m) => m.id === one.id));
  assert.equal(revokeAgent(members, whole.id, 'a').members, members, 'the whole workspace is changed from the Team page, not by taking one agent away');
  assert.deepEqual(grantAgent(members, one.id, 'c').find((m) => m.id === one.id).scope, { agents: ['a', 'c'] });
  assert.equal(grantAgent(members, whole.id, 'c'), members, 'someone with the whole workspace needs nothing more');
});

test('when an agent no longer exists, people who could only open it have nothing left', () => {
  const one = person('o@x.com', 'viewer', agentsScope(['gone']));
  const two = person('t@x.com', 'editor', agentsScope(['gone', 'a']));
  const next = pruneScopes([owner, one, two], ['a', 'b']);
  assert.deepEqual(
    next.map((m) => m.email),
    ['g@acme.com', 't@x.com'],
  );
  assert.deepEqual(next[1].scope, { agents: ['a'] });
});

test('a new workspace starts with its owner, and the demo team shows each kind of access', () => {
  assert.deepEqual([owner.role, owner.status, owner.scope, owner.email], ['owner', 'active', WHOLE_WORKSPACE, 'g@acme.com']);
  const team = demoTeam({ fullName: 'Gautham', email: 'g@acme.com' }, ['a', 'b']);
  assert.deepEqual(
    team.map((m) => m.role),
    ['owner', 'admin', 'editor', 'viewer'],
  );
  assert.deepEqual(team.find((m) => m.role === 'editor').scope, { agents: ['a'] });
  assert.equal(team.find((m) => m.role === 'viewer').status, 'invited');
  assert.equal(addMembers([owner], [makeMember({ email: 'n@x.com' })]).members.length, 2);
});
