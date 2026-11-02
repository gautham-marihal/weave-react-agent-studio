import { useCallback, useEffect, useRef, useState } from 'react';
import { api, followCall } from '../api/client';
import type { CallSummaryItem } from '../api/types';
import { appendRecords, readCallPage, recordsQuery, type CallUsage } from '../models/calls';

// One call's records (GET /bots/{id}/calls/{call}?after&limit&kinds), read a page at a time up to a cap, with more on
// request. A call in progress is then followed on its stream (/calls/{call}/stream) from the last record read, and read
// once more when it ends, for its final counts and state. Read-only.

export const PAGE = 500;
export const CAP = 5000;

type Rec = Record<string, unknown>;

export interface TraceRecords {
  call: CallSummaryItem | null;
  records: Rec[];
  counts: Record<string, number>;
  finalState: Record<string, unknown> | null;
  usage: CallUsage[];
  loading: boolean;
  error: string | null;
  /** More records are on the server than were read (past the cap). */
  truncated: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  /** The call's stream is open: new records arrive as they are written. */
  following: boolean;
  /** Why following stopped, when it stopped before the call ended. */
  followProblem: string;
  followAgain: () => void;
}

/** Reads pages of records after `after` until there are no more or `cap` were read. */
async function readPages(agentId: string, callId: string, after: number, cap: number, kinds: string[], signal: AbortSignal) {
  let next = after;
  let events: Rec[] = [];
  let last = readCallPage(null, after);
  for (;;) {
    const answer = await api.getCall(agentId, callId, recordsQuery({ after: next, limit: PAGE, kinds }), { signal });
    last = readCallPage(answer, next);
    events = events.concat(last.events);
    if (!last.more || last.nextAfter === next || events.length >= cap) break;
    next = last.nextAfter;
  }
  return { last, events, nextAfter: last.nextAfter };
}

export function useTraceRecords(agentId: string | null, callId: string | null, { kinds = [] as string[], enabled = true } = {}): TraceRecords {
  const [call, setCall] = useState<CallSummaryItem | null>(null);
  const [records, setRecords] = useState<Rec[]>([]);
  const [meta, setMeta] = useState<{ counts: Record<string, number>; finalState: Record<string, unknown> | null; usage: CallUsage[] }>({ counts: {}, finalState: null, usage: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followProblem, setFollowProblem] = useState('');
  const [followTurn, setFollowTurn] = useState(0);
  const lastSeq = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const kindsKey = kinds.join(',');

  // the first pages
  useEffect(() => {
    if (!enabled || !agentId || !callId) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    lastSeq.current = 0;
    setCall(null);
    setRecords([]);
    setMeta({ counts: {}, finalState: null, usage: [] });
    setLoading(true);
    setError(null);
    setTruncated(false);
    readPages(agentId, callId, 0, CAP, kindsKey ? kindsKey.split(',') : [], controller.signal)
      .then(({ last, events, nextAfter }) => {
        if (controller.signal.aborted) return;
        lastSeq.current = nextAfter;
        setCall(last.call);
        setRecords(events);
        setMeta({ counts: last.counts, finalState: last.finalState, usage: last.usage });
        setTruncated(last.more);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'This call could not be read.');
        setLoading(false);
      });
    return () => controller.abort();
  }, [agentId, callId, kindsKey, enabled]);

  const inProgress = call?.status === 'in_progress';

  // a call in progress: follow its stream from the last record read
  useEffect(() => {
    if (!enabled || !agentId || !callId || loading || error || !inProgress || truncated) return;
    let off = false;
    const wanted = kindsKey ? new Set(kindsKey.split(',')) : null;
    setFollowing(true);
    setFollowProblem('');
    const stop = followCall(agentId, callId, {
      after: lastSeq.current,
      onRecord: (record) => {
        if (off || typeof record !== 'object' || record === null) return;
        const r = record as Rec;
        if (typeof r.seq === 'number') lastSeq.current = Math.max(lastSeq.current, r.seq);
        if (wanted && !wanted.has(String(r.event))) return;
        setRecords((old) => appendRecords(old, [r]));
      },
      onEnd: () => {
        if (off) return;
        setFollowing(false);
        // read once more: the server's own word on how it ended, its counts and final state
        const controller = new AbortController();
        controllerRef.current = controller;
        readPages(agentId, callId, lastSeq.current, CAP, kindsKey ? kindsKey.split(',') : [], controller.signal)
          .then(({ last, events, nextAfter }) => {
            if (off) return;
            lastSeq.current = nextAfter;
            setRecords((old) => appendRecords(old, events));
            setMeta({ counts: last.counts, finalState: last.finalState, usage: last.usage });
            setCall((c) => last.call ?? (c ? { ...c, status: 'ended' } : c));
          })
          .catch(() => {
            if (!off) setCall((c) => (c ? { ...c, status: 'ended' } : c));
          });
      },
      onError: () => {
        if (off) return;
        setFollowing(false);
        setFollowProblem('Live updates stopped: the connection to the API was cut, or nothing new was written for a while.');
      },
    });
    return () => {
      off = true;
      stop();
      setFollowing(false);
    };
  }, [agentId, callId, kindsKey, enabled, loading, error, inProgress, truncated, followTurn]);

  const loadMore = useCallback(() => {
    if (!agentId || !callId || loadingMore) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoadingMore(true);
    readPages(agentId, callId, lastSeq.current, CAP, kindsKey ? kindsKey.split(',') : [], controller.signal)
      .then(({ last, events, nextAfter }) => {
        if (controller.signal.aborted) return;
        lastSeq.current = nextAfter;
        setRecords((old) => appendRecords(old, events));
        setTruncated(last.more);
        if (last.call) setCall(last.call);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'More records could not be read.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingMore(false);
      });
  }, [agentId, callId, kindsKey, loadingMore]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return {
    call,
    records,
    counts: meta.counts,
    finalState: meta.finalState,
    usage: meta.usage,
    loading: enabled && loading,
    error,
    truncated,
    loadingMore,
    loadMore,
    following,
    followProblem,
    followAgain: () => setFollowTurn((n) => n + 1),
  };
}
