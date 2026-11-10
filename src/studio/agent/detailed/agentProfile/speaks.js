// Whether the agent talks: a channel that is on is a voice one (a phone line, web voice) or says it hears or speaks
// audio. Then it needs a voice, and the models that hear and speak.
const list = (v) => (Array.isArray(v) ? v : []);
export const speaks = (config) =>
  list(config?.channels).some(
    (ch) =>
      ch &&
      ch.enabled !== false &&
      (['sip_voice', 'web_voice'].includes(ch.type) || list(ch.modalities?.input).includes('audio') || list(ch.modalities?.output).includes('audio')),
  );
