import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../api/client';
import type { AgentConfig } from '../../types/studio';
import { readCall, type CallFacts } from '../../models/replayFacts';
import { compareReplay, type ReplayComparison } from '../../models/replayCompare';
import { configWithScenario, factsFromResult, replayResultOf, scenarioForReplay } from '../../models/replayRun';

// The two things a call's actions need from the server: the call's records, read as facts, and a replay of its caller
// side on the real runtime (the scenario runner), compared turn by turn.

const POLL_MS = 1500;
/** A replay that has not finished after this long is reported as not finished, not waited on for ever. */
const GIVE_UP_MS = 5 * 60_000;

const message = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

export interface CallFactsState {
  facts: CallFacts | null;
  /** The call list's status for this call: ended, in_progress or unfinished. */
  status: string;
  error: string | null;
  loading: boolean;
}

/** The call's records (GET /calls/{id}, every page), read as facts. Only once `enabled`. */
export function useCallFacts(agentId: string, callId: string, enabled: boolean): CallFactsState {
  const [state, setState] = useState<CallFactsState>({ facts: null, status: '', error: null, loading: false });
  useEffect(() => {
    if (!enabled || state.facts) return;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      const events: unknown[] = [];
      let after = 0;
      let status = '';
      for (let page = 0; page < 20; page += 1) {
        const answer = (await api.getCall(agentId, callId, { after, limit: 2000 }, { signal: controller.signal })) as {
          call?: { status?: string };
          events?: unknown[];
          more?: boolean;
          next_after?: number;
        };
        status = answer?.call?.status ?? status;
        events.push(...(Array.isArray(answer?.events) ? answer.events : []));
        if (!answer?.more || typeof answer.next_after !== 'number' || answer.next_after <= after) break;
        after = answer.next_after;
      }
      return { facts: readCall(events), status };
    })()
      .then(({ facts, status }) => setState({ facts, status, error: null, loading: false }))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setState({ facts: null, status: '', error: message(err, 'The call’s records could not be read.'), loading: false });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, callId, enabled]);
  return state;
}

export interface ReplayOutcome {
  comparison: ReplayComparison;
  /** What it was played to, in words. */
  label: string;
  notes: string[];
  unmocked: string[];
}

export interface ReplayState {
  phase: 'idle' | 'running' | 'done' | 'failed';
  outcome: ReplayOutcome | null;
  problem: string;
}

/** Plays the call's caller side to `config` on the runtime (POST /tests/run with the config in the body: nothing is
 *  saved), polls the run, and compares its answer with the call. */
export function useReplayRun(agentId: string) {
  const [state, setState] = useState<ReplayState>({ phase: 'idle', outcome: null, problem: '' });
  const timer = useRef<number | null>(null);
  const alive = useRef(true);
  const stop = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stop();
    };
  }, []);

  const reset = useCallback(() => {
    stop();
    setState({ phase: 'idle', outcome: null, problem: '' });
  }, []);

  const start = useCallback(
    async (config: AgentConfig, original: CallFacts, label: string) => {
      stop();
      setState({ phase: 'running', outcome: null, problem: '' });
      const fail = (problem: string) => alive.current && setState({ phase: 'failed', outcome: null, problem });
      const scenario = scenarioForReplay(config, original);
      if (!scenario.channel) return fail('The agent has no channel to play the call on.');
      let runId: string;
      try {
        const started = (await api.runTests(agentId, { config: configWithScenario(config, scenario), scenarios: [scenario.id], live: true })) as { run_id?: string; id?: string };
        runId = String(started.run_id ?? started.id ?? '');
        if (!runId) return fail('The server started a run but did not say which.');
      } catch (err: unknown) {
        if (err instanceof ApiError && err.status === 409) return fail('A test run is already going for this agent. Try again when it has finished.');
        return fail(message(err, 'The replay could not be started.'));
      }
      const startedAt = Date.now();
      const poll = async () => {
        if (!alive.current) return;
        try {
          const run = (await api.getTestRun(agentId, runId)) as { status?: string; scenarios?: unknown };
          if (!alive.current) return;
          if (run.status === 'running' || !run.status) {
            if (Date.now() - startedAt > GIVE_UP_MS) return fail('The replay has not finished after five minutes. It may still finish: see the runs on the Test page.');
            timer.current = window.setTimeout(() => void poll(), POLL_MS);
            return;
          }
          const { result, problem } = replayResultOf(run, scenario.id);
          const facts = factsFromResult(result, { channelId: original.channelId });
          if (!result || !facts) return fail(problem || 'The runner could not play the replay.');
          setState({
            phase: 'done',
            problem: '',
            outcome: {
              comparison: compareReplay(original, facts),
              label,
              notes: Array.isArray(result.notes) ? result.notes.filter((n): n is string => typeof n === 'string') : [],
              unmocked: (Array.isArray(result.unmocked) ? result.unmocked : []).map((r) => `${r.method ?? ''} ${r.path ?? ''}`.trim()).filter(Boolean),
            },
          });
        } catch (err: unknown) {
          fail(message(err, 'The replay’s result could not be read.'));
        }
      };
      timer.current = window.setTimeout(() => void poll(), 600);
    },
    [agentId]
  );

  return { ...state, start, reset };
}
