import { useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import type { Participant, RemoteParticipant, RemoteTrack, Room, TextStreamReader } from 'livekit-client';
import type { AgentConfig, ChannelType } from '../types/studio';
import type { ChatMessage, FormRequest, TraceEvent } from '../types/testConsole';
import { api, followCall } from '../api/client';
import type { ChannelSpec, Session } from '../api/types';
import { reportLiveKitStatus } from './useLiveKitStatus';
import type { BubbleState } from '../components/agent/test/VoiceBubble';
import {
  AGENT_DID_NOT_JOIN,
  MIC_NEEDS_SECURE_CONTEXT,
  disconnectReasonText,
  isAgentParticipant,
  micErrorMessage,
  roomConnectError,
  sessionStartError,
  traceFromRecord,
  type TraceItem,
} from '../utils/testSession';

export type SessionStatus = 'idle' | 'connecting' | 'waiting' | 'live' | 'ended' | 'error';

const TOPIC_TRANSCRIPTION = 'lk.transcription';
const TOPIC_CHAT = 'lk.chat';
const TOPIC_FORM = 'agent-builder.form';
const TOPIC_FORM_SUBMIT = 'agent-builder.form.submit';

// The token asks LiveKit to send the agent; if no agent participant has joined by then, it is not coming.
const AGENT_JOIN_TIMEOUT_MS = 20_000;
// When the agent leaves, LiveKit usually closes the room right after, with a reason worth showing. Wait that long for it.
const AGENT_LEFT_GRACE_MS = 1_500;

// Audio meters: an analyser's RMS (speech sits around 0.05–0.3) is boosted into a 0–1 level, the same boost the
// voice orb gives its own microphone. The agent's voice drives the level; the caller's moves it only a little.
const METER_OPTIONS = { fftSize: 512, smoothingTimeConstant: 0.3, minDecibels: -90, maxDecibels: -10 };
const LEVEL_GAIN = 4.5;
const USER_LEVEL_SHARE = 0.35;
const METER_INTERVAL_MS = 50;

interface Meter {
  track: unknown;
  calculateVolume: () => number;
  cleanup: () => Promise<void>;
}

export interface TestSession {
  status: SessionStatus;
  bubbleState: BubbleState;
  channel: ChannelType;
  messages: ChatMessage[];
  trace: TraceEvent[];
  typing: boolean;
  listening: boolean;
  agentSpeaking: boolean;
  audioLevel: number;
  latestCaption: string;
  isMuted: boolean;
  /** Why the conversation could not start or broke off; set with status 'error'. */
  error: string | null;
  /** Why the last conversation ended, in plain words; set with status 'ended'. */
  endReason: string | null;
  /** The LiveKit room of the current conversation, while joined. */
  room: string | null;
  /**
   * This conversation's LiveKit join token, while joined. The banking panel presents it to the banking gateway's
   * channel routes to prove it is this call's device; it is cleared when the conversation ends.
   */
  roomToken: string | null;
  /** When the current conversation started (ms since epoch), for placing other timelines next to the trace. */
  startedAt: number | null;
  /** The browser blocked the agent's audio until the person clicks; `enableAudio` (from a click) lets it play. */
  audioBlocked: boolean;
  /** The microphone could not be turned on; `retryMic` (from a click) asks again. */
  micError: string | null;
  /** Unlocks audio playback; call it synchronously in the click that starts a conversation, before any await. */
  primeAudio: () => void;
  enableAudio: () => Promise<void>;
  retryMic: () => Promise<void>;
  /** What the current (or last) conversation runs: the ref asked for, the version the server chose, its channel. */
  info: SessionInfo | null;
  /** The call's own records as the runtime wrote them (followed live), for making a scenario from the conversation. */
  records: unknown[];
  /** Camera and screen sharing, offered only when the session's channel takes video. */
  media: { camera: boolean; screen: boolean };
  toggleMedia: (what: 'camera' | 'screen') => Promise<void>;
  /** Sends a picture on the topic the channel names; false when it could not be sent. */
  sendImage: (file: File, topic: string) => Promise<boolean>;
  /** Shows the local camera in a video element (while the camera is on). */
  attachCamera: (video: HTMLVideoElement | null) => void;
  /**
   * `channelId` is the channel's id in the config (e.g. "web-voice"); the server picks channels by id, not type.
   * `ref` is what to talk to: "draft" (the saved draft), "latest", a version or an environment.
   */
  start: (type: ChannelType, channelId?: string, ref?: string) => Promise<void>;
  stop: () => void;
  send: (text: string) => Promise<void>;
  toggleMute: () => Promise<void>;
  submitForm: (messageId: string, form: FormRequest, values: Record<string, string>) => Record<string, string>;
  /**
   * Set only for a conversation played in this browser (Sandbox's, src/sandbox/test, and Live's banking rehearsal on
   * the mock bank): an imitation, with the words the screen shows for it in place of LiveKit's and the runtime's.
   */
  sandbox?: SandboxConversationWords;
  /** Set only for a banking conversation played in this browser (src/sandbox/banking): what the Test console draws around it. */
  extras?: ConversationExtras;
  /**
   * Set only in Live for a banking draft (src/sandbox/banking/LiveBankingSession): who plays the agent, the real agent
   * on the Agent Builder runtime or a banking rehearsal on the mock bank. Chosen before a conversation starts.
   */
  playedBy?: PlayedByChoice;
}

export type PlayedBy = 'agent' | 'rehearsal';

export interface PlayedByChoice {
  value: PlayedBy;
  options: Array<{ value: PlayedBy; label: string }>;
  onChange: (value: PlayedBy) => void;
}

/** What a Sandbox banking conversation adds around the conversation (drawn by its own code in src/sandbox). */
export interface ConversationExtras {
  /** Under an agent reply: its card (a balance, a list, choices) and where its answer came from. */
  underMessage: (message: ChatMessage) => ReactNode;
  /** The customer's device, beside the conversation: sign-in, keypad, accounts, confirmations, the phone's SMS. */
  beside: ReactNode;
  /** Shown over the message box (e.g. "key the PIN on the secure keypad"), or null. */
  composerNote: ReactNode;
  /** What the message box asks for (a Phone Code, an account number), when something in particular. */
  placeholder?: string;
  /** Suggested things to say. */
  suggestions: string[];
  /** The browser's speech service speaks and listens on a voice channel: the voice bubble's wording, or null. */
  voice: { title: string; descriptions: Partial<Record<BubbleState, string>> } | null;
  /** Said plainly on a voice channel when this browser cannot speak or listen (the conversation is typed instead). */
  voiceMissing: string | null;
  /** Changes whenever the customer's device needs the person (a keypad, a confirmation), for narrow layouts. */
  attention: string;
}

/** What a Sandbox conversation says about itself (the words live in src/sandbox). */
export interface SandboxConversationWords {
  /** The tag on each made-up reply, and its tooltip. */
  replyTag: string;
  replyTagTitle: string;
  /** The status chip in place of "Real LiveKit". */
  chip: string;
  /** The start screen's lead, and what it says while starting. */
  intro: string;
  starting: string;
  /** Said where a real conversation asks for unsaved edits to be saved first. */
  unsaved: string;
  /** A note beside the conversation, and one over its trace. */
  note: string;
  traceNote: string;
}

export interface SessionInfo {
  ref: string;
  version: string;
  channel: ChannelSpec | null;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err ?? ''));

