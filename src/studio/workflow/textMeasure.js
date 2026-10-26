// How wide words are, so a block, a plug-in or the words on an arrow can be made as big as their words and never cut
// them: measured in the page's own font when there is a page (a canvas measures them), else a fair guess (in a test,
// say). And words wrapped into lines no wider than a width.
//   font: { size, weight }

let ruler = null;
let family = '';
let familyAt = 0;
function getRuler() {
  if (ruler === null) {
    try {
      ruler = (typeof document !== 'undefined' && document.createElement('canvas').getContext('2d')) || false;
    } catch {
      ruler = false;
    }
  }
  return ruler;
}
// the page's font (looked up again now and then: the style can change)
function pageFont() {
  const now = Date.now();
  if (!family || now - familyAt > 1000) {
    family = (typeof document !== 'undefined' && document.body && getComputedStyle(document.body).fontFamily) || 'sans-serif';
    familyAt = now;
  }
  return family;
}

// measured again from now on (the fonts have loaded, or the style changed the font)
export function resetMeasure() {
  family = '';
}

export function textWidth(text, { size = 12, weight = 400 } = {}) {
  const words = String(text ?? '');
  const r = getRuler();
  if (!r) return words.length * size * (weight >= 600 ? 0.6 : 0.56);
  r.font = `${weight} ${size}px ${pageFont()}`;
  return r.measureText(words).width;
}

// the lines the words take at this width (a word wider than the width on its own is broken where it must be)
export function wrapText(text, width, font) {
  const words = String(text ?? '')
    .split(/\s+/)
    .filter(Boolean);
  const lines = [];
  let line = '';
  const breakWord = (word) => {
    let part = '';
    for (const ch of word) {
      if (part && textWidth(part + ch, font) > width) {
        lines.push(part);
        part = ch;
      } else part += ch;
    }
    return part;
  };
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, font) <= width) line = next;
    else {
      if (line) lines.push(line);
      line = textWidth(word, font) > width ? breakWord(word) : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
