// A banking agent's test conversation played in this browser (Sandbox's, and Live's banking rehearsal), in the shape
// of useTestSession (TestSession), so the Test page and the test panel beside other pages show it as they show any
// conversation. One test session on the mock bank per conversation (gateway.rehearsal.start, rehearsalSource), ended
// when the conversation ends. The agent's turns are played by the
// rule-based banking engine (useBankingAssistant), which runs the gateway's tools; the customer's device (sign-in,
// keypad, accounts, confirmations, SMS) sits beside the transcript. On a web voice channel the browser's speech
// service speaks the agent's replies and listens to the caller, with typed input as the fallback; secrets are keyed,
// never spoken. What happened is written as a real call's records, and the ended conversation is handed to onFinished
// (Sandbox keeps it as a call; Live's Calls page lists real calls only, so a rehearsal is not added there).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bankingSourceLabel, gateway, GatewayError, rehearsalSource } from '../../api/gateway';
import type { Rehearsal } from '../../api/gatewayTypes';
import type { AgentConfig, ChannelType } from '../../types/studio';
import type { ChatMessage, TraceEvent } from '../../types/testConsole';
import type { SessionInfo, SessionStatus, TestSession } from '../../hooks/useTestSession';
import { useBankingChannel } from '../../hooks/useBankingChannel';
import { useBrowserVoice } from '../../hooks/useBrowserVoice';
import { traceFromRecord } from '../../utils/testSession';
import { closingRecords, makeRecord, tabOf, type CallLogRecord, type FinishedConversation } from '../test/simulatedConversation';
import { useBankingAssistant, type BankingAssistant, type BankingLine, type ToolRun } from './useBankingAssistant';
import { bankingChannelLabel, bankingWords, bubbleStateOf, messageId, noSpeechNote, toChatMessages, VOICE_TITLE, VOICE_WORDING } from './bankingConversation';
import { CustomerDevice, ReplyExtras, SecureEntryNote } from './BankingParts';

const SMS_POLL_MS = 3_000;
const SUGGESTIONS = ["What's my balance?", 'Show my recent transactions', 'Did my cheque clear?', 'USD exchange rate', 'Book an appointment', 'Speak to a person'];
const SECURE_LABEL: Record<string, string> = { pin: 'Phone PIN', nric: 'NRIC digits', otp: 'one-time password', current_pin: 'current Phone PIN', new_pin: 'new Phone PIN', confirm_new_pin: 'new Phone PIN again' };

export interface BankingConversationOptions {
  agentId: string;
  agentName: string;
  getConfig: (ref: string) => Promise<{ config: AgentConfig; version: string }>;
  /** Called once when a conversation in which something was said ends (by the person, or by leaving the page). */
  onFinished?: (done: FinishedConversation) => void;
  /** The draft is a banking one: where banking answers come from is asked for now, not only when a conversation starts. */
  wanted?: boolean;
  /** Which data source the studio runs on: in Live this is a rehearsal on the mock bank, and its words say so. */
  studio?: 'live' | 'sandbox';
}

const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

