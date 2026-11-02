// What the provider, model and voice pickers may offer. Which providers exist, and whether their key is set, comes from
// the server (GET /providers). Labels and model/voice suggestions come from the hand-kept catalogues in data/, and are
// only offered for providers the server reports. Pure: no network, no DOM.

import type { ProviderStage, ProvidersAnswer } from '../api/types';
import type { CatalogVoice } from '../data/voiceCatalog';
import { providerLabels } from '../data/providers';

export interface ProviderChoice {
  value: string;
  label: string;
  /** false when the server reports the provider's key is not set; undefined when it did not say. */
  keyAvailable?: boolean;
  secret?: string | null;
  /** The config names a provider the server did not report (or the list could not be fetched). Kept so it can be seen. */
  unlisted?: boolean;
}

/** Installed providers that can run this stage, plus the current one if the server did not list it. */
export function providersFor(stage: ProviderStage, answer: ProvidersAnswer | null, current?: string): ProviderChoice[] {
  const listed: ProviderChoice[] = (answer?.providers ?? [])
    .filter((p) => p.installed && p.stages.includes(stage))
    .map((p) => ({ value: p.name, label: providerLabels[p.name] ?? p.name, keyAvailable: p.key_available, secret: p.default_secret }));
  if (current && !listed.some((p) => p.value === current)) {
    listed.push({ value: current, label: providerLabels[current] ?? current, keyAvailable: undefined, secret: undefined, unlisted: true });
  }
  return listed;
}

/** The catalogue voices for one provider (catalogue providers are display names, config providers are ids). */
export function voicesFor(provider: string | undefined, catalog: CatalogVoice[]): CatalogVoice[] {
  if (!provider) return [];
  return catalog.filter((v) => v.provider.toLowerCase() === provider.toLowerCase());
}

/** Secret name -> whether the server has it, for the secrets the server reports on (each provider's default key). */
export function secretKeys(answer: ProvidersAnswer | null): Record<string, boolean> {
  const keys: Record<string, boolean> = {};
  (answer?.providers ?? []).forEach((p) => {
    if (p.default_secret && typeof p.key_available === 'boolean') keys[p.default_secret] = keys[p.default_secret] || p.key_available;
  });
  return keys;
}

export type SecretState = 'found' | 'missing' | 'unknown';

/** Found or missing only when the server said so; anything else is unknown here (deploy preflight checks it). */
export function secretState(name: string, keys: Record<string, boolean>): SecretState {
  if (!(name in keys)) return 'unknown';
  return keys[name] ? 'found' : 'missing';
}

export const missingSecrets = (required: string[], keys: Record<string, boolean>): string[] =>
  required.filter((name) => secretState(name, keys) === 'missing');

/** The key a provider needs when the server says it is not set, else null. */
export function missingProviderKey(provider: string | undefined, answer: ProvidersAnswer | null): string | null {
  const p = answer?.providers.find((x) => x.name === provider);
  return p && p.key_available === false && p.default_secret ? p.default_secret : null;
}
