// The voice view of a conversation (VoiceStage): what state it is in and the words it shows. Pure: no React.
//   connecting   asking for the conversation, joining, or reconnecting
//   joining      in the room, waiting for the agent
//   listening    the agent waits for the caller
//   thinking     the caller has spoken and the agent is working out a reply
//   speaking     the agent is talking
//   idle | ended | error

// How long a simulated reply counts as being spoken: it arrives whole, so its length stands for the time to say it.
export const speakingMs = (text) => Math.min(6000, Math.max(1200, String(text || '').length * 55));

const lastSpoken = (messages) => [...(messages || [])].reverse().find((m) => m.role === 'user' || m.role === 'bot') || null;

/**
 * The voice state of a session ({ status, reconnecting, agentState, messages }) at `now`. A real agent says what it is
 * doing (lk.agent.state); otherwise it is read from the last line: a line still coming in, or a reply said moments ago,
 * is speaking; the caller's line is thinking; anything else is listening.
 */
export function voiceStateOf(session, now = Date.now()) {
  const { status, reconnecting, agentState } = session || {};
  if (status === 'error') return 'error';
  if (status === 'ended') return 'ended';
  if (status === 'idle' || !status) return 'idle';
  if (reconnecting || status === 'starting' || status === 'connecting') return 'connecting';
  if (status === 'waiting') return 'joining';
  if (['listening', 'thinking', 'speaking'].includes(agentState)) return agentState;
  const last = lastSpoken(session.messages);
  if (!last) return 'listening';
  if (last.role === 'user') return 'thinking';
  if (!last.final || now - (last.at || 0) < speakingMs(last.text)) return 'speaking';
  return 'listening';
}

/** When a simulated reply stops counting as spoken (so the view can change then), or null. */
export function speakingEndsAt(session) {
  const last = lastSpoken(session?.messages);
  if (session?.agentState || !last || last.role !== 'bot' || !last.final || !last.at) return null;
  return last.at + speakingMs(last.text);
}

const TITLES = {
  idle: 'Ready to talk',
  connecting: 'Connecting…',
  joining: 'Waiting for the agent',
  listening: 'Listening',
  thinking: 'Thinking…',
  speaking: 'Speaking',
  ended: 'Call ended',
  error: 'Connection error',
};
const DETAILS = {
  idle: 'Start the conversation. The agent greets you first.',
  connecting: 'Asking the server for a session…',
  joining: 'It usually greets you within a few seconds.',
  listening: 'Go ahead, the agent is listening.',
  thinking: 'Working out a reply…',
  speaking: '',
  ended: 'You can start again.',
  error: 'The conversation didn’t start.',
};

/** The heading and the line under it, for a state (the error's own words, when there are some). */
export function voiceWords(state, { error, reconnecting } = {}) {
  if (state === 'error' && error) return { title: TITLES.error, detail: error.body || error.title || DETAILS.error };
  if (state === 'connecting' && reconnecting) return { title: 'Reconnecting…', detail: 'The connection dropped. Trying to restore it.' };
  return { title: TITLES[state] || TITLES.idle, detail: DETAILS[state] ?? '' };
}

/** The badge in the corner: its words and tone (StatusChip). */
export function voiceBadge(state) {
  if (state === 'error') return { text: 'Error', tone: 'bad' };
  if (state === 'ended') return { text: 'Ended', tone: 'draft' };
  if (state === 'idle') return { text: 'Ready', tone: 'draft' };
  if (state === 'connecting' || state === 'joining') return { text: 'Connecting', tone: 'review' };
  return { text: 'Live', tone: 'live' };
}

// ---- written replies: the runtime writes a reply out (the transcript the captions show) only when the channel's
// output has text; a web voice channel starts as speech only (GET /channel-types: "spoken and also written")

const outputOf = (channel) => (Array.isArray(channel?.modalities?.output) ? channel.modalities.output : []);

/** A web voice channel whose replies are only spoken, so no transcript arrives for the captions. */
export const speaksOnly = (channel) => channel?.type === 'web_voice' && !outputOf(channel).includes('text');

/** The configuration with that channel's replies written out as well as spoken. */
export function withWrittenReplies(config, channelId) {
  const channels = Array.isArray(config?.channels) ? config.channels : [];
  return {
    ...config,
    channels: channels.map((channel) =>
      channel?.id === channelId && speaksOnly(channel)
        ? {
            ...channel,
            // no modalities means the defaults: audio in, audio out
            modalities: {
              ...channel.modalities,
              input: channel.modalities?.input || ['audio'],
              output: [...(outputOf(channel).length ? outputOf(channel) : ['audio']), 'text'],
            },
          }
        : channel,
    ),
  };
}

/** The captions: the latest line, said by the agent or by you, with who said it. */
export function captionOf(messages) {
  const last = lastSpoken(messages);
  return last && last.text ? { who: last.role === 'user' ? 'You' : 'Agent', text: last.text, final: last.final !== false } : null;
}
