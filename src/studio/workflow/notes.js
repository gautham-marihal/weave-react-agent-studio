// Sticky notes on an agent's workflow. The server refuses extra fields in the configuration, so notes are kept in this
// browser, one list per agent. Pure apart from browser storage, which may be missing or full.
//   { id, x, y, w, h, text, color }

export const NOTE_COLORS = [
  ['yellow', 'Yellow'],
  ['blue', 'Blue'],
  ['green', 'Green'],
  ['pink', 'Pink'],
  ['grey', 'Grey'],
];
export const NOTE_SIZE = { w: 240, h: 150, minW: 140, minH: 80 };
const key = (botId) => `weave_workflow_notes:${botId}`;
const isNote = (n) =>
  !!n && typeof n === 'object' && typeof n.id === 'string' && [n.x, n.y, n.w, n.h].every((v) => Number.isFinite(v)) && typeof n.text === 'string';

// A note id never matches an agent id (agent ids have no ":"), so a note and an agent are never the same block.
// Notes saved before this rule ("note-1") are read under the new id.
const NOTE_PREFIX = '::note::';
const noteId = (id) => (id.startsWith(NOTE_PREFIX) ? id : `${NOTE_PREFIX}${id}`);

export function readNotes(botId) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key(botId)) || '[]');
    return Array.isArray(parsed) ? parsed.filter(isNote).map((n) => ({ ...n, id: noteId(n.id) })) : [];
  } catch {
    return [];
  }
}
export function writeNotes(botId, notes) {
  try {
    if (notes.length) window.localStorage.setItem(key(botId), JSON.stringify(notes));
    else window.localStorage.removeItem(key(botId));
  } catch {
    /* storage unavailable or full: the notes last until the page is closed */
  }
}
// a new note centred on `at` (the middle of the view), with an unused id
export function newNote(notes, at) {
  let n = notes.length + 1;
  while (notes.some((x) => x.id === `${NOTE_PREFIX}${n}`)) n += 1;
  return {
    id: `${NOTE_PREFIX}${n}`,
    x: Math.round(at.x - NOTE_SIZE.w / 2),
    y: Math.round(at.y - NOTE_SIZE.h / 2),
    w: NOTE_SIZE.w,
    h: NOTE_SIZE.h,
    text: '',
    color: 'yellow',
  };
}
