// Where each of Knowledge's settings shows in its workspace, by the part's row ids ("card.row"). Pure data, so the
// tests can check that every setting has exactly one place.

// the parts of the sentence, and the editor each opens
export const TOKENS = {
  docs: { title: 'Documents', ids: ['docs.upload'], blank: 'documents', optional: true, width: 520 },
  pages: { title: 'Web pages', ids: ['docs.page', 'docs.depth'], blank: 'web pages', optional: true, width: 560 },
  mode: { title: 'When it searches', ids: ['search.mode'], blank: 'on every caller turn', width: 600 },
  topk: { title: 'How many passages', ids: ['search.topk', 'search.chars'], blank: 'the 4 best passages', width: 480 },
};

// the shelf under the sentence: the index, and every document and page with its state
export const SHELF = ['docs.index', 'docs.read'];

// the chapters' lines that open under themselves, and the settings under "more"
export const LINES = {
  readers: ['docs.readers'],
  from: ['search.from'],
  close: ['search.score'],
  ask: ['try.ask'],
};
export const MORE = {
  reads: ['rag.use', 'rag.connection', 'rag.collection', 'rag.request', 'rag.response'],
  search: ['search.timeout', 'search.strip', 'search.refresh', 'search.role', 'search.lead', 'search.size', 'search.overlap', 'search.embed'],
};

// every id the workspace shows, once each
export const placedIds = () => [...Object.values(TOKENS).flatMap((t) => t.ids), ...SHELF, ...Object.values(LINES).flat(), ...Object.values(MORE).flat()];
