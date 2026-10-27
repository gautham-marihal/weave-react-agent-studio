// Which channels a browser can try. The Test tab talks to the agent over the web, so only web chat and web voice work;
// a phone line is tried by calling its number. Pure: no network, no DOM.

type Channel = { id?: string; type?: string; enabled?: boolean; input?: string[]; output?: string[] };

const WEB = ['web_chat', 'web_voice'];
const channelsOf = (config: unknown): Channel[] => {
  const channels = (config as { channels?: unknown } | null | undefined)?.channels;
  return Array.isArray(channels) ? channels.filter((channel): channel is Channel => !!channel && typeof channel === 'object') : [];
};

export type Testability = { state: 'none' | 'off' | 'ok' | 'unknown'; phone: string[] };

// 'none': no web channel (the server refuses a test); 'off': web channels all switched off; 'ok' otherwise;
// 'unknown': configuration not loaded yet.
export function testability(config: unknown): Testability {
  if (!config) return { state: 'unknown', phone: [] };
  const all = channelsOf(config);
  const web = all.filter((channel) => WEB.includes(channel.type || ''));
  const phone = all
    .filter((channel) => channel.type === 'sip_voice')
    .map((channel) => channel.id)
    .filter((id): id is string => !!id);
  if (!web.length) return { state: 'none', phone };
  if (!web.some((channel) => channel.enabled !== false)) return { state: 'off', phone };
  return { state: 'ok', phone };
}

// Draw the widget by what the channel carries, not just its kind (FRONTEND_GUIDE 5): a web chat carrying audio is a
// web voice channel to the server, so it gets a microphone too. `channel`: a session's answer, { type, input, output }.
export const drawsVoice = (channel: Channel | null | undefined): boolean =>
  !!channel && (channel.type === 'web_voice' || (Array.isArray(channel.input) && channel.input.includes('audio')));
