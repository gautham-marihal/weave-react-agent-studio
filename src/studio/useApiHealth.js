import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import { isDemoMode } from '../demo/demoMode.js';

// Whether the Agent Builder API answers, and nothing more: the API has no status endpoint for the worker, LiveKit or
// provider keys, so the wording never claims they are fine.
//   state: 'checking' | 'up' | 'slow' (answers after SLOW_MS or more) | 'down' | 'demo'
//   show: whether a person needs to be told (an answering or still-checking server goes unsaid)
const SLOW_MS = 1500;
const inWords = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);

//   latency: how long its last answer took, in ms (null before the first)
export function describeHealth(state, latency = null) {
  switch (state) {
    case 'up':
      return {
        show: false,
        tone: 'good',
        title: latency === null ? 'Connected' : `Connected · ${inWords(latency)}`,
        note: 'The server answers. This does not check the worker, LiveKit or provider keys.',
      };
    case 'slow':
      return {
        show: false,
        tone: 'warn',
        title: `Connected, but slow · ${inWords(latency)}`,
        note: 'The server answers, but slowly: loading and saving may take a moment.',
      };
    case 'down':
      // the strip across every page says it (ui/Connectivity.jsx), so Home doesn't repeat it
      return { show: false, tone: 'bad', title: 'Can’t reach the server', note: 'Nothing can be loaded or saved until it answers again. Weave keeps trying.' };
    case 'demo':
      return { show: true, tone: 'idle', title: 'Demo data', note: 'There is no server in demo mode: everything is kept in this browser.' };
    default:
      return { show: false, tone: 'idle checking', title: 'Checking the server…', note: '' };
  }
}

// -> { state, latency, recheck }; recheck asks now (a banner's "Try again"). Polls every 15 s while down, else 60 s.
export function useApiHealth(everyMs = 60000) {
  const [state, setState] = useState(isDemoMode() ? 'demo' : 'checking');
  const [latency, setLatency] = useState(null);
  const check = useRef(() => {});
  useEffect(() => {
    if (isDemoMode()) {
      setState('demo');
      return undefined;
    }
    let off = false;
    check.current = () => {
      const started = performance.now();
      return api.health().then(
        () => {
          if (off) return;
          const took = Math.round(performance.now() - started);
          setLatency(took);
          setState(took >= SLOW_MS ? 'slow' : 'up');
        },
        () => {
          if (!off) setState('down');
        },
      );
    };
    check.current();
    const timer = setInterval(() => check.current(), state === 'down' ? Math.min(15000, everyMs) : everyMs);
    return () => {
      off = true;
      clearInterval(timer);
    };
  }, [everyMs, state === 'down']); // eslint-disable-line react-hooks/exhaustive-deps -- re-armed only when it goes down or comes back
  const recheck = useCallback(() => check.current(), []);
  return { state, latency, recheck };
}
