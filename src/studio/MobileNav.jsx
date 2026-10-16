import React, { useEffect, useState } from 'react';
import './mobileNav.css';

// On a phone the sidebar is hidden, which left no way to move between pages. This adds a menu button that
// opens the same sidebar as a drawer. It works for every page because they all share the `.sidebar` element.
export default function MobileNav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.body.classList.toggle('mobileNavOpen', open);
    return () => document.body.classList.remove('mobileNavOpen');
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    // Choosing a page or a workspace closes the drawer; opening the workspace menu, its ⋯ actions and the
    // collapse button keep it open.
    const onClick = (event) => {
      const target = event.target instanceof Element ? event.target.closest('.sidebar button, .sidebar a') : null;
      if (target && (!target.closest('.workspaceSwitch, .workspaceMenu, .collapse') || target.closest('.workspaceOption'))) setOpen(false);
    };
    const onHash = () => setOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    window.addEventListener('hashchange', onHash);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
      window.removeEventListener('hashchange', onHash);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="stNavToggle"
        aria-label={open ? 'Close the menu' : 'Open the menu'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">{open ? '×' : '☰'}</span>
      </button>
      {open && <div className="stNavScrim" onClick={() => setOpen(false)} aria-hidden="true" />}
    </>
  );
}
