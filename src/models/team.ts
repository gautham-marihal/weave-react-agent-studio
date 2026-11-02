// Who can work in this workspace, and on which agents: a ROLE (what they may do) and a SCOPE (the whole workspace,
// agents made later included, or chosen agents). There is no team API yet: the list is kept in this browser, no
// invitation is sent and nothing here limits anyone. The rules are kept readable so a server can enforce the same.
// Pure: no React, no DOM, no network.

export type TeamRole = 'owner' | 'admin' | 'editor' | 'viewer';
export type MemberStatus = 'active' | 'invited';

export type Scope = { all: true } | { agents: string[] };

export interface Member {
  id: string;
  email: string;
  name: string;
  role: TeamRole;
  scope: Scope;
  status: MemberStatus;
  invitedBy: string;
  /** When they were added (ms). */
  at: number;
}

export interface TeamAgent {
  id: string;
  name: string;
}

interface RoleInfo {
  id: TeamRole;
  label: string;
  blurb: string;
  /** Runs the workspace (its people), so it can't be limited to some agents. */
  workspaceOnly: boolean;
  assignable: boolean;
  can: { see: boolean; test: boolean; edit: boolean; publish: boolean; people: boolean };
}

export const ROLES: RoleInfo[] = [
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

export const roleOf = (id: string): RoleInfo => ROLES.find((r) => r.id === id) ?? ROLES[ROLES.length - 1];
export const ASSIGNABLE_ROLES = ROLES.filter((r) => r.assignable);

/** What a role may do, in short words: "See, try, change and publish". */
export function canWords(role: string): string {
  const c = roleOf(role).can;
  const parts = [c.see && 'see', c.test && 'try', c.edit && 'change', c.publish && 'publish'].filter(Boolean) as string[];
  if (parts.length === 0) return 'Nothing';
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `${text[0].toUpperCase()}${text.slice(1)}${c.people ? ', and manage people' : ''}`;
}

export const WHOLE_WORKSPACE: Scope = { all: true };
export const agentsScope = (ids: string[] | undefined): Scope => ({ agents: [...new Set((ids ?? []).filter(Boolean))] });
export const isWhole = (scope: Scope | undefined | null): boolean => !!scope && 'all' in scope && scope.all === true;
export const scopeAgents = (scope: Scope | undefined | null): string[] =>
  !scope || isWhole(scope) ? [] : Array.isArray((scope as { agents?: string[] }).agents) ? (scope as { agents: string[] }).agents : [];

/** A role that runs the workspace always has all of it; others keep the scope they were given. */
export function normalizeScope(role: string, scope: Scope): Scope {
  if (roleOf(role).workspaceOnly) return WHOLE_WORKSPACE;
  return isWhole(scope) ? WHOLE_WORKSPACE : agentsScope(scopeAgents(scope));
}

// ---- email addresses
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;
export const isEmail = (text: string): boolean => EMAIL.test(String(text ?? '').trim());

/** "a@x.com, b@y.com\nc@z.com" -> the addresses (lower case, once each) and the parts that are not addresses. */
export function parseEmails(text: string): { emails: string[]; invalid: string[] } {
  const seen = new Set<string>();
  const emails: string[] = [];
  const invalid: string[] = [];
  String(text ?? '')
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .forEach((part) => {
      const key = part.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      if (isEmail(part)) emails.push(key);
      else invalid.push(part);
    });
  return { emails, invalid };
}

export const nameFromEmail = (email: string): string =>
  String(email ?? '')
    .trim()
    .split('@')[0]
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

// ---- members
let counter = 0;
const newId = (now: number) => `m_${now.toString(36)}${(counter += 1).toString(36)}`;

export function makeMember({
  email,
  name = '',
  role = 'viewer',
  scope = WHOLE_WORKSPACE,
  status = 'invited',
  by = '',
  now = Date.now(),
}: {
  email: string;
  name?: string;
  role?: TeamRole;
  scope?: Scope;
  status?: MemberStatus;
  by?: string;
  now?: number;
}): Member {
  return {
    id: newId(now),
    email: String(email ?? '').trim().toLowerCase(),
    name: name || nameFromEmail(email),
    role,
    scope: normalizeScope(role, scope),
    status,
    invitedBy: by,
    at: now,
  };
}

export interface InviteCheck {
  ok: boolean;
  problems: string[];
  add: string[];
  already: string[];
  invalid: string[];
}

/** What stops these people being invited: someone already on the team, or a bad address. */
export function checkInvite({ text, members }: { text: string; members: Pick<Member, 'email'>[] }): InviteCheck {
  const { emails, invalid } = parseEmails(text);
  const have = new Set(members.map((m) => m.email));
  const already = emails.filter((e) => have.has(e));
  const add = emails.filter((e) => !have.has(e));
  const problems: string[] = [];
  if (invalid.length)
    problems.push(`${invalid.length === 1 ? `“${invalid[0]}” is` : `${invalid.map((i) => `“${i}”`).join(', ')} are`} not an email address.`);
  if (already.length) problems.push(`${already.join(', ')} ${already.length === 1 ? 'is' : 'are'} already on the team: change their access from the list.`);
  if (!emails.length && !invalid.length) problems.push('Enter at least one email address.');
  return { ok: problems.length === 0 && add.length > 0, problems, add, already, invalid };
}

/** What a choice of access is missing: only some agents, and none chosen. */
export const scopeProblem = (role: string, scope: Scope): string =>
  !roleOf(role).workspaceOnly && !isWhole(scope) && scopeAgents(scope).length === 0
    ? 'Choose at least one agent, or give access to the whole workspace.'
    : '';

// ---- who can open what
export interface Access {
  role: TeamRole;
  via: 'workspace' | 'agent';
}

/** The access a member has to one agent, or null. */
export function accessOf(member: Member | null | undefined, agentId: string): Access | null {
  if (!member) return null;
  if (isWhole(member.scope)) return { role: member.role, via: 'workspace' };
  return scopeAgents(member.scope).includes(agentId) ? { role: member.role, via: 'agent' } : null;
}

const ORDER: Record<TeamRole, number> = { owner: 0, admin: 1, editor: 2, viewer: 3 };
export const byRole = (a: Member, b: Member): number => (ORDER[a.role] ?? 9) - (ORDER[b.role] ?? 9) || a.email.localeCompare(b.email);

/** The people who can open an agent, with the way they can, the highest role first. */
export function peopleWithAccess(members: Member[], agentId: string): ({ member: Member } & Access)[] {
  return members
    .map((member) => ({ member, access: accessOf(member, agentId) }))
    .filter((x): x is { member: Member; access: Access } => !!x.access)
    .map((x) => ({ member: x.member, ...x.access }))
    .sort((a, b) => byRole(a.member, b.member));
}

/** The agents a member can open, out of the workspace's agents. */
export const agentsOf = (member: Member, agents: TeamAgent[]): TeamAgent[] =>
  isWhole(member.scope) ? agents : agents.filter((a) => scopeAgents(member.scope).includes(a.id));

export const canDo = (member: Member, agentId: string, what: keyof RoleInfo['can']): boolean => {
  const a = accessOf(member, agentId);
  return !!(a && roleOf(a.role).can[what]);
};

/** "Whole workspace", "Acme Support", "Acme Support and 2 more". */
export function describeScope(scope: Scope, agents: TeamAgent[]): string {
  if (isWhole(scope)) return 'Whole workspace';
  const names = scopeAgents(scope).map((id) => agents.find((a) => a.id === id)?.name ?? id);
  if (names.length === 0) return 'No agents';
  return names.length === 1 ? names[0] : `${names[0]} and ${names.length - 1} more`;
}

/** The sentence that says what a choice gives, shown before it is confirmed. */
export function describeGrant({ role, scope, agents }: { role: string; scope: Scope; agents: TeamAgent[] }): string {
  const r = roleOf(role);
  const verb = canWords(role).toLowerCase();
  if (isWhole(scope) || r.workspaceOnly) return `${r.label}: can ${verb} every agent in the workspace, including agents made later.`;
  const names = scopeAgents(scope).map((id) => agents.find((a) => a.id === id)?.name ?? id);
  if (!names.length) return `${r.label}: no agent chosen yet.`;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${r.label}: can ${verb} ${names.length === 1 ? 'one agent' : `${names.length} agents`}: ${list}. Nothing else in the workspace.`;
}

// ---- changing the team: each returns the new list, or the same one with a `problem` when the change is not allowed
export interface TeamChange {
  members: Member[];
  problem: string;
}
const withProblem = (members: Member[], problem: string): TeamChange => ({ members, problem });
const adminsLeft = (members: Member[]) => members.filter((m) => roleOf(m.role).can.people && m.status === 'active').length;

export function addMembers(members: Member[], people: Member[]): TeamChange {
  return withProblem([...members, ...people], '');
}

export function changeMember(members: Member[], id: string, { role, scope }: { role?: TeamRole; scope?: Scope }): TeamChange {
  const m = members.find((x) => x.id === id);
  if (!m) return withProblem(members, '');
  if (m.role === 'owner') return withProblem(members, 'The owner’s access cannot be changed.');
  if (role === 'owner') return withProblem(members, 'There is one owner.');
  const nextRole = role ?? m.role;
  const nextScope = normalizeScope(nextRole, scope === undefined ? m.scope : scope);
  const problem = scopeProblem(nextRole, nextScope);
  if (problem) return withProblem(members, problem);
  const next = members.map((x) => (x.id === id ? { ...x, role: nextRole, scope: nextScope } : x));
  if (roleOf(m.role).can.people && !roleOf(nextRole).can.people && m.status === 'active' && adminsLeft(next) === 0)
    return withProblem(members, 'Someone has to be able to manage people: keep at least one admin.');
  return withProblem(next, '');
}

export function removeMember(members: Member[], id: string): TeamChange {
  const m = members.find((x) => x.id === id);
  if (!m) return withProblem(members, '');
  if (m.role === 'owner') return withProblem(members, 'The owner cannot be removed.');
  const next = members.filter((x) => x.id !== id);
  if (roleOf(m.role).can.people && m.status === 'active' && adminsLeft(next) === 0)
    return withProblem(members, 'Someone has to be able to manage people: keep at least one admin.');
  return withProblem(next, '');
}

/** Takes one agent out of what a person can open. Someone who had only that agent has nothing left, so they leave. */
export function revokeAgent(members: Member[], id: string, agentId: string): { members: Member[]; removed: boolean } {
  const m = members.find((x) => x.id === id);
  if (!m || isWhole(m.scope)) return { members, removed: false };
  const left = scopeAgents(m.scope).filter((a) => a !== agentId);
  if (left.length === 0) return { members: members.filter((x) => x.id !== id), removed: true };
  return { members: members.map((x) => (x.id === id ? { ...x, scope: agentsScope(left) } : x)), removed: false };
}

export function grantAgent(members: Member[], id: string, agentId: string, role?: TeamRole): Member[] {
  const m = members.find((x) => x.id === id);
  if (!m || isWhole(m.scope) || roleOf(m.role).workspaceOnly) return members;
  return members.map((x) => (x.id === id ? { ...x, role: role ?? x.role, scope: agentsScope([...scopeAgents(x.scope), agentId]) } : x));
}

/** When an agent no longer exists, people who could only open it have nothing left. */
export function pruneScopes(members: Member[], agentIds: string[]): Member[] {
  const ids = new Set(agentIds);
  return members.flatMap((m) => {
    if (isWhole(m.scope)) return [m];
    const left = scopeAgents(m.scope).filter((a) => ids.has(a));
    return left.length === 0 ? [] : [{ ...m, scope: agentsScope(left) }];
  });
}

// ---- the first team of a workspace: the person signed in, as its owner (no one else is made up)
export function ownerFrom(profile: { name?: string; email?: string } | null | undefined, now = Date.now()): Member {
  const email = String(profile?.email || 'you').toLowerCase();
  return {
    id: 'owner',
    email,
    name: profile?.name || nameFromEmail(email),
    role: 'owner',
    scope: WHOLE_WORKSPACE,
    status: 'active',
    invitedBy: '',
    at: now,
  };
}

/** The team as it was stored, or null when there is none or it can't be read. */
export function readTeam(raw: string | null): Member[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { members?: unknown };
    if (!Array.isArray(v?.members)) return null;
    return (v.members as Member[]).filter((m) => m && typeof m.email === 'string' && typeof m.id === 'string' && roleOf(m.role).id === m.role);
  } catch {
    return null;
  }
}

export const initialsOf = (member: Pick<Member, 'name' | 'email'>): string =>
  String(member?.name || member?.email || '?')
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('') || '?';
