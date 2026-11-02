// Who is signed in, in words: names, initials and the profile remembered for an email. Pure: no storage, no React.
// There is no sign-in service yet, so the profile (never a secret) is kept in this browser.

/** What the first-time profile step asks for. */
export interface ProfileDetails {
  name: string;
  workspaceName: string;
}

/** How an email or phone is matched to a remembered profile: trimmed, lower case. */
export const identifierKey = (identifier: string): string => identifier.trim().toLowerCase();

/** "asha.rao@x.com" -> "Asha rao"; "+44 20…" stays as it is. A name to use until the person gives theirs. */
export function nameFromIdentifier(identifier: string): string {
  const clean = identifier.trim();
  const local = clean.includes('@') ? clean.split('@')[0] : clean;
  const words = local.replace(/[._-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'You';
}

/** "Asha Rao" -> "AR", "asha" -> "AS"; never empty. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] ?? '').slice(0, 2).toUpperCase() || 'YO';
}

/** "Asha Rao" -> "Asha": what Home greets them by. */
export const firstNameOf = (name: string): string => name.trim().split(/\s+/)[0] ?? '';

/** What is wrong with the profile step's answers, field by field (empty when nothing is). */
export function profileProblems(details: ProfileDetails): Partial<Record<keyof ProfileDetails, string>> {
  const out: Partial<Record<keyof ProfileDetails, string>> = {};
  if (!details.name.trim()) out.name = 'Enter your name.';
  else if (details.name.trim().length > 80) out.name = 'Use 80 characters or fewer.';
  if (!details.workspaceName.trim()) out.workspaceName = 'Enter a name for your workspace.';
  else if (details.workspaceName.trim().length > 60) out.workspaceName = 'Use 60 characters or fewer.';
  return out;
}

/** The remembered profiles, read from what storage held (anything unreadable counts as none). */
export function readProfiles(raw: string | null): Record<string, ProfileDetails> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, ProfileDetails> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([key, value]) => {
      const v = value as Partial<ProfileDetails> | null;
      if (v && typeof v.name === 'string' && v.name.trim() && typeof v.workspaceName === 'string') {
        out[key] = { name: v.name, workspaceName: v.workspaceName };
      }
    });
    return out;
  } catch {
    return {};
  }
}
