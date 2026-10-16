import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { isDemoMode } from '../demo/demoMode.js';

// Whether the Agent Builder API answers. That is ALL it tells: nothing here says the worker, LiveKit or a provider's key is fine (the API
// has no status endpoint for those yet, see "What the backend side can provide next" in the review), so the wording never claims more.
// state: 'checking' | 'up' | 'down' | 'demo'
export function describeHealth(state) {
  switch (state) {
    case 'up':
      return { tone: 'good', title: 'API reachable', note: 'The Agent Builder API answers. This does not check the worker, LiveKit or provider keys.' };
    case 'down':
      return { tone: 'bad', title: 'API not responding', note: 'The studio cannot reach the Agent Builder API, so nothing can be loaded or saved.' };
    case 'demo':
      return { tone: 'idle', title: 'Demo data', note: 'There is no server in demo mode: everything is kept in this browser.' };
    default:
      return { tone: 'idle', title: 'Checking the API…', note: '' };
  }
}

export function useApiHealth(everyMs = 60000) {
  const [state, setState] = useState(isDemoMode() ? 'demo' : 'checking');
  useEffect(() => {
    if (isDemoMode()) {
      setState('demo');
      return undefined;
    }
    let off = false;
    const check = () =>
      api.health().then(
        () => {
          if (!off) setState('up');
        },
        () => {
          if (!off) setState('down');
        },
      );
    check();
    const timer = setInterval(check, everyMs);
    return () => {
      off = true;
      clearInterval(timer);
    };
  }, [everyMs]);
  return state;
}
