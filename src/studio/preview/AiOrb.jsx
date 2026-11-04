import React, { useEffect, useRef } from 'react';
import { createOrb } from './orbPainter.js';
import './preview.css';

// The agent's presence in a test conversation: the same woven sphere of threads as the voice orb (orbPainter.js), in the
// style's orb colours; it holds still for reduced motion. A small one (a status mark beside a chat) keeps a simple
// lit sphere, CSS only, since threads that small would read as a smudge.
//   size: pixels, or any CSS length (a variable the surrounding panel sets from the room it has)
//   state: 'idle' | 'thinking' (starting, connecting, reconnecting) | 'live' | 'rest' (ended, or it did not start)
const SMALL = 48;
// the chat's states as the globe's: live is the agent there and listening
const GLOBE_STATE = { idle: 'idle', thinking: 'thinking', live: 'listening', rest: 'ended' };

export default function AiOrb({ size = 120, state = 'idle', className = '' }) {
  const length = typeof size === 'number' ? `${size}px` : size;
  if (typeof size === 'number' && size < SMALL)
    return (
      <span className={`aiOrb ${state} ${className}`.trim()} style={{ '--orb-size': length }} aria-hidden="true">
        <span className="aiOrbCore">
          <i />
          <i />
          <i />
          <i />
        </span>
      </span>
    );
  return <GlobeOrb length={length} state={GLOBE_STATE[state] || 'idle'} className={className} />;
}

// The woven sphere, sized by the room it is given: its side is measured (the size may be a CSS variable) and followed
function GlobeOrb({ length, state, className }) {
  const box = useRef(null);
  const canvas = useRef(null);
  const orb = useRef(null);
  useEffect(() => {
    // no canvas to draw on in the tests' stand-in for a browser
    if (!box.current || !canvas.current || /jsdom/i.test(navigator.userAgent)) return undefined;
    const side = () => Math.round(box.current?.getBoundingClientRect().width || 120);
    orb.current = createOrb(canvas.current, { size: side() });
    orb.current.setState(state);
    const resized = typeof ResizeObserver === 'function' ? new ResizeObserver(() => orb.current?.setSize(side())) : null;
    resized?.observe(box.current);
    return () => {
      resized?.disconnect();
      orb.current?.destroy();
      orb.current = null;
    };
    // made once; its state is passed on below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => orb.current?.setState(state), [state]);
  return (
    <span ref={box} className={`aiOrb globe ${className}`.trim()} style={{ '--orb-size': length }} aria-hidden="true">
      <canvas ref={canvas} className="aiOrbCanvas" />
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
