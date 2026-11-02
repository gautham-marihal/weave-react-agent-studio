import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronRightIcon, CircleHelpIcon, LogOutIcon, UserIcon } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { AccountDialog, roleLabel } from './AccountDialog';

// The person's menu at the right of the top bar: who is signed in, their account, help and shortcuts, and sign out.
// Escape or a click outside closes it and gives focus back to the button; arrow keys move between its items.
export function ProfileMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!user) return null;

  const close = (focusBack = true) => {
    setOpen(false);
    if (focusBack) buttonRef.current?.focus();
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(at + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(at - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Your account: ${user.name}`}
        title={user.name}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent ring-offset-2 ring-offset-surface transition-shadow hover:ring-2 hover:ring-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <span aria-hidden>{user.initials}</span>
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={user.name}
          onKeyDown={onMenuKey}
          className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-line bg-surface p-1.5 shadow-overlay"
        >
          <div className="flex items-center gap-2.5 px-2 py-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent" aria-hidden>
              {user.initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{user.name}</p>
              <p className="truncate text-xs text-muted">{user.phone ?? user.email}</p>
              <p className="truncate text-xs text-muted">{roleLabel[user.role]} · temporary sign-in</p>
            </div>
          </div>
          <div className="my-1 h-px bg-line" aria-hidden />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close(false);
              setAccountOpen(true);
            }}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm text-ink hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none"
          >
            <UserIcon className="h-4 w-4 text-muted" aria-hidden />
            <span className="flex-1">
              Account
              <span className="block text-xs text-muted">Profile and workspace details</span>
            </span>
            <ChevronRightIcon className="h-4 w-4 text-muted" aria-hidden />
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close(false);
              window.dispatchEvent(new CustomEvent('open-help-modal'));
            }}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm text-ink hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none"
          >
            <CircleHelpIcon className="h-4 w-4 text-muted" aria-hidden />
            <span className="flex-1">Help & shortcuts</span>
            <kbd className="rounded bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-muted">?</kbd>
          </button>
          <div className="my-1 h-px bg-line" aria-hidden />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close(false);
              signOut();
            }}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm text-ink hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none"
          >
            <LogOutIcon className="h-4 w-4 text-muted" aria-hidden />
            Sign out
          </button>
        </div>
      )}

      <AccountDialog open={accountOpen} onClose={() => setAccountOpen(false)} />
    </div>
  );
}
