import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { ALL_AGENTS_LIMIT } from '../calls/callModel.js';
import { readCall } from '../replay/callFacts.js';

// Reads what the monitoring page needs, and only reads: the list of calls of each agent for the period and the one before it, and the records of the
// newest few calls of each agent (for answer times, failed tools and the like). Agents are asked a few at a time. One agent failing does not hide the others.
const AT_A_TIME = 4;
const PAGE = 100;
const MAX_PAGES = 3; // up to 300 calls an agent: past that, the numbers say they rest on the newest
const SAMPLE_PER_AGENT = 15;
const SAMPLE_CAP = 120;

async function inChunks(items, size, work) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(work))));
  return out;
}

export function useMonitoring({ bots = [], days = 7 }) {
  const ids = bots.slice(0, ALL_AGENTS_LIMIT).map((b) => b.id);
  const key = `${ids.join(',')}|${days}`;
  const [state, setState] = useState({ loading: true, calls: [], samples: {}, errors: [], nowMs: Date.now(), truncated: false });
  const generation = useRef(0);

  const load = useCallback(async () => {
    generation.current += 1;
    const mine = generation.current;
    const nowMs = Date.now();
    setState((old) => ({ ...old, loading: true }));
    const since = new Date(nowMs - 2 * days * 24 * 3600 * 1000).toISOString();
    let truncated = false;
    const listed = await inChunks(ids, AT_A_TIME, async (id) => {
      const calls = [];
      let cursor;
      let error = null;
      try {
        for (let page = 0; page < MAX_PAGES; page += 1) {
          const answer = await api.listCalls(id, { limit: PAGE, cursor, since });
          calls.push(...(Array.isArray(answer?.calls) ? answer.calls : []));
          cursor = answer?.next;
          if (!cursor) break;
          if (page === MAX_PAGES - 1) truncated = true;
        }
      } catch (e) {
        error = e?.message || 'This agent’s calls could not be read.';
      }
      return { id, calls: calls.map((c) => ({ ...c, bot: c.bot || id })), error };
    });
    if (mine !== generation.current) return;
    const calls = listed.flatMap((l) => l.calls);
    const errors = listed.filter((l) => l.error).map((l) => ({ botId: l.id, message: l.error }));
    setState({ loading: false, calls, samples: {}, errors, nowMs, truncated });

    // the records of the newest calls of each agent, read in the background so the page is already useful
    const wanted = listed
      .flatMap((l) =>
        [...l.calls]
          .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
          .filter((c) => c.status !== 'in_progress')
          .slice(0, SAMPLE_PER_AGENT),
      )
      .slice(0, SAMPLE_CAP);
    const samples = {};
    await inChunks(wanted, AT_A_TIME, async (c) => {
      try {
        const page = await api.getCall(c.bot, c.id, { limit: 500 });
        samples[`${c.bot}/${c.id}`] = readCall(Array.isArray(page?.events) ? page.events : []);
      } catch {
        /* one call that cannot be read is left out of the sample */
      }
    });
    if (mine !== generation.current) return;
    setState((old) => ({ ...old, samples }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    load();
    return () => {
      generation.current += 1;
    };
  }, [load]);
  return { ...state, reload: load };
}
