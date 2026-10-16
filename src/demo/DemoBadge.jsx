import React, { useEffect, useState } from 'react';
import { DEMO_NOTE, demoIsForced, isDemoMode, setDemoMode } from './demoMode.js';

// A small DEMO tag that is on every screen while the app runs on the imitation API, so a demo is never mistaken for the real thing.
// It explains what is simulated, lets you start the demo data again, and (unless this is a demo build) switch back to the real API.
export function DemoBadge() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
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
    if (!window.confirm('Start the demo again? The demo agents you made or changed in this browser are replaced by the sample ones.')) return;
    setBusy(true);
    const { resetDemoData } = await import('./demoApi.js');
    resetDemoData();
    window.location.hash = '#/bots';
    window.location.reload();
  };

  return (
    <div className="demoBadgeWrap">
      <button
        type="button"
        className="demoBadge"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        title="This is demo mode"
      >
        <i aria-hidden="true" />
        DEMO
      </button>
      {open && (
        <div className="demoPopover" role="dialog" aria-label="About demo mode">
          <strong>Demo mode</strong>
          <p>{DEMO_NOTE}</p>
          <ul>
            <li>Agents, drafts, versions and deployments are kept in this browser (localStorage).</li>
            <li>The checks are a few simple rules, not the real validator.</li>
            <li>“Deployed” only means a record in this demo. No phone, widget or server is involved.</li>
          </ul>
          <div className="demoActions">
            <button type="button" className="quietButton" onClick={reset} disabled={busy}>
              Start the demo again
            </button>
            {!demoIsForced() && (
              <button type="button" className="primaryCta compactCta" onClick={() => setDemoMode(false)}>
                Use the real API
              </button>
            )}
          </div>
          {demoIsForced() && (
            <small>
              This is a demo build (<code>npm run dev:demo</code>). Run <code>npm run dev</code> to use the real API.
            </small>
          )}
        </div>
      )}
    </div>
  );
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
