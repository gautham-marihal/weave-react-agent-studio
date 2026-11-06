// Where each of Images & Videos' settings shows in its workspace (canvas page "11 · Images & Videos, redesigned"). A
// way in and an agent's way of seeing open in place on their own line; a picture step opens on a page of its own, in
// these sections; the pictures to try with and your camera each open on a page. Pure data, so the tests can check every
// setting has a place.

// the parts of the sentence, and the part-level rows each opens ("card.row")
export const TOKENS = {
  reach: { title: 'Pictures on each way in', ids: [], blank: 'photos or the camera on a way in', width: 640 },
  picky: { title: 'How picky', ids: ['picky.pickyUpload', 'picky.pickyCamera'], width: 560 },
  add: { title: 'Add a picture step', ids: [], blank: 'a step that asks for a picture', width: 760 },
};

// the chapters' lines that hold part-level rows
export const LINES = {
  pickyUpload: ['picky.pickyUpload'],
  pickyCamera: ['picky.pickyCamera'],
};

// a way in's and an agent's rows, shown under their line (the main ones, then the rarer)
export const ITEM_ROWS = {
  ways: ['photo', 'camera', 'onReceive', 'maxSize', 'accept', 'screen', 'videoCamera', 'topic'],
  seeing: ['seeMode', 'seeSize', 'watchEvery', 'watchChange', 'watchGap', 'watchSay'],
};

// a picture step's page, by its list
export const PAGES = {
  requests: {
    word: 'step',
    card: 'requests',
    sections: [
      { key: 'sees', title: 'What they see', ids: ['kind', 'prompt', 'sees'] },
      { key: 'check', title: 'The check in code', ids: ['picky'] },
      { key: 'none', title: 'If nothing comes', ids: ['timeout', 'onTimeout'] },
      { key: 'goes', title: 'Where it goes', ids: ['into'] },
    ],
    more: ['whenAsk'],
  },
  reads: {
    word: 'step',
    card: 'reads',
    sections: [
      { key: 'what', title: 'What it reads', ids: ['readImages', 'instructions'] },
      { key: 'details', title: 'The details', ids: ['details', 'okInto'] },
      { key: 'who', title: 'Who reads it', ids: ['model', 'readTimeout'] },
    ],
    more: ['whenRead'],
  },
  compares: {
    word: 'step',
    card: 'compares',
    sections: [
      { key: 'pairs', title: 'The pairs', ids: ['pairs'] },
      { key: 'passes', title: 'When it passes', ids: ['require', 'matched', 'differences', 'score'] },
      { key: 'try', title: 'Try it', ids: ['tryPairs'] },
    ],
    more: ['whenCompare'],
  },
  forgets: {
    word: 'step',
    card: 'forgets',
    sections: [{ key: 'which', title: 'What it forgets', ids: ['forgetImages'] }],
    more: ['whenForget'],
  },
};
// the pages that are a whole tool, not a step
export const TOOL_PAGES = { library: 'library.library', camera: 'camera.live' };

// every part-level row id the workspace shows
export const placedIds = () => [...new Set([...Object.values(TOKENS).flatMap((t) => t.ids), ...Object.values(LINES).flat(), ...Object.values(TOOL_PAGES)])];
// every row of an item the workspace shows
export const placedItemIds = (listId) =>
  ITEM_ROWS[listId] ? [...ITEM_ROWS[listId]] : [...PAGES[listId].sections.flatMap((s) => s.ids), ...PAGES[listId].more];
