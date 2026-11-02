// Language codes the studio offers by name (BCP 47, as the config's defaults.language takes them). A code that is not
// listed is still accepted and shown as it is. Pure.

export const LANGUAGES: Array<[code: string, name: string]> = [
  ['en-US', 'English (United States)'],
  ['en-GB', 'English (United Kingdom)'],
  ['en-AU', 'English (Australia)'],
  ['en-IN', 'English (India)'],
  ['en-NG', 'English (Nigeria)'],
  ['es-ES', 'Spanish (Spain)'],
  ['es-MX', 'Spanish (Mexico)'],
  ['fr-FR', 'French (France)'],
  ['fr-CA', 'French (Canada)'],
  ['de-DE', 'German'],
  ['it-IT', 'Italian'],
  ['pt-BR', 'Portuguese (Brazil)'],
  ['pt-PT', 'Portuguese (Portugal)'],
  ['nl-NL', 'Dutch'],
  ['sv-SE', 'Swedish'],
  ['pl-PL', 'Polish'],
  ['tr-TR', 'Turkish'],
  ['ar-SA', 'Arabic'],
  ['hi-IN', 'Hindi'],
  ['ja-JP', 'Japanese'],
  ['ko-KR', 'Korean'],
  ['zh-CN', 'Chinese (Mandarin)'],
  ['id-ID', 'Indonesian'],
  ['sw-KE', 'Swahili'],
];

/** The language part of a code: "en-GB" -> "en". */
export const baseOf = (code: string | undefined): string => String(code ?? '').toLowerCase().split(/[-_]/)[0];

/** A code in words: the exact one, else the language without its region ("en" -> "English"), else the code itself. */
export function languageName(code: string | undefined): string {
  if (!code) return '';
  const exact = LANGUAGES.find(([c]) => c.toLowerCase() === code.toLowerCase());
  if (exact) return exact[1];
  const same = LANGUAGES.find(([c]) => baseOf(c) === baseOf(code));
  return same ? same[1].replace(/ \(.*\)$/, '') : code;
}

/**
 * The main language for a new agent: the first of the person's own languages (the browser's) that is offered, by exact
 * code or by language; English (United States) when none is.
 */
export function defaultLanguage(preferred: readonly string[] = []): string {
  for (const p of preferred) {
    const exact = LANGUAGES.find(([c]) => c.toLowerCase() === p.toLowerCase());
    if (exact) return exact[0];
  }
  for (const p of preferred) {
    const same = LANGUAGES.find(([c]) => baseOf(c) === baseOf(p));
    if (same) return same[0];
  }
  return 'en-US';
}

/** The languages without their region, one per language ("en" English, "es" Spanish), for "also speaks". */
export const BASE_LANGUAGES: { code: string; name: string }[] = [
  ...new Map(LANGUAGES.map(([code, name]) => [baseOf(code), name.replace(/ \(.*\)$/, '')])),
].map(([code, name]) => ({ code, name }));
