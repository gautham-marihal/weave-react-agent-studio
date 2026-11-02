// Whether "tests must pass before publishing" is on for an agent. A preference kept in this browser (the API has no
// place for it); with no storage it is simply off.
const key = (agentId: string) => `weave_tests_gate_${agentId}`;
const listeners = new Set<() => void>();
const cache = new Map<string, boolean>();
let version = 0;

export const subscribeGate = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
export const gateVersion = () => version;

export function isGateOn(agentId: string): boolean {
  if (cache.has(agentId)) return cache.get(agentId) === true;
  let on = false;
  try {
    on = typeof localStorage !== 'undefined' && localStorage.getItem(key(agentId)) === 'on';
  } catch {
    on = false;
  }
  cache.set(agentId, on);
  return on;
}

export function setGateOn(agentId: string, on: boolean) {
  cache.set(agentId, on);
  try {
    if (on) localStorage.setItem(key(agentId), 'on');
    else localStorage.removeItem(key(agentId));
  } catch {
    // kept for this visit only
  }
  version++;
  listeners.forEach((l) => l());
}
