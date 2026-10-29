import { pickBrowserVoice } from '../../pages/browserVoice.js';
import { useCallback, useEffect, useRef, useState } from 'react';

// Voice for banking rehearsals through the browser's own Web Speech API: speech recognition for what the customer
// says, speech synthesis for the assistant's replies, and a level meter from the real microphone input. This is the
// browser's speech service, not the Agent Builder voice runtime (which needs a LiveKit room and a deployed agent).
// Chrome and Edge send recognised audio to their speech service; the screen says so.

export type VoiceStatus = 'unsupported' | 'idle' | 'connecting' | 'listening' | 'processing' | 'speaking' | 'error';

interface RecognitionResult {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}
interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access was blocked. Allow the microphone for this site in the browser, then start the call again.',
  'service-not-allowed': "The browser's speech service is not allowed here. Use the typed chat instead.",
  'audio-capture': 'No microphone was found. Connect one, or use the typed chat.',
  network: "The browser's speech service could not be reached. Check the connection, or use the typed chat.",
};

export interface BrowserVoice {
  readonly status: VoiceStatus;
  readonly supported: boolean;
  readonly canSpeak: boolean;
  /** What is being heard right now (not yet final). */
  readonly interim: string;
  /** Microphone input level, 0–1, from the real input. */
  readonly level: number;
  readonly error: string | null;
  readonly active: boolean;
  /** `active`, readable right after awaiting `start` (before the next render). */
  isActive: () => boolean;
  start: () => Promise<void>;
  stop: () => void;
  /** Speaks a reply; listening pauses meanwhile so the assistant does not hear itself. */
  speak: (text: string) => Promise<void>;
  setProcessing: (processing: boolean) => void;
  /** Muted: nothing is heard (recognition stops); replies are still spoken. */
  readonly muted: boolean;
  toggleMute: () => void;
}

/** The voice to speak with: the agent's own (Build → Banking → Agent voice), matched to a browser voice by language and gender. */
export interface VoiceHint {
  locale?: string;
  gender?: string;
}

export function useBrowserVoice(onFinal: (text: string) => void, lang = 'en-SG', hint: VoiceHint | null = null): BrowserVoice {
  const Ctor = recognitionCtor();
  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [status, setStatus] = useState<VoiceStatus>(Ctor ? 'idle' : 'unsupported');
  const [interim, setInterim] = useState('');
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [muted, setMuted] = useState(false);

  const activeRef = useRef(false);
  const mutedRef = useRef(false);
  const speakingRef = useRef(false);
  const processingRef = useRef(false);
  const recognitionRef = useRef<Recognition | null>(null);
  const runningRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | null>(null);
  const hintRef = useRef(hint);
  hintRef.current = hint;
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const settle = useCallback(() => {
    if (!activeRef.current) return setStatus(Ctor ? 'idle' : 'unsupported');
    setStatus(speakingRef.current ? 'speaking' : processingRef.current ? 'processing' : 'listening');
  }, [Ctor]);

  const listen = useCallback(() => {
    const r = recognitionRef.current;
    if (!r || runningRef.current || !activeRef.current || speakingRef.current || mutedRef.current) return;
    try {
      r.start();
      runningRef.current = true;
    } catch {
      // Already started: the browser throws InvalidStateError; nothing to do.
    }
  }, []);

  const pause = useCallback(() => {
    const r = recognitionRef.current;
    if (!r || !runningRef.current) return;
    runningRef.current = false;
    try {
      r.abort();
    } catch {
      // Not running.
    }
  }, []);

  const stopMeter = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioRef.current?.close().catch(() => undefined);
    audioRef.current = null;
    setLevel(0);
  }, []);

  const stop = useCallback(() => {
    activeRef.current = false;
    setActive(false);
    mutedRef.current = false;
    setMuted(false);
    pause();
    recognitionRef.current = null;
    if (canSpeak) window.speechSynthesis.cancel();
    speakingRef.current = false;
    stopMeter();
    setInterim('');
    setStatus(Ctor ? 'idle' : 'unsupported');
  }, [pause, stopMeter, canSpeak, Ctor]);

  const start = useCallback(async () => {
    if (!Ctor || activeRef.current) return;
    setError(null);
    setStatus('connecting');
    // Ask for the microphone first: it gives a clear permission error and feeds the level meter.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        audioRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (const v of data) sum += ((v - 128) / 128) ** 2;
          setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
          frameRef.current = requestAnimationFrame(tick);
        };
        tick();
      }
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      setError(
        (name === 'NotAllowedError' ? ERRORS['not-allowed'] : name === 'NotFoundError' ? ERRORS['audio-capture'] : null) ??
          'The microphone could not be started. Use the typed chat instead.',
      );
      setStatus('error');
      return;
    }

    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = lang;
    r.onresult = (event) => {
      let partial = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        const text = result[0].transcript.trim();
        if (result.isFinal) {
          setInterim('');
          if (text) onFinalRef.current(text);
        } else partial += `${text} `;
      }
      if (partial.trim()) setInterim(partial.trim());
    };
    r.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return; // silence, or our own pause
      const message = ERRORS[event.error];
      if (message) {
        setError(message);
        activeRef.current = false;
        setActive(false);
        stopMeter();
        setStatus('error');
      }
    };
    // Recognition stops by itself after a pause; keep listening while the call is on.
    r.onend = () => {
      runningRef.current = false;
      if (activeRef.current && !speakingRef.current) window.setTimeout(listen, 150);
    };
    recognitionRef.current = r;
    activeRef.current = true;
    setActive(true);
    listen();
    settle();
  }, [Ctor, lang, listen, settle, stopMeter]);

  const speak = useCallback(
    (text: string) =>
      new Promise<void>((resolve) => {
        if (!canSpeak || !text.trim()) return resolve();
        speakingRef.current = true;
        pause();
        settle();
        const utterance = new SpeechSynthesisUtterance(text);
        // the agent's own voice, as near as this browser has one (same language, then same gender, else pitched towards it)
        const match = hintRef.current?.locale
          ? pickBrowserVoice(window.speechSynthesis.getVoices(), { locale: hintRef.current.locale, gender: hintRef.current.gender ?? '' })
          : null;
        if (match?.voice) {
          utterance.voice = match.voice;
          utterance.lang = match.voice.lang;
          utterance.pitch = match.pitch;
        } else utterance.lang = lang;
        utterance.rate = 1.02;
        let finished = false;
        // Chrome sometimes never fires onend (long utterances, no voices): don't leave the microphone paused.
        const watchdog = window.setTimeout(() => done(), 3_000 + text.split(/\s+/).length * 450);
        const done = () => {
          if (finished) return;
          finished = true;
          window.clearTimeout(watchdog);
          speakingRef.current = false;
          setInterim('');
          settle();
          listen();
          resolve();
        };
        utterance.onend = done;
        utterance.onerror = done;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      }),
    [canSpeak, lang, pause, settle, listen],
  );

  const setProcessing = useCallback(
    (processing: boolean) => {
      processingRef.current = processing;
      settle();
    },
    [settle],
  );

  useEffect(() => () => stop(), [stop]);
  const isActive = useCallback(() => activeRef.current, []);

  const toggleMute = useCallback(() => {
    mutedRef.current = !mutedRef.current;
    setMuted(mutedRef.current);
    setInterim('');
    if (mutedRef.current) pause();
    else listen();
  }, [pause, listen]);

  return {
    status,
    supported: Boolean(Ctor),
    canSpeak,
    interim,
    level: muted ? 0 : level,
    error,
    active,
    isActive,
    start,
    stop,
    speak,
    setProcessing,
    muted,
    toggleMute,
  };
}
