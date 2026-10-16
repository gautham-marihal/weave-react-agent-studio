// @ts-check
// Which channels a browser can try. The Test tab talks to the agent over the web, so only web chat and web voice work; a phone line
// is tried by calling its number. Pure: no network, no DOM.

const WEB = ['web_chat', 'web_voice'];
const channelsOf = (config) => (Array.isArray(config?.channels) ? config.channels.filter((channel) => channel && typeof channel === 'object') : []);

// 'none' = no web channel at all (the server refuses a test), 'off' = web channels exist but all are switched off, 'ok' otherwise,
// 'unknown' when the configuration isn't loaded yet.
export function testability(config) {
  if (!config) return { state: 'unknown', phone: [] };
  const all = channelsOf(config);
  const web = all.filter((channel) => WEB.includes(channel.type));
  const phone = all
    .filter((channel) => channel.type === 'sip_voice')
    .map((channel) => channel.id)
    .filter(Boolean);
  if (!web.length) return { state: 'none', phone };
  if (!web.some((channel) => channel.enabled !== false)) return { state: 'off', phone };
  return { state: 'ok', phone };
}
