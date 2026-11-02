// Where an agent runs: the environments the server has (GET /environments), the phone numbers each one answers, and
// the secrets the server could not find when a version was last deployed there. Pure, apart from a small in-memory
// note of deploy answers (this tab only: the deployments list does not repeat them).
import type { PhoneNumber } from '../api/types';

const RANK = (env: string) => (/prod/i.test(env) ? 3 : /stag|uat|qa|pre/i.test(env) ? 2 : /dev/i.test(env) ? 1 : 0);

/**
 * The environments to show, in the server's order. While the server's list is not known (or could not be read), the
 * environments the agent's deployments name are shown, so nothing is invented; `fromServer` says which it is.
 */
export function environmentList(fromServer: unknown, deployed: string[]): { names: string[]; fromServer: boolean } {
  const names = Array.isArray(fromServer) ? fromServer.filter((e): e is string => typeof e === 'string' && e.trim() !== '') : null;
  if (names && names.length) return { names, fromServer: true };
  const seen = Array.from(new Set(deployed.filter(Boolean)));
  return { names: seen.sort((a, b) => RANK(a) - RANK(b)), fromServer: false };
}

/** GET /bots/{id}/numbers answers { numbers } (or, on some servers, the plain list). */
export function readNumbers(raw: unknown): PhoneNumber[] {
  const rows = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { numbers?: unknown }).numbers) ? (raw as { numbers: unknown[] }).numbers : [];
  return rows.filter((r): r is PhoneNumber => !!r && typeof r === 'object' && typeof (r as PhoneNumber).number === 'string');
}

/** Environment -> the numbers whose calls it answers. */
export function numbersByEnvironment(numbers: PhoneNumber[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  numbers.forEach((n) => {
    if (!n.environment) return;
    (out[n.environment] ??= []).push(n.number);
  });
  return out;
}

/** A number's problems as sentences. */
export const numberProblems = (n: PhoneNumber): string[] =>
  (Array.isArray(n.problems) ? n.problems : []).map((p) => (typeof p === 'string' ? p : p.fix ? `${p.problem} ${p.fix}` : p.problem)).filter(Boolean);

// ---- secrets missing at the last deploy, per agent and environment (kept for this tab only)

const lastDeploy = new Map<string, { version: string; missing: string[] }>();
const listeners = new Set<() => void>();
const keyOf = (agentId: string, env: string) => `${agentId}\u0000${env}`;

/** Notes what the server said about secrets when `version` went to `env`. */
export function noteDeploySecrets(agentId: string, env: string, version: string, missing: unknown) {
  lastDeploy.set(keyOf(agentId, env), { version, missing: Array.isArray(missing) ? missing.filter((m): m is string => typeof m === 'string') : [] });
  listeners.forEach((l) => l());
}

/** The secrets the server could not find at the last deploy to `env` made in this tab, if it is still that version. */
export function deploySecretsMissing(agentId: string, env: string, runningVersion: string | undefined): string[] {
  const note = lastDeploy.get(keyOf(agentId, env));
  return note && note.version === runningVersion ? note.missing : [];
}

export function onDeploySecrets(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
