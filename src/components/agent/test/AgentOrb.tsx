import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { LiveOrb } from '../../ui/live-orb';
import { VoicePoweredOrb } from '../../ui/voice-powered-orb';
import { cn, easeOut } from '../../../utils/styles';

export type OrbState = 'ready' | 'connecting' | 'live' | 'error';

interface AgentOrbProps {
  state: OrbState;
  /** 0–1. Drives the fluid orb while live, and the glow behind every state. */
  level?: number;
  /** What the orb shows, for screen readers. */
  label: string;
  className?: string;
  /** Smaller orb (150px), for when a transcript shares the panel. */
  small?: boolean;
}

// Kept at module level: LiveOrb pushes new options to its engine whenever the array changes identity.
const CONNECTING_WASH = ['#7C6AF7', '#7DD3C7', '#E8B4D4'];

const ring: Record<OrbState, string> = {
  ready: 'border-line-strong',
  connecting: 'border-line-strong',
  live: 'border-violet-400/60 animate-breathe',
  error: 'border-red-400/60',
};

/** 240px orb, 180px below the `sm` breakpoint. */
function useOrbSize() {
  const query = '(max-width: 639px)';
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setCompact(e.matches);
    setCompact(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return compact ? 180 : 240;
}

/**
 * The voice agent's face. Ready and error show the eye orb, connecting shows its animated wash, and a live call
 * shows the fluid orb driven by `level`. States crossfade; once a fade ends only the current orb stays mounted,
 * since browsers allow only a handful of WebGL contexts.
 */
export function AgentOrb({ state, level = 0, label, className, small = false }: AgentOrbProps) {
  const fullSize = useOrbSize();
  const size = small ? 150 : fullSize;
  const reduceMotion = useReducedMotion();

  return (
    <div role="img" aria-label={label} className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 rounded-full blur-3xl transition-[opacity,transform] duration-150 ease-out',
          state === 'error' ? 'bg-red-500/20' : 'bg-violet-500/20'
        )}
        style={{ opacity: 0.6 + level * 0.4, transform: `scale(${1 + level * 0.25})` }}
      />
      <div aria-hidden className={cn('absolute -inset-2 rounded-full border transition-colors duration-300', ring[state])} />

      <AnimatePresence initial={false}>
        <motion.div
          key={state}
          aria-hidden
          className={cn(
            'absolute inset-0 rounded-full',
            state === 'error' && 'shadow-[0_0_60px_rgba(239,68,68,0.35)]'
          )}
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.4, ease: easeOut }}
        >
          {state === 'ready' && (
            <LiveOrb variant="custom" color="#7C5CFF" eyeColor="#FAFAFA" interactive blink size={size} />
          )}
          {state === 'connecting' && <LiveOrb variant="webgl" colors={CONNECTING_WASH} size={size} />}
          {state === 'live' && (
            <VoicePoweredOrb hue={0} enableVoiceControl={false} maxHoverIntensity={0.8} level={level} />
          )}
          {state === 'error' && (
            <LiveOrb variant="custom" color="#EF4444" eyeColor="#FFF5F5" blink={false} size={size} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
