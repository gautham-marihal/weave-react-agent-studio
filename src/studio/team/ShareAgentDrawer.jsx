import React, { useMemo, useState } from 'react';
import Drawer from '../newlayout/Drawer.jsx';
import AccessPicker from './AccessPicker.jsx';
import { useTeam } from './useTeam.js';
import { addMembers, agentsScope, checkInvite, grantAgent, hueOf, initialsOf, makeMember, peopleWithAccess, revokeAgent, roleOf } from './teamModel.js';
import './team.css';

const VIA = { workspace: 'Whole workspace', agent: 'This agent only' };

// "Who can open this agent?" from inside the agent: the people who can (some because they have the whole workspace, some because this agent was shared with
// them), and a way to share just this one agent with someone, by their address or from the people already on the team. The rest of the workspace stays
// closed to them; that is chosen from the Team page.
export default function ShareAgentDrawer({ botId, name, onClose, onOpenTeam }) {
  const { members, update } = useTeam();
  const agent = useMemo(() => ({ id: botId, name }), [botId, name]);
  const people = peopleWithAccess(members, botId);
  const others = members.filter((m) => !people.some((p) => p.member.id === m.id) && !roleOf(m.role).workspaceOnly);
  const [text, setText] = useState('');
  const [role, setRole] = useState('viewer');
  const [touched, setTouched] = useState(false);
  const [done, setDone] = useState('');
  const check = useMemo(() => checkInvite({ text, members }), [text, members]);
  const existing = useMemo(() => members.filter((m) => check.already.includes(m.email)), [members, check.already]);

  const share = () => {
    setTouched(true);
    const parsed = checkInvite({ text, members });
    const byAddress = members.filter((m) => parsed.already.includes(m.email) && !roleOf(m.role).workspaceOnly);
    if (!parsed.add.length && !byAddress.length) return;
    if (parsed.invalid.length) return;
    update((list) => {
      let next = list;
      byAddress.forEach((m) => {
        next = grantAgent(next, m.id, botId, role);
      });
      return parsed.add.length
        ? addMembers(
            next,
            parsed.add.map((email) => makeMember({ email, role, scope: agentsScope([botId]), by: members.find((m) => m.role === 'owner')?.email })),
          ).members
        : next;
    });
    setDone(`Shared ${name} with ${[...parsed.add, ...byAddress.map((m) => m.email)].join(', ')} as ${roleOf(role).label.toLowerCase()}.`);
    setText('');
    setTouched(false);
  };
  const addExisting = (member) => {
    update((list) => grantAgent(list, member.id, botId, member.role));
    setDone(`${member.name} can now open ${name}.`);
  };
  const stop = (member) => {
    update((list) => revokeAgent(list, member.id, botId).members);
    setDone(`${member.name} can no longer open ${name}.`);
  };

  const problems = touched ? check.problems.filter((p) => !/already on the team/.test(p) || existing.every((m) => roleOf(m.role).workspaceOnly)) : [];

  return (
    <Drawer
      title={`Share ${name}`}
      icon="team"
      width="wide"
      onClose={onClose}
      footer={
        <button type="button" className="primaryCta compactCta" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="tmDrawer">
        <section className="tmBlock">
          <header>
            <h3>Who can open this agent</h3>
            <p>People with the whole workspace can open every agent. Others can open it because it was shared with them.</p>
          </header>
          <ul className="tmShareList" aria-label="People who can open this agent">
            {people.map(({ member, role: r, via }) => (
              <li key={member.id} data-member={member.email}>
                <span className="tmAvatar" style={{ '--hue': hueOf(member.email) }} aria-hidden="true">
                  {initialsOf(member)}
                </span>
                <span className="tmShareWho">
                  <strong>{member.name}</strong>
                  <small>
                    {member.email}
                    {member.status === 'invited' ? ' · invited' : ''}
                  </small>
                </span>
                <span className={`tmRole ${r}`}>{roleOf(r).label}</span>
                <span className="tmVia">{VIA[via]}</span>
                {via === 'agent' ? (
                  <button type="button" className="quietButton small" onClick={() => stop(member)} aria-label={`Stop sharing with ${member.name}`}>
                    Remove
                  </button>
                ) : (
                  <span className="tmViaNote">{member.role === 'owner' ? 'Owner' : 'Change on Team'}</span>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="tmBlock">
          <header>
            <h3>Share only this agent</h3>
            <p>They can open {name} and nothing else in the workspace.</p>
          </header>
          <div className="tmField">
            <label htmlFor="tm-share-emails">Email addresses</label>
            <input
              id="tm-share-emails"
              className="stFInput"
              type="text"
              value={text}
              placeholder="name@company.com"
              aria-label="Email address to share with"
              aria-invalid={problems.length > 0 || undefined}
              onChange={(event) => setText(event.target.value)}
              onBlur={() => setTouched(true)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  share();
                }
              }}
            />
            {problems.length > 0 && (
              <ul className="tmProblems" role="alert">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </div>
          <AccessPicker
            role={role}
            scope={agentsScope([botId])}
            agents={[agent]}
            fixedAgent={agent}
            roles={['editor', 'viewer'].map(roleOf)}
            onChange={(next) => setRole(next.role)}
          />
          <div className="tmShareActions">
            <button type="button" className="primaryCta compactCta" onClick={share} disabled={!text.trim()}>
              Share {name}
            </button>
          </div>
          {others.length > 0 && (
            <div className="tmField">
              <label htmlFor="tm-existing">Or someone already on the team</label>
              <div className="tmExisting">
                <select
                  id="tm-existing"
                  className="stFInput"
                  aria-label="Someone already on the team"
                  defaultValue=""
                  onChange={(event) => {
                    const m = members.find((x) => x.id === event.target.value);
                    if (m) {
                      addExisting(m);
                      event.target.value = '';
                    }
                  }}
                >
                  <option value="">Choose a person…</option>
                  {others.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({roleOf(m.role).label},{' '}
                      {m.scope.agents ? `${m.scope.agents.length} agent${m.scope.agents.length === 1 ? '' : 's'}` : 'no agents'})
                    </option>
                  ))}
                </select>
              </div>
              <small>They keep their role and the agents they already have; this adds {name}.</small>
            </div>
          )}
        </section>

        {done && (
          <p className="tmDone" role="status">
            {done}
          </p>
        )}
        <p className="tmFine">
          Saved in this browser for now: no email is sent and the server does not enforce access yet.{' '}
          <button
            type="button"
            className="linkButton"
            onClick={() => {
              onClose();
              (onOpenTeam || (() => window.dispatchEvent(new Event('weave-open-team'))))();
            }}
          >
            Open the Team page
          </button>{' '}
          to give someone the whole workspace.
        </p>
      </div>
    </Drawer>
  );
}
