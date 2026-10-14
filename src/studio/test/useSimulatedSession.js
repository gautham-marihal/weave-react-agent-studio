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
  const [error, setError] = useState(null);
  const agentRef = useRef(null);
  const timersRef = useRef(new Set());
  const aliveRef = useRef(true);
  const startedRef = useRef(null);
  const infoRef = useRef(null);
  const messagesRef = useRef([]);
  const recordedRef = useRef(true);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const getConfigRef = useRef(getConfig);
  getConfigRef.current = getConfig;
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const later = useCallback((fn, ms) => { const id = window.setTimeout(() => { timersRef.current.delete(id); if (aliveRef.current) fn(); }, ms); timersRef.current.add(id); }, []);
  const clearTimers = useCallback(() => { timersRef.current.forEach((id) => window.clearTimeout(id)); timersRef.current.clear(); }, []);
  const log = useCallback((text, kind = 'info') => { if (aliveRef.current) setEvents((old) => [...old.slice(-199), { id: nextId('ev'), at: Date.now(), text, kind }]); }, []);
  const push = useCallback((message) => { if (aliveRef.current) setMessages((old) => [...old, { id: nextId('m'), final: true, at: Date.now(), ...message }]); }, []);

  const finish = useCallback((reason) => {
    if (recordedRef.current || !startedRef.current) return;
    recordedRef.current = true;
    const spoken = messagesRef.current.filter((m) => m.role !== 'system' && m.text);
    if (!spoken.length) return;
    onFinishedRef.current?.({ info: infoRef.current, messages: spoken.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text })), startedAt: startedRef.current, endedAt: Date.now(), reason });
  }, []);

  useEffect(() => { aliveRef.current = true; return () => { finish('closed'); aliveRef.current = false; clearTimers(); }; }, [clearTimers, finish]);

  const startFor = useCallback(async (botId, options = {}) => {
    if (['starting', 'connecting', 'waiting', 'live'].includes(status)) return;
    clearTimers();
    setError(null); setMessages([]); setEvents([]); setInfo(null);
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
      setStatus('waiting');
      later(() => {
        agent.greeting().forEach((message, index) => later(() => push({ ...message, role: 'bot' }), index * THINK_MS));
        later(() => setStatus('live'), 0);
      }, 250);
    }, 250);
  }, [clearTimers, later, log, push, status]);

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
    out.toolCalls.forEach((call) => log(`Simulated tool call: ${call.tool}${call.handoff ? ` (hand-off to ${call.handoff})` : ''}`));
    out.messages.forEach((message, index) => later(() => push({ ...message, role: 'bot' }), THINK_MS * (index + 1)));
    if (out.ended) {
      later(() => { finish('agent'); push({ role: 'system', text: 'The simulated agent ended the conversation.' }); setStatus('ended'); }, THINK_MS * (out.messages.length + 1));
    }
    return true;
  }, [finish, later, log, push]);

  const noop = useCallback(() => {}, []);
  return {
    status, info, messages, events, error, form: null, media: { mic: false, camera: false, screen: false }, agentHint: false, reconnecting: false, simulated: true,
    audioHostRef: useRef(null), localVideoRef: useRef(null),
    startFor, stop, attachPreview: noop, sendText, sendImage: noop, toggle: noop, submitForm: noop, dismissForm: noop, clearError: () => setError(null),
  };
}
