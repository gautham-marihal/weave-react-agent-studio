import React, { useMemo, useState } from 'react';
import { XIcon } from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { AccessPicker } from './AccessPicker';
import {
  WHOLE_WORKSPACE,
  checkInvite,
  describeScope,
  initialsOf,
  normalizeScope,
  roleOf,
  scopeProblem,
  type Member,
  type Scope,
  type TeamAgent,
  type TeamRole,
} from '../../models/team';
import { cn, inputClass, inputErrorClass } from '../../utils/styles';

// One dialog to invite people or change someone's access. Nothing changes until the bottom button is pressed;
// Cancel and Escape leave the team as it was.

type MemberDialogProps =
  | { mode: 'invite'; members: Member[]; agents: TeamAgent[]; onClose: () => void; onInvite: (x: { emails: string[]; role: TeamRole; scope: Scope }) => void }
  | { mode: 'edit'; member: Member; members: Member[]; agents: TeamAgent[]; onClose: () => void; onChange: (x: { role: TeamRole; scope: Scope }) => void };

export function MemberDialog(props: MemberDialogProps) {
  const { members, agents, onClose } = props;
  const editing = props.mode === 'edit';
  const member = editing ? props.member : null;
  const [emails, setEmails] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [role, setRole] = useState<TeamRole>(member ? member.role : 'editor');
  const [scope, setScope] = useState<Scope>(member ? member.scope : WHOLE_WORKSPACE);

  // what is typed, checked against the team and the addresses already added
  const pending = useMemo(() => checkInvite({ text, members: [...members, ...emails.map((email) => ({ email }))] }), [text, members, emails]);
  const problem = scopeProblem(role, normalizeScope(role, scope));
  const unchanged = !!member && role === member.role && JSON.stringify(normalizeScope(role, scope)) === JSON.stringify(member.scope);
  const typedOk = text.trim() !== '' && pending.problems.length === 0 && pending.add.length > 0;
  const total = emails.length + (typedOk ? pending.add.length : 0);

  // puts the typed address in the list when it is a good one; says what is wrong with it when it is not
  const addTyped = () => {
    if (!text.trim()) return;
    if (!typedOk) {
      setError(pending.problems[0] ?? '');
      return;
    }
    setEmails((old) => [...old, ...pending.add]);
    setText('');
    setError('');
  };

  const submit = () => {
    if (props.mode === 'edit') {
      props.onChange({ role, scope: normalizeScope(role, scope) });
      return;
    }
    if (text.trim() && !typedOk) {
      setError(pending.problems[0] ?? '');
      return;
    }
    if (total === 0) {
      setError('Enter an email address.');
      return;
    }
    if (!problem) props.onInvite({ emails: [...emails, ...(typedOk ? pending.add : [])], role, scope: normalizeScope(role, scope) });
  };

  const actionLabel = editing ? 'Save access' : total > 1 ? `Add ${total} invitations` : 'Add invitation';
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={editing ? 'Change access' : 'Invite people'}
      description={
        editing
          ? 'What this person may do, and on which agents.'
          : 'Kept in this browser: invitations are not sent and access is not enforced yet.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={editing ? !!problem || unchanged : !!problem || total === 0} data-testid="member-submit">
            {actionLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {member ? (
          <div className="flex items-center gap-3 rounded-lg bg-subtle p-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent" aria-hidden>
              {initialsOf(member)}
            </span>
            <span className="min-w-0 text-sm">
              <strong className="block truncate font-semibold text-ink">{member.name}</strong>
              <span className="block truncate text-xs text-muted">
                {member.email} · now {roleOf(member.role).label}, {describeScope(member.scope, agents).toLowerCase()}
              </span>
            </span>
          </div>
        ) : (
          <div>
            <label htmlFor="team-email" className="block text-sm font-semibold text-ink">
              Email address
            </label>
            {emails.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="People to invite" data-testid="team-emails">
                {emails.map((email) => (
                  <li key={email} className="inline-flex items-center gap-1 rounded-full bg-accent-soft py-0.5 pl-2.5 pr-1 text-xs font-medium text-accent">
                    <span>{email}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${email}`}
                      onClick={() => setEmails(emails.filter((e) => e !== email))}
                      className="rounded-full p-0.5 hover:bg-accent/10"
                    >
                      <XIcon className="h-3 w-3" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex gap-2">
              <input
                id="team-email"
                type="email"
                autoComplete="off"
                value={text}
                placeholder="name@company.com"
                aria-label="Email address"
                aria-invalid={!!error || undefined}
                aria-describedby={error ? 'team-email-error' : 'team-email-help'}
                onChange={(e) => {
                  setText(e.target.value);
                  setError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addTyped();
                  }
                }}
                className={cn(inputClass, error && inputErrorClass)}
              />
              <Button variant="secondary" onClick={addTyped} disabled={!text.trim()}>
                Add
              </Button>
            </div>
            <p id="team-email-help" className="mt-1.5 text-xs text-muted">
              {emails.length ? 'Press Enter to add another person.' : 'Press Enter to add it, then add more people if you like.'} Everyone added gets the same
              access, chosen below.
            </p>
            {error && (
              <p id="team-email-error" className="mt-1.5 text-[13px] text-danger" role="alert" data-testid="team-email-error">
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
      </div>
    </Dialog>
  );
}
