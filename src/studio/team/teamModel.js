// Who can work in a workspace, and on which agents: a ROLE (what they may do) and a SCOPE (the whole workspace, agents
// made later included, or chosen agents). The rules stay readable so the server can enforce the same ones later.
// Pure: no React, no DOM, no network.

// What each role may do. `workspaceOnly`: runs the workspace (its people), so it can't be limited to some agents.
const ROLES = [
  {
    id: 'owner',
    label: 'Owner',
    blurb: 'Everything, including who has access. There is one owner.',
    workspaceOnly: true,
    assignable: false,
    can: { see: true, test: true, edit: true, publish: true, people: true },
  },
  {
    id: 'admin',
    label: 'Admin',
    blurb: 'Everything an editor can do, and invites and removes people.',
    workspaceOnly: true,
    assignable: true,
    can: { see: true, test: true, edit: true, publish: true, people: true },
  },
  {
    id: 'editor',
    label: 'Editor',
    blurb: 'Builds agents: changes them, tries them, publishes and deploys them.',
    workspaceOnly: false,
    assignable: true,
    can: { see: true, test: true, edit: true, publish: true, people: false },
  },
  {
    id: 'viewer',
    label: 'Viewer',
    blurb: 'Looks at agents and their calls and tries them out. Cannot change anything.',
    workspaceOnly: false,
    assignable: true,
    can: { see: true, test: true, edit: false, publish: false, people: false },
  },
];
export const roleOf = (id) => ROLES.find((r) => r.id === id) || ROLES[ROLES.length - 1];
export const ASSIGNABLE_ROLES = ROLES.filter((r) => r.assignable);

// The permissions as short phrases, for a line under a role: "See, try, change and publish".
export function canWords(role) {
  const c = roleOf(role).can;
  const parts = [c.see && 'see', c.test && 'try', c.edit && 'change', c.publish && 'publish'].filter(Boolean);
  if (parts.length === 0) return 'Nothing';
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `${text[0].toUpperCase()}${text.slice(1)}${c.people ? ', and manage people' : ''}`;
}

export const WHOLE_WORKSPACE = { all: true };
export const agentsScope = (ids) => ({ agents: [...new Set((ids || []).filter(Boolean))] });
export const isWhole = (scope) => !!scope && scope.all === true;
export const scopeAgents = (scope) => (isWhole(scope) ? [] : Array.isArray(scope?.agents) ? scope.agents : []);

// A role that runs the workspace always has all of it; others keep the scope they were given.
export function normalizeScope(role, scope) {
  if (roleOf(role).workspaceOnly) return WHOLE_WORKSPACE;
  return isWhole(scope) ? WHOLE_WORKSPACE : agentsScope(scopeAgents(scope));
}

// ---- email addresses
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;
const isEmail = (text) => EMAIL.test(String(text || '').trim());
// "a@x.com, b@y.com\nc@z.com" -> { emails: [...], invalid: [...] } (lower case, once each)
export function parseEmails(text) {
  const seen = new Set();
  const emails = [];
  const invalid = [];
  String(text || '')
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .forEach((part) => {
      const key = part.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      (isEmail(part) ? emails : invalid).push(isEmail(part) ? key : part);
    });
  return { emails, invalid };
}
const nameFromEmail = (email) =>
  String(email || '')
    .split('@')[0]
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

// ---- members
let counter = 0;
const newId = () => `m_${Date.now().toString(36)}${(counter += 1).toString(36)}`;

export function makeMember({ email, name = '', role = 'viewer', scope = WHOLE_WORKSPACE, status = 'invited', by = '', now = Date.now() } = {}) {
  return {
    id: newId(),
    email: String(email || '')
      .trim()
      .toLowerCase(),
    name: name || nameFromEmail(email),
    role,
    scope: normalizeScope(role, scope),
    status,
    invitedBy: by,
    at: now,
  };
}

