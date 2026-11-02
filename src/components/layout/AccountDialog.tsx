import React from 'react';
import { Link } from 'react-router-dom';
import { LogOutIcon } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';

export const roleLabel = { admin: 'Admin', editor: 'Editor', viewer: 'Viewer' } as const;

const roleText = {
  admin: 'Can edit, publish and deploy anywhere, including Production.',
  editor: 'Can edit, publish and deploy to Development and Staging.',
  viewer: 'Can look at agents and calls. Can’t change anything.',
} as const;

/** Who is signed in: name, email, workspace and role, and a way to sign out. Nothing here is checked by a server yet. */
export function AccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, signOut, keepSignedIn } = useAuth();
  if (!user) return null;

  const rows: [string, React.ReactNode][] = [
    ['Full name', user.name],
    [user.phone ? 'Phone' : 'Email', user.phone ?? user.email],
    ['Workspace', user.workspaceName || <span className="text-muted">Not named yet</span>],
    [
      'Role',
      <>
        <span className="font-medium">{roleLabel[user.role]}</span>
        <span className="block text-xs text-muted">{roleText[user.role]}</span>
      </>,
    ],
    [
      'Signed in',
      keepSignedIn
        ? 'Kept in this browser until you sign out.'
        : 'Until this browser is closed.',
    ],
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Your account"
      description="Profile and workspace details for this browser."
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              onClose();
              signOut();
            }}
          >
            <LogOutIcon className="h-4 w-4" aria-hidden />
            Sign out
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent" aria-hidden>
          {user.initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-ink">{user.name}</p>
          <p className="truncate text-sm text-muted">{user.phone ?? user.email}</p>
        </div>
      </div>
      <dl className="mt-5 divide-y divide-line rounded-lg border border-line">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-1 px-4 py-2.5 text-sm sm:grid-cols-[120px_1fr]">
            <dt className="text-muted">{label}</dt>
            <dd className="text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-[13px] leading-relaxed text-muted">
        This is a temporary sign-in: your email or phone is sent to the API as your name on saves and publishes, and no
        password is checked yet. Who else works here is on the{' '}
        <Link to="/team" onClick={onClose} className="font-medium text-accent hover:underline">
          Team
        </Link>{' '}
        page.
      </p>
    </Dialog>
  );
}
