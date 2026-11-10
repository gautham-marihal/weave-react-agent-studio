// Where each of Conversation's settings shows in its overview, by the part's row ids ("card.row"). Pure data, so the
// tests can check that every setting has exactly one place (the sentence's "then" opens the same editor as "quiet").

// the parts of the sentence, and the editor each opens (width: how wide it may get)
export const TOKENS = {
  wait: { title: 'How long it waits', ids: ['turns.wait', 'turns.min', 'turns.max'], blank: 'the usual pause', width: 560 },
  interrupt: {
    title: 'When a caller cuts in',
    ids: ['turns.interrupt', 'turns.shortest', 'turns.words', 'turns.resume', 'turns.resumeAfter', 'turns.noticed', 'turns.fixed'],
    blank: 'can cut in',
    width: 520,
  },
  quiet: { title: 'When someone goes quiet', ids: ['quiet.nudge', 'quiet.clock', 'quiet.script'], blank: 'doesn’t check in yet', optional: true, width: 600 },
  // "it checks in [twice], [2½ minutes apart], then [says goodbye…]": blanks until set, each opening the same script
  count: {
    title: 'When someone goes quiet',
    ids: ['quiet.nudge', 'quiet.clock', 'quiet.script'],
    blank: 'how often',
    optional: true,
    width: 600,
    same: 'quiet',
  },
  gap: {
    title: 'When someone goes quiet',
    ids: ['quiet.nudge', 'quiet.clock', 'quiet.script'],
    blank: 'how far apart',
    optional: true,
    width: 600,
    same: 'quiet',
  },
  then: {
    title: 'When someone goes quiet',
    ids: ['quiet.nudge', 'quiet.clock', 'quiet.script'],
    blank: 'what happens',
    optional: true,
    width: 600,
    same: 'quiet',
  },
};

// the chapters' lines that open under themselves, and the settings under "more"
export const LINES = {
  says: ['speech.rules', 'speech.apply', 'speech.trySpeech'],
  thinking: ['sounds.thinking'],
  line: ['sounds.noise', 'sounds.ivr'],
  remembers: ['remembers.variables'],
  reacts: ['events.events'],
  fails: ['fails.failures', 'fails.failThen'],
};
export const MORE = {
  rhythm: ['turns.early', 'turns.turnlimit', 'turns.vad', 'turns.eot'],
  sound: ['sounds.ambient', 'speech.buffer'],
  scenes: ['steps.maxsteps', 'fails.retries'],
};

// every id the overview shows, once each
export const placedIds = () => [
  ...Object.values(TOKENS)
    .filter((t) => !t.same)
    .flatMap((t) => t.ids),
  ...Object.values(LINES).flat(),
  ...Object.values(MORE).flat(),
];
