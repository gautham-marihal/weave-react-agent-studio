import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { CallSummaryItem } from '../api/types';
import { isTestConversation } from '../models/home';

// The test conversations of every agent in the last 30 days: real calls of each agent's draft, read from
// GET /bots/{id}/calls (the server keeps them like any other call). Pages through each agent's list, up to a limit.

const DAYS = 30;
const PAGE = 200;
const MAX_PAGES = 5;

export interface TestConversations {
  calls: CallSummaryItem[];
  loading: boolean;
  /** Agents whose calls could not be read (the numbers leave them out). */
  failed: string[];
  /** Some agent had more calls than were read. */
  partial: boolean;
}

export function useTestConversations(agentIds: string[]): TestConversations {
  const key = agentIds.join('\n');
  const [state, setState] = useState<TestConversations>({ calls: [], loading: true, failed: [], partial: false });

  useEffect(() => {
    const ids = key ? key.split('\n') : [];
    const controller = new AbortController();
    const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
    setState((s) => ({ ...s, loading: true }));

    const readAgent = async (id: string) => {
      const out: CallSummaryItem[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const res = await api.listCalls(id, { since, limit: PAGE, ...(cursor ? { cursor } : {}) }, { signal: controller.signal });
        out.push(...(Array.isArray(res?.calls) ? res.calls : []).filter(isTestConversation));
        cursor = res?.next ?? null;
        if (!cursor) return { calls: out, partial: false };
      }
      return { calls: out, partial: true };
    };

    void Promise.allSettled(ids.map(readAgent)).then((results) => {
      if (controller.signal.aborted) return;
      const calls: CallSummaryItem[] = [];
      const failed: string[] = [];
      let partial = false;
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          calls.push(...r.value.calls);
          partial = partial || r.value.partial;
        } else failed.push(ids[i]);
      });
      setState({ calls, loading: false, failed, partial });
    });
    return () => controller.abort();
  }, [key]);

  return state;
}