export function useBankingConversation({ agentId, agentName, getConfig, onFinished, wanted = false, studio = 'sandbox' }: BankingConversationOptions): TestSession {
  const [status, setStatusState] = useState<SessionStatus>('idle');
  const [channelType, setChannelType] = useState<ChannelType>('web_chat');
  const [rehearsal, setRehearsal] = useState<Rehearsal | null>(null);
  // An ended conversation keeps its transcript; only its device is disconnected.
  const [closed, setClosed] = useState(false);
  const rehearsalRef = useRef(rehearsal);
  rehearsalRef.current = rehearsal;
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [endReason, setEndReason] = useState<string | null>(null);
  const [records, setRecords] = useState<CallLogRecord[]>([]);
  const [trace, setTrace] = useState<TraceEvent[]>([]);
  const [sms, setSms] = useState<string[]>([]);
  const [source, setSource] = useState('the banking gateway');

  const statusRef = useRef<SessionStatus>('idle');
  const startedRef = useRef<number | null>(null);
  const recordsRef = useRef<CallLogRecord[]>([]);
  const linesRef = useRef<BankingLine[]>([]);
  const toolsRef = useRef<ToolRun[]>([]);
  const recordedRef = useRef(true);
  const attemptRef = useRef(0);
  const playingRef = useRef<{ ref: string; version: string; type: ChannelType; channelId: string } | null>(null);
  const openingNoteRef = useRef<string | null>(null);
  const aliveRef = useRef(true);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;
  const getConfigRef = useRef(getConfig);
  getConfigRef.current = getConfig;
  const nameRef = useRef(agentName);
  nameRef.current = agentName;

  const setStatus = useCallback((next: SessionStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  // Where banking answers come from on this page, in words (asked once, when there is banking to talk about).
  const needSource = wanted || status !== 'idle';
  useEffect(() => {
    if (!needSource) return;
    rehearsalSource()
      .then((s) => aliveRef.current && setSource(bankingSourceLabel(s)))
      .catch(() => undefined);
  }, [needSource]);

  const addRecord = useCallback((event: string, fields: Record<string, unknown> = {}) => {
    if (!aliveRef.current) return;
    const now = Date.now();
    const started = startedRef.current ?? now;
    const record = makeRecord(recordsRef.current.length + 1, started, now, event, fields);
    recordsRef.current = [...recordsRef.current, record];
    setRecords(recordsRef.current);
    const item = traceFromRecord(record);
    if (item) setTrace((prev) => [...prev, { ...item, raw: record, id: `b${record.seq}`, at_ms: now - started }]);
  }, []);

  // ---- the customer's device, the engine and the voice ----

  const channel = useBankingChannel(rehearsal && !closed ? rehearsal.channel_token : null);
  const assistantRef = useRef<BankingAssistant | null>(null);
  const voice = useBrowserVoice((text) => assistantRef.current?.handle(text, 'voice'));
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const speech = useRef<Promise<void>>(Promise.resolve());

  const onLine = useCallback(
    (line: BankingLine) => {
      linesRef.current = [...linesRef.current, line];
      if (line.role === 'customer') addRecord('user_said', { text: line.text, ...(line.via ? { via: line.via } : {}) });
      if (line.role !== 'assistant') return;
      addRecord('agent_said', { text: line.text, interrupted: false, simulated: true });
      const v = voiceRef.current;
      if (v.isActive() && v.canSpeak) speech.current = speech.current.then(() => v.speak(line.text));
    },
    [addRecord]
  );
  const onTool = useCallback(
    (run: ToolRun) => {
      toolsRef.current = [...toolsRef.current, run];
      addRecord('tool_called', {
        tool: run.tool,
        args: run.args,
        ...(run.response ? { output: run.response } : {}),
        ...(run.error ? { error: run.error } : run.response && !run.response.ok ? { error: run.response.error_code ?? 'refused' } : {}),
        simulated: true,
      });
    },
    [addRecord]
  );
  const assistant = useBankingAssistant({ callId: rehearsal?.call_id ?? null, channel, onLine, onTool, agentName });
  assistantRef.current = assistant;
  const { setProcessing } = voice;
  useEffect(() => setProcessing(assistant.thinking), [assistant.thinking, setProcessing]);

  // ---- the conversation's life ----

  /** The log's end, and the conversation handed on to be kept: once, and only when something was said. */
  const finish = useCallback(
    (reason: 'user' | 'agent' | 'closed') => {
      const started = startedRef.current;
      if (recordedRef.current || !started) return;
      recordedRef.current = true;
      const lines = linesRef.current.map((l) => ({ from: l.role === 'assistant' ? ('agent' as const) : l.role === 'customer' ? ('user' as const) : ('system' as const), text: l.text }));
      const now = Date.now();
      const state = { verified: channel.state?.auth.authenticated === true };
      closingRecords(reason, { startedAt: started, now, lines, handoffs: 0, state }).forEach(([event, fields]) => addRecord(event, fields));
      if (!lines.some((m) => m.from !== 'system' && m.text)) return;
      const playing = playingRef.current;
      const type = playing?.type ?? 'web_chat';
      finishedRef.current?.({
        agentId,
        agentName: nameRef.current,
        ref: playing?.ref ?? 'draft',
        version: playing?.version ?? 'draft',
        channel: { id: playing?.channelId ?? type, type, input: type === 'web_voice' ? ['audio', 'text'] : ['text'], output: type === 'web_voice' ? ['audio', 'text'] : ['text'] },
        channelLabel: bankingChannelLabel(type, studio),
        lines,
        tools: toolsRef.current.map((t) => ({ tool: t.tool, args: t.args })),
        state,
        agent: nameRef.current,
        startedAt: started,
        endedAt: now,
      });
    },
    [addRecord, agentId, channel.state?.auth.authenticated, studio]
  );
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // Leaving the page ends the conversation, and it is kept like any other.
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      finishRef.current('closed');
      aliveRef.current = false;
    };
  }, []);

  // Each conversation's gateway session ends with it.
  useEffect(() => {
    if (!rehearsal) return;
    return () => void gateway.rehearsal.end(rehearsal.call_id).catch(() => undefined);
  }, [rehearsal]);

  // The phone: SMS one-time passwords sent to this conversation's customer.
  useEffect(() => {
    if (!rehearsal || closed) return;
    const controller = new AbortController();
    const poll = () =>
      gateway.rehearsal
        .sms(rehearsal.call_id, controller.signal)
        .then((messages) => setSms(messages.map((m) => m.text)))
        .catch(() => undefined);
    void poll();
    const timer = window.setInterval(poll, SMS_POLL_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [rehearsal, closed]);

  // The agent speaks first, once the customer's secure channel is open.
  const greeted = useRef<string | null>(null);
  useEffect(() => {
    if (!rehearsal || greeted.current === rehearsal.call_id) return;
    if (channel.connection === 'open') {
      greeted.current = rehearsal.call_id;
      setStatus('live');
      if (openingNoteRef.current) assistant.note(openingNoteRef.current);
      openingNoteRef.current = null;
      void assistant.greet();
    } else if (channel.connection === 'closed' && statusRef.current === 'waiting') {
      greeted.current = rehearsal.call_id;
      setError(`The customer’s secure channel could not open: ${channel.error?.message ?? 'the banking gateway did not answer.'}`);
      setStatus('error');
    }
  }, [rehearsal, channel.connection, channel.error, assistant, setStatus]);

  const start = useCallback(
    async (type: ChannelType, channelId?: string, ref = 'draft') => {
      if (statusRef.current === 'connecting' || statusRef.current === 'waiting') return;
      if (statusRef.current === 'live') finishRef.current('user');
      attemptRef.current += 1;
      const attempt = attemptRef.current;
      const tab = tabOf(type);
      voiceRef.current.stop();
      speech.current = Promise.resolve();
      setRehearsal(null);
      setClosed(false);
      openingNoteRef.current = null;
      setError(null);
      setEndReason(null);
      setSms([]);
      setChannelType(tab);
      linesRef.current = [];
      toolsRef.current = [];
      recordsRef.current = [];
      setRecords([]);
      setTrace([]);
      startedRef.current = Date.now();
      setStartedAt(startedRef.current);
      recordedRef.current = true;
      setStatus('connecting');

      let version = 'draft';
      try {
        ({ version } = await getConfigRef.current(ref));
      } catch (err) {
        if (attempt !== attemptRef.current) return;
        setError(`Couldn’t start the conversation: ${errorText(err, 'the configuration could not be read.')}`);
        setStatus('error');
        return;
      }
      const id = channelId || (tab === 'web_voice' ? 'web-voice' : 'web-chat');
      playingRef.current = { ref, version, type: tab, channelId: id };
      setInfo({ ref, version, channel: { id, type: tab, input: tab === 'web_voice' ? ['audio', 'text'] : ['text'], output: tab === 'web_voice' ? ['audio', 'text'] : ['text'] } });

      // Voice: the microphone is asked for first, from the click, so the greeting can be spoken.
      let voiceNote: string | null = null;
      if (tab === 'web_voice') {
        const v = voiceRef.current;
        voiceNote = noSpeechNote({ recognition: v.supported, synthesis: v.canSpeak });
        if (v.supported) {
          await v.start();
          if (!v.isActive()) voiceNote = 'The microphone could not be turned on, so this voice conversation is typed for now. Use Try again on the voice panel to turn it on.';
        }
      }

      let started: Rehearsal;
      try {
        started = await gateway.rehearsal.start(tab === 'web_voice' ? 'web_voice' : 'web_chat');
      } catch (e) {
        if (attempt !== attemptRef.current) return;
        voiceRef.current.stop();
        const err = e instanceof GatewayError ? e : null;
        setError(`The banking gateway could not start a session: ${err?.message ?? errorText(e, 'it did not answer.')}`);
        setStatus('error');
        return;
      }
      if (attempt !== attemptRef.current || !aliveRef.current) {
        void gateway.rehearsal.end(started.call_id).catch(() => undefined);
        return;
      }
      startedRef.current = Date.now();
      setStartedAt(startedRef.current);
      recordedRef.current = false;
      greeted.current = null;
      openingNoteRef.current = voiceNote;
      setRehearsal(started);
      setStatus('waiting');
      addRecord('call_started', { bot: agentId, ref, version, channel: { id, type: tab }, caller: null, simulated: true, gateway_call_id: started.call_id, room: started.room });
      addRecord('agent_entered', { agent: nameRef.current, first: true });
    },
    [addRecord, agentId, setStatus]
  );

  const stop = useCallback(() => {
    const was = statusRef.current;
    if (was === 'idle' || was === 'ended' || was === 'error') return;
    attemptRef.current += 1;
    finishRef.current('user');
    voiceRef.current.stop();
    speech.current = Promise.resolve();
    assistantRef.current?.note('You ended the conversation. Its banking gateway session is closed.');
    setClosed(true);
    const current = rehearsalRef.current;
    if (current) void gateway.rehearsal.end(current.call_id).catch(() => undefined);
    setStatus('ended');
    setEndReason('You ended the conversation.');
  }, [setStatus]);

  const send = useCallback(async (text: string) => {
    if (statusRef.current !== 'live') return;
    assistantRef.current?.handle(text, 'chat');
  }, []);

  // ---- what the Test console shows ----

  const callKey = rehearsal?.call_id ?? 'none';
  const maskHeard = Boolean(assistant.secureStep || assistant.identifierStep);
  const messages = useMemo<ChatMessage[]>(() => toChatMessages(callKey, assistant.lines, { text: voice.interim, maskDigits: maskHeard }), [callKey, assistant.lines, voice.interim, maskHeard]);

  const lastId = assistant.lines[assistant.lines.length - 1]?.id;
  const byId = useMemo(() => new Map(assistant.lines.map((l) => [messageId(callKey, l), l])), [assistant.lines, callKey]);
  const underMessage = useCallback(
    (m: ChatMessage) => {
      const line = byId.get(m.id);
      if (!line || line.role !== 'assistant') return null;
      return <ReplyExtras line={line} latest={line.id === lastId} busy={assistant.thinking} source={source} onChoose={assistant.choose} onCurrency={assistant.balanceIn} />;
    },
    [byId, lastId, assistant.thinking, assistant.choose, assistant.balanceIn, source]
  );

  const live = status === 'live';
  const beside = (
    <CustomerDevice
      token={rehearsal && !closed ? rehearsal.channel_token : null}
      channel={channel}
      sms={sms}
      source={source}
      onUseAccount={(account) => live && assistant.selectAccount(account)}
      onAskForPerson={() => live && assistant.handle('I would like to speak to a Service Manager.', 'screen')}
      onRequestCallback={() => live && assistant.handle('Please arrange a call back.', 'screen')}
    />
  );
  const voiceOn = channelType === 'web_voice' && voice.supported;
  const bubbleState = voiceOn ? bubbleStateOf(voice, { thinking: assistant.thinking, secureStep: assistant.secureStep }) : 'idle';
  const latestCaption = [...assistant.lines].reverse().find((l) => l.role === 'assistant')?.text ?? '';

  return {
    status,
    bubbleState,
    channel: channelType,
    messages,
    trace,
    typing: assistant.thinking,
    listening: voice.status === 'listening',
    agentSpeaking: voice.status === 'speaking',
    audioLevel: voice.status === 'listening' ? voice.level : 0,
    latestCaption,
    isMuted: voice.muted,
    error,
    endReason,
    room: rehearsal?.room ?? null,
    roomToken: null,
    startedAt,
    audioBlocked: false,
    micError: voiceOn && live ? voice.error : null,
    primeAudio: () => undefined,
    enableAudio: async () => undefined,
    retryMic: async () => voice.start(),
    info,
    records,
    media: { camera: false, screen: false },
    toggleMedia: async () => undefined,
    sendImage: async () => false,
    attachCamera: () => undefined,
    start,
    stop,
    send,
    toggleMute: async () => voice.toggleMute(),
    submitForm: () => ({}),
    sandbox: bankingWords(source, studio),
    extras: {
      underMessage,
      beside,
      composerNote: assistant.secureStep ? <SecureEntryNote label={SECURE_LABEL[assistant.secureStep] ?? 'code'} /> : null,
      placeholder: assistant.identifierStep === 'phone_code' ? 'Type the 7-digit Phone Code' : assistant.identifierStep === 'account_number' ? 'Type the 12-digit account number' : undefined,
      suggestions: SUGGESTIONS,
      voice: voice.supported ? { title: VOICE_TITLE, descriptions: VOICE_WORDING } : null,
      voiceMissing: noSpeechNote({ recognition: voice.supported, synthesis: voice.canSpeak }),
      attention: `${assistant.secureStep ?? ''}|${channel.confirmation?.id ?? ''}:${channel.confirmation?.phase ?? ''}|${channel.state?.auth.state ?? ''}`,
    },
  };
}
