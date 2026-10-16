import { useCallback, useEffect, useRef, useState } from 'react';
import { pickBrowserVoice } from './browserVoice.js';

// Listening to a voice from the library. A voice that has a recorded sample of its own (`previewUrl`: ElevenLabs publishes one for each of its premade voices)
// plays THAT, so a man and a woman, or two women, really sound different. A voice with none (Cartesia publishes samples only to account holders) is read by the
// browser's own speech voices, chosen by language and gender, which only gives an idea, and the note says so. Shared by the Voices page and the voice picker.
export function useVoicePreview() {
  const [playing, setPlaying] = useState('');
  const [note, setNote] = useState('');
  const [browserVoices, setBrowserVoices] = useState([]);
  const audio = useRef(null);
  const speech = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const canPlay = speech || typeof Audio !== 'undefined';

  const silence = useCallback(() => {
    if (audio.current) {
      audio.current.pause();
      audio.current.onended = null;
      audio.current.onerror = null;
      audio.current = null;
    }
    if (speech) window.speechSynthesis.cancel();
  }, [speech]);

  useEffect(() => {
    if (!speech) return undefined;
    const load = () => setBrowserVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener?.('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', load);
  }, [speech]);
  useEffect(() => silence, [silence]);

  const readAloud = (voice, because = '') => {
    if (!speech) {
      setPlaying('');
      setNote('This browser cannot read text aloud, and there is no recorded sample of this voice.');
      return;
    }
    const utterance = new SpeechSynthesisUtterance(`Hello, I'm ${voice.name}. How can I help you today?`);
    utterance.lang = voice.locale;
    utterance.rate = 0.96;
    // a female voice is played with a female browser voice and a male one with a male one; when the browser has none of that gender the pitch is nudged
    const pick = pickBrowserVoice(browserVoices.length ? browserVoices : window.speechSynthesis.getVoices(), voice);
    if (pick.voice) utterance.voice = pick.voice;
    utterance.pitch = pick.pitch;
    const why = because || `${voice.provider} does not publish a sample of this voice, so this is your browser’s voice reading it.`;
    setNote(
      pick.certain
        ? `${why} It only gives an idea: the real voice is ${voice.provider}’s.`
        : `${why} Your browser has no ${String(voice.gender).toLowerCase()} ${voice.language} voice either, so this is only an approximation of ${voice.name}.`,
    );
    utterance.onend = () => setPlaying('');
    utterance.onerror = () => setPlaying('');
    setPlaying(voice.id);
    window.speechSynthesis.speak(utterance);
  };

  const play = (voice) => {
    const wasPlaying = playing === voice.id;
    silence();
    if (wasPlaying) {
      setPlaying('');
      return;
    }
    if (voice.previewUrl && typeof Audio !== 'undefined') {
      const sample = new Audio(voice.previewUrl);
      audio.current = sample;
      sample.onended = () => setPlaying('');
      sample.onerror = () => {
        audio.current = null;
        readAloud(voice, `${voice.provider}’s recorded sample could not be loaded (are you offline?), so this is your browser’s voice reading it.`);
      };
      setNote('');
      setPlaying(voice.id);
      sample.play().catch(() => sample.onerror?.());
      return;
    }
    readAloud(voice);
  };

  return { can: canPlay, playing, note, play };
}
