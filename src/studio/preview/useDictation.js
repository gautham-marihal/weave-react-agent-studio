import { useCallback, useEffect, useRef, useState } from 'react';

// Speaking to the simulated agent: the browser's own speech recognition turns what is said into text that goes into the
// message box (the studio uploads nothing; where the recognition runs is up to the browser). Where the browser has
// none, `supported` is false and the button says so. The real agent hears the microphone itself, through the session;
// this is only for the simulated one.
export function useDictation(onText) {
  const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : undefined;
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef(null);
  const latest = useRef(onText);
  latest.current = onText;

  const stop = useCallback(() => {
    try {
      ref.current?.stop();
    } catch {
      /* already stopped */
    }
    setListening(false);
  }, []);
  // for when what was said is no longer wanted (the message was sent, the conversation ended): nothing more is delivered from it
  const cancel = useCallback(() => {
    const rec = ref.current;
    ref.current = null;
    try {
      rec?.abort();
    } catch {
      /* nothing to stop */
    }
    setListening(false);
  }, []);
  const start = useCallback(() => {
    if (!Recognition) return;
    setError('');
    const rec = new Recognition();
    rec.lang = document.documentElement.lang || navigator.language || 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (event) => {
      if (ref.current !== rec) return;
      latest.current([...event.results].map((r) => r[0].transcript).join(' '), event.results[event.results.length - 1].isFinal);
    };
    rec.onerror = (event) => {
      if (ref.current !== rec) return;
      setError(event.error === 'not-allowed' ? 'Allow the microphone in the browser to speak.' : `Speech recognition stopped (${event.error}).`);
      setListening(false);
    };
    rec.onend = () => {
      if (ref.current === rec) setListening(false);
    }; // an older recogniser ending must not switch off the one that replaced it
    ref.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [Recognition]);
  useEffect(
    () => () => {
      try {
        ref.current?.abort();
      } catch {
        /* nothing to stop */
      }
    },
    [],
  );
  return { supported: !!Recognition, listening, error, cancel, toggle: () => (listening ? stop() : start()) };
}

// What a channel lets the caller send, read from its settings (`modalities.input`, and `inputs.image` for pictures):
// the preview offers the microphone, the picture button and the camera exactly when the channel does. `sessionChannel`
// is what a started session reported, used when the config does not say.
export function inputCapabilities(config, sessionChannel) {
  const channels = Array.isArray(config?.channels) ? config.channels : [];
  const channel =
    channels.find((c) => c && c.id === sessionChannel?.id) ||
    channels.find((c) => c && c.enabled !== false && ['web_voice', 'web_chat'].includes(c.type)) ||
    null;
  const inputs = Array.isArray(channel?.modalities?.input) ? channel.modalities.input : Array.isArray(sessionChannel?.input) ? sessionChannel.input : [];
  const image = inputs.includes('image') ? channel?.inputs?.image || {} : null;
  return {
    channel,
    inputs,
    voice: inputs.includes('audio'),
    video: inputs.includes('video'),
    image: image
      ? { acceptedMime: Array.isArray(image.accepted_mime) ? image.accepted_mime : [], maxBytes: image.max_bytes || 0, topic: image.topic || 'image-upload' }
      : null,
  };
}

// Why a picture can't be sent, in words, or '' when it can.
export function pictureProblem(file, image) {
  if (!file || !image) return '';
  if (image.maxBytes && file.size > image.maxBytes)
    return `That picture is ${(file.size / 1048576).toFixed(1)} MB; this channel allows ${(image.maxBytes / 1048576).toFixed(1)} MB.`;
  if (image.acceptedMime.length && !image.acceptedMime.includes(file.type))
    return `This channel accepts ${image.acceptedMime.join(', ')}; that file is ${file.type || 'an unknown type'}.`;
  return '';
}
