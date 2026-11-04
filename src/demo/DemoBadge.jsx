import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { askConfirm } from '../ui/dialogs.js';
import { DEMO_NOTE, demoIsForced, isDemoMode, setDemoMode } from './demoMode.js';
import Button from '../ui/Button.tsx';

// The tag sits first in the screen's top bar (each has a DemoSlot) so it never covers a button;
// screens without a top bar (landing, sign-in) show it in the corner.
const slots = new Set();
const listeners = new Set();
const currentSlot = () => [...slots].pop() || null;
const announce = () => listeners.forEach((listener) => listener());

export function DemoSlot() {
  const node = useRef(null);
  const ref = useCallback((el) => {
    if (node.current) slots.delete(node.current);
    node.current = el;
    if (el) slots.add(el);
    announce();
  }, []);
  if (!isDemoMode()) return null;
  return <span className="demoSlot" ref={ref} />;
}

// A DEMO tag on every screen while the app runs on the imitation API, so a demo is never mistaken for the real thing.
// It explains what is simulated, resets the demo data, and (unless a demo build) switches back to the real API.
export function DemoBadge() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slot, setSlot] = useState(currentSlot);
  useEffect(() => {
    const follow = () => setSlot(currentSlot());
    listeners.add(follow);
    follow();
    return () => listeners.delete(follow);
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  if (!isDemoMode()) return null;

  const reset = async () => {
    const again = await askConfirm({
      title: 'Start the demo again?',
      body: 'The demo agents you made or changed are replaced by the sample ones.',
      confirmLabel: 'Start again',
      tone: 'danger',
    });
    if (!again) return;
    setBusy(true);
    const { resetDemoData } = await import('./demoApi.js');
    resetDemoData();
    window.location.hash = '#/bots';
    window.location.reload();
  };

  const tag = (
    <div className={`demoBadgeWrap ${slot ? 'inBar' : ''}`}>
      <button
        type="button"
        className="demoBadge"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        title="This is demo mode"
      >
        <i aria-hidden="true" />
        Demo
      </button>
      {open && (
        <div className="demoPopover" role="dialog" aria-label="About demo mode">
          <strong>Demo mode</strong>
          {/* the heading already says "Demo mode" */}
          <p>{DEMO_NOTE.replace(/^Demo mode:\s*/, '').replace(/^./, (c) => c.toUpperCase())}</p>
          <ul>
            <li>Agents, drafts, versions and deployments are kept in this browser (localStorage).</li>
            <li>The checks are a few simple rules, not the real validator.</li>
            <li>“Deployed” only means a record in this demo. No phone, widget or server is involved.</li>
          </ul>
          <div className="demoActions">
            <Button type="button" onClick={reset} disabled={busy}>
              Start the demo again
            </Button>
            {!demoIsForced() && (
              <Button type="button" variant="primary" size="compact" onClick={() => setDemoMode(false)}>
                Use the real API
              </Button>
            )}
          </div>
          {demoIsForced() && <small>This copy of Weave is a demo, so it always uses demo data.</small>}
        </div>
      )}
    </div>
  );
  return slot ? createPortal(tag, slot) : tag;
}

// The same words, in place, on a screen where a demo could mislead (publish, deploy, a test conversation).
export function DemoNote({ children, kind = 'deploy' }) {
  if (!isDemoMode()) return null;
  return (
    <p className={`demoNote ${kind}`} role="note">
      <b>Demo</b>
      <span>{children}</span>
    </p>
  );
}
