// Picks a browser speech voice for voices with no playable sample (voicePreview.js). Browsers don't report a voice's
// gender and often default to a man's (Microsoft David), so voices are picked by the gender their name is known for.
// Pure: no DOM, so the tests run it in Node.

const FEMALE = [
  'zira',
  'hazel',
  'susan',
  'samantha',
  'victoria',
  'karen',
  'moira',
  'tessa',
  'fiona',
  'allison',
  'ava',
  'catherine',
  'linda',
  'heera',
  'jenny',
  'aria',
  'sonia',
  'libby',
  'maisie',
  'natasha',
  'clara',
  'emma',
  'michelle',
  'ana',
  'elena',
  'helena',
  'laura',
  'paulina',
  'monica',
  'sabina',
  'hortense',
  'julie',
  'amelie',
  'denise',
  'katja',
  'hedda',
  'anna',
  'zosia',
  'paola',
  'elsa',
  'female',
  'woman',
  'serena',
  'kate',
  'nicole',
  'joanna',
  'salli',
  'kimberly',
  'ivy',
  'amy',
  'emily',
  'raveena',
  'veena',
  'kalpana',
  'swara',
  'neerja',
  'yelda',
  'lekha',
  'siri',
];
const MALE = [
  'david',
  'mark',
  'george',
  'james',
  'richard',
  'ravi',
  'daniel',
  'alex',
  'fred',
  'tom',
  'oliver',
  'guy',
  'ryan',
  'eric',
  'christopher',
  'sean',
  'rishi',
  'male',
  'man',
  'jorge',
  'pablo',
  'diego',
  'stefan',
  'claude',
  'hans',
  'luca',
  'thomas',
  'jacques',
  'paul',
  'brian',
  'matthew',
  'joey',
  'justin',
  'kevin',
  'russell',
  'geraint',
  'arthur',
  'hemant',
  'prabhat',
  'madhur',
  'liam',
  'connor',
  'neil',
  'william',
];

const words = (name) =>
  String(name || '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);

// 'female' | 'male' | '' (unknown) for a browser voice, from its name.
export function genderOfBrowserVoice(voice) {
  const parts = words(voice?.name);
  const f = parts.some((p) => FEMALE.includes(p));
  const m = parts.some((p) => MALE.includes(p));
  if (f && !m) return 'female';
  if (m && !f) return 'male';
  return '';
}

const base = (lang) =>
  String(lang || '')
    .toLowerCase()
    .replace('_', '-')
    .split('-')[0];
const same = (a, b) =>
  String(a || '')
    .toLowerCase()
    .replace('_', '-') ===
  String(b || '')
    .toLowerCase()
    .replace('_', '-');

// Chooses the browser voice for a catalogue voice ({ locale: 'en-US', gender: 'Female' | 'Male' }).
// Returns { voice, certain, pitch }: `certain` when the voice is known to be that gender; otherwise `pitch` nudges
// another voice towards it (higher for female, lower for male) and the page says the preview is approximate.
export function pickBrowserVoice(voices, { locale, gender }) {
  const want = String(gender || '').toLowerCase();
  const list = Array.isArray(voices) ? voices : [];
  const sameLanguage = list.filter((v) => base(v.lang) === base(locale));
  const rank = (v) => (same(v.lang, locale) ? 0 : 1) + (v.localService ? 0 : 0.5); // exact locale, then installed
  const byRank = (a, b) => rank(a) - rank(b);
  const confirmed = sameLanguage.filter((v) => genderOfBrowserVoice(v) === want).sort(byRank);
  if (confirmed.length) return { voice: confirmed[0], certain: true, pitch: 1 };
  const pitch = want === 'female' ? 1.25 : want === 'male' ? 0.8 : 1;
  const unknown = sameLanguage.filter((v) => genderOfBrowserVoice(v) === '').sort(byRank);
  if (unknown.length) return { voice: unknown[0], certain: false, pitch };
  // only voices of the other gender in that language: use one, pitch-shifted, and the page says it is approximate
  const other = sameLanguage.filter((v) => genderOfBrowserVoice(v) !== want);
  return { voice: other.length ? other[0] : null, certain: false, pitch };
}
