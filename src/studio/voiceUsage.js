// @ts-check
// Which agents speak with each voice of the library, from their saved configurations (defaults.models.tts: provider + voice_id).
// Pure: no network, no DOM.

const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

// voices: the catalog ({ id, provider, voiceId }); configs: { agentId: config | null | undefined }; agents: [{ id, name }].
// -> { voiceId (the catalog id): [agent, ...] }
export function voiceUsage(voices, agents, configs) {
  const usage = {};
  (agents || []).forEach((agent) => {
    const tts = configs?.[agent.id]?.defaults?.models?.tts;
    if (!tts || !tts.voice_id) return;
    (voices || []).forEach((voice) => {
      if (!same(voice.provider, tts.provider)) return;
      if (voice.voiceId && voice.voiceId === tts.voice_id) (usage[voice.id] = usage[voice.id] || []).push(agent);
    });
  });
  return usage;
}
