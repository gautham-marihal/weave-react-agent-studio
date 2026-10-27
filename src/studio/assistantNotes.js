// What the draft assistant assumed and couldn't decide, kept per agent in sessionStorage until read, so the editor can
// show it above the settings. See demo/draftAssistant.js.

const key = (botId) => `weave_assistant_notes:${botId}`;

export function rememberNotes(botId, notes) {
  try {
    window.sessionStorage.setItem(key(botId), JSON.stringify(notes));
  } catch {
    /* the notes are simply not carried over */
  }
}

export function peekNotes(botId) {
  try {
    const raw = window.sessionStorage.getItem(key(botId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function dismissNotes(botId) {
  try {
    window.sessionStorage.removeItem(key(botId));
  } catch {
    /* nothing to remove */
  }
}