export function useTestSession(agentId: string, _config?: AgentConfig, _revision?: number): TestSession {
  void _config;
  void _revision;
  const [status, setStatusState] = useState<SessionStatus>('idle');
  const [bubbleState, setBubbleState] = useState<BubbleState>('idle');
  const [channel, setChannel] = useState<ChannelType>('web_chat');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [trace, setTrace] = useState<TraceEvent[]>([]);
  const [typing, setTyping] = useState(false);
  const [listening, setListening] = useState(false);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [latestCaption, setLatestCaption] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [endReason, setEndReason] = useState<string | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [room, setRoom] = useState<string | null>(null);
  const [roomToken, setRoomToken] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [records, setRecords] = useState<unknown[]>([]);
  const [media, setMedia] = useState({ camera: false, screen: false });

  const roomRef = useRef<Room | null>(null);
  const audioHostRef = useRef<HTMLDivElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamUnsubRef = useRef<(() => void) | null>(null);
  const agentMeterRef = useRef<Meter | null>(null);
  const userMeterRef = useRef<Meter | null>(null);
  const meterTimerRef = useRef<number | null>(null);
  const watchdogRef = useRef<number | null>(null);
  const agentLeftRef = useRef<number | null>(null);
  const agentIdentityRef = useRef<string | null>(null);
  const statusRef = useRef<SessionStatus>('idle');
  const mutedRef = useRef(false);
  // Every start (and every end) bumps the run; handlers and awaits of an older run see they are stale and stop.
  const runRef = useRef(0);
  const idRef = useRef(0);
  // Transcript segment id -> message id, so a segment that arrives in pieces (or is re-sent as it firms up) stays one bubble.
  const segmentsRef = useRef(new Map<string, string>());
  const startRef = useRef(0);
  const activeAgentRef = useRef(agentId);
  activeAgentRef.current = agentId;

  const setStatus = useCallback((next: SessionStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  // Ensure an invisible audio host element exists in the DOM
  useEffect(() => {
    let host = document.getElementById('livekit-audio-host') as HTMLDivElement;
    if (!host) {
      host = document.createElement('div');
      host.id = 'livekit-audio-host';
      host.style.display = 'none';
      document.body.appendChild(host);
    }
    audioHostRef.current = host;
    return () => {
      if (audioHostRef.current) {
        audioHostRef.current.replaceChildren();
      }
      audioContextRef.current?.close().catch(() => undefined);
      audioContextRef.current = null;
    };
  }, []);

  const nextId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(idRef.current += 1)}`;

  const addTrace = useCallback((events: TraceItem[]) => {
    const at = Date.now() - startRef.current;
    setTrace((prev) => [...prev, ...events.map((e) => ({ ...e, id: nextId('t'), at_ms: at }))]);
  }, []);

  const addMessage = useCallback((m: Omit<ChatMessage, 'id'>): string => {
    const id = nextId('m');
    setMessages((prev) => [...prev, { ...m, id }]);
    return id;
  }, []);

  const upsertSegment = useCallback(
    (key: string, m: Omit<ChatMessage, 'id'>) => {
      const id = segmentsRef.current.get(key);
      if (id) setMessages((prev) => prev.map((x) => (x.id === id ? { ...x, text: m.text, partial: m.partial } : x)));
      else segmentsRef.current.set(key, addMessage(m));
    },
    [addMessage]
  );

  const setMeter = useCallback((ref: MutableRefObject<Meter | null>, next: Meter | null) => {
    ref.current?.cleanup().catch(() => undefined);
    ref.current = next;
  }, []);

  const stopMeters = useCallback(() => {
    if (meterTimerRef.current !== null) {
      window.clearInterval(meterTimerRef.current);
      meterTimerRef.current = null;
    }
    setMeter(agentMeterRef, null);
    setMeter(userMeterRef, null);
    setAudioLevel(0);
  }, [setMeter]);

  // Samples both meters while connected; state only changes when the level does, so silence costs no renders.
  const startMeters = useCallback(() => {
    if (meterTimerRef.current !== null) return;
    meterTimerRef.current = window.setInterval(() => {
      const agent = agentMeterRef.current?.calculateVolume() ?? 0;
      const user = userMeterRef.current?.calculateVolume() ?? 0;
      const next = Math.round(Math.min(1, Math.max(agent, user * USER_LEVEL_SHARE) * LEVEL_GAIN) * 100) / 100;
      setAudioLevel((prev) => (Math.abs(prev - next) < 0.02 ? prev : next));
    }, METER_INTERVAL_MS);
  }, []);

  const clearTimers = useCallback(() => {
    if (watchdogRef.current !== null) window.clearTimeout(watchdogRef.current);
    if (agentLeftRef.current !== null) window.clearTimeout(agentLeftRef.current);
    watchdogRef.current = null;
    agentLeftRef.current = null;
  }, []);

  const cleanup = useCallback(() => {
    clearTimers();
    stopMeters();
    if (streamUnsubRef.current) {
      streamUnsubRef.current();
      streamUnsubRef.current = null;
    }
    const room = roomRef.current;
    roomRef.current = null;
    agentIdentityRef.current = null;
    if (audioHostRef.current) {
      audioHostRef.current.replaceChildren();
    }
    if (room) {
      try {
        room.removeAllListeners();
        room.disconnect().catch(() => undefined);
      } catch {
        // ignore
      }
    }
    setAudioBlocked(false);
    setRoomToken(null);
    setMedia({ camera: false, screen: false });
  }, [clearTimers, stopMeters]);

  useEffect(() => {
    return () => {
      runRef.current += 1;
      cleanup();
    };
  }, [cleanup]);

  const resetFlags = useCallback(() => {
    setListening(false);
    setAgentSpeaking(false);
    setTyping(false);
  }, []);

  /** The conversation is over: tear it down and say why. `failed` shows the reason as an error with Try again. */
  const finish = useCallback(
    (reason: string, failed: boolean, traceDetail?: string) => {
      runRef.current += 1;
      cleanup();
      resetFlags();
      setStatus(failed ? 'error' : 'ended');
      setBubbleState(failed ? 'error' : 'ended');
      setError(failed ? reason : null);
      setEndReason(failed ? null : reason);
      if (!failed) addMessage({ from: 'system', text: reason });
      addTrace([{ kind: failed ? 'error' : 'end', label: reason, detail: traceDetail, status: failed ? 'error' : 'info' }]);
    },
    [cleanup, resetFlags, setStatus, addMessage, addTrace]
  );

  const stop = useCallback(() => {
    if (statusRef.current === 'idle' || statusRef.current === 'ended' || statusRef.current === 'error') return;
    finish('You ended the conversation.', false, 'Left the room');
  }, [finish]);

  /** The bubble's resting state while live: listening, or muted. Leaves other phases alone. */
  const restBubble = useCallback(() => {
    setBubbleState((prev) => (statusRef.current === 'live' ? (mutedRef.current ? 'muted' : 'listening') : prev));
  }, []);

  const primeAudio = useCallback(() => {
    // Browsers only let audio start from a click. Resuming a context here, inside the click, unlocks audio for the
    // page (the agent itself plays through audio elements; see webAudioMix below).
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') audioContextRef.current = new Ctor();
      audioContextRef.current.resume().catch(() => undefined);
    } catch {
      // No Web Audio: LiveKit plays through audio elements, and the Enable audio button covers a blocked start.
    }
  }, []);

  const enableAudio = useCallback(async () => {
    audioContextRef.current?.resume().catch(() => undefined);
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.startAudio();
    } catch (err) {
      addTrace([{ kind: 'session', label: 'Audio is still blocked', detail: errorText(err), status: 'error' }]);
    }
    setAudioBlocked(!room.canPlaybackAudio);
  }, [addTrace]);

  const enableMic = useCallback(
    async (room: Room, isCurrent: () => boolean, meterFor: (track: unknown) => Meter | null) => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setMicError(MIC_NEEDS_SECURE_CONTEXT);
        addTrace([{ kind: 'session', label: 'Microphone unavailable', detail: 'Page is not a secure context (HTTPS or localhost)', status: 'error' }]);
        return;
      }
      try {
        const mic = await room.localParticipant.setMicrophoneEnabled(true);
        if (!isCurrent()) return;
        setMicError(null);
        mutedRef.current = false;
        setIsMuted(false);
        // Reads the published track; a muted mic simply reads as silence.
        if (mic?.audioTrack) setMeter(userMeterRef, meterFor(mic.audioTrack));
        restBubble();
        // Which input the browser picked: a wrong default (e.g. a disconnected headset) shows up here.
        const device = mic?.audioTrack?.mediaStreamTrack?.label;
        addTrace([{ kind: 'session', label: 'Microphone on', detail: `Audio track published to the room${device ? ` · ${device}` : ''}`, status: 'ok' }]);
      } catch (err) {
        if (!isCurrent()) return;
        setMicError(micErrorMessage(err));
        addTrace([
          {
            kind: 'session',
            label: 'Microphone could not be turned on',
            detail: `${(err as { name?: string })?.name ?? 'Error'}: ${errorText(err)}`,
            status: 'error',
          },
        ]);
      }
    },
    [addTrace, setMeter, restBubble]
  );

  // Set by start(); lets retryMic reuse the current run's meter factory and staleness check.
  const micRetryRef = useRef<(() => Promise<void>) | null>(null);

  const retryMic = useCallback(async () => {
    await micRetryRef.current?.();
  }, []);

  const start = useCallback(
    async (type: ChannelType, channelId?: string, ref = 'draft') => {
      // A conversation is already being set up; a second click must not start another one.
      if (statusRef.current === 'connecting' || statusRef.current === 'waiting') return;
      primeAudio();
      cleanup();
      const run = (runRef.current += 1);
      const isCurrent = () => run === runRef.current;
      startRef.current = Date.now();
      setStartedAt(startRef.current);
      setRoom(null);
      micRetryRef.current = null;
      mutedRef.current = false;
      setChannel(type);
      setMessages([]);
      segmentsRef.current.clear();
      setTrace([]);
      setRecords([]);
      setInfo(null);
      setError(null);
      setEndReason(null);
      setMicError(null);
      setLatestCaption('');
      setIsMuted(false);
      resetFlags();
      setStatus('connecting');
      setBubbleState('connecting');

      const fail = (message: string, detail: string, label: string, liveKit = false) => {
        if (!isCurrent()) return;
        if (liveKit) reportLiveKitStatus({ state: 'failed', at: Date.now(), message });
        // The step that failed, with the technical detail; finish() then adds the plain-words message.
        addTrace([{ kind: 'session', label, detail, status: 'error' }]);
        finish(message, true);
      };

      if (type === 'web_voice' && (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)) {
        fail(MIC_NEEDS_SECURE_CONTEXT, `isSecureContext=${window.isSecureContext}; mediaDevices=${Boolean(navigator.mediaDevices)}`, 'Voice needs a secure page');
        return;
      }

      // 1. Ask the API for a LiveKit join token (the token also asks LiveKit to send the agent).
      let session: Session;
      try {
        // No id: the server picks the bot's web channel itself.
        session = await api.startSession(activeAgentRef.current, channelId ? { ref, channel: channelId } : { ref });
      } catch (err) {
        const { message, detail } = sessionStartError(err, ref);
        fail(message, detail, 'Session could not be created', (err as { kind?: string })?.kind === 'unavailable');
        return;
      }
      if (!isCurrent()) return;
      setInfo({ ref: session.ref || ref, version: session.version || ref, channel: session.channel ?? null });
      addTrace([{ kind: 'session', label: 'Session created', detail: `Room ${session.room} · token valid ${session.expires_in_s}s`, status: 'ok' }]);

      // 2. The call's records feed the live trace. The runtime writes them once it has joined, so follow from then
      //    (the stream replays the call from its first record).
      let streamClosed = false;
      const followTrace = () => {
        if (streamUnsubRef.current) return;
        streamUnsubRef.current = followCall(activeAgentRef.current, session.room, {
          onRecord: (record) => {
            if (!isCurrent()) return;
            setRecords((prev) => [...prev, record]);
            const item = traceFromRecord(record);
            if (item) addTrace([{ ...item, raw: record }]);
          },
          onEnd: () => {
            if (isCurrent()) addTrace([{ kind: 'session', label: 'Live trace complete', status: 'info' }]);
          },
          onError: () => {
            if (!isCurrent() || streamClosed) return;
            streamClosed = true;
            addTrace([{ kind: 'session', label: 'Live trace stream closed', detail: 'The conversation itself is not affected', status: 'info' }]);
          },
        });
      };

      // 3. Build the room.
      let lk: typeof import('livekit-client');
      try {
        lk = await import('livekit-client');
      } catch (err) {
        fail('The voice and chat library could not load. Reload the page and try again.', errorText(err), 'livekit-client failed to load');
        return;
      }
      if (!isCurrent()) return;
      const { Room: LiveKitRoom, RoomEvent, Track, ParticipantKind, ConnectionState, createAudioAnalyser } = lk;

      // A meter that fails to start (no Web Audio) leaves the orb idle; the call itself is unaffected.
      const meterFor = (track: unknown): Meter | null => {
        try {
          return { track, ...createAudioAnalyser(track as Parameters<typeof createAudioAnalyser>[0], METER_OPTIONS) };
        } catch {
          return null;
        }
      };

      const room = new LiveKitRoom({
        audioCaptureDefaults: { autoGainControl: true, echoCancellation: true, noiseSuppression: true },
        // The agent plays through ordinary audio elements, not a Web Audio mix: Chrome's echo cancellation only
        // covers element playback. Through a Web Audio mix, laptop speakers leak the agent's voice into the built-in
        // microphone, the runtime hears itself and the caller is cut off (it only worked with earphones). The Start
        // click gives the page user activation, so the greeting still plays; a blocked start shows Enable audio.
        webAudioMix: false,
      });
      roomRef.current = room;
      const isAgent = (p: Participant) => isAgentParticipant(p, ParticipantKind.AGENT);

      const agentJoined = (p: Participant) => {
        if (!isCurrent() || agentIdentityRef.current) return;
        agentIdentityRef.current = p.identity;
        if (watchdogRef.current !== null) window.clearTimeout(watchdogRef.current);
        watchdogRef.current = null;
        setStatus('live');
        setBubbleState(type === 'web_voice' && mutedRef.current ? 'muted' : 'listening');
        setListening(type === 'web_voice');
        addTrace([{ kind: 'agent', label: `${p.identity} joined`, detail: 'The runtime worker joined the room', status: 'ok' }]);
        followTrace();
      };

      // Agent replies (and, in voice, the caller's own words) arrive as text streams.
      // Both sides print live, like a chat: the agent's words arrive in pieces as it speaks; the caller's words are
      // re-sent as the transcription firms up (lk.transcription_final). One segment (lk.segment_id) = one bubble.
      room.registerTextStreamHandler(TOPIC_TRANSCRIPTION, async (reader: TextStreamReader, participant: { identity: string }) => {
        const isLocal = participant?.identity === room.localParticipant.identity;
        const attributes = reader.info?.attributes ?? {};
        const key = `${isLocal ? 'user' : 'agent'}:${attributes['lk.segment_id'] ?? reader.info?.id}`;
        const from = isLocal ? 'user' : 'agent';
        const via = type === 'web_voice' ? 'voice' : undefined;
        let fullText = '';
        try {
          for await (const chunk of reader) {
            if (!isCurrent()) return;
            fullText += chunk;
            if (!fullText.trim()) continue;
            if (!isLocal) {
              setTyping(false);
              setLatestCaption(fullText);
            }
            upsertSegment(key, { from, text: fullText.trim(), via, partial: true });
          }
        } catch (err) {
          if (isCurrent()) addTrace([{ kind: 'session', label: 'A transcript stream broke off', detail: errorText(err), status: 'error' }]);
        }
        if (!isCurrent() || !fullText.trim()) return;
        upsertSegment(key, { from, text: fullText.trim(), via, partial: isLocal && attributes['lk.transcription_final'] === 'false' });
      });

      room.registerTextStreamHandler(TOPIC_FORM, async (reader: TextStreamReader) => {
        let jsonText = '';
        try {
          for await (const chunk of reader) jsonText += chunk;
          const formPacket = JSON.parse(jsonText);
          if (isCurrent() && formPacket.type === 'form') {
            addMessage({ from: 'agent', text: formPacket.title || 'Please fill in this form', form: formPacket, formStatus: 'open' });
            addTrace([{ kind: 'form', label: `Form: ${formPacket.title || 'details'}`, status: 'info' }]);
          }
        } catch (err) {
          if (isCurrent()) addTrace([{ kind: 'form', label: 'A form could not be read', detail: errorText(err), status: 'error' }]);
        }
      });

      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio && audioHostRef.current) {
          const element = track.attach();
          audioHostRef.current.appendChild(element);
          // Meter the agent from its own track. Chrome only feeds a remote track to Web Audio while it is
          // attached to an element, which the line above does.
          setMeter(agentMeterRef, meterFor(track));
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach().forEach((el) => el.remove());
        if (agentMeterRef.current?.track === track) setMeter(agentMeterRef, null);
      });

      room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
        if (!isCurrent()) return;
        const blocked = !room.canPlaybackAudio;
        setAudioBlocked(blocked);
        if (blocked) addTrace([{ kind: 'session', label: 'Browser blocked audio', detail: 'Waiting for a click on Enable audio', status: 'info' }]);
      });

      // Who is talking (the level itself comes from the meters).
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        if (!isCurrent() || statusRef.current !== 'live') return;
        const agentSpeaker = speakers.some((s) => s.identity !== room.localParticipant.identity);
        setAgentSpeaking(agentSpeaker);
        if (agentSpeaker) setBubbleState('speaking');
        else restBubble();
      });

      room.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
        if (!isCurrent()) return;
        if (isAgent(p)) agentJoined(p);
        else addTrace([{ kind: 'session', label: `${p.identity} joined`, detail: 'Another participant (not an agent)', status: 'info' }]);
      });

      room.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
        if (!isCurrent()) return;
        addTrace([{ kind: 'agent', label: `${p.identity} left`, status: 'info' }]);
        if (p.identity !== agentIdentityRef.current) return;
        agentLeftRef.current = window.setTimeout(() => {
          if (isCurrent()) finish('The agent left the conversation.', false, `${p.identity} left the room`);
        }, AGENT_LEFT_GRACE_MS);
      });

      room.on(RoomEvent.ConnectionStateChanged, (state: string) => {
        if (!isCurrent()) return;
        if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting) {
          setBubbleState('reconnecting');
          addTrace([{ kind: 'session', label: 'Connection dropped, reconnecting…', detail: state, status: 'info' }]);
        } else if (state === ConnectionState.Connected && statusRef.current !== 'connecting') {
          setBubbleState((prev) => (prev === 'reconnecting' ? (statusRef.current === 'live' ? (mutedRef.current ? 'muted' : 'listening') : 'waiting') : prev));
        }
      });

      room.on(RoomEvent.Reconnected, () => {
        if (isCurrent()) addTrace([{ kind: 'session', label: 'Reconnected', status: 'ok' }]);
      });

      room.on(RoomEvent.MediaDevicesError, (err: Error) => {
        if (!isCurrent()) return;
        setMicError(micErrorMessage(err));
        addTrace([{ kind: 'session', label: 'Microphone or speaker problem', detail: `${err.name}: ${err.message}`, status: 'error' }]);
      });

      room.on(RoomEvent.Disconnected, (reason?: number) => {
        if (!isCurrent()) return;
        const { name, text, error: failed } = disconnectReasonText(reason);
        finish(text, failed, `LiveKit: ${name}`);
      });

      // 4. Join the room.
      try {
        await room.connect(session.livekit_url, session.token);
      } catch (err) {
        if (!isCurrent()) return;
        const { message, detail } = roomConnectError(err);
        fail(message, detail, 'Could not join the LiveKit room', true);
        return;
      }
      if (!isCurrent()) {
        room.disconnect().catch(() => undefined);
        return;
      }
      reportLiveKitStatus({ state: 'ok', at: Date.now(), connectMs: Date.now() - startRef.current });
      setRoom(session.room);
      setRoomToken(session.token);
      addTrace([{ kind: 'session', label: 'Joined the room', detail: `as ${room.localParticipant.identity}`, status: 'ok' }]);
      startMeters();

      // The agent may already be in the room; otherwise wait for it, but not forever.
      room.remoteParticipants.forEach((p) => {
        if (isAgent(p)) agentJoined(p);
      });
      if (!agentIdentityRef.current) {
        setStatus('waiting');
        setBubbleState('waiting');
        watchdogRef.current = window.setTimeout(() => {
          if (!isCurrent() || agentIdentityRef.current) return;
          fail(AGENT_DID_NOT_JOIN, `No agent participant joined ${session.room} within ${AGENT_JOIN_TIMEOUT_MS / 1000}s`, 'Agent did not join', true);
        }, AGENT_JOIN_TIMEOUT_MS);
      }

      room.startAudio().catch(() => undefined).finally(() => {
        if (isCurrent()) setAudioBlocked(!room.canPlaybackAudio);
      });

      // 5. Voice: turn the microphone on.
      if (type === 'web_voice') {
        micRetryRef.current = () => (isCurrent() && roomRef.current === room ? enableMic(room, isCurrent, meterFor) : Promise.resolve());
        await enableMic(room, isCurrent, meterFor);
      }
    },
    [cleanup, primeAudio, resetFlags, setStatus, finish, addTrace, addMessage, upsertSegment, setMeter, startMeters, restBubble, enableMic]
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      const room = roomRef.current;
      if (!trimmed || !room || statusRef.current !== 'live') return;

      // Typed, even during a voice call (the agent takes text in either channel).
      addMessage({ from: 'user', text: trimmed, via: channel === 'web_voice' ? 'text' : undefined });
      setTyping(true);
      setBubbleState('thinking');

      try {
        await room.localParticipant.sendText(trimmed, { topic: TOPIC_CHAT });
      } catch (err) {
        setTyping(false);
        restBubble();
        addMessage({ from: 'system', text: 'Your message was not sent. Check the connection and send it again.' });
        addTrace([{ kind: 'session', label: 'Message not sent', detail: errorText(err), status: 'error' }]);
      }
    },
    [channel, addMessage, addTrace, restBubble]
  );

  const toggleMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !mutedRef.current;
    try {
      await room.localParticipant.setMicrophoneEnabled(!next);
      mutedRef.current = next;
      setIsMuted(next);
      if (!next) setMicError(null);
      restBubble();
    } catch (err) {
      setMicError(micErrorMessage(err));
      addTrace([{ kind: 'session', label: next ? 'Could not mute' : 'Could not unmute', detail: errorText(err), status: 'error' }]);
    }
  }, [addTrace, restBubble]);

  const toggleMedia = useCallback(
    async (what: 'camera' | 'screen') => {
      const room = roomRef.current;
      if (!room) return;
      const next = !media[what];
      const name = what === 'camera' ? 'camera' : 'screen sharing';
      try {
        if (what === 'camera') await room.localParticipant.setCameraEnabled(next);
        else await room.localParticipant.setScreenShareEnabled(next);
        setMedia((m) => ({ ...m, [what]: next }));
        addTrace([{ kind: 'session', label: `${what === 'camera' ? 'Camera' : 'Screen sharing'} ${next ? 'on' : 'off'}`, status: 'ok' }]);
      } catch (err) {
        addMessage({ from: 'system', text: `The ${name} could not be turned ${next ? 'on' : 'off'}: ${errorText(err)}` });
        addTrace([{ kind: 'session', label: `The ${name} could not be turned ${next ? 'on' : 'off'}`, detail: errorText(err), status: 'error' }]);
      }
    },
    [media, addMessage, addTrace]
  );

  const attachCamera = useCallback((video: HTMLVideoElement | null) => {
    const room = roomRef.current;
    if (!room || !video) return;
    room.localParticipant.getTrackPublications().forEach((pub) => {
      if (pub.track && pub.kind === 'video' && pub.source === 'camera') pub.track.attach(video);
    });
  }, []);

  const sendImage = useCallback(
    async (file: File, topic: string): Promise<boolean> => {
      const room = roomRef.current;
      if (!room || statusRef.current !== 'live') return false;
      try {
        await room.localParticipant.sendFile(file, { topic });
        addMessage({ from: 'user', text: `Sent a picture: ${file.name}` });
        addTrace([{ kind: 'session', label: 'Picture sent', detail: `${file.name} on ${topic}`, status: 'ok' }]);
        return true;
      } catch (err) {
        addMessage({ from: 'system', text: `The picture was not delivered: ${errorText(err)}` });
        addTrace([{ kind: 'session', label: 'Picture not sent', detail: errorText(err), status: 'error' }]);
        return false;
      }
    },
    [addMessage, addTrace]
  );

  const submitForm = useCallback(
    (messageId: string, form: FormRequest, values: Record<string, string>): Record<string, string> => {
      const errors: Record<string, string> = {};
      form.fields.forEach((f) => {
        const v = (values[f.name] ?? '').trim();
        if (f.required && !v) errors[f.name] = `Enter your ${f.label.toLowerCase()}.`;
      });

      if (Object.keys(errors).length > 0) return errors;

      if (roomRef.current) {
        const payload = JSON.stringify({ request_id: form.request_id || messageId, values });
        roomRef.current.localParticipant.sendText(payload, { topic: TOPIC_FORM_SUBMIT }).catch((err: unknown) => {
          addMessage({ from: 'system', text: `The details for ${form.title} were not sent. Try again.` });
          addTrace([{ kind: 'form', label: 'Form answers not sent', detail: errorText(err), status: 'error' }]);
        });
      }

      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, formStatus: 'accepted' as const, formValues: values } : m))
      );
      addMessage({ from: 'system', text: `Sent details for ${form.title}.` });
      return {};
    },
    [addMessage, addTrace]
  );

  return {
    status,
    bubbleState,
    channel,
    messages,
    trace,
    typing,
    listening,
    agentSpeaking,
    audioLevel,
    latestCaption,
    isMuted,
    error,
    endReason,
    room,
    roomToken,
    startedAt,
    info,
    records,
    media,
    toggleMedia,
    sendImage,
    attachCamera,
    audioBlocked,
    micError,
    primeAudio,
    enableAudio,
    retryMic,
    start,
    stop,
    send,
    toggleMute,
    submitForm,
  };
}
