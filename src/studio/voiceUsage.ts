// Which agents speak with each library voice, from their saved configs (defaults.models.tts: provider + voice_id).
// Pure: no network, no DOM.

type Voice = { id: string; provider?: string; voiceId?: string };
type Agent = { id: string; name?: string };
type ConfigWithTts = { defaults?: { models?: { tts?: { provider?: string; voice_id?: string } } } } | null | undefined;

const same = (a: unknown, b: unknown) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

//   voices: the catalog ({ id, provider, voiceId })
//   configs: { agentId: config | null | undefined }
//   agents: [{ id, name }]
// -> { voiceId (the catalog id): [agent, ...] }
export function voiceUsage<A extends Agent>(
  voices: Voice[] | null | undefined,
  agents: A[] | null | undefined,
  configs: Record<string, ConfigWithTts> | null | undefined,
): Record<string, A[]> {
  const usage: Record<string, A[]> = {};
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
