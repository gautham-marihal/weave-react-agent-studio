import { useEffect, useMemo, useRef, useState } from 'react';
import { api, followCall } from '../api/client';
import { boardOrder, liveCall, type LiveCall } from '../models/live';
import { createLiveBoard, type BoardSnapshot, type LiveBoard } from '../models/liveBoard';

// The Live board's calls in progress and just ended (each a liveCall()), redrawn every second so durations count up.
// Watching stops while paused or while the tab is hidden, and resumes from where it was.

export interface LiveBoardState extends Omit<BoardSnapshot, 'calls'> {
  calls: LiveCall[];
  nowMs: number;
  /** Watching right now: not paused, the tab is on screen, and there are agents. */
  watching: boolean;
  refresh: () => Promise<void>;
}

const EMPTY: BoardSnapshot = { calls: [], errors: [], checkedAt: null, checking: false, running: false, following: 0 };

export function useLiveBoard(agents: Array<{ id: string }>, { paused = false } = {}): LiveBoardState {
  const [snap, setSnap] = useState<BoardSnapshot>(EMPTY);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'hidden');
  const boardRef = useRef<LiveBoard | null>(null);
  if (!boardRef.current) {
    boardRef.current = createLiveBoard({
      api: {
        listCalls: (bot, filters) => api.listCalls(bot, filters),
        getCall: (bot, id, query) => api.getCall(bot, id, query),
      },
      follow: (bot, id, handlers) => followCall(bot, id, handlers),
      onChange: setSnap,
    });
  }
  const board = boardRef.current;

  const key = agents.map((a) => a.id).join(',');
  useEffect(() => {
    board.setBots(key ? key.split(',').map((id) => ({ id })) : []);
  }, [key, board]);

  useEffect(() => {
    const onVisible = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const watching = !paused && !hidden && key.length > 0;
  useEffect(() => {
    if (!watching) return undefined;
    void board.start();
    return () => board.stop();
  }, [watching, board]);

  // the second hand: durations and waits are worked out from it
  useEffect(() => {
    if (paused) return undefined;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [paused]);

  const calls = useMemo(
    () =>
      snap.calls
        .map((c) => ({ ...liveCall(c.summary, c.records, { nowMs, heardAtMs: c.heardAtMs, endedAtMs: c.endedAtMs }), loading: c.loading }))
        .sort(boardOrder),
    [snap.calls, nowMs]
  );

  return { ...snap, calls, nowMs, watching, refresh: board.refresh };
}