// What stops these people being invited: someone already in, or a bad address.
// -> { ok, problems: [string], add: [email], already: [email] }
export function checkInvite({ text, members }) {
  const { emails, invalid } = parseEmails(text);
  const have = new Set((members || []).map((m) => m.email));
  const already = emails.filter((e) => have.has(e));
  const add = emails.filter((e) => !have.has(e));
  const problems = [];
  if (invalid.length) problems.push(`${invalid.length === 1 ? `“${invalid[0]}” is` : `${invalid.map((i) => `“${i}”`).join(', ')} are`} not an email address.`);
  if (already.length) problems.push(`${already.join(', ')} ${already.length === 1 ? 'is' : 'are'} already on the team: change their access from the list.`);
  if (!emails.length && !invalid.length) problems.push('Enter at least one email address.');
  return { ok: problems.length === 0 && add.length > 0, problems, add, already, invalid };
}

// What a choice of access is missing: only some agents, and none chosen.
export const scopeProblem = (role, scope) =>
  !roleOf(role).workspaceOnly && !isWhole(scope) && scopeAgents(scope).length === 0 ? 'Choose at least one agent, or give access to the whole workspace.' : '';

// ---- who can open what
// The access a member has to one agent: { role, via: 'workspace' | 'agent' }, or null.
export function accessOf(member, agentId) {
  if (!member) return null;
  if (isWhole(member.scope)) return { role: member.role, via: 'workspace' };
  return scopeAgents(member.scope).includes(agentId) ? { role: member.role, via: 'agent' } : null;
}
const ORDER = { owner: 0, admin: 1, editor: 2, viewer: 3 };
export const byRole = (a, b) => (ORDER[a.role] ?? 9) - (ORDER[b.role] ?? 9) || a.email.localeCompare(b.email);

// The people who can open an agent, with the way they can: [{ member, role, via }], the highest role first.
export function peopleWithAccess(members, agentId) {
  return (members || [])
    .map((member) => ({ member, ...accessOf(member, agentId) }))
    .filter((x) => x.role)
    .sort((a, b) => byRole(a.member, b.member));
}
// The agents a member can open, out of the workspace's agents ([{ id, name }]).
export const agentsOf = (member, agents) => (isWhole(member.scope) ? agents : agents.filter((a) => scopeAgents(member.scope).includes(a.id)));
export const canDo = (member, agentId, what) => {
  const a = accessOf(member, agentId);
  return !!(a && roleOf(a.role).can[what]);
};

// "Whole workspace", "Acme Support", "Acme Support and 2 more"
export function describeScope(scope, agents) {
  if (isWhole(scope)) return 'Whole workspace';
  const names = scopeAgents(scope).map((id) => (agents || []).find((a) => a.id === id)?.name || id);
  if (names.length === 0) return 'No agents';
  return names.length === 1 ? names[0] : `${names[0]} and ${names.length - 1} more`;
}

