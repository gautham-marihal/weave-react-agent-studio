// What the runtime can't do yet (`unsupported`, valid configs only): [{ feature, where, severity? }]. "security" means
// a protection is declared but NOT enforced: the agent looks protected and isn't. Shown first, in red; gates prod.

import type { Deployments, Provider, Unsupported } from '../api/types.ts';

export const isSecurity = (item: Partial<Unsupported> | null | undefined): boolean => item?.severity === 'security';

// The server's words for a feature, without an operator's command line ("…; rebuild it with python -m …"), which means
// nothing in a browser: the clause that carries one is left out (the knowledge page has its own Build button).
const COMMAND = /\b(?:python3?|pip3?|npm|npx|curl|docker)\s+\S|\s-m\s+\S/i;
export const plainFeature = (feature: unknown): string =>
  String(feature ?? '')
    .split(/;\s*/)
    .filter((part, i) => i === 0 || !COMMAND.test(part))
    .join('; ');
// The list as it is shown: every feature in plain words.
export const plainUnsupported = (list: unknown): Unsupported[] =>
  (Array.isArray(list) ? list : []).map((item: Unsupported) => ({ ...item, feature: plainFeature(item?.feature) }));

// What the server says it doesn't run yet at one place of the config, or inside it ('' when nothing): the row for
// `defaults.conversation.sounds` is told about "thinking / ambient sounds", the row for `agents.items[0].vision` about
// vision. The server's `where` reads `a.b[0].c`; a place above the row (a whole list) is not the row's to say.
export function notRunAt(list: unknown, path: (string | number)[] | null | undefined): string {
  if (!Array.isArray(path) || !path.length) return '';
  const here = path.map((part, i) => (typeof part === 'number' ? `[${part}]` : `${i ? '.' : ''}${part}`)).join('');
  const found = plainUnsupported(list).filter((item) => {
    const where = String(item?.where || '');
    return where === here || where.startsWith(`${here}.`) || where.startsWith(`${here}[`);
  });
  return [...new Set(found.map((item) => item.feature).filter(Boolean))].join('; ');
}

export function splitUnsupported(list: unknown): { security: Unsupported[]; advice: Unsupported[] } {
  const items = plainUnsupported(list);
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
