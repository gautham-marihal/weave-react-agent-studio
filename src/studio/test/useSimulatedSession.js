import { useCallback, useEffect, useRef, useState } from 'react';
import { createSimulatedAgent } from '../../demo/simulatedAgent.js';

// A SIMULATED conversation with the same shape as useLiveSession, so the Test tab and the preview beside the editor can show either.
// No server and no LiveKit: replies come from the rules in demo/simulatedAgent.js, marked `simulated` on every message. It runs on
// whatever configuration `getConfig(ref)` gives (the current editor contents for the draft, so unsaved edits show at once).

let counter = 0;
const nextId = (prefix) => { counter += 1; return `${prefix}-${Date.now().toString(36)}-${counter}`; };
const THINK_MS = 380;

export function useSimulatedSession({ onFinished, getConfig } = {}) {
  const [status, setStatus] = useState('idle'); // idle | starting | connecting | waiting | live | ended | error
  const [info, setInfo] = useState(null);
  const [messages, setMessages] = useState([]);
  const [events, setEvents] = useState([]);
  const [records, setRecords] = useState([]); // what happened, as the same kind of records a real call has (see studio/trace)
  const [error, setError] = useState(null);
  const agentRef = useRef(null);
  const timersRef = useRef(new Set());
  const aliveRef = useRef(true);
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
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // One record of what happened, in the shape of the API's call log: { t, seq, elapsed_s, event, ...fields }.
  const addRecord = useCallback((event, fields = {}) => {
    if (!aliveRef.current) return;
    seqRef.current += 1;
    const started = startedRef.current || Date.now();
    const record = { t: new Date().toISOString(), seq: seqRef.current, elapsed_s: Math.round(((Date.now() - started) / 1000) * 1000) / 1000, event, ...fields };
    recordsRef.current = [...recordsRef.current, record];
    setRecords(recordsRef.current);
  }, []);

  const later = useCallback((fn, ms) => { const id = window.setTimeout(() => { timersRef.current.delete(id); if (aliveRef.current) fn(); }, ms); timersRef.current.add(id); }, []);
  const clearTimers = useCallback(() => { timersRef.current.forEach((id) => window.clearTimeout(id)); timersRef.current.clear(); }, []);
  const log = useCallback((text, kind = 'info') => { if (aliveRef.current) setEvents((old) => [...old.slice(-199), { id: nextId('ev'), at: Date.now(), text, kind }]); }, []);
  const push = useCallback((message) => {
    if (!aliveRef.current) return;
    setMessages((old) => [...old, { id: nextId('m'), final: true, at: Date.now(), ...message }]);
    if (message.role === 'user') addRecord('user_said', { text: message.text });
    else if (message.role === 'bot') addRecord('agent_said', { text: message.text, interrupted: false, simulated: true });
  }, [addRecord]);

  const finish = useCallback((reason) => {
    if (recordedRef.current || !startedRef.current) return;
    recordedRef.current = true;
    const spoken = messagesRef.current.filter((m) => m.role !== 'system' && m.text);
    if (!spoken.length) return;
    addRecord('session_closed', { reason: reason === 'user' ? 'participant_disconnected' : reason, error: null });
    addRecord('call_ended', { duration_s: Math.round((Date.now() - startedRef.current) / 1000), caller_turns: spoken.filter((m) => m.role === 'user').length, agent_turns: spoken.filter((m) => m.role !== 'user').length, handoffs: recordsRef.current.filter((r) => r.event === 'tool_called' && r.handoff).length, usage: [], state: agentRef.current?.state || {} });
    onFinishedRef.current?.({ info: infoRef.current, messages: spoken.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text })), tools: recordsRef.current.filter((r) => r.event === 'tool_called').map((r) => ({ tool: r.tool, args: r.args, handoff: r.handoff })), state: agentRef.current?.state || {}, agent: agentRef.current?.currentAgent, startedAt: startedRef.current, endedAt: Date.now(), reason });
  }, [addRecord]);

  useEffect(() => { aliveRef.current = true; return () => { finish('closed'); aliveRef.current = false; clearTimers(); }; }, [clearTimers, finish]);

  const startFor = useCallback(async (botId, options = {}) => {
    if (['starting', 'connecting', 'waiting', 'live'].includes(status)) return;
    clearTimers();
    setError(null); setMessages([]); setEvents([]); setInfo(null);
    recordsRef.current = []; seqRef.current = 0; setRecords([]);
    setStatus('starting');
    const ref = options.ref || 'draft';
    let config;
    try {
      config = await getConfigRef.current?.(ref);
      if (!config || typeof config !== 'object') throw new Error('There is no configuration to simulate yet.');
    } catch (err) {
      if (!aliveRef.current) return;
      setError({ title: 'Couldn’t start the simulation', body: err.message || 'The configuration could not be read.' });
      setStatus('error');
      return;
    }
    if (!aliveRef.current) return;
    const agent = createSimulatedAgent(config, options);
    agentRef.current = agent;
    const channel = agent.channel;
    const sessionInfo = {
      room: 'simulated', ref, version: ref === 'draft' ? 'draft' : ref, simulated: true,
      channel: { id: channel?.id || 'simulated', type: channel?.type === 'sip_voice' || channel?.type === 'web_voice' ? 'web_chat' : channel?.type || 'web_chat', input: ['text'], output: ['text'] },
    };
    infoRef.current = sessionInfo;
    setInfo(sessionInfo);
    setStatus('connecting');
    log('Starting a simulated conversation (no server, no real agent)');
    later(() => {
      startedRef.current = Date.now();
      recordedRef.current = false;
      addRecord('call_started', { bot: botId, ref, version: sessionInfo.version, channel: { id: sessionInfo.channel.id, type: sessionInfo.channel.type }, caller: null, simulated: true });
      addRecord('agent_entered', { agent: agent.currentAgent, first: true });
      setStatus('waiting');
      later(() => {
        agent.greeting().forEach((message, index) => later(() => push({ ...message, role: 'bot' }), index * THINK_MS));
        later(() => setStatus('live'), 0);
      }, 250);
    }, 250);
  }, [addRecord, clearTimers, later, log, push, status]);

  const stop = useCallback(() => {
    finish('user');
    clearTimers();
    setStatus('idle');
    log('You ended the simulated conversation');
  }, [clearTimers, finish, log]);

  const sendText = useCallback(async (text) => {
    const body = String(text || '').trim();
    const agent = agentRef.current;
    if (!agent || !body) return false;
    push({ role: 'user', text: body });
    const out = agent.reply(body);
    out.toolCalls.forEach((call) => {
      log(`Simulated tool call: ${call.tool}${call.handoff ? ` (hand-off to ${call.handoff})` : ''}`);
      addRecord('tool_called', { tool: call.tool, args: call.args || {}, ...(call.handoff ? { handoff: call.handoff } : {}), simulated: true });
      if (call.handoff) addRecord('agent_entered', { agent: call.handoff, first: false });
    });
    out.messages.forEach((message, index) => later(() => push({ ...message, role: 'bot' }), THINK_MS * (index + 1)));
    if (out.ended) {
      later(() => { finish('agent'); push({ role: 'system', text: 'The simulated agent ended the conversation.' }); setStatus('ended'); }, THINK_MS * (out.messages.length + 1));
    }
    return true;
  }, [addRecord, finish, later, log, push]);

  const noop = useCallback(() => {}, []);
  return {
    status, info, messages, events, records, error, form: null, media: { mic: false, camera: false, screen: false }, agentHint: false, reconnecting: false, simulated: true,
    audioHostRef: useRef(null), localVideoRef: useRef(null),
    startFor, stop, attachPreview: noop, sendText, sendImage: noop, toggle: noop, submitForm: noop, dismissForm: noop, clearError: () => setError(null),
  };
}
