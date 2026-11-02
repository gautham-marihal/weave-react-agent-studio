// What the server says about an agent beyond its draft: its test scenarios, the newest finished run of the saved draft,
// and how far its knowledge has been read. Read once and shared (Home, the agent list, the header, Overview and Release
// show the same answer), and read again when a page says something changed (a test run finished, a build).
import type { KnowledgeBaseState, LatestRun } from '../models/readiness';
import { api } from '../api/client';
import { latestDraftRun } from './testRuns';

export interface AgentFacts {
  /** null: not known (the request failed or has not answered). */
  scenarioCount: number | null;
  /** null: never run; undefined: not known. */
  latestRun: LatestRun | null | undefined;
  /** null: not known. */
  knowledge: KnowledgeBaseState[] | null;
  loading: boolean;
  loadedAt: number;
}

const FRESH_MS = 60_000;
const facts = new Map<string, AgentFacts>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let version = 0;

const emit = () => {
  version++;
  listeners.forEach((l) => l());
};

export const subscribeFacts = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
export const factsVersion = () => version;
export const getFacts = (agentId: string): AgentFacts | undefined => facts.get(agentId);

/** Reads (or re-reads, with force) an agent's tests, latest draft run and knowledge. Each part fails on its own. */
export function loadFacts(agentId: string, { force = false } = {}): Promise<void> {
  const have = facts.get(agentId);
  if (!force && have && !have.loading && Date.now() - have.loadedAt < FRESH_MS) return Promise.resolve();
  const running = inflight.get(agentId);
  if (running) return running;
  facts.set(agentId, { scenarioCount: have?.scenarioCount ?? null, latestRun: have?.latestRun, knowledge: have?.knowledge ?? null, loading: true, loadedAt: have?.loadedAt ?? 0 });
  emit();
  const job = Promise.allSettled([api.listTests(agentId), api.listTestRuns(agentId, 10), api.getKnowledge(agentId)]).then(([tests, runs, knowledge]) => {
    const bases = knowledge.status === 'fulfilled' ? (Array.isArray(knowledge.value) ? knowledge.value : knowledge.value.bases) : null;
    facts.set(agentId, {
      scenarioCount: tests.status === 'fulfilled' ? (tests.value.scenarios ?? []).length : null,
      latestRun: runs.status === 'fulfilled' && Array.isArray(runs.value) ? latestDraftRun(runs.value) : undefined,
      knowledge: bases ? bases.map((b) => ({ id: b.id, index: b.index ?? null, build: b.build ?? null, problems: b.problems ?? [] })) : null,
      loading: false,
      loadedAt: Date.now(),
    });
    inflight.delete(agentId);
    emit();
  });
  inflight.set(agentId, job);
  return job;
}
