// "Show me this setting": the search (or anything else outside the Config tab) asks for a setting of an agent to be shown, and the Config tab of
// that agent takes the request the moment it is there to take it. A request for another agent is left alone. Pure state, no React.
let pending = null;
const listeners = new Set();

export function requestSettingFocus(botId, path) {
  pending = { botId, path, nonce: Date.now() };
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
