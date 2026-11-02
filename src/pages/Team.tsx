import React, { useEffect, useMemo, useState } from 'react';
import { InfoIcon, PlusIcon, SearchIcon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useStudio } from '../contexts/StudioContext';
import { useTeam } from '../hooks/useTeam';
import { Button } from '../components/ui/Button';
import { StatusChip } from '../components/ui/StatusChip';
import { MemberDialog } from '../components/team/MemberDialog';
import {
  addMembers,
  agentsOf,
  byRole,
  changeMember,
  describeScope,
  initialsOf,
  isWhole,
  makeMember,
  pruneScopes,
  removeMember,
  roleOf,
  scopeAgents,
  type Scope,
  type TeamRole,
} from '../models/team';
import { cn, inputClass, pageClass } from '../utils/styles';
import { isSandbox } from '../sandbox/mode';

// Sandbox: the sample people (src/sandbox/sampleTeam.ts, loaded only in Sandbox) are added the first time, and marked
const SAMPLE_PREFIX = 'sample_';
const isSample = (id: string) => isSandbox() && id.startsWith(SAMPLE_PREFIX);

// Who works in this workspace and on which agents. There is no team API yet: the list is kept in this browser, no
// invitation is sent, and the server does not enforce any of it. The page says so plainly.

const roleTone = { owner: 'accent', admin: 'primary', editor: 'info', viewer: 'neutral' } as const;

