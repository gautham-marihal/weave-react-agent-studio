// Which channel the simulated conversation plays. The simulation is typed text, so a channel that is text is the honest
// choice: a chat, not the phone line with the chat's face on it. Only an agent with nothing but voice channels is
// simulated on one of those, and then the conversation says so, because the lines it speaks (the recording notice, the
// greeting of a call) are written out as text. Pure: no React, no DOM.

const VOICE = ['sip_voice', 'web_voice'];
const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

export const isVoiceChannel = (channel) => isObj(channel) && (VOICE.includes(channel.type) || list(channel.modalities?.output).includes('audio'));

// -> { id, type, voice } or null: the one asked for if there is one, else the first enabled text channel (web chat
// before the rest), else the first enabled one.
export function chooseSimulatedChannel(config, wanted = '') {
  const channels = list(config?.channels).filter((c) => isObj(c) && typeof c.id === 'string' && c.id);
  const on = channels.filter((c) => c.enabled !== false);
  const asked = wanted ? channels.find((c) => c.id === wanted) : null;
  const picked = asked || on.find((c) => c.type === 'web_chat') || on.find((c) => !isVoiceChannel(c)) || on[0] || channels[0] || null;
  return picked ? { id: picked.id, type: picked.type, voice: isVoiceChannel(picked) } : null;
}
