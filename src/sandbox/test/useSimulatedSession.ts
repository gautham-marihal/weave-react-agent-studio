// Sandbox's test conversation: a SIMULATED one in the shape of useTestSession (TestSession), so the Test page and the
// test panel beside other pages show it as they show a real one. No server and no LiveKit: replies come from the
// imitation agent (createSimulatedAgent), each marked as made up, on `getConfig(ref)` (for the draft, the editor's
// current contents, so unsaved edits show at once). What happened is written as the records a real call's log has, so
// the trace and "make a scenario from this conversation" read it as they read a real call. Ported from Weave React's
// studio/test/useSimulatedSession.js.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentConfig, ChannelType } from '../../types/studio';
import type { ChatMessage, TraceEvent } from '../../types/testConsole';
import type { SessionInfo, SessionStatus, TestSession } from '../../hooks/useTestSession';
import type { TraceItem } from '../../utils/testSession';
import { traceFromRecord } from '../../utils/testSession';
import { api } from '../../api/client';
import { chooseSimulatedChannel, createSimulatedAgent, widenQuestion, type SandboxAgent } from '../sandboxEngine.js';
import {
  OPEN_MS,
  SIMULATED_WORDS,
  THINK_MS,
  closingRecords,
  makeRecord,
  shownChannel,
  stateChanges,
  tabOf,
  voiceNote,
  type CallLogRecord,
  type FinishedConversation,
  type PlayedChannel,
} from './simulatedConversation';

export interface SimulatedSessionOptions {
  agentId: string;
  agentName: string;
  /** The configuration to play for a ref: the editor's contents for "draft", else that version's. */
  getConfig: (ref: string) => Promise<{ config: AgentConfig; version: string }>;
  /** Called once when a conversation in which something was said ends (by either side, or by leaving the page). */
  onFinished?: (done: FinishedConversation) => void;
}

// What a simulation has nothing to do for (audio, microphone, camera, forms).
const noop = (): void => undefined;
const noopAsync = async (): Promise<void> => undefined;
const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

// What its documents say about what was said, best first, from Sandbox's own search, so the imitation can answer from
// them. Nothing found, or no index yet, means no hits.
async function searchDocuments(agentId: string, ref: string, bases: string[], query: string): Promise<unknown[]> {
  if (!bases.length) return [];
  const found = await Promise.all(
    bases.map((base) =>
      api
        .searchKnowledge(agentId, base, { query: widenQuestion(query), ref })
        .then((result) => {
          const hits = (result as { hits?: unknown } | null)?.hits;
          return Array.isArray(hits) ? hits : [];
        })
        .catch(() => []),
    ),
  );
  const score = (hit: unknown) => Number((hit as { score?: unknown })?.score) || 0;
  return found.flat().sort((a, b) => score(b) - score(a));
}

