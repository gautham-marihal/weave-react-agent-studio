import React, { useEffect, useState } from 'react';
import Icon from '../ui/Icon.jsx';
import './mobileNav.css';

// On a phone the sidebar is hidden, so this menu button opens it as a drawer. It works on every page because they all
// share the `.sidebar` element.
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
    // Choosing a page or workspace closes the drawer; the workspace menu, its ⋯ actions and collapse keep it open.
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
        <Icon name={open ? 'close' : 'menu'} size={20} />
      </button>
      {open && <div className="stNavScrim" onClick={() => setOpen(false)} aria-hidden="true" />}
    </>
  );
}
