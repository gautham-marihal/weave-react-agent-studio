// "Show me this setting": the search (or anything else outside the page that holds it) asks for a setting of an agent to be shown, and the agent's
// workspace takes the request the moment it is there to take it, and opens the page and panel that hold it.
// A request for another agent is left alone. Pure state, no React.
//   path: where the setting is, as far as it can be opened (no list item is
//   named); extra: { trail } the whole path down to the setting, { view: 'json' }
let pending = null;
const listeners = new Set();

export function requestSettingFocus(botId, path, extra = {}) {
  pending = { ...extra, botId, path, nonce: Date.now() };
  listeners.forEach((listener) => listener());
}

export function takeSettingFocus(botId) {
  if (pending && pending.botId === botId) {
    const taken = pending;
    pending = null;
    return taken;
  }
  return null;
}

export function onSettingFocus(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
