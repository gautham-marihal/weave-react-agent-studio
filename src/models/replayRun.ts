// Playing a call's caller side again on the real runtime: the caller's words become a scenario the server's test runner
// plays (POST /bots/{id}/tests/run with the config in the body, so nothing is saved), and its answer is read into the
// same facts as the call (see replayFacts.ts) so the two can be compared. Pure: no network, no DOM.
import type { AgentConfig } from '../types/studio';
import { emptyFacts, isObj, readCall, readTranscript, type CallFacts } from './replayFacts';

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** One scenario of a run (GET /tests/runs/{id}), as far as a replay reads it. */
export interface ScenarioResult {
  id: string;
  status: string;
  detail?: string;
  reason?: string;
  error?: string | null;
  transcript?: unknown;
  tools?: unknown;
  events?: unknown;
  final_agent?: string;
  final_state?: Record<string, unknown>;
  notes?: string[];
  unmocked?: Array<{ method?: string; path?: string }>;
}

/** A test scenario as the config's `tests` holds it. */
export interface TestScenario {
  id: string;
  description?: string;
  channel: string;
  turns: { say: string }[];
  expect: Record<string, unknown>[];
  [key: string]: unknown;
}

/** `base`, or `base_2`, `base_3`… so it is not the id of a scenario already there. */
export function freshScenarioId(scenarios: unknown, base = 'scenario'): string {
  const taken = new Set(list(scenarios).map((s) => (isObj(s) ? s.id : undefined)));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

/** A runner result read as facts: from its records when it has them (they carry waits and hand-overs), else from its
 *  transcript and tool list. */
export function factsFromResult(result: ScenarioResult | null | undefined, { channelId = '' } = {}): CallFacts | null {
  if (!result) return null;
  const events = list(result.events);
  const base = events.length
    ? readCall(events)
    : readTranscript({ transcript: result.transcript, tools: result.tools, finalAgent: result.final_agent, finalState: result.final_state, channelId });
  return {
    ...emptyFacts(),
    ...base,
    channelId: base.channelId || channelId,
    finalAgent: result.final_agent || base.finalAgent,
    finalState: isObj(result.final_state) && Object.keys(result.final_state).length ? result.final_state : base.finalState,
  };
}

/** The caller's turns as a scenario the runner can play, named so it can't clash with the agent's own tests. */
export function scenarioForReplay(config: AgentConfig, original: CallFacts, { id = '' } = {}): TestScenario {
  const channels = list(config?.channels).filter((c): c is Record<string, unknown> => isObj(c) && typeof c.id === 'string');
  const channel = channels.find((c) => c.id === original.channelId) ?? channels.find((c) => c.enabled !== false) ?? channels[0];
  return {
    id: id || freshScenarioId(config?.tests, 'replay'),
    description: 'A replay of a call',
    channel: typeof channel?.id === 'string' ? channel.id : original.channelId,
    turns: original.turns.map((t) => ({ say: t.say })).filter((t) => t.say),
    expect: [{ said_matches: '.+' }],
  };
}

/** The configuration a replay run plays: the agent as it is, plus the replay scenario. The config itself is not changed. */
export function configWithScenario(config: AgentConfig, scenario: TestScenario): AgentConfig {
  return { ...config, tests: [...list(config?.tests), scenario] };
}

/** The scenario's result in a finished run, or why there is none to compare. */
export function replayResultOf(run: { status?: string; scenarios?: unknown } | null | undefined, scenarioId: string): { result: ScenarioResult | null; problem: string } {
  if (!run || run.status === 'running') return { result: null, problem: '' };
  const result = list(run.scenarios).find((s): s is ScenarioResult => isObj(s) && s.id === scenarioId) ?? null;
  if (!result) return { result: null, problem: 'The run finished without playing the replay.' };
  if (result.status === 'error' || result.status === 'skipped')
    return { result: null, problem: result.detail || result.reason || result.error || (result.status === 'skipped' ? 'The runner skipped the replay.' : 'The runner could not play the replay.') };
  return { result, problem: '' };
}
