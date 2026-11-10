// Where each of Guardrails' settings shows in its workspace (canvas page "8 · Guardrails, redesigned"). A check (on what
// callers say or on what it says) and a rule of its own each open on a page of their own, in these sections; the rarer
// settings are under "more". Pure data, so the tests can check every setting has exactly one place.

// the parts of the sentence, and the part-level rows each opens ("card.row")
export const TOKENS = {
  input: { title: 'Checks on what callers say', ids: [], blank: 'a check on what callers say', width: 560 },
  output: { title: 'Checks on what it says', ids: [], width: 560 },
  topics: {
    title: 'The topics it keeps to',
    ids: ['topics.allowed', 'topics.blocked', 'topics.offtopic', 'topics.strikes', 'topics.then', 'topics.say'],
    blank: 'the topics it keeps to',
    width: 600,
  },
  moments: { title: 'When to hand over or end', ids: ['moments.frustrated', 'moments.manager', 'moments.words', 'moments.abusive'], width: 600 },
  rules: { title: 'Rules of its own', ids: [], width: 560 },
  limits: {
    title: 'Its limits',
    ids: ['limits.max_call_duration_s', 'limits.max_silence_s', 'limits.max_tool_calls_per_call', 'limits.limitSay'],
    blank: 'a longest call',
    width: 560,
  },
};

// the chapters' lines that hold part-level rows
export const LINES = {
  allowed: ['topics.allowed'],
  blocked: ['topics.blocked'],
  offtopic: ['topics.offtopic', 'topics.strikes', 'topics.then', 'topics.say'],
  frustrated: ['moments.frustrated'],
  manager: ['moments.manager', 'moments.words'],
  abusive: ['moments.abusive'],
  call: ['limits.max_call_duration_s'],
  silence: ['limits.max_silence_s'],
  tools: ['limits.max_tool_calls_per_call'],
  limitSay: ['limits.limitSay'],
  try: ['try.try'],
};

// a check's page (the same sections on both lists; a check on what it says has its rows named with "Out")
const checkPage = (sfx, word) => ({
  word: 'check',
  card: word,
  path: true,
  sections: [
    { key: 'looks', title: 'What it looks for', ids: [`entities${sfx}`, `patterns${sfx}`, `fields${sfx}`, `statement${sfx}`] },
    { key: 'finds', title: 'When it finds it', ids: [`action${sfx}`, `checkSay${sfx}`] },
    { key: 'how', title: 'How it is enforced', ids: [`enforce${sfx}`] },
  ],
  more: [`name${sfx}`],
});
export const PAGES = {
  input: checkPage('', 'input'),
  output: checkPage('Out', 'output'),
  rules: {
    word: 'rule',
    card: 'rule',
    path: true,
    sections: [
      { key: 'when', title: 'When', sub: 'any of these, together', ids: ['ruleIntent', 'ruleWords', 'ruleFeel', 'ruleState', 'ruleCompare'] },
      { key: 'then', title: 'Then', ids: ['ruleThen', 'ruleUsing'] },
      { key: 'says', title: 'It says', ids: ['ruleSay'] },
    ],
    more: ['ruleTurns', 'ruleName'],
  },
};

// every row id the workspace shows: the sentence's and chapters' (part-level, "card.row") and a page's (the item's own)
export const placedIds = () => [...new Set([...Object.values(TOKENS).flatMap((t) => t.ids), ...Object.values(LINES).flat()])];
export const placedItemIds = (list) => [...PAGES[list].sections.flatMap((s) => s.ids), ...PAGES[list].more];
