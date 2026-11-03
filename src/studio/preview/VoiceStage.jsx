import React, { useEffect, useReducer, useRef } from 'react';
import { createOrb } from './orbPainter.js';
import StatusChip from '../../ui/StatusChip.tsx';
import { captionOf, speakingEndsAt, voiceBadge, voiceStateOf, voiceWords } from './voiceState.js';
import { maskConversation } from '../privacy/maskConfidential.js';
import './voice.css';

// A voice conversation as one big orb: the agent's state in the middle (listening, thinking, speaking), what is
// happening under it, and the latest line as captions. Used by Test and the Preview when the channel is web voice.

// The orb: threads of light woven into a turning sphere, with sonar rings, drawn by orbPainter.js in the style's orb colours (themes.css),
// each state with its own motion; it follows the agent's voice while it speaks (getLevel) and the caller's while it
// listens (getUserLevel). The painter reads the levels every frame itself, so the conversation does not re-render sixty
// times a second.
//   state: a voiceState.js state; size: in pixels (the rings reach past it)
function VoiceOrb({ state = 'idle', size = 200, getLevel, getUserLevel }) {
  const canvas = useRef(null);
  const orb = useRef(null);
  // the levels are read through refs, so a new session's functions are used without starting the orb again
  const levels = useRef({ getLevel, getUserLevel });
  levels.current = { getLevel, getUserLevel };
  const px = typeof size === 'number' ? size : 200;
  useEffect(() => {
    // no canvas to draw on in the tests' stand-in for a browser
    if (!canvas.current || /jsdom/i.test(navigator.userAgent)) return undefined;
    orb.current = createOrb(canvas.current, {
      size: px,
      getLevel: () => (levels.current.getLevel ? levels.current.getLevel() : null),
      getUserLevel: () => levels.current.getUserLevel?.() || 0,
    });
    return () => {
      orb.current?.destroy();
      orb.current = null;
    };
    // made once; its size and state are passed on below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => orb.current?.setSize(px), [px]);
  useEffect(() => orb.current?.setState(state), [state]);
  return (
    <span className={`vOrb ${state}`} style={{ '--size': `${px}px` }} aria-hidden="true">
      <canvas ref={canvas} className="vOrbCanvas" />
    </span>
  );
}

// The session's voice state, moving on by itself when a simulated reply has been "said".
function useVoiceState(session) {
  const [, redraw] = useReducer((n) => n + 1, 0);
  const endsAt = speakingEndsAt(session);
  useEffect(() => {
    if (!endsAt) return undefined;
    const timer = window.setTimeout(redraw, Math.max(0, endsAt - Date.now()) + 30);
    return () => window.clearTimeout(timer);
  }, [endsAt]);
  return voiceStateOf(session);
}

//   session: a live or simulated session; size: the orb's size; announce: false when a transcript beside it already
//   reads new lines out; badge: false where the panel shows the status already; children: the controls under the captions
export default function VoiceStage({ session, size = 200, announce = true, badge: showBadge = true, className = '', children }) {
  const state = useVoiceState(session);
  const { title, detail } = voiceWords(state, session);
  const badge = voiceBadge(state);
  const caption = state === 'idle' ? null : captionOf(maskConversation(session.messages));
  return (
    <div className={`vStage ${state} ${className}`.trim()} data-voice-state={state}>
      {showBadge && (
        <StatusChip tone={badge.tone} className="vBadge">
          {badge.text}
        </StatusChip>
      )}
      <VoiceOrb state={state} size={size} getLevel={session.agentLevel} getUserLevel={session.userLevel} />
      <div className="vWords" role="status">
        <strong>{title}</strong>
        {detail && <span>{detail}</span>}
      </div>
      <div className="vCaptions" aria-label="Captions" aria-live={announce ? 'polite' : undefined}>
        {caption ? (
          <p>
            <b>{caption.who}</b> {caption.text}
            {!caption.final && <i className="vCaret" aria-hidden="true" />}
          </p>
        ) : (
          <p className="vCaptionsEmpty">Captions will stream here as the agent speaks…</p>
        )}
      </div>
      {children}
    </div>
  );
}
