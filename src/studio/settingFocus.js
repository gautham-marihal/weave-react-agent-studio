// "Show me this setting": search asks for a setting, and the agent's workspace takes the request once it is mounted and
// opens the page and panel that hold it. A request for another agent is left alone. Pure state, no React.
//   path: where the setting is, as far as it can be opened (no list item is named)
//   extra: { trail } the whole path down to the setting, or { view: 'json' }
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
