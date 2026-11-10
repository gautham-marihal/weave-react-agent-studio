// Where each of Tools' settings shows in its workspace (canvas page "4 · Tools, redesigned"). Pure data, so the tests
// can check that every setting has exactly one place.

// the parts of the sentence (one per quick ability), and the rows each opens (the quick card's own, "card.row")
export const TOKENS = {
  end: { title: 'End politely', ids: ['quick.end', 'quick.bye'], blank: 'end the conversation politely', optional: true, width: 520 },
  hand: { title: 'Pass people to a person', ids: ['quick.hand', 'quick.number'], blank: 'pass people to a person', optional: true, width: 620 },
  details: { title: 'Take requests', ids: ['quick.details', 'quick.fields'], blank: 'take requests', optional: true, width: 520 },
  lookup: {
    title: 'Look things up in your system',
    ids: ['quick.lookup', 'quick.address', 'quick.finds'],
    blank: 'look things up in your system',
    optional: true,
    width: 620,
  },
};

// a tool, as the steps of one run: each step's rows (the chosen tool's own row ids, from the part's tool card)
export const STEPS = [
  { key: 'asked', sub: 'what the model reads to decide, and what it fills in', ids: ['when', 'inputs', 'agents'] },
  { key: 'may', sub: 'checked in code, before anything is called', ids: ['pre'] },
  { key: 'calls', sub: '', ids: ['connection', 'method', 'request', 'wait', 'params', 'kTopK'] },
  { key: 'back', sub: '', ids: ['sees', 'keeps', 'oob'] },
  { key: 'then', sub: '', ids: ['reply', 'effects'] },
  { key: 'fails', sub: 'no answer, an error, or past the wait', ids: ['fails', 'kFails'] },
];
// the tool's settings fewer people need
export const TOOL_MORE = ['name', 'channels', 'limits', 'sample', 'json'];

// every id the workspace shows, once each: the quick rows, and a tool's rows
export const placedIds = () => Object.values(TOKENS).flatMap((t) => t.ids);
export const placedToolIds = () => [...STEPS.flatMap((s) => s.ids), ...TOOL_MORE];
