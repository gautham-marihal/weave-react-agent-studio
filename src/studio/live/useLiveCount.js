import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';

const AT_A_TIME = 4;

// How many calls are going on now across the agents, for a number on Home (the Live page follows each call; this only counts). It asks each agent for its
// calls in progress, a few agents at a time, again every `everyMs` while the tab is on screen. It only reads. { count, loading, errors }
export function useLiveCount(bots, { everyMs = 20000 } = {}) {
  const [state, setState] = useState({ count: null, loading: true, errors: 0 });
  const key = (bots || []).map((b) => b.id).join(',');
  useEffect(() => {
    if (!key) {
      setState({ count: 0, loading: false, errors: 0 });
      return undefined;
    }
    const ids = key.split(',');
    let controller = null;
    const read = async () => {
      if (document.visibilityState === 'hidden') return;
      controller?.abort();
      const mine = new AbortController();
      controller = mine;
      let count = 0;
      let errors = 0;
      for (let i = 0; i < ids.length; i += AT_A_TIME) {
        await Promise.all(
          ids.slice(i, i + AT_A_TIME).map(async (id) => {
            try {
              const answer = await api.listCalls(id, { status: 'in_progress', limit: 100 }, { signal: mine.signal });
              // a server that does not filter by status still gives the right number
              count += (Array.isArray(answer?.calls) ? answer.calls : []).filter((c) => c && c.status === 'in_progress').length;
            } catch {
              errors += 1;
            }
          }),
        );
        if (mine.signal.aborted) return;
      }
      setState({ count, loading: false, errors });
    };
    read();
    const timer = window.setInterval(read, everyMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') read();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      controller?.abort();
    };
  }, [key, everyMs]);
  return state;
}
