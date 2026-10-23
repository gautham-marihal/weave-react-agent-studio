import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { isDemoMode } from '../demo/demoMode.js';

// Whether the Agent Builder API answers. That is ALL it tells: nothing here says the worker, LiveKit or a provider's key is fine (the API
// has no status endpoint for those yet, see "What the backend side can provide next" in the review), so the wording never claims more.
// state: 'checking' | 'up' | 'down' | 'demo'
//   show: whether a person needs to be told (a server that answers, or is still being asked, goes unsaid)
export function describeHealth(state) {
  switch (state) {
    case 'up':
      return { show: false, tone: 'good', title: 'Connected', note: 'The server answers. This does not check the worker, LiveKit or provider keys.' };
    case 'down':
      // the strip across the top of every page says it (ui/Connectivity.jsx), so the line on Home doesn't repeat it
      return { show: false, tone: 'bad', title: 'Can’t reach the server', note: 'Nothing can be loaded or saved until it answers again. Weave keeps trying.' };
    case 'demo':
      return { show: true, tone: 'idle', title: 'Demo data', note: 'There is no server in demo mode: everything is kept in this browser.' };
    default:
      return { show: false, tone: 'idle', title: 'Checking the server…', note: '' };
  }
}

// -> { state, recheck }: recheck asks again now (the "Try again" of a banner); while the server is down it is asked every 15 s, else every minute
export function useApiHealth(everyMs = 60000) {
  const [state, setState] = useState(isDemoMode() ? 'demo' : 'checking');
  const check = useRef(() => {});
  useEffect(() => {
    if (isDemoMode()) {
      setState('demo');
      return undefined;
    }
    let off = false;
    check.current = () =>
      api.health().then(
        () => {
          if (!off) setState('up');
        },
        () => {
          if (!off) setState('down');
        },
      );
    check.current();
    const timer = setInterval(() => check.current(), state === 'down' ? Math.min(15000, everyMs) : everyMs);
    return () => {
      off = true;
      clearInterval(timer);
    };
  }, [everyMs, state === 'down']); // eslint-disable-line react-hooks/exhaustive-deps -- re-armed only when it goes down or comes back
  const recheck = useCallback(() => check.current(), []);
  return { state, recheck };
}
