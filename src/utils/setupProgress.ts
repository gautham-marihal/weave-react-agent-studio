// Where a person is in an agent's guided setup, kept in this browser per agent: the step they were on, whether they tried
// the agent, whether the setup is finished. Leaving keeps it, so "Continue setup" opens where they stopped. Nothing here
// is needed to use the agent: with no storage the setup simply starts at the beginning again.
import { STEP_IDS, type StepId } from '../models/setup';

export interface SetupProgress {
  step: StepId | '';
  tried: boolean;
  finished: boolean;
  /** The setup was started for this agent in this browser. */
  known: boolean;
}

const EMPTY: SetupProgress = Object.freeze({ step: '', tried: false, finished: false, known: false }) as SetupProgress;
const key = (agentId: string) => `weave_setup_${agentId}`;
const cache = new Map<string, SetupProgress>();
const listeners = new Set<() => void>();
let version = 0;

export const subscribeSetup = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
export const setupVersion = () => version;

export function readProgress(agentId: string): SetupProgress {
  if (!agentId) return EMPTY;
  const hit = cache.get(agentId);
  if (hit) return hit;
  let value = EMPTY;
  try {
    const raw = JSON.parse(localStorage.getItem(key(agentId)) ?? 'null') as Partial<SetupProgress> | null;
    if (raw && typeof raw === 'object') {
      const step = STEP_IDS.includes(raw.step as StepId) ? (raw.step as StepId) : '';
      value = { step, tried: raw.tried === true, finished: raw.finished === true, known: true };
    }
  } catch {
    value = EMPTY;
  }
  cache.set(agentId, value);
  return value;
}

export function saveProgress(agentId: string, patch: Partial<Omit<SetupProgress, 'known'>>) {
  if (!agentId) return;
  const next = { ...readProgress(agentId), ...patch, known: true };
  cache.set(agentId, next);
  try {
    localStorage.setItem(key(agentId), JSON.stringify({ step: next.step, tried: next.tried, finished: next.finished }));
  } catch {
    // kept for this visit only
  }
  version++;
  listeners.forEach((l) => l());
}

/** An agent made with the setup starts it at its second step (the first, name and starting point, is the create dialog). */
export const startSetup = (agentId: string) => saveProgress(agentId, { step: 'purpose', tried: false, finished: false });

/**
 * Whether the agent's next steps open the setup: while it is being set up here (started and not finished), and for any
 * agent never published. A published agent not set up here keeps its own pages for each step.
 */
export const inSetup = (progress: SetupProgress, published: boolean): boolean => !progress.finished && (progress.known || !published);
