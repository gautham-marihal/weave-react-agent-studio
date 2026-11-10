// Where each of After the call's settings shows in its workspace (canvas page "9 · After the call, redesigned"). Each
// question opens in place on its own line (its row is "questions.q<index>"); the rarer settings are under "more". Pure
// data, so the tests can check every setting has a place.

// the parts of the sentence, and the rows each opens ("card.row")
export const TOKENS = {
  summary: { title: 'A summary of each call', ids: ['summary.summary', 'summary.cover'], blank: 'a summary', width: 520 },
  questions: { title: 'Questions about each call', ids: [], blank: 'questions about each call', width: 560 },
  log: { title: 'A log of each call', ids: ['recording.log', 'recording.logdays'], width: 520 },
  logdays: { title: 'How long logs are kept', ids: ['recording.logdays'], width: 440 },
  rec: { title: 'The audio and the transcript', ids: ['recording.transcript', 'recording.audio', 'recording.days'], width: 520 },
  days: { title: 'How long they are kept', ids: ['recording.days'], width: 440 },
  hide: { title: 'What it hides', ids: ['privacy.hide', 'privacy.entities', 'privacy.replace'], blank: 'hiding sensitive details', width: 600 },
  close: { title: 'Closing a call', ids: ['closing.wait', 'closing.silent'], width: 560 },
};

// the chapters' lines that hold rows (a question's line is its own row)
export const LINES = {
  close: ['closing.wait', 'closing.silent'],
  summary: ['summary.summary', 'summary.cover'],
  addQuestion: ['questions.add'],
  log: ['recording.log', 'recording.logdays'],
  transcript: ['recording.transcript', 'recording.days'],
  audio: ['recording.audio', 'recording.days'],
  files: ['recording.files'],
  notice: ['recording.notice'],
  hide: ['privacy.hide'],
  entities: ['privacy.entities'],
  replace: ['privacy.replace'],
  patterns: ['privacy.patterns'],
  try: ['privacy.try'],
};

// each chapter's settings fewer people need, folded under "more"
export const MORE = {
  writes: ['summary.llm'],
  keeps: ['recording.detail', 'recording.folder'],
  hides: ['privacy.secrets', 'privacy.pii', 'privacy.requests'],
};

// every row id the workspace shows (questions aside)
export const placedIds = () => [...new Set([...Object.values(TOKENS).flatMap((t) => t.ids), ...Object.values(LINES).flat(), ...Object.values(MORE).flat()])];
