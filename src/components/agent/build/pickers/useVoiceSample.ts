import { useCallback, useEffect, useRef, useState } from 'react';
import { isSandbox } from '../../../../sandbox/mode';

export interface SampleVoice {
  id: string;
  name: string;
  previewUrl?: string;
  locale?: string;
  language?: string;
  gender?: string;
  provider?: string;
}

/**
 * Plays a catalogue voice's own recorded sample (its `previewUrl`), one at a time. In Live a voice without a recording,
 * or one that can't be loaded, says so: nothing is read aloud in another voice instead. In Sandbox the browser's own
 * voice reads it instead, and the note says it is the browser's voice, not the real one.
 */
export function useVoiceSample() {
  const [playing, setPlaying] = useState('');
  const [note, setNote] = useState('');
  const audio = useRef<HTMLAudioElement | null>(null);
  // which start is current: events of an older one are ignored
  const turn = useRef(0);
  const speaking = useRef(false);

  const stop = useCallback(() => {
    turn.current += 1;
    if (audio.current) {
      audio.current.pause();
      audio.current.onended = null;
      audio.current.onerror = null;
      audio.current = null;
    }
    if (speaking.current) {
      speaking.current = false;
      void import('../../../../sandbox/browserVoicePreview').then((m) => m.stopBrowserVoice());
    }
    setPlaying('');
  }, []);
  useEffect(() => stop, [stop]);

  // Sandbox: the browser's voice reads it (loaded only in Sandbox)
  const readAloud = useCallback(async (voice: SampleVoice, hadSample: boolean, mine: number) => {
    const { readAloudInBrowser } = await import('../../../../sandbox/browserVoicePreview');
    if (turn.current !== mine) return;
    const done = () => {
      if (turn.current === mine) {
        speaking.current = false;
        setPlaying('');
      }
    };
    const said = readAloudInBrowser(voice, { hadSample, onDone: done });
    speaking.current = said.speaking;
    setNote(said.note);
    setPlaying(said.speaking ? voice.id : '');
  }, []);

  const play = useCallback(
    (voice: SampleVoice) => {
      const again = playing === voice.id;
      stop();
      if (again) return;
      setNote('');
      const mine = turn.current;
      if (!voice.previewUrl) {
        if (isSandbox()) void readAloud(voice, false, mine);
        else setNote(`There is no recording of ${voice.name} to play.`);
        return;
      }
      const sample = new Audio(voice.previewUrl);
      audio.current = sample;
      let failedOnce = false;
      const failed = () => {
        if (turn.current !== mine || failedOnce) return;
        failedOnce = true;
        audio.current = null;
        if (isSandbox()) {
          void readAloud(voice, true, mine);
          return;
        }
        setPlaying('');
        setNote(`The recording of ${voice.name} couldn’t be played. Check your connection and try again.`);
      };
      sample.onended = () => {
        if (turn.current === mine) setPlaying('');
      };
      sample.onerror = failed;
      setPlaying(voice.id);
      sample.play().catch(failed);
    },
    [playing, stop, readAloud]
  );

  return { playing, note, play, stop };
}
