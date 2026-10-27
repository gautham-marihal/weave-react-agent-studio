import { useEffect, useMemo, useRef, useState } from 'react';
import { api, followCall } from '../../api/client.ts';
import { createLiveBoard } from './liveBoard.js';
import { boardOrder, liveCall } from './liveModel.js';

// The Live board's calls in progress and just ended (each a liveCall()), redrawn every second so durations count up.
// Watching stops while paused or the tab is hidden, and resumes from where it was.
export function useLiveBoard(bots, { paused = false } = {}) {
  const [snap, setSnap] = useState({ calls: [], errors: [], checkedAt: null, checking: false, running: false, following: 0 });
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'hidden');
  const boardRef = useRef(null);
  if (!boardRef.current) boardRef.current = createLiveBoard({ api, follow: followCall, onChange: setSnap });
  const board = boardRef.current;

  const key = bots.map((b) => b.id).join(',');
  useEffect(() => {
    board.setBots(bots);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onVisible = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const watching = !paused && !hidden && bots.length > 0;
  useEffect(() => {
    if (!watching) return undefined;
    board.start();
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
        .map((c) => liveCall(c.summary, c.records, { nowMs, heardAtMs: c.heardAtMs, endedAtMs: c.endedAtMs }))
        .map((c, i) => ({ ...c, loading: snap.calls[i].loading }))
        .sort(boardOrder),
    [snap.calls, nowMs],
  );

  return { ...snap, calls, nowMs, watching, refresh: board.refresh };
}
