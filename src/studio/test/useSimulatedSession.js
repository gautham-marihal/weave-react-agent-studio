import { useCallback, useEffect, useRef, useState } from 'react';
import { createSimulatedAgent, widenQuestion } from '../../demo/simulatedAgent.js';
import { isDemoMode } from '../../demo/demoMode.js';
import { api } from '../../api/client.ts';
import { chooseSimulatedChannel } from './simulatedChannel.js';

// A SIMULATED conversation shaped like useLiveSession, so the Test tab and the editor's preview can show either. No
// server or LiveKit: replies come from demo/simulatedAgent.js, each marked `simulated`, on `getConfig(ref)` (for the
// draft, the editor's current contents, so unsaved edits show at once).

let counter = 0;
const nextId = (prefix) => {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
};
const THINK_MS = 380;

// What its documents say about what was said, best first, from the demo's own search, so the simulation can answer
// from them (demo mode only: with a real server, try the real agent). Nothing found or no index yet means no hits.
async function searchDocuments(playing, query) {
  if (!isDemoMode() || !playing?.botId || !playing.bases.length) return [];
  const found = await Promise.all(
    playing.bases.map((base) =>
      api
        .searchKnowledge(playing.botId, base, { query: widenQuestion(query), ref: playing.ref })
        .then((result) => (Array.isArray(result?.hits) ? result.hits : []))
        .catch(() => []),
    ),
  );
  return found.flat().sort((a, b) => (b.score || 0) - (a.score || 0));
}

