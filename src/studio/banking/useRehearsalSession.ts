import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gateway, GatewayError } from '../../api/gateway.ts';
import type { Rehearsal } from '../../api/gatewayTypes.ts';
import { useBankingChannel, type BankingChannel } from './useBankingChannel.ts';
import { useBankingAssistant, type BankingAssistant, type EndReason } from './useBankingAssistant.ts';
import { useBrowserVoice, type BrowserVoice, type VoiceHint } from './useBrowserVoice.ts';
import { useGatewayRecords } from './useGatewayRecords.ts';
import { mergeRecords } from './gatewayRecords.ts';
import type { RunEvent } from './scenarios.ts';

// A banking REHEARSAL: Weave Studio's banking assistant, by web chat or web voice, on the gateway's mock bank. No
// language model and no agent runtime: a rule-based assistant (assistantModel.ts) plays the agent and calls the
// gateway's tools the way the runtime would; the gateway's own state machine, secure keypad, confirmations and audit
// decide every outcome. Voice is the browser's own speech service (useBrowserVoice.ts).
//
// It lives with the workspace, not the Test tab, so moving between pages does not hang up, and it has the fields the
// workspace reads from every test session (status, info, records, startFor, stop). RehearsalConsole.tsx draws it.
// Needs a mock gateway and BANKING_GATEWAY_REHEARSALS=on for the studio server (the proxy refuses it otherwise).

type Status = 'idle' | 'starting' | 'live' | 'ended' | 'error';
export type ConversationMode = 'chat' | 'voice';

interface LogEntry {
  id: string;
  at: number;
  text: string;
  kind: 'info' | 'warn' | 'error';
}

export interface RehearsalInfo {
  room: string;
  ref: 'draft';
  version: 'draft';
  channel: { id: string; type: 'web_chat' | 'web_voice' };
  channels: [];
  rehearsal: true;
  hosts: Rehearsal['hosts'];
}

export interface FinishedRehearsal {
  info: RehearsalInfo;
  messages: Array<{ role: 'user' | 'assistant'; text: string }>;
  startedAt: number;
  endedAt: number;
  reason: string;
}

const noop = () => undefined;

/** What went wrong starting a rehearsal, in words a person can act on. */
export function describeRehearsalError(error: unknown): string {
  const kind = error instanceof GatewayError ? error.kind : null;
  if (kind === 'not_configured')
    return 'No banking gateway is set up for this studio. Set BANKING_GATEWAY_URL and BANKING_GATEWAY_TOKEN for the studio server, then restart it.';
  if (kind === 'refused' || kind === 'not_found')
    return 'Rehearsals are off. They need the mock banking gateway (npm run gateway:mock) and BANKING_GATEWAY_REHEARSALS=on for the studio server.';
  if (kind === 'unreachable') return 'The banking gateway is not reachable. Start it and try again.';
  return error instanceof Error ? error.message : 'The conversation could not start.';
}

const logLine = (event: RunEvent): Omit<LogEntry, 'id' | 'at'> | null => {
  switch (event.type) {
    case 'tool':
      return { text: `${event.tool}: ${event.ok ? 'ok' : (event.code ?? 'refused')}`, kind: event.ok ? 'info' : 'warn' };
    case 'auth':
      return {
        text: `Sign-in: ${event.state.replace(/_/g, ' ')}${event.reason ? ` (${event.reason.replace(/_/g, ' ')})` : ''}`,
        kind: event.state === 'locked' ? 'warn' : 'info',
      };
    case 'capture':
      return { text: `Secure entry (${event.purpose}, ${event.via}) ${event.accepted ? 'accepted' : 'not accepted'}`, kind: event.accepted ? 'info' : 'warn' };
    case 'confirmation':
      return { text: `Bank request ${event.outcome}`, kind: event.outcome === 'confirmed' || event.outcome === 'cancelled' ? 'info' : 'warn' };
    case 'gateway_unreachable':
      return { text: 'The banking gateway did not answer', kind: 'error' };
    default:
      return null;
  }
};

