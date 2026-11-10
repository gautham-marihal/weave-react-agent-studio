// Where each of Engine and details' settings shows in its workspace (canvas page "10 · Engine and details,
// redesigned"); the rarer settings are under "more". Pure data, so the tests can check every setting has a place.

// the parts of the sentence, and the rows each opens ("card.row")
export const TOKENS = {
  id: { title: 'Its id', ids: ['version.id'], width: 440 },
  version: { title: 'Its version and status', ids: ['version.version', 'version.status', 'version.when'], width: 480 },
  env: { title: 'The environment it’s meant for', ids: ['version.env'], blank: 'the environment it’s meant for', width: 480 },
  engine: { title: 'The engine', ids: ['engine.engine'], width: 440 },
  mode: { title: 'Where models come from', ids: ['engine.mode'], width: 540 },
  tz: { title: 'Its time zone', ids: ['engine.tz'], blank: 'a time zone', width: 460 },
  vault: { title: 'Where secrets are kept', ids: ['engine.vault'], width: 460 },
  consts: { title: 'Fixed values', ids: ['constants.values'], blank: 'fixed values', width: 720 },
  lint: { title: 'Studio checks', ids: ['lint.words', 'lint.tools', 'lint.mono'], width: 520 },
};

// the chapters' lines that hold rows
export const LINES = {
  env: ['version.env'],
  engine: ['engine.engine'],
  mode: ['engine.mode'],
  tz: ['engine.tz'],
  vault: ['engine.vault'],
  hangup: ['engine.drain', 'engine.close'],
  consts: ['constants.values'],
  lint: ['lint.words', 'lint.tools', 'lint.mono'],
  logs: ['logs.level', 'logs.metrics', 'logs.tracing', 'logs.otelOn', 'logs.otelEndpoint', 'logs.otelName'],
};

// each chapter's settings fewer people need, folded under "more"
export const MORE = {
  runs: ['engine.worker', 'engine.dispatch'],
  values: ['logs.logFile'],
};

// every row id the workspace shows
export const placedIds = () => [...new Set([...Object.values(TOKENS).flatMap((t) => t.ids), ...Object.values(LINES).flat(), ...Object.values(MORE).flat()])];
