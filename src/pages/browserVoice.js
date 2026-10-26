// A voice with no recorded sample of its own, or whose recording can't be played, is read with the browser's own speech
// engine (voicePreview.js). Browsers don't say whether an installed voice is a woman's or a man's, and when no voice is
// set they use their default, which is often a man's (Microsoft David on Windows). So to preview a female voice as
// female and a male voice as male, the voice is picked by the gender its name is known for.
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
// Returns { voice, certain, pitch }: `certain` is true when the voice is known to be of that gender; otherwise `pitch` nudges whatever
// is available towards it (higher for female, lower for male) and the page says the preview is approximate.
export function pickBrowserVoice(voices, { locale, gender }) {
  const want = String(gender || '').toLowerCase();
  const list = Array.isArray(voices) ? voices : [];
  const sameLanguage = list.filter((v) => base(v.lang) === base(locale));
  const rank = (v) => (same(v.lang, locale) ? 0 : 1) + (v.localService ? 0 : 0.5); // the exact locale first, installed voices before online ones
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