export interface RehearsalControls {
  /** The gateway session, while there is one (kept after it ends, so its conversation stays on screen). */
  call: Rehearsal | null;
  live: boolean;
  starting: boolean;
  startError: string | null;
  channel: BankingChannel;
  /** The channel as the banking panel uses it: its keypad reports the outcome to the assistant (for the scenarios). */
  panelChannel: BankingChannel;
  assistant: BankingAssistant;
  voice: BrowserVoice;
  mode: ConversationMode;
  setMode: (mode: ConversationMode) => void;
  /** What the gateway did, across this page's sessions, for the scenario checks ("Reset results" clears it). */
  runEvents: RunEvent[];
  resetRunEvents: () => void;
  begin: () => Promise<void>;
  end: () => void;
  newConversation: () => Promise<void>;
  /** Why the assistant ended the last conversation itself (goodbye, or handed to a Service Manager), if it did. */
  endedBy: EndReason | null;
  /** The bank it speaks for (Build → Banking → Banking name). */
  bankName: string;
}

/** What the session takes from the agent's draft: the bank's name and the agent's voice (Build → Banking). */
export interface RehearsalProfile {
  bankName: string;
  voice: VoiceHint | null;
}

export function useRehearsalSession({
  onFinished,
  profile = { bankName: '', voice: null },
}: { onFinished?: (finished: FinishedRehearsal) => void; profile?: RehearsalProfile } = {}) {
  const [call, setCall] = useState<Rehearsal | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [mode, setModeState] = useState<ConversationMode>('chat');
  const [runEvents, setRunEvents] = useState<RunEvent[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [endedBy, setEndedBy] = useState<EndReason | null>(null);
  const attemptRef = useRef(0);
  const counterRef = useRef(0);
  const callRef = useRef<Rehearsal | null>(null);
  callRef.current = call;
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const live = status === 'live' && Boolean(call);
  const channel = useBankingChannel(live ? (call?.channel_token ?? null) : null);

  // Voice and assistant refer to each other: what is heard goes to the assistant; what it says is spoken, one reply
  // after another.
  const assistantRef = useRef<BankingAssistant | null>(null);
  const voice = useBrowserVoice((text) => assistantRef.current?.handle(text, 'voice'), 'en-SG', profile.voice);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const speech = useRef<Promise<void>>(Promise.resolve());
  const onSay = useCallback((text: string) => {
    const v = voiceRef.current;
    if (v.isActive() && v.canSpeak) speech.current = speech.current.then(() => v.speak(text));
  }, []);
  const onEvent = useCallback((event: RunEvent) => {
    setRunEvents((prev) => [...prev, event]);
    const line = logLine(event);
    if (line) {
      counterRef.current += 1;
      const id = `rh-${counterRef.current}`;
      setLog((old) => [...old.slice(-199), { id, at: Date.now(), ...line }]);
    }
  }, []);
  // The assistant ended the conversation (goodbye, or handed to a Service Manager): once its last reply has been said,
  // the conversation closes and says why, so nothing more is answered or run in it.
  const finishByAssistantRef = useRef<(reason: EndReason) => void>(noop);
  const onEnd = useCallback((reason: EndReason) => finishByAssistantRef.current(reason), []);
  const assistant = useBankingAssistant({
    callId: call?.call_id ?? null,
    channel,
    voiceActive: voice.active,
    onSay,
    onEvent,
    bankName: profile.bankName,
    onEnd,
  });
  assistantRef.current = assistant;

  const { setProcessing } = voice;
  useEffect(() => setProcessing(assistant.thinking), [assistant.thinking, setProcessing]);

  const panelChannel = useMemo(() => ({ ...channel, submitCapture: assistant.submitFromKeypad }), [channel, assistant.submitFromKeypad]);

  // The assistant speaks first, once the caller's secure channel is open.
  const greetedRef = useRef<string | null>(null);
  const { greet } = assistant;
  useEffect(() => {
    if (!live || !call || channel.connection !== 'open' || greetedRef.current === call.call_id) return;
    greetedRef.current = call.call_id;
    void greet();
  }, [live, call, channel.connection, greet]);

  const gatewayRecords = useGatewayRecords(call?.room, startedAt, live);

  const info: RehearsalInfo | null = useMemo(
    () =>
      call
        ? {
            room: call.room,
            ref: 'draft',
            version: 'draft',
            channel: { id: 'rehearsal', type: call.channel },
            channels: [],
            rehearsal: true,
            hosts: call.hosts,
          }
        : null,
    [call],
  );

  // What was said, as the records a call has, beside what the gateway did (the Trace tab).
  const records = useMemo(() => {
    if (!startedAt) return [];
    const said = assistant.messages.map((m, i) => ({
      t: new Date(m.at).toISOString(),
      seq: i + 1,
      elapsed_s: Math.max(0, m.at - startedAt) / 1000,
      event: m.role === 'customer' ? 'user_said' : 'agent_said',
      text: m.text,
    }));
    return mergeRecords<Record<string, unknown>>(said, gatewayRecords);
  }, [assistant.messages, gatewayRecords, startedAt]);

  // Reported once per conversation, however it ends.
  const finishRef = useRef<(reason: string) => void>(noop);
  finishRef.current = (reason) => {
    if (!info || !startedAt || !live) return;
    const spoken = assistant.messages.filter((m) => m.text && !m.secure);
    if (!spoken.length) return;
    onFinishedRef.current?.({
      info,
      messages: spoken.map((m) => ({ role: m.role === 'customer' ? 'user' : 'assistant', text: m.text })),
      startedAt,
      endedAt: Date.now(),
      reason,
    });
  };

  /** Ends the gateway's session for the conversation in progress (the gateway forgets it on expiry anyway). */
  const close = useCallback((reason: string) => {
    attemptRef.current += 1;
    finishRef.current(reason);
    voiceRef.current.stop();
    speech.current = Promise.resolve();
    const current = callRef.current;
    if (current) void gateway.rehearsal.end(current.call_id).catch(noop);
  }, []);

  finishByAssistantRef.current = (reason) => {
    const ending = callRef.current;
    void speech.current.then(() => {
      if (callRef.current !== ending) return; // another conversation started meanwhile
      close(reason);
      setEndedBy(reason);
      setStatus('ended');
    });
  };

  // Leaving the page ends the conversation.
  useEffect(() => () => close('closed'), [close]);

  const begin = useCallback(async () => {
    if (status === 'starting') return;
    if (status === 'live') close('restarted');
    attemptRef.current += 1;
    const attempt = attemptRef.current;
    const withVoice = mode === 'voice';
    setStartError(null);
    setEndedBy(null);
    setStatus('starting');
    try {
      // Ask for the microphone first, from the click, so the greeting can be spoken.
      if (withVoice) await voiceRef.current.start();
      const started = await gateway.rehearsal.start(withVoice ? 'web_voice' : 'web_chat');
      if (attempt !== attemptRef.current) {
        void gateway.rehearsal.end(started.call_id).catch(noop);
        return;
      }
      setCall(started);
      setStartedAt(Date.now());
      setStatus('live');
    } catch (error) {
      if (attempt !== attemptRef.current) return;
      voiceRef.current.stop();
      setStartError(describeRehearsalError(error));
      setStatus('error');
    }
  }, [status, mode, close]);

  const end = useCallback(() => {
    if (status === 'starting') {
      // the start in flight ends its own session when it arrives
      attemptRef.current += 1;
      voiceRef.current.stop();
      setStatus('idle');
      return;
    }
    if (status !== 'live') return;
    close('user');
    setStatus('ended');
  }, [status, close]);

  const newConversation = useCallback(async () => {
    if (voiceRef.current.isActive()) setModeState('voice');
    await begin();
  }, [begin]);

  // Chat and voice share one session: switching only turns the microphone on or off.
  const setMode = useCallback(
    (next: ConversationMode) => {
      setModeState(next);
      if (next === 'chat') voiceRef.current.stop();
      else if (live && !voiceRef.current.isActive()) void voiceRef.current.start();
    },
    [live],
  );

  const controls: RehearsalControls = {
    call,
    live,
    starting: status === 'starting',
    startError,
    channel,
    panelChannel,
    assistant,
    voice,
    mode,
    setMode,
    runEvents,
    resetRunEvents: () => setRunEvents([]),
    begin,
    end,
    newConversation,
    endedBy,
    bankName: profile.bankName,
  };

  return {
    status,
    info,
    // the conversation itself is drawn by RehearsalConsole from the assistant; these are for the workspace
    messages: [],
    events: log,
    records,
    error: null,
    form: null,
    media: { mic: voice.active, camera: false, screen: false },
    agentHint: false,
    reconnecting: false,
    simulated: false,
    localTrace: true,
    startedAt,
    rehearsal: controls,
    audioHostRef: { current: null },
    localVideoRef: { current: null },
    startFor: begin,
    stop: end,
    attachPreview: noop,
    sendText: async (text: string) => assistant.handle(text, 'chat'),
    sendImage: noop,
    toggle: noop,
    submitForm: noop,
    dismissForm: noop,
    clearError: () => setStartError(null),
  };
}

export type RehearsalSession = ReturnType<typeof useRehearsalSession>;
