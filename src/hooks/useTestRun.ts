import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { isFinished, normalizeHeadline, normalizeRun, type Run } from '../models/scenarioRuns';

// Starts a test run on the server (POST /tests/run) and follows it until it is over; `run.scenarios` grows while
// `run.status` is "running". One run per agent at a time: when the server says one is going (409) this follows that
// one instead, so another tab or a reload shows the same run. Reading a run changes nothing on the server.

const POLL_MS = 1000;
/** Stop following an endless run after ten minutes (it stays on the server). */
export const MAX_FOLLOW_MS = 10 * 60 * 1000;

export interface RunProblem {
  title: string;
  body: string;
  /** "info": not a failure, only something to know (another run was already going). */
  tone?: 'info' | 'error';
  errors?: Array<{ message: string }>;
}

export interface TestRunState {
  run: Run | null;
  running: boolean;
  starting: boolean;
  problem: RunProblem | null;
  start: (body: Record<string, unknown>) => Promise<boolean>;
  open: (runId: string) => Promise<void>;
  clear: () => void;
  dismissProblem: () => void;
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err ?? ''));

export function useTestRun(
  agentId: string,
  { scenarios = [], onFinished, pollMs = POLL_MS }: { scenarios?: unknown[]; onFinished?: (run: Run) => void; pollMs?: number } = {},
): TestRunState {
  const [run, setRun] = useState<Run | null>(null);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<RunProblem | null>(null);
  const timer = useRef<number | null>(null);
  // Which follow loop is current: a new run, clear or another agent moves it on, so a read still in flight is dropped.
  const loop = useRef(0);
  const alive = useRef(true);
  const scenariosRef = useRef(scenarios);
  scenariosRef.current = scenarios;
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;

  const stopFollowing = useCallback(() => {
    loop.current += 1;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    return loop.current;
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    stopFollowing();
    setRun(null);
    setProblem(null);
  }, [agentId, stopFollowing]);

  const follow = useCallback(
    (first: unknown) => {
      const mine = stopFollowing();
      const here = () => alive.current && mine === loop.current;
      const began = Date.now();
      let current = normalizeRun(first, scenariosRef.current);
      setRun(current);
      const tick = async () => {
        if (!here()) return;
        if (isFinished(current.status)) {
          finishedRef.current?.(current);
          return;
        }
        if (Date.now() - began > MAX_FOLLOW_MS) {
          setProblem({ title: 'This run is taking too long', body: 'It is still on the server. Open it again from “Earlier runs” to see how it ended.' });
          return;
        }
        try {
          const raw = await api.getTestRun(agentId, current.id);
          if (!here()) return;
          current = normalizeRun(raw, scenariosRef.current);
          setRun(current);
        } catch (err) {
          if (!here()) return;
          setProblem({ title: 'Lost track of the run', body: messageOf(err) || 'Studio could not read the run.' });
          return;
        }
        timer.current = window.setTimeout(() => void tick(), pollMs);
      };
      timer.current = window.setTimeout(() => void tick(), isFinished(current.status) ? 0 : pollMs);
    },
    [agentId, pollMs, stopFollowing],
  );

  const start = useCallback(
    async (body: Record<string, unknown>): Promise<boolean> => {
      stopFollowing();
      setStarting(true);
      setProblem(null);
      try {
        const raw = await api.runTests(agentId, body);
        if (!alive.current) return false;
        follow(raw);
        return true;
      } catch (err) {
        if (!alive.current) return false;
        const kind = err instanceof ApiError ? err.kind : undefined;
        if (kind === 'conflict') {
          // One is already going: follow that one.
          try {
            const heads = await api.listTestRuns(agentId, 1);
            const head = Array.isArray(heads) && heads[0] ? normalizeHeadline(heads[0]) : null;
            if (head?.id) {
              const raw = await api.getTestRun(agentId, head.id);
              if (alive.current) follow(raw);
              setProblem({ tone: 'info', title: 'A run was already going', body: 'Showing it. A new one can start when it ends.' });
              return false;
            }
          } catch {
            // Fall through to the plain message.
          }
        }
        setProblem({
          title: kind === 'invalid' ? 'These scenarios can’t be run yet' : 'The run didn’t start',
          body: messageOf(err) || 'Something went wrong starting it.',
          errors: err instanceof ApiError ? err.errors : undefined,
        });
        return false;
      } finally {
        if (alive.current) setStarting(false);
      }
    },
    [agentId, follow, stopFollowing],
  );

  // Shows a run that already exists (from the list of earlier runs), following it if it is still going.
  const open = useCallback(
    async (runId: string) => {
      const asked = stopFollowing();
      setProblem(null);
      try {
        const raw = await api.getTestRun(agentId, runId);
        if (alive.current && asked === loop.current) follow(raw);
      } catch (err) {
        if (alive.current && asked === loop.current) setProblem({ title: 'That run can’t be opened', body: messageOf(err) });
      }
    },
    [agentId, follow, stopFollowing],
  );

  const clear = useCallback(() => {
    stopFollowing();
    setRun(null);
    setProblem(null);
  }, [stopFollowing]);

  return {
    run,
    running: !!run && !isFinished(run.status),
    starting,
    problem,
    start,
    open,
    clear,
    dismissProblem: () => setProblem(null),
  };
}
