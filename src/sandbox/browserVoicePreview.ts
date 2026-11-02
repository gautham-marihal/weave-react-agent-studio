// Sandbox only: a library voice whose recorded sample can't be played (there is none, or it didn't load) is read aloud
// by one of the browser's own speech voices of the same language and gender (Weave React's pages/voicePreview.js). It
// only gives an idea, and the note under it says so: it is the browser's voice, not the provider's. Live never does
// this; it plays recorded samples only. Loaded with import() by the Library and the voice picker, only in Sandbox.
import { pickBrowserVoice } from './sandboxEngine.js';

export interface PreviewVoice {
  name: string;
  /** "en-US" */
  locale?: string;
  /** "English (US)" */
  language?: string;
  /** "Female" | "Male" */
  gender?: string;
  /** "ElevenLabs" */
  provider?: string;
}

/** What to say under the voice. Pure, so it is tested in node. */
export function browserVoiceNote(voice: PreviewVoice, { certain, hadSample }: { certain: boolean; hadSample: boolean }): string {
  const provider = voice.provider || 'The provider';
  const why = hadSample
    ? `${provider}’s recording of ${voice.name} couldn’t be loaded, so this is your browser’s own voice reading it, not ${voice.name}.`
    : `There is no recorded sample of ${voice.name}, so this is your browser’s own voice reading it, not ${voice.name}.`;
  if (certain) return `${why} It only gives an idea: the real voice is ${provider}’s.`;
  const kind = [String(voice.gender || '').toLowerCase(), voice.language || voice.locale || ''].filter(Boolean).join(' ');
  return `${why} Your browser has no ${kind ? `${kind} ` : ''}voice either, so this is only a rough approximation.`;
}

export const CANNOT_SPEAK = 'This browser can’t read text aloud, and there is no recording of this voice that can be played.';

const speech = (): SpeechSynthesis | null => (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null);

/**
 * Reads a short line in the browser's voice closest to `voice`. Calls `onDone` when it finishes (or fails) and returns
 * the note to show, or CANNOT_SPEAK when the browser has no speech.
 */
export function readAloudInBrowser(voice: PreviewVoice, { hadSample, onDone }: { hadSample: boolean; onDone: () => void }): { note: string; speaking: boolean } {
  const synth = speech();
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return { note: CANNOT_SPEAK, speaking: false };
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(`Hello, I’m ${voice.name}. How can I help you today?`);
  if (voice.locale) utterance.lang = voice.locale;
  utterance.rate = 0.96;
  // a browser voice of the same gender; when the browser has none, the pitch is nudged towards it
  const pick = pickBrowserVoice(synth.getVoices(), { locale: voice.locale, gender: voice.gender });
  if (pick.voice) utterance.voice = pick.voice;
  utterance.pitch = pick.pitch ?? 1;
  utterance.onend = onDone;
  utterance.onerror = onDone;
  synth.speak(utterance);
  return { note: browserVoiceNote(voice, { certain: pick.certain, hadSample }), speaking: true };
}

/** Stops the browser's voice (another voice was chosen, or the voice left the screen). */
export function stopBrowserVoice(): void {
  speech()?.cancel();
}
