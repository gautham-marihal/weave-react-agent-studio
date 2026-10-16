import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { Notice } from '../ui.jsx';
import PageShell from '../newlayout/PageShell.jsx';
import '../newlayout/newlayout.css';
import MemberDrawer from './MemberDrawer.jsx';
import { useTeam } from './useTeam.js';
import {
  addMembers,
  agentsOf,
  byRole,
  changeMember,
  describeScope,
  hueOf,
  initialsOf,
  isWhole,
  makeMember,
  pruneScopes,
  removeMember,
  roleOf,
  scopeAgents,
} from './teamModel.js';
import './team.css';

const STATUS = { active: { text: 'Active', tone: 'good' }, invited: { text: 'Invited', tone: 'wait' } };

// Who works in this workspace and on which agents. Someone is given a role and either the whole workspace or only some agents; the same choice can be made
// from inside one agent ("Share"). `agents` is [{ id, name }]; `agentsLoaded` is false while the list is still being read (so nobody is dropped from it).
export default function TeamPage({ agents, agentsLoaded = true, workspaceName }) {
  const { members, update } = useTeam();
  const [panel, setPanel] = useState(null); // { mode: 'invite' } | { mode: 'edit', id }
  const [query, setQuery] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [confirming, setConfirming] = useState('');
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  const me = members.find((m) => m.role === 'owner');

  // an agent that is gone takes the access to it away (only once the list of agents has been read)
  useEffect(() => {
    if (agentsLoaded && agents.length > 0)
      update((list) => {
        const next = pruneScopes(
          list,
          agents.map((a) => a.id),
        );
        return JSON.stringify(next) === JSON.stringify(list) ? list : next;
      });
  }, [agentsLoaded, agents, update]);

  const shown = useMemo(
    () =>
      members
        .filter((m) => {
          if (query.trim() && !`${m.name} ${m.email}`.toLowerCase().includes(query.trim().toLowerCase())) return false;
          if (agentFilter && !(isWhole(m.scope) || scopeAgents(m.scope).includes(agentFilter))) return false;
          return true;
        })
        .sort(byRole),
    [members, query, agentFilter],
  );
  const editing = panel?.mode === 'edit' ? members.find((m) => m.id === panel.id) : null;
  const waiting = members.filter((m) => m.status === 'invited').length;

  const invite = ({ emails, role, scope }) => {
    update(
      (list) =>
        addMembers(
          list,
          emails.map((email) => makeMember({ email, role, scope, by: me?.email })),
        ).members,
    );
    setPanel(null);
    setNotice(
      `${emails.length === 1 ? emails[0] : `${emails.length} people`} invited as ${roleOf(role).label.toLowerCase()}${emails.length === 1 ? '' : 's'}. Their access shows below.`,
    );
  };
  const change = (id, patch) => {
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
  const remove = (id) => {
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
    <PageShell
      title="Team"
      wide
      className="tmPage"
      lead={`Who can work in ${workspaceName || 'this workspace'}. Give each person the whole workspace, or only the agents they need.`}
      actions={
        <button
          type="button"
          className="primaryCta compactCta"
          onClick={() => {
            setPanel({ mode: 'invite' });
            setNotice('');
          }}
        >
          <Icon name="plus" size={14} /> Invite people
        </button>
      }
    >
      <Notice kind="info" title="Preview: saved in this browser only">
        The team and its access are kept here for now. No emails are sent and the server does not check them yet, so this does not limit anyone in practice. It
        is ready for when the server can.
      </Notice>
      {notice && (
        <p className="tmDone" role="status">
          {notice}
        </p>
      )}
      {problem && (
        <Notice kind="warn" title="That can’t be done">
          {problem}
        </Notice>
      )}

      <div className="tmTools">
        <input
          className="stFInput"
          type="search"
          value={query}
          placeholder="Search people"
          aria-label="Search people"
          onChange={(event) => setQuery(event.target.value)}
        />
        <label className="tmFilter">
          <span>Who can open</span>
          <select className="stFInput" value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)} aria-label="Who can open">
            <option value="">Any agent</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <span className="tmCount">
          {members.length} {members.length === 1 ? 'person' : 'people'}
          {waiting ? ` · ${waiting} invited` : ''}
        </span>
      </div>

      <div className="tmTable" role="table" aria-label="People in the workspace">
        <div className="tmHead" role="row">
          <span role="columnheader">Person</span>
          <span role="columnheader">Role</span>
          <span role="columnheader">Access</span>
          <span role="columnheader">Status</span>
          <span role="columnheader" className="srOnly">
            Actions
          </span>
        </div>
        {shown.map((m) => {
          const can = agentsOf(m, agents);
          return (
            <div key={m.id} className="tmRow" role="row" data-member={m.email}>
              <span className="tmPerson" role="cell">
                <span className="tmAvatar" style={{ '--hue': hueOf(m.email) }} aria-hidden="true">
                  {initialsOf(m)}
                </span>
                <span>
                  <strong>{m.name}</strong>
                  <small>{m.email}</small>
                </span>
              </span>
              <span role="cell">
                <span className={`tmRole ${m.role}`}>{roleOf(m.role).label}</span>
              </span>
              <span role="cell" className="tmScope">
                <strong>{describeScope(m.scope, agents)}</strong>
                {!isWhole(m.scope) && can.length > 1 && <small>{can.map((a) => a.name).join(', ')}</small>}
                {isWhole(m.scope) && (
                  <small>
                    {agents.length} agent{agents.length === 1 ? '' : 's'}, and new ones
                  </small>
                )}
              </span>
              <span role="cell">
                <span className={`tmStatus ${STATUS[m.status]?.tone || ''}`}>{STATUS[m.status]?.text || m.status}</span>
              </span>
              <span role="cell" className="tmActions">
                {m.role === 'owner' ? (
                  <small>Owner</small>
                ) : confirming === m.id ? (
                  <>
                    <span className="tmSure">Remove {m.name}?</span>
                    <button type="button" className="quietButton small danger" onClick={() => remove(m.id)}>
                      Remove
                    </button>
                    <button type="button" className="quietButton small" onClick={() => setConfirming('')}>
                      Keep
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="quietButton small"
                      onClick={() => {
                        setPanel({ mode: 'edit', id: m.id });
                        setNotice('');
                        setProblem('');
                      }}
                      aria-label={`Change access of ${m.name}`}
                    >
                      Change access
                    </button>
                    <button
                      type="button"
                      className="quietButton small"
                      onClick={() => {
                        setConfirming(m.id);
                        setProblem('');
                      }}
                      aria-label={`Remove ${m.name}`}
                    >
                      Remove
                    </button>
                  </>
                )}
              </span>
            </div>
          );
        })}
        {shown.length === 0 && (
          <p className="tmNone">{members.length > 1 ? 'No one matches.' : 'You are the only one here so far. Invite people to work with you.'}</p>
        )}
      </div>

      {panel?.mode === 'invite' && (
        <MemberDrawer mode="invite" members={members} agents={agents} startAgent={agentFilter} onClose={() => setPanel(null)} onInvite={invite} />
      )}
      {editing && (
        <MemberDrawer
          key={editing.id}
          mode="edit"
          member={editing}
          members={members}
          agents={agents}
          onClose={() => setPanel(null)}
          onChange={(patch) => change(editing.id, patch)}
        />
      )}
    </PageShell>
  );
}
