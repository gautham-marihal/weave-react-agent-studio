import React from 'react';
import './preview.css';

// The agent's presence in a test conversation: soft lights drifting inside a glass sphere. CSS only (transforms and
// opacity) so it costs little while you type; each style colours it (themes.css); it holds still for reduced motion.
//   size: pixels, or any CSS length (a variable the surrounding panel sets from the room it has)
//   state: 'idle' | 'thinking' (starting, connecting, reconnecting) | 'live' | 'rest' (ended, or it did not start)
export default function AiOrb({ size = 120, state = 'idle', className = '' }) {
  return (
    <span className={`aiOrb ${state} ${className}`.trim()} style={{ '--orb-size': typeof size === 'number' ? `${size}px` : size }} aria-hidden="true">
      <span className="aiOrbCore">
        <i />
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}

// A conversation's status (the test session's, or the preview's) → the orb's state.
export function orbState(status) {
  if (status === 'idle') return 'idle';
  if (status === 'live') return 'live';
  if (status === 'ended' || status === 'error') return 'rest';
  return 'thinking';
}
