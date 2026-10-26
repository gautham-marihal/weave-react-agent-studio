import React from 'react';
import './preview.css';

// The agent's presence in a test conversation: soft lights that drift and blend inside a glass sphere, the way a voice assistant shows it is there, rather
// than a shape that spins. CSS only (transforms and opacity on a few layers), so it costs little while you type beside it. Each style gives it its own
// colours (themes.css), and it holds still for people who ask for less motion.
//   size: pixels, or any CSS length (a variable the surrounding panel sets from the room it has)
//   state: 'idle' (waiting to start) | 'thinking' (starting, connecting, reconnecting) | 'live' (in a conversation) | 'rest' (ended, or it did not start)
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