export function useSimulatedSession({ onFinished, getConfig } = {}) {
  const [status, setStatus] = useState('idle'); // idle | starting | connecting | waiting | live | ended | error
  const [info, setInfo] = useState(null);
  const [messages, setMessages] = useState([]);
  const [events, setEvents] = useState([]);
  const [records, setRecords] = useState([]); // what happened, as the records a real call has (see studio/trace)
  const [error, setError] = useState(null);
  const agentRef = useRef(null);
  const playingRef = useRef(null); // what is being simulated: { botId, ref, bases } (the knowledge bases it reads)
  const timersRef = useRef(new Set());
  const aliveRef = useRef(true);
  const attemptRef = useRef(0); // which start is the current one (see startFor)
  const startedRef = useRef(null);
  const infoRef = useRef(null);
  const messagesRef = useRef([]);
  const recordedRef = useRef(true);
  const recordsRef = useRef([]);
  const seqRef = useRef(0);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const getConfigRef = useRef(getConfig);
  getConfigRef.current = getConfig;
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // One record of what happened, in the shape of the API's call log: { t, seq, elapsed_s, event, ...fields }.
  const addRecord = useCallback((event, fields = {}) => {
    if (!aliveRef.current) return;
    seqRef.current += 1;
    const started = startedRef.current || Date.now();
    const record = { t: new Date().toISOString(), seq: seqRef.current, elapsed_s: Math.round(((Date.now() - started) / 1000) * 1000) / 1000, event, ...fields };
    recordsRef.current = [...recordsRef.current, record];
    setRecords(recordsRef.current);
  }, []);

  const later = useCallback((fn, ms) => {
    const id = window.setTimeout(() => {
      timersRef.current.delete(id);
      if (aliveRef.current) fn();
    }, ms);
    timersRef.current.add(id);
  }, []);
  const clearTimers = useCallback(() => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current.clear();
  }, []);
  const log = useCallback((text, kind = 'info') => {
    if (aliveRef.current) setEvents((old) => [...old.slice(-199), { id: nextId('ev'), at: Date.now(), text, kind }]);
  }, []);
  const push = useCallback(
    (message) => {
      if (!aliveRef.current) return;
      setMessages((old) => [...old, { id: nextId('m'), final: true, at: Date.now(), ...message }]);
      if (message.role === 'user') addRecord('user_said', { text: message.text });
      else if (message.role === 'bot') addRecord('agent_said', { text: message.text, interrupted: false, simulated: true });
    },
    [addRecord],
  );

  const finish = useCallback(
    (reason) => {
      if (recordedRef.current || !startedRef.current) return;
      recordedRef.current = true;
      const spoken = messagesRef.current.filter((m) => m.role !== 'system' && m.text);
      if (!spoken.length) return;
      addRecord('session_closed', { reason: reason === 'user' ? 'participant_disconnected' : reason, error: null });
      addRecord('call_ended', {
        duration_s: Math.round((Date.now() - startedRef.current) / 1000),
        caller_turns: spoken.filter((m) => m.role === 'user').length,
        agent_turns: spoken.filter((m) => m.role !== 'user').length,
        handoffs: recordsRef.current.filter((r) => r.event === 'tool_called' && r.handoff).length,
        usage: [],
        state: agentRef.current?.state || {},
      });
      onFinishedRef.current?.({
        info: infoRef.current,
        messages: spoken.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text })),
        tools: recordsRef.current.filter((r) => r.event === 'tool_called').map((r) => ({ tool: r.tool, args: r.args, handoff: r.handoff })),
        state: agentRef.current?.state || {},
        agent: agentRef.current?.currentAgent,
        startedAt: startedRef.current,
        endedAt: Date.now(),
        reason,
      });
    },
    [addRecord],
  );

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      finish('closed');
      aliveRef.current = false;
      clearTimers();
    };
  }, [clearTimers, finish]);

  const startFor = useCallback(
    async (botId, options = {}) => {
      if (['starting', 'connecting', 'waiting', 'live'].includes(status)) return;
      // which start is the current one: End moves it on, so a start still reading the configuration stops where it is
      attemptRef.current += 1;
      const attempt = attemptRef.current;
      clearTimers();
      setError(null);
      setMessages([]);
      setEvents([]);
      setInfo(null);
      recordsRef.current = [];
      seqRef.current = 0;
      setRecords([]);
      setStatus('starting');
      const ref = options.ref || 'draft';
      let config;
      try {
        config = await getConfigRef.current?.(ref);
        if (!config || typeof config !== 'object') throw new Error('There is no configuration to simulate yet.');
      } catch (err) {
        if (!aliveRef.current || attempt !== attemptRef.current) return;
        setError({ title: 'Couldn’t start the simulation', body: err.message || 'The configuration could not be read.' });
        setStatus('error');
        return;
      }
      if (!aliveRef.current || attempt !== attemptRef.current) return;
      const played = chooseSimulatedChannel(config, options.channelId);
      const agent = createSimulatedAgent(config, { ...options, channelId: played?.id || options.channelId });
      agentRef.current = agent;
      playingRef.current = { botId, ref, bases: (Array.isArray(config.knowledge) ? config.knowledge : []).map((base) => base?.id).filter(Boolean) };
      const channel = agent.channel;
      const sessionInfo = {
        room: 'simulated',
        ref,
        version: ref === 'draft' ? 'draft' : ref,
        simulated: true,
        channel: {
          id: channel?.id || 'simulated',
          // what the screen draws (no microphone in a simulation) vs what the channel really is, never confused
          type: channel?.type === 'sip_voice' || channel?.type === 'web_voice' ? 'web_chat' : channel?.type || 'web_chat',
          realType: channel?.type || 'web_chat',
          input: ['text', ...(Array.isArray(channel?.modalities?.input) && channel.modalities.input.includes('image') ? ['image'] : [])],
          output: ['text'],
        },
      };
      infoRef.current = sessionInfo;
      setInfo(sessionInfo);
      setStatus('connecting');
      log('Starting a simulated conversation (no server, no real agent)');
      if (played?.voice)
        log(
          options.channelId === played.id
            ? `Simulated as the voice channel “${played.id}”, written out as text: a simulation has no microphone.`
            : `This agent has no text channel, so it is simulated on its voice channel “${played.id}”, written out as text.`,
        );
      // the agent's first lines, one at a time, and then the conversation is live
      const greet = () => {
        agent.greeting().forEach((message, index) => later(() => push({ ...message, role: 'bot' }), index * THINK_MS));
        later(() => setStatus('live'), 0);
      };
      later(() => {
        startedRef.current = Date.now();
        recordedRef.current = false;
        addRecord('call_started', {
          bot: botId,
          ref,
          version: sessionInfo.version,
          channel: { id: sessionInfo.channel.id, type: sessionInfo.channel.realType },
          caller: null,
          simulated: true,
        });
        addRecord('agent_entered', { agent: agent.currentAgent, first: true });
        setStatus('waiting');
        later(greet, 250);
      }, 250);
    },
    [addRecord, clearTimers, later, log, push, status],
  );

  const stop = useCallback(() => {
    attemptRef.current += 1;
    finish('user');
    clearTimers();
    setStatus('idle');
    log('You ended the simulated conversation');
  }, [clearTimers, finish, log]);

  const sendText = useCallback(
    async (text) => {
      const body = String(text || '').trim();
      const agent = agentRef.current;
      if (!agent || !body) return false;
      push({ role: 'user', text: body });
      const hits = await searchDocuments(playingRef.current, body);
      // ended, or started again, while its documents were searched: this answer belongs to no conversation now
      if (!aliveRef.current || agentRef.current !== agent) return false;
      const out = agent.reply(body, { hits });
      out.toolCalls.forEach((call) => {
        log(`Simulated tool call: ${call.tool}${call.handoff ? ` (hand-off to ${call.handoff})` : ''}`);
        addRecord('tool_called', { tool: call.tool, args: call.args || {}, ...(call.handoff ? { handoff: call.handoff } : {}), simulated: true });
        if (call.handoff) addRecord('agent_entered', { agent: call.handoff, first: false });
      });
      out.messages.forEach((message, index) => later(() => push({ ...message, role: 'bot' }), THINK_MS * (index + 1)));
      if (out.ended) {
        later(
          () => {
            finish('agent');
            push({ role: 'system', text: 'The simulated agent ended the conversation.' });
            setStatus('ended');
          },
          THINK_MS * (out.messages.length + 1),
        );
      }
      return true;
    },
    [addRecord, finish, later, log, push],
  );

  // A picture sent in the preview: shown as sent, with a reply saying it's made up (the real agent would look at it).
  const sendImage = useCallback(
    async (file) => {
      if (!agentRef.current || !file) return;
      push({ role: 'user', text: `Sent a picture: ${file.name}` });
      addRecord('user_sent_image', { name: file.name, type: file.type, size: file.size, simulated: true });
      later(() => push({ role: 'bot', text: 'Thanks, I received your picture. (A simulated reply: the real agent would look at it.)' }), THINK_MS);
    },
    [addRecord, later, push],
  );

  const noop = useCallback(() => {}, []);
  return {
    status,
    info,
    messages,
    events,
    records,
    error,
    form: null,
    media: { mic: false, camera: false, screen: false },
    agentHint: false,
    reconnecting: false,
    simulated: true,
    audioHostRef: useRef(null),
    localVideoRef: useRef(null),
    startFor,
    stop,
    attachPreview: noop,
    sendText,
    sendImage,
    toggle: noop,
    submitForm: noop,
    dismissForm: noop,
    clearError: () => setError(null),
  };
}
