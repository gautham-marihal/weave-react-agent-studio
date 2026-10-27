// What the runtime can't do yet (`unsupported`, valid configs only): [{ feature, where, severity? }]. "security" means
// a protection is declared but NOT enforced: the agent looks protected and isn't. Shown first, in red; gates prod.

import type { Deployments, Provider, Unsupported } from '../api/types.ts';

export const isSecurity = (item: Partial<Unsupported> | null | undefined): boolean => item?.severity === 'security';

export function splitUnsupported(list: unknown): { security: Unsupported[]; advice: Unsupported[] } {
  const items: Unsupported[] = Array.isArray(list) ? list : [];
  return { security: items.filter(isSecurity), advice: items.filter((item) => !isSecurity(item)) };
}

// The secrets a version needs. `providers` (GET /providers) marks a default_secret with key_available false as missing;
// others can't be known before deploying (the deploy answer lists secrets_missing).
export function secretsStatus(required: unknown, providers: Partial<Provider>[] | null | undefined): { name: string; missing: boolean; known: boolean }[] {
  const names: string[] = Array.isArray(required) ? required : [];
  return names.map((name) => {
    const owner = (providers || []).find((provider) => provider.default_secret === name);
    return { name, missing: !!owner && owner.key_available === false, known: !!owner };
  });
}

// The word to type to deploy to production while a security item stands.
export const PRODUCTION_WORD = 'production';
export const mayDeploy = ({ environment, security, typed }: { environment: string; security: unknown[]; typed?: string | null }): boolean =>
  environment !== 'production' ||
  security.length === 0 ||
  String(typed || '')
    .trim()
    .toLowerCase() === PRODUCTION_WORD;

type DeploymentsLike =
  | {
      current?: Record<string, { id: string; version: string; previous_version?: string | null }>;
      history?: Deployments['history'];
    }
  | null
  | undefined;

// The version an environment ran before the current one, for "Roll back", or null. `data` is GET /deployments:
// { current: { env: { id, version, ... } }, history: [...] }.
export function rollbackTarget(data: DeploymentsLike, environment: string): string | null {
  const current = data?.current?.[environment];
  if (!current) return null;
  const history = Array.isArray(data?.history) ? data.history : [];
  const record = history.find((item) => item.id === current.id);
  const previous = record?.previous_version || current.previous_version || null;
  return previous && previous !== current.version ? previous : null;
}
