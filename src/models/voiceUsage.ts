// Which agents speak with each library voice, from their saved drafts (defaults.models.tts: provider + voice_id). Pure,
// apart from the favourites kept in this browser at the end.

import { browserStore, stringList } from './manageStore';

type Voice = { id: string; provider?: string; voiceId?: string };
type Agent = { id: string; name?: string };
type ConfigWithTts = { defaults?: { models?: { tts?: { provider?: string; voice_id?: string } } } } | null | undefined;

const same = (a: unknown, b: unknown) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

/**
 * voices: the catalogue ({ id, provider, voiceId }); agents: [{ id, name }]; configs: { agentId: config }.
 * Returns { catalogue id: [agent, ...] }. A voice id counts only under its own provider.
 */
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

/** The voices starred in the Library, kept in this browser. */
export const FAVOURITE_VOICES_KEY = 'weave_voice_favorites';
export const favouriteVoicesStore = browserStore(FAVOURITE_VOICES_KEY, stringList);
export const toggleFavouriteVoice = (id: string) => favouriteVoicesStore.update((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
