import React, { useEffect, useReducer, useRef } from 'react';
import StatusChip from '../../ui/StatusChip.tsx';
import { captionOf, speakingEndsAt, voiceBadge, voiceStateOf, voiceWords } from './voiceState.js';
import './voice.css';

// A voice conversation as one big orb: the agent's state in the middle (listening, thinking, speaking), what is
// happening under it, and the latest line as captions. Used by Test and the Preview when the channel is web voice.

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

// The orb: swirling colour inside a sphere, in the style's orb colours (themes.css). It moves with the agent's voice:
// getLevel() is read every frame (a real call's loudness); without it, while speaking, it moves as if talking. The
// level is written straight onto the element as --lvl, so the conversation does not re-render sixty times a second.
//   state: a voiceState.js state; size: pixels or any CSS length
function VoiceOrb({ state = 'idle', size = 200, getLevel }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    el.style.setProperty('--lvl', '0');
    if (state !== 'speaking' || window.matchMedia?.(REDUCED_MOTION).matches) return undefined;
    const startedAt = performance.now();
    let smooth = 0;
    let frame = 0;
    const tick = (time) => {
      const seconds = (time - startedAt) / 1000;
      const raw = getLevel ? Math.min(1, getLevel() * 2.2) : Math.max(0, 0.45 + 0.4 * Math.sin(seconds * 7.3) * Math.sin(seconds * 2.1 + 1));
      smooth += (raw - smooth) * 0.25;
      el.style.setProperty('--lvl', smooth.toFixed(3));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state, getLevel]);

  return (
    <span ref={ref} className={`vOrb ${state}`} style={{ '--size': typeof size === 'number' ? `${size}px` : size }} aria-hidden="true">
      <span className="vOrbGlow" />
      <span className="vOrbRing" />
      <span className="vOrbBody">
        <i />
        <i />
        <i />
      </span>
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
  const caption = state === 'idle' ? null : captionOf(session.messages);
  return (
    <div className={`vStage ${state} ${className}`.trim()} data-voice-state={state}>
      {showBadge && (
        <StatusChip tone={badge.tone} className="vBadge">
          {badge.text}
        </StatusChip>
      )}
      <VoiceOrb state={state} size={size} getLevel={session.agentLevel} />
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
