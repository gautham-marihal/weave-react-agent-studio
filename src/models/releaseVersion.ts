// Version numbers for publishing: which numbers the Publish dialog offers, and in what order. A bump counts from the
// newest published version (the server refuses one before anything is published); the draft's own number (meta.version)
// can be published as it is when it is newer than the newest version. Pure: no React, no network.
import type { VersionBump } from '../types/studio';

const SEMVER = /^\d+\.\d+\.\d+$/;
export const isSemver = (value: unknown): value is string => typeof value === 'string' && SEMVER.test(value);

const parts = (version: string | null | undefined): number[] => {
  const out = String(version || '0.0.0')
    .split('.')
    .map((p) => Number.parseInt(p, 10) || 0);
  while (out.length < 3) out.push(0);
  return out;
};

/** -1, 0 or 1, comparing numbers: 1.10.0 is newer than 1.9.0. */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): -1 | 0 | 1 {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = pa[i] - pb[i];
    if (diff) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** The next number after `version` for a bump. */
export function nextVersion(version: string | null | undefined, bump: VersionBump): string {
  const [a, b, c] = parts(version || '0.1.0');
  if (bump === 'major') return `${a + 1}.0.0`;
  if (bump === 'minor') return `${a}.${b + 1}.0`;
  return `${a}.${b}.${c + 1}`;
}

export type PublishChoice = VersionBump | 'draft';

export interface PublishOption {
  value: PublishChoice;
  label: string;
  /** The number it publishes as ('—' when the draft has none). */
  version: string;
  hint: string;
  /** A bump that lands on the draft's own number. */
  matchesDraft?: boolean;
  disabled?: boolean;
}

const BUMP_HINTS: Record<VersionBump, string> = {
  patch: 'Small fixes: wording, a greeting, a typo.',
  minor: 'New behaviour: a tool, a channel, new instructions.',
  major: 'A big rework that changes how callers are handled.',
};

/**
 * The Publish dialog's choices. The draft's own number is offered first when it is newer than the latest and unlike any
 * bump; an older or invalid one is shown switched off (the server will not reuse a number). Before the first publish,
 * only the draft's number can be used.
 */
export function publishOptions(latestVersion: string | null | undefined, draftVersion: unknown): { options: PublishOption[]; defaultChoice: PublishChoice } {
  const draftOk = isSemver(draftVersion);
  if (!latestVersion) {
    return {
      options: [{ value: 'draft', label: 'The draft’s version', version: draftOk ? draftVersion : '—', hint: 'The first version of this agent.', disabled: !draftOk }],
      defaultChoice: 'draft',
    };
  }
  const bumps: PublishOption[] = (['patch', 'minor', 'major'] as VersionBump[]).map((kind) => ({
    value: kind,
    label: kind[0].toUpperCase() + kind.slice(1),
    version: nextVersion(latestVersion, kind),
    hint: BUMP_HINTS[kind],
  }));
  const draftIsNewer = draftOk && compareVersions(draftVersion, latestVersion) > 0;
  const match = draftOk ? bumps.find((option) => option.version === draftVersion) : undefined;
  if (match) match.matchesDraft = true;
  const options = [...bumps];
  if (!match) {
    options.unshift({
      value: 'draft',
      label: 'The draft’s version',
      version: draftOk ? draftVersion : '—',
      hint: draftIsNewer ? 'The number already in the draft.' : draftOk ? `Not newer than ${latestVersion}, so it can’t be published.` : 'The draft has no valid version number.',
      disabled: !draftIsNewer,
    });
  }
  const defaultChoice: PublishChoice = match ? match.value : draftIsNewer ? 'draft' : 'patch';
  return { options, defaultChoice };
}
