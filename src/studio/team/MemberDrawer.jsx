import React, { useMemo, useState } from 'react';
import Drawer from '../agent/Drawer.jsx';
import AccessPicker from './AccessPicker.jsx';
import { WHOLE_WORKSPACE, agentsScope, checkInvite, describeScope, hueOf, initialsOf, normalizeScope, roleOf, scopeProblem } from './teamModel.js';
import './team.css';
import Icon from '../../ui/Icon.jsx';

// One panel to invite people or change someone's access. Nothing changes until the bottom button is pressed;
// Cancel and Escape leave the team as it was.
export default function MemberDrawer({ mode, member = null, members, agents, startAgent = '', onClose, onInvite, onChange }) {
  const editing = mode === 'edit';
  const [emails, setEmails] = useState([]); // the addresses added so far
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [role, setRole] = useState(editing ? member.role : 'editor');
  const [scope, setScope] = useState(editing ? member.scope : startAgent ? agentsScope([startAgent]) : WHOLE_WORKSPACE);
  // what is typed, checked against the team and the addresses already added
  const pending = useMemo(() => checkInvite({ text, members: [...members, ...emails.map((email) => ({ email }))] }), [text, members, emails]);
  const problem = scopeProblem(role, normalizeScope(role, scope));
  const unchanged = editing && role === member.role && JSON.stringify(normalizeScope(role, scope)) === JSON.stringify(member.scope);
  const typedOk = text.trim() !== '' && pending.problems.length === 0 && pending.add.length > 0;
  const total = emails.length + (typedOk ? pending.add.length : 0);

  // puts the address that is typed in the list, when it is a good one; says what is wrong with it when it is not
  const addTyped = () => {
    if (!text.trim()) return true;
    if (!typedOk) {
      setError(pending.problems[0] || '');
      return false;
    }
    setEmails((old) => [...old, ...pending.add]);
    setText('');
    setError('');
    return true;
  };
  const submit = () => {
    if (editing) {
      onChange({ role, scope: normalizeScope(role, scope) });
      return;
    }
    if (text.trim() && !typedOk) {
      setError(pending.problems[0] || '');
      return;
    }
    if (total === 0) {
      setError('Enter an email address.');
      return;
    }
    if (!problem) onInvite({ emails: [...emails, ...(typedOk ? pending.add : [])], role, scope: normalizeScope(role, scope) });
  };

  const title = editing ? 'Change access' : 'Invite people';
  const actionLabel = editing ? 'Save access' : `Send ${total > 1 ? `${total} invitations` : 'invitation'}`;
  return (
    <Drawer
      title={title}
      icon="team"
      width="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="quietButton" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primaryCta compactCta" onClick={submit} disabled={editing ? !!problem || unchanged : !!problem || total === 0}>
            {actionLabel}
          </button>
        </>
      }
    >
      <div className="tmDrawer">
        {editing ? (
          <div className="tmWho">
            <span className="tmAvatar" style={{ '--hue': hueOf(member.email) }} aria-hidden="true">
              {initialsOf(member)}
            </span>
            <span>
              <strong>{member.name}</strong>
              <small>
                {member.email} · now {roleOf(member.role).label}, {describeScope(member.scope, agents).toLowerCase()}
              </small>
            </span>
          </div>
        ) : (
          <div className="tmField">
            <label htmlFor="tm-email">Email address</label>
            {emails.length > 0 && (
              <ul className="tmEmails" aria-label="People to invite">
                {emails.map((email) => (
                  <li key={email}>
                    <span>{email}</span>
                    <button type="button" aria-label={`Remove ${email}`} onClick={() => setEmails(emails.filter((e) => e !== email))}>
                      <Icon name="close" size={18} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="tmEmailRow">
              <input
                id="tm-email"
                className="stFInput"
                type="email"
                autoComplete="off"
                value={text}
                placeholder="name@company.com"
                aria-label="Email address"
                aria-invalid={!!error || undefined}
                onChange={(event) => {
                  setText(event.target.value);
                  setError('');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ',') {
                    event.preventDefault();
                    addTyped();
                  }
                }}
              />
              <button type="button" className="quietButton" onClick={addTyped} disabled={!text.trim()}>
                Add
              </button>
            </div>
            <small>
              {emails.length ? 'Press Enter to add another person.' : 'Press Enter to add it, then add more people if you like.'} Everyone added gets the same
              access, chosen below.
            </small>
            {error && (
              <p className="tmProblems" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
        <AccessPicker
          role={role}
          scope={scope}
          agents={agents}
          onChange={(next) => {
            setRole(next.role);
            setScope(next.scope);
          }}
        />
        {!editing && (
          <p className="tmFine">The invitation is saved in this browser for now. No email is sent yet, and the server does not enforce access yet.</p>
        )}
      </div>
    </Drawer>
  );
}
