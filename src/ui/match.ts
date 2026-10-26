// How well what was typed in the search matches a result, from 0 (not at all) to 1, forgiving the way people type: the
// words in any order, the start of a word ("dep" finds Deploy), letters left out ("spd" finds Speed), and a slip in a
// longer word ("scnearios" finds Scenarios). Every word typed has to be found somewhere; the title counts more than the
// other words (a description, the words people use for it).

const plain = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const wordsOf = (text: string) => plain(text).split(' ').filter(Boolean);

// the fewest single-letter changes (a letter added, left out, changed, or two swapped) between two words, stopping once it is over `most`
function slips(a: string, b: string, most: number): number {
  if (Math.abs(a.length - b.length) > most) return most + 1;
  let before = Array.from({ length: b.length + 1 }, (_, j) => j);
  let previous: number[] = [];
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(before[j] + 1, row[j - 1] + 1, before[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, previous[j - 2] + 1);
      row.push(value);
      best = Math.min(best, value);
    }
    if (best > most) return most + 1;
    previous = before;
    before = row;
  }
  return before[b.length];
}

// the letters of `typed` in order inside `word`, starting with its first letter
const inOrder = (typed: string, word: string) => {
  if (typed[0] !== word[0]) return false;
  let at = 0;
  for (const letter of typed) {
    at = word.indexOf(letter, at);
    if (at < 0) return false;
    at += 1;
  }
  return true;
};

function wordScore(typed: string, word: string): number {
  if (word === typed) return 1;
  if (word.startsWith(typed)) return 0.9;
  if (typed.length >= 3 && word.includes(typed)) return 0.7;
  if (typed.length >= 4) {
    const most = typed.length >= 8 ? 2 : 1;
    if (slips(typed, word, most) <= most || (word.length > typed.length && slips(typed, word.slice(0, typed.length), most) <= most)) return 0.55;
  }
  if (typed.length >= 2 && inOrder(typed, word)) return 0.4;
  return 0;
}

export function matchScore(query: string, title: string, other = ''): number {
  const typed = wordsOf(query);
  if (!typed.length) return 1;
  const titleWords = wordsOf(title);
  const otherWords = wordsOf(other);
  let total = 0;
  for (const t of typed) {
    const best = Math.max(0, ...titleWords.map((w) => wordScore(t, w)), ...otherWords.map((w) => wordScore(t, w) * 0.7));
    if (best === 0) return 0;
    total += best;
  }
  const score = total / typed.length;
  // the whole phrase in the title, as typed: the best kind of match
  const phrase = plain(query);
  return Math.min(1, plain(title).includes(phrase) ? score + 0.2 : score);
}

// a match worth showing: below this, the letters only happen to be there
export const SHOWN = 0.38;

// the results that match, the best first (equal ones keep their order)
export function bestFirst<T>(items: T[], query: string, textOf: (item: T) => [string, string?]): T[] {
  if (!plain(query)) return items;
  return items
    .map((item, i) => ({ item, i, score: matchScore(query, ...textOf(item)) }))
    .filter((m) => m.score >= SHOWN)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((m) => m.item);
}