export function useSimulatedSession({ agentId, agentName, getConfig, onFinished }: SimulatedSessionOptions): TestSession {
  const [status, setStatusState] = useState<SessionStatus>('idle');
  const [channel, setChannel] = useState<ChannelType>('web_chat');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [trace, setTrace] = useState<TraceEvent[]>([]);
  const [records, setRecords] = useState<CallLogRecord[]>([]);
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [endReason, setEndReason] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [info, setInfo] = useState<SessionInfo | null>(null);

  const statusRef = useRef<SessionStatus>('idle');
  const agentRef = useRef<SandboxAgent | null>(null);
  const playingRef = useRef<{ ref: string; version: string; bases: string[]; channel: SessionInfo['channel'] } | null>(null);
  const timersRef = useRef(new Set<number>());
  const aliveRef = useRef(true);
  const attemptRef = useRef(0); // which start is the current one: End moves it on, so a start still reading stops
  const startedRef = useRef<number | null>(null);
  const linesRef = useRef<ChatMessage[]>([]);
  const recordsRef = useRef<CallLogRecord[]>([]);
  const recordedRef = useRef(true);
  const pendingRef = useRef(0); // replies still to come, for the typing dots
  const idRef = useRef(0);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;
  const getConfigRef = useRef(getConfig);
  getConfigRef.current = getConfig;
  const nameRef = useRef(agentName);
  nameRef.current = agentName;

  const nextId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(idRef.current += 1)}`;
  const setStatus = useCallback((next: SessionStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  const addTrace = useCallback((items: (TraceItem & { raw?: unknown })[]) => {
    if (!aliveRef.current) return;
    const at = Date.now() - (startedRef.current ?? Date.now());
    setTrace((prev) => [...prev, ...items.map((e) => ({ ...e, id: nextId('t'), at_ms: at }))]);
  }, []);

  const addRecord = useCallback(
    (event: string, fields: Record<string, unknown> = {}) => {
      if (!aliveRef.current) return;
      const now = Date.now();
      const record = makeRecord(recordsRef.current.length + 1, startedRef.current ?? now, now, event, fields);
      recordsRef.current = [...recordsRef.current, record];
      setRecords(recordsRef.current);
      const item = traceFromRecord(record);
      if (item) addTrace([{ ...item, raw: record }]);
    },
    [addTrace],
  );

  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timersRef.current.delete(id);
      if (aliveRef.current) fn();
    }, ms);
    timersRef.current.add(id);
  }, []);
  const clearTimers = useCallback(() => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current.clear();
    pendingRef.current = 0;
    setTyping(false);
  }, []);

  const push = useCallback(
    (message: Omit<ChatMessage, 'id'>) => {
      if (!aliveRef.current) return;
      const full: ChatMessage = { ...message, id: nextId('m') };
      linesRef.current = [...linesRef.current, full];
      setMessages(linesRef.current);
      if (message.from === 'user') addRecord('user_said', { text: message.text });
      else if (message.from === 'agent') addRecord('agent_said', { text: message.text, interrupted: false, simulated: true });
    },
    [addRecord],
  );

  // An agent's line said after it has "thought", with the typing dots meanwhile.
  const sayLater = useCallback(
    (text: string, ms: number) => {
      pendingRef.current += 1;
      setTyping(true);
      later(() => {
        pendingRef.current = Math.max(0, pendingRef.current - 1);
        setTyping(pendingRef.current > 0);
        push({ from: 'agent', text, sandbox: true });
      }, ms);
    },
    [later, push],
  );

  // The log's end, and the conversation handed on to be kept: once, and only when something was said.
  const finish = useCallback(
    (reason: 'user' | 'agent' | 'closed') => {
      const started = startedRef.current;
      if (recordedRef.current || !started) return;
      recordedRef.current = true;
      const lines = linesRef.current.map((m) => ({ from: m.from, text: m.text }));
      if (!lines.some((m) => m.from !== 'system' && m.text)) return;
      const now = Date.now();
      const handoffs = recordsRef.current.filter((r) => r.event === 'tool_called' && r.handoff).length;
      const state = agentRef.current?.state ?? {};
      closingRecords(reason, { startedAt: started, now, lines, handoffs, state }).forEach(([event, fields]) => addRecord(event, fields));
      const playing = playingRef.current;
      finishedRef.current?.({
        agentId,
        agentName: nameRef.current,
        ref: playing?.ref ?? 'draft',
        version: playing?.version ?? 'draft',
        channel: playing?.channel ?? { id: 'simulated', type: 'web_chat', input: ['text'], output: ['text'] },
        lines,
        tools: recordsRef.current
          .filter((r) => r.event === 'tool_called')
          .map((r) => ({ tool: String(r.tool ?? ''), args: (r.args as Record<string, unknown>) ?? {}, handoff: typeof r.handoff === 'string' ? r.handoff : undefined })),
        state,
        agent: agentRef.current?.currentAgent ?? '',
        startedAt: started,
        endedAt: now,
      });
    },
    [addRecord, agentId],
  );

  // Leaving the page (or another agent opening) ends the conversation, and it is kept like any other.
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    aliveRef.current = true;
    const timers = timersRef.current;
    return () => {
      finishRef.current('closed');
      aliveRef.current = false;
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
    };
  }, []);

  const start = useCallback(
    async (type: ChannelType, channelId?: string, ref = 'draft') => {
      if (statusRef.current === 'connecting' || statusRef.current === 'waiting') return;
      // a conversation still going is closed (and kept) before the next one starts
      if (statusRef.current === 'live') finish('user');
      attemptRef.current += 1;
      const attempt = attemptRef.current;
      clearTimers();
      setError(null);
      setEndReason(null);
      linesRef.current = [];
      setMessages([]);
      setTrace([]);
      recordsRef.current = [];
      setRecords([]);
      setInfo(null);
      startedRef.current = Date.now();
      setStartedAt(startedRef.current);
      recordedRef.current = true;
      setChannel(tabOf(type));
      setStatus('connecting');
      addTrace([{ kind: 'session', label: 'Simulated conversation', detail: 'In this browser: no server, no LiveKit, no real agent', status: 'info' }]);

      let config: AgentConfig;
      let version: string;
      try {
        ({ config, version } = await getConfigRef.current(ref));
        if (!config || typeof config !== 'object') throw new Error('There is no configuration to simulate yet.');
      } catch (err) {
        if (!aliveRef.current || attempt !== attemptRef.current) return;
        const message = `Couldn’t start the simulation: ${errorText(err, 'the configuration could not be read.')}`;
        setError(message);
        setStatus('error');
        addTrace([{ kind: 'error', label: 'Couldn’t start the simulation', detail: errorText(err, ''), status: 'error' }]);
        return;
      }
      if (!aliveRef.current || attempt !== attemptRef.current) return;

      const played = chooseSimulatedChannel(config, channelId) as PlayedChannel | null;
      const agent = createSimulatedAgent(config, { channelId: played?.id || channelId });
      agentRef.current = agent;
      const spec = shownChannel(played, config);
      const knowledge = (config as Record<string, unknown>).knowledge;
      const bases = (Array.isArray(knowledge) ? knowledge : [])
        .map((base) => (base && typeof base === 'object' ? String((base as { id?: unknown }).id ?? '') : ''))
        .filter(Boolean);
      playingRef.current = { ref, version, bases, channel: spec };
      setInfo({ ref, version, channel: spec });
      const note = voiceNote(played, channelId);
      if (note) push({ from: 'system', text: note });

      later(() => {
        if (attempt !== attemptRef.current) return;
        startedRef.current = Date.now();
        setStartedAt(startedRef.current);
        recordedRef.current = false;
        addRecord('call_started', { bot: agentId, ref, version, channel: { id: spec.id, type: spec.type }, caller: null, simulated: true });
        addRecord('agent_entered', { agent: agent.currentAgent, first: true });
        setStatus('waiting');
        later(() => {
          if (attempt !== attemptRef.current) return;
          // the agent's first lines, one at a time; the conversation is open from the start
          agent.greeting().forEach((m, i) => sayLater(m.text, i * THINK_MS));
          setStatus('live');
        }, OPEN_MS);
      }, OPEN_MS);
    },
    [addRecord, addTrace, agentId, clearTimers, finish, later, push, sayLater, setStatus],
  );

  const stop = useCallback(() => {
    const was = statusRef.current;
    if (was === 'idle' || was === 'ended' || was === 'error') return;
    attemptRef.current += 1;
    finish('user');
    clearTimers();
    setStatus('ended');
    setEndReason('You ended the simulated conversation.');
    push({ from: 'system', text: 'You ended the simulated conversation.' });
  }, [clearTimers, finish, push, setStatus]);

  const send = useCallback(
    async (text: string) => {
      const body = String(text || '').trim();
      const agent = agentRef.current;
      if (!agent || !body || statusRef.current !== 'live') return;
      push({ from: 'user', text: body, via: 'text' });
      const playing = playingRef.current;
      setTyping(true);
      const hits = playing ? await searchDocuments(agentId, playing.ref, playing.bases, body) : [];
      // ended, or started again, while its documents were searched: this answer belongs to no conversation now
      if (!aliveRef.current || agentRef.current !== agent || statusRef.current !== 'live') return;
      const before = { ...agent.state };
      const out = agent.reply(body, { hits });
      out.toolCalls.forEach((call) => {
        const handoff = typeof call.handoff === 'string' ? call.handoff : '';
        addRecord('tool_called', { tool: call.tool, args: call.args || {}, ...(handoff ? { handoff } : {}), simulated: true });
        if (handoff) addRecord('agent_entered', { agent: handoff, first: false });
      });
      stateChanges(before, agent.state).forEach((change) => addRecord('state_changed', { ...change, simulated: true }));
      if (!out.messages.length) setTyping(pendingRef.current > 0);
      out.messages.forEach((m, i) => sayLater(m.text, THINK_MS * (i + 1)));
      if (out.ended) {
        later(
          () => {
            finish('agent');
            clearTimers();
            setStatus('ended');
            setEndReason('The simulated agent ended the conversation.');
            push({ from: 'system', text: 'The simulated agent ended the conversation.' });
          },
          THINK_MS * (out.messages.length + 1) + 20,
        );
      }
    },
    [addRecord, agentId, clearTimers, finish, later, push, sayLater, setStatus],
  );

  // A picture sent: shown as sent, with a reply saying it's made up (the real agent would look at it).
  const sendImage = useCallback(
    async (file: File) => {
      if (!agentRef.current || statusRef.current !== 'live') return false;
      push({ from: 'user', text: `Sent a picture: ${file.name}`, via: 'text' });
      addRecord('user_sent_image', { name: file.name, type: file.type, size: file.size, simulated: true });
      sayLater('Thanks, I received your picture. (A simulated reply: the real agent would look at it.)', THINK_MS);
      return true;
    },
    [addRecord, push, sayLater],
  );

  return {
    status,
    bubbleState: 'idle',
    channel,
    messages,
    trace,
    typing,
    listening: false,
    agentSpeaking: false,
    audioLevel: 0,
    latestCaption: '',
    isMuted: false,
    error,
    endReason,
    room: null,
    roomToken: null,
    startedAt,
    audioBlocked: false,
    micError: null,
    primeAudio: noop,
    enableAudio: noopAsync,
    retryMic: noopAsync,
    info,
    records,
    media: { camera: false, screen: false },
    toggleMedia: noopAsync,
    sendImage,
    attachCamera: noop,
    start,
    stop,
    send,
    toggleMute: noopAsync,
    submitForm: () => ({}),
    sandbox: SIMULATED_WORDS,
  };
}