export function Team() {
  const { user } = useAuth();
  const { agents: studioAgents, loading } = useStudio();
  const { members, fresh, update } = useTeam();
  const agents = useMemo(() => studioAgents.map((a) => ({ id: a.id, name: a.name || a.id })), [studioAgents]);
  const [panel, setPanel] = useState<{ mode: 'invite' } | { mode: 'edit'; id: string } | null>(null);
  const [query, setQuery] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [confirming, setConfirming] = useState('');
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  const owner = members.find((m) => m.role === 'owner');
  const workspaceName = user?.workspaceName || 'this workspace';

  // Sandbox starts with React's sample team: the owner and three made-up people to try the page with
  useEffect(() => {
    if (!isSandbox() || !fresh || loading) return;
    let off = false;
    void import('../sandbox/sampleTeam').then(({ sampleTeam }) => {
      if (!off) update((list) => (list.length === 1 && list[0].role === 'owner' ? sampleTeam(list[0], agents.map((a) => a.id)) : list));
    });
    return () => {
      off = true;
    };
  }, [fresh, loading, agents, update]);
  const samples = members.filter((m) => isSample(m.id)).length;

  // an agent that is gone takes the access to it away (only once the list of agents has been read)
  useEffect(() => {
    if (loading || agents.length === 0) return;
    update((list) => {
      const next = pruneScopes(
        list,
        agents.map((a) => a.id)
      );
      return JSON.stringify(next) === JSON.stringify(list) ? list : next;
    });
  }, [loading, agents, update]);

  const shown = useMemo(
    () =>
      members
        .filter((m) => {
          if (query.trim() && !`${m.name} ${m.email}`.toLowerCase().includes(query.trim().toLowerCase())) return false;
          if (agentFilter && !(isWhole(m.scope) || scopeAgents(m.scope).includes(agentFilter))) return false;
          return true;
        })
        .sort(byRole),
    [members, query, agentFilter]
  );
  const editing = panel?.mode === 'edit' ? members.find((m) => m.id === panel.id) : undefined;
  const waiting = members.filter((m) => m.status === 'invited').length;

  const invite = ({ emails, role, scope }: { emails: string[]; role: TeamRole; scope: Scope }) => {
    update((list) => addMembers(list, emails.map((email) => makeMember({ email, role, scope, by: owner?.email }))).members);
    setPanel(null);
    setProblem('');
    setNotice(
      `${emails.length === 1 ? emails[0] : `${emails.length} people`} added as ${roleOf(role).label.toLowerCase()}${emails.length === 1 ? '' : 's'}. No email was sent.`
    );
  };
  const change = (id: string, patch: { role: TeamRole; scope: Scope }) => {
    const result = changeMember(members, id, patch);
    if (result.problem) {
      setProblem(result.problem);
      return;
    }
    update(() => result.members);
    setPanel(null);
    setProblem('');
    setNotice('Access saved.');
  };
  const remove = (id: string) => {
    const result = removeMember(members, id);
    setConfirming('');
    if (result.problem) {
      setProblem(result.problem);
      return;
    }
    setProblem('');
    setNotice('Removed from the team.');
    update(() => result.members);
  };

  return (
    <div className={pageClass}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Team</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Who can work in {workspaceName}. Give each person the whole workspace, or only the agents they need.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            setPanel({ mode: 'invite' });
            setNotice('');
            setProblem('');
          }}
        >
          <PlusIcon className="h-4 w-4" aria-hidden />
          Invite people
        </Button>
      </div>

      <div className="mt-6 flex gap-2.5 rounded-lg border border-info/30 bg-info-soft p-3 text-[13px] text-ink" role="note" data-testid="team-note">
        <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
        <p>
          <strong className="font-semibold">Kept in this browser: invitations are not sent and access is not enforced yet.</strong> The list is a plan of
          who should have which access, ready for when the server can hold it. Everyone signed in to this studio can still do everything their role
          in Settings allows.
        </p>
      </div>

      {samples > 0 && (
        <div className="mt-3 flex gap-2.5 rounded-lg border border-warning/30 bg-warning-soft p-3 text-[13px] text-ink" role="note" data-testid="team-samples">
          <StatusChip tone="warning" className="h-5 shrink-0">Sample</StatusChip>
          <p>
            <strong className="font-semibold">Sandbox starts with a sample team.</strong> The people marked “Sample” are made up in this browser so there is
            something to try the page with. Change or remove them as you like; they never appear in Live.
          </p>
        </div>
      )}

      {notice && (
        <p className="mt-4 text-[13px] font-medium text-success" role="status" data-testid="team-notice">
          {notice}
        </p>
      )}
      {problem && (
        <p className="mt-4 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[13px] text-ink" role="alert">
          <strong className="font-semibold">That can’t be done.</strong> {problem}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={query}
            placeholder="Search people"
            aria-label="Search people"
            onChange={(e) => setQuery(e.target.value)}
            className={cn(inputClass, 'h-9 py-1 pl-8')}
          />
        </div>
        <label className="flex items-center gap-2 text-[13px] text-muted">
          Who can open
          <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} aria-label="Who can open" className={cn(inputClass, 'h-9 w-auto py-1 pr-8')}>
            <option value="">Any agent</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <span className="ml-auto text-[13px] text-muted" data-testid="team-count">
          {members.length} {members.length === 1 ? 'person' : 'people'}
          {waiting ? ` · ${waiting} invited` : ''}
        </span>
      </div>

      <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm" aria-label="People in the workspace">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th scope="col" className="px-4 py-2.5 font-medium">Person</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Role</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Access</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => {
              const can = agentsOf(m, agents);
              return (
                <tr key={m.id} className="border-b border-line last:border-0" data-member={m.email}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-subtle text-xs font-semibold text-ink-soft" aria-hidden>
                        {initialsOf(m)}
                      </span>
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 truncate font-medium text-ink">
                          {m.name}
                          {isSample(m.id) && (
                            <StatusChip tone="warning" className="shrink-0" title="A made-up person Sandbox starts with">
                              Sample
                            </StatusChip>
                          )}
                        </p>
                        <p className="truncate text-xs text-muted">{m.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusChip tone={roleTone[m.role]}>{roleOf(m.role).label}</StatusChip>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-ink">{describeScope(m.scope, agents)}</p>
                    {!isWhole(m.scope) && can.length > 1 && <p className="text-xs text-muted">{can.map((a) => a.name).join(', ')}</p>}
                    {isWhole(m.scope) && (
                      <p className="text-xs text-muted">
                        {agents.length} agent{agents.length === 1 ? '' : 's'}, and new ones
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {m.status === 'active' ? <StatusChip tone="success" dot>Active</StatusChip> : <StatusChip tone="warning" dot>Invited</StatusChip>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {m.role === 'owner' ? (
                      <span className="text-xs text-muted">Owner</span>
                    ) : confirming === m.id ? (
                      <span className="inline-flex flex-wrap items-center justify-end gap-2">
                        <span className="text-[13px] text-ink">Remove {m.name}?</span>
                        <Button size="sm" variant="danger" onClick={() => remove(m.id)}>
                          Remove
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirming('')}>
                          Keep
                        </Button>
                      </span>
                    ) : (
                      <span className="inline-flex gap-1.5">
                        <Button
                          size="sm"
                          variant="secondary"
                          aria-label={`Change access of ${m.name}`}
                          onClick={() => {
                            setPanel({ mode: 'edit', id: m.id });
                            setNotice('');
                            setProblem('');
                          }}
                        >
                          Change access
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Remove ${m.name}`}
                          onClick={() => {
                            setConfirming(m.id);
                            setProblem('');
                          }}
                        >
                          Remove
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted">
            {members.length > 1 ? 'No one matches.' : 'You are the only one here so far. Invite people to work with you.'}
          </p>
        )}
        {shown.length === 1 && members.length === 1 && (
          <p className="border-t border-line px-4 py-3 text-[13px] text-muted">You are the only one here so far. Invite people to work with you.</p>
        )}
      </div>

      {panel?.mode === 'invite' && <MemberDialog mode="invite" members={members} agents={agents} onClose={() => setPanel(null)} onInvite={invite} />}
      {editing && (
        <MemberDialog
          key={editing.id}
          mode="edit"
          member={editing}
          members={members}
          agents={agents}
          onClose={() => setPanel(null)}
          onChange={(patch) => change(editing.id, patch)}
        />
      )}
    </div>
  );
}