// The sentence that says what a choice gives, shown before it is confirmed: "Can change and publish 2 agents: A and B."
export function describeGrant({ role, scope, agents }) {
  const r = roleOf(role);
  const verb = canWords(role).toLowerCase();
  if (isWhole(scope) || r.workspaceOnly) return `${r.label}: can ${verb} every agent in the workspace, including agents made later.`;
  const names = scopeAgents(scope).map((id) => (agents || []).find((a) => a.id === id)?.name || id);
  if (!names.length) return `${r.label}: no agent chosen yet.`;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${r.label}: can ${verb} ${names.length === 1 ? 'one agent' : `${names.length} agents`}: ${list}. Nothing else in the workspace.`;
}

// ---- changing the team (each returns a new list, or the same one with a `problem` when the change is not allowed)
const withProblem = (members, problem) => ({ members, problem });
const adminsLeft = (members) => members.filter((m) => roleOf(m.role).can.people && m.status === 'active').length;

export function addMembers(members, people) {
  return withProblem([...members, ...people], '');
}

export function changeMember(members, id, { role, scope }) {
  const m = members.find((x) => x.id === id);
  if (!m) return withProblem(members, '');
  if (m.role === 'owner') return withProblem(members, 'The owner’s access cannot be changed.');
  if (role === 'owner') return withProblem(members, 'There is one owner.');
  const nextRole = role || m.role;
  const nextScope = normalizeScope(nextRole, scope === undefined ? m.scope : scope);
  const problem = scopeProblem(nextRole, nextScope);
  if (problem) return withProblem(members, problem);
  const next = members.map((x) => (x.id === id ? { ...x, role: nextRole, scope: nextScope } : x));
  if (roleOf(m.role).can.people && !roleOf(nextRole).can.people && m.status === 'active' && adminsLeft(next) === 0)
    return withProblem(members, 'Someone has to be able to manage people: keep at least one admin.');
  return withProblem(next, '');
}

export function removeMember(members, id) {
  const m = members.find((x) => x.id === id);
  if (!m) return withProblem(members, '');
  if (m.role === 'owner') return withProblem(members, 'The owner cannot be removed.');
  const next = members.filter((x) => x.id !== id);
  if (roleOf(m.role).can.people && m.status === 'active' && adminsLeft(next) === 0)
    return withProblem(members, 'Someone has to be able to manage people: keep at least one admin.');
  return withProblem(next, '');
}

// Takes one agent out of what a person can open. Someone who had only that agent has nothing left, so they leave the
// team. -> { members, removed: bool }
export function revokeAgent(members, id, agentId) {
  const m = members.find((x) => x.id === id);
  if (!m || isWhole(m.scope)) return { members, removed: false };
  const left = scopeAgents(m.scope).filter((a) => a !== agentId);
  if (left.length === 0) return { members: members.filter((x) => x.id !== id), removed: true };
  return { members: members.map((x) => (x.id === id ? { ...x, scope: agentsScope(left) } : x)), removed: false };
}
export function grantAgent(members, id, agentId, role) {
  const m = members.find((x) => x.id === id);
  if (!m || isWhole(m.scope) || roleOf(m.role).workspaceOnly) return members;
  return members.map((x) => (x.id === id ? { ...x, role: role || x.role, scope: agentsScope([...scopeAgents(x.scope), agentId]) } : x));
}

// When an agent no longer exists, people who could only open it have nothing left.
export function pruneScopes(members, agentIds) {
  const ids = new Set(agentIds);
  return members.flatMap((m) => {
    if (isWhole(m.scope)) return [m];
    const left = scopeAgents(m.scope).filter((a) => ids.has(a));
    return left.length === 0 ? [] : [{ ...m, scope: agentsScope(left) }];
  });
}

// ---- the first team of a workspace: its owner
export function ownerFrom(profile, now = Date.now()) {
  const email = String(profile?.email || 'you@example.com').toLowerCase();
  return {
    id: 'owner',
    email,
    name: profile?.fullName || nameFromEmail(email),
    role: 'owner',
    scope: WHOLE_WORKSPACE,
    status: 'active',
    invitedBy: '',
    at: now,
  };
}
// Demo people to try the page with: an editor on the whole workspace, a viewer on one agent, one invite waiting.
export function demoTeam(profile, agentIds, now = Date.now()) {
  const owner = ownerFrom(profile, now);
  const first = agentIds[0] || 'acme-support'; // the agent list may not be read yet; the sample agent of the demo is the usual one
  return [
    owner,
    {
      id: 'demo_a',
      email: 'priya.shah@example.com',
      name: 'Priya Shah',
      role: 'admin',
      scope: WHOLE_WORKSPACE,
      status: 'active',
      invitedBy: owner.email,
      at: now - 9 * 86400000,
    },
    {
      id: 'demo_b',
      email: 'marco.rossi@example.com',
      name: 'Marco Rossi',
      role: 'editor',
      scope: first ? agentsScope([first]) : WHOLE_WORKSPACE,
      status: 'active',
      invitedBy: owner.email,
      at: now - 4 * 86400000,
    },
    {
      id: 'demo_c',
      email: 'dana.lee@example.com',
      name: 'Dana Lee',
      role: 'viewer',
      scope: WHOLE_WORKSPACE,
      status: 'invited',
      invitedBy: owner.email,
      at: now - 86400000,
    },
  ];
}

export const initialsOf = (member) =>
  String(member?.name || member?.email || '?')
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('') || '?';
export const hueOf = (text) => {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
};
