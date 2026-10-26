import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import { isFinished, normalizeHeadline, normalizeRun } from './runResults.js';

// Starts a test run on the server and follows it until it is over. Results appear as scenarios finish, so `run.scenarios` grows while
// `run.status` is "running". One run per agent at a time: if the server says one is already going (409), this attaches to it
// instead of failing, so a second tab or a refresh shows the same run. Reading a run never changes anything on the server.
const POLL_MS = 1000;
export const MAX_POLL_MS = 10 * 60 * 1000; // a run that never finishes stops being followed after ten minutes (it is still on the server)

export function useTestRun(botId, { scenarios = [], onFinished, pollMs = POLL_MS } = {}) {
  const [run, setRun] = useState(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);
  const timer = useRef(null);
  // which following is the current one: each new one (and clear, or another agent) moves it on, so a read still on its
  // way when that happens is dropped instead of carrying on as a second loop beside the new one
  const loop = useRef(0);
  const stopFollowing = useCallback(() => {
    loop.current += 1;
    clearTimeout(timer.current);
    return loop.current;
  }, []);
  const alive = useRef(true);
  const scenariosRef = useRef(scenarios);
  scenariosRef.current = scenarios;
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    stopFollowing();
    setRun(null);
    setError(null);
  }, [botId, stopFollowing]);

  const follow = useCallback(
    (first) => {
      const mine = stopFollowing();
      const here = () => alive.current && mine === loop.current;
      const started = Date.now();
      let current = normalizeRun(first, scenariosRef.current);
      setRun(current);
      const tick = async () => {
        if (!here()) return;
        if (isFinished(current.status)) {
          finishedRef.current?.(current);
          return;
        }
        if (Date.now() - started > MAX_POLL_MS) {
          setError({ title: 'This run is taking too long', body: 'It is still on the server. Open it again from “Earlier runs” to see how it ended.' });
          return;
        }
        try {
          const raw = await api.getTestRun(botId, current.id);
          if (!here()) return;
          current = normalizeRun(raw, scenariosRef.current);
          setRun(current);
        } catch (e) {
          if (!here()) return;
          setError({ title: 'Lost track of the run', body: e?.message || 'The studio could not read the run.' });
          return;
        }
        timer.current = setTimeout(tick, pollMs);
      };
      timer.current = setTimeout(tick, isFinished(current.status) ? 0 : pollMs);
    },
    [botId, pollMs, stopFollowing],
  );

  const start = useCallback(
    async (body = {}) => {
      stopFollowing();
      setStarting(true);
      setError(null);
      try {
        const raw = await api.runTests(botId, body);
        if (!alive.current) return null;
        follow(raw);
        return raw;
      } catch (e) {
        if (!alive.current) return null;
        if (e?.kind === 'conflict') {
          // one is already going: follow that one
          try {
            const heads = await api.listTestRuns(botId, 1);
            const head = Array.isArray(heads) ? heads[0] : null;
            if (head?.id) {
              const raw = await api.getTestRun(botId, normalizeHeadline(head).id);
              if (alive.current) follow(raw);
              setError({ kind: 'info', title: 'A run was already going', body: 'Showing it. A new one can start when it ends.' });
              return null;
            }
          } catch {
            /* fall through to the plain message */
          }
        }
        setError({
          title: e?.kind === 'invalid' ? 'These scenarios can’t be run yet' : 'The run didn’t start',
          body: e?.message || 'Something went wrong starting it.',
          errors: e?.errors || [],
        });
        return null;
      } finally {
        if (alive.current) setStarting(false);
      }
    },
    [botId, follow, stopFollowing],
  );

  // Shows a run that already exists (from the list of earlier runs), following it if it is still going.
  const open = useCallback(
    async (runId) => {
      const asked = stopFollowing();
      setError(null);
      try {
        const raw = await api.getTestRun(botId, runId);
        // another run was opened (or started, or this one closed) while it was read
        if (alive.current && asked === loop.current) follow(raw);
      } catch (e) {
        if (alive.current && asked === loop.current) setError({ title: 'That run can’t be opened', body: e?.message || '' });
      }
    },
    [botId, follow, stopFollowing],
  );

  const clear = useCallback(() => {
    stopFollowing();
    setRun(null);
    setError(null);
  }, [stopFollowing]);
  const running = !!run && !isFinished(run.status);
  return { run, running, starting, error, start, open, clear, dismissError: () => setError(null) };
}
