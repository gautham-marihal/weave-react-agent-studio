import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.js';

// One conversation with an agent over LiveKit: ask the API for a join token (POST /sessions), connect, and
// turn what arrives into messages. The bot's text replies come as text streams on `lk.transcription`, the
// visitor's chat goes out on `lk.chat`, and forms travel on `agent-builder.form` / `agent-builder.form.submit`.
// The join token is a secret for this one session: it is used to connect and never kept or logged.

const TOPIC_TRANSCRIPTION = 'lk.transcription';
const TOPIC_CHAT = 'lk.chat';
const TOPIC_FORM = 'agent-builder.form';
const TOPIC_FORM_SUBMIT = 'agent-builder.form.submit';
const AGENT_JOIN_HINT_MS = 30000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let counter = 0;
const nextId = (prefix) => { counter += 1; return `${prefix}-${Date.now().toString(36)}-${counter}`; };

// What went wrong starting a session, in words a person can act on.
export function describeStartError(error, ref) {
  if (!error) return { title: 'Couldn’t start the conversation', body: '' };
  switch (error.kind) {
    case 'not_found':
      return ref === 'draft' || !ref
        ? { title: 'This agent has no draft to test', body: error.message }
        : { title: `Nothing is deployed to “${ref}” yet`, body: 'Deploy a version there first, or test the draft instead.' };
    case 'invalid': {
      const noChannel = /web|channel/i.test(error.message) && !error.errors?.length;
      return noChannel
        ? { title: 'This agent can’t be tried in a browser', body: `${error.message} The Test panel needs a web chat or web voice channel. Phone-only agents are tested by calling them.` }
        : { title: 'The configuration has errors, so it can’t be tried', body: 'Fix these on the Config tab and save the draft.', errors: error.errors };
    }
    case 'unavailable':
      return { title: 'The server can’t start browser sessions yet', body: `${error.message} It needs LiveKit to be configured on the server.` };
    case 'network':
      return { title: 'Can’t reach the Agent Builder API', body: error.message };
    case 'auth':
      return { title: 'The API rejected the access key', body: error.message };
    default:
      return { title: 'Couldn’t start the conversation', body: error.message };
  }
}

export function useLiveSession({ onFinished } = {}) {
  const [status, setStatus] = useState('idle'); // idle | starting | connecting | waiting | live | ended | error
  const [info, setInfo] = useState(null); // { room, ref, version, channel, expiresInS }
  const [messages, setMessages] = useState([]);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(null); // { title, body, errors }
  const [form, setForm] = useState(null); // { requestId, title, description, fields, submitLabel, errors, busy }
  const [media, setMedia] = useState({ mic: false, camera: false, screen: false });
  const [agentHint, setAgentHint] = useState(false);
  const [reconnecting, setReconnecting] = useState(false); // the connection dropped and LiveKit is trying to restore it

  const roomRef = useRef(null);
  const lkRef = useRef(null);
  const aliveRef = useRef(true);
  const stoppingRef = useRef(false);
  const formViaRef = useRef('data');
  const hintTimerRef = useRef(null);
  const audioHostRef = useRef(null);
  const localVideoRef = useRef(null);
  // What a finished conversation reports (see finish): when it began, what was said, how it ended.
  const startedRef = useRef(null);
  const infoRef = useRef(null);
  const messagesRef = useRef([]);
  const recordedRef = useRef(true);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const log = useCallback((text, kind = 'info') => {
    if (!aliveRef.current) return;
    setEvents((old) => [...old.slice(-199), { id: nextId('ev'), at: Date.now(), text, kind }]);
  }, []);

  const upsertMessage = useCallback((id, patch) => {
    if (!aliveRef.current) return;
    setMessages((old) => {
      const index = old.findIndex((m) => m.id === id);
      if (index === -1) return [...old, { id, role: 'bot', text: '', final: false, at: Date.now(), ...patch }];
      const next = old.slice();
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }, []);

  const addSystem = useCallback((text) => upsertMessage(nextId('sys'), { role: 'system', text, final: true }), [upsertMessage]);

  // Reported once per conversation, however it ends: you end it, the agent hangs up, or you leave the page.
  const finish = useCallback((reason) => {
    if (recordedRef.current || !startedRef.current) return;
    recordedRef.current = true;
    const spoken = messagesRef.current.filter((m) => m.role !== 'system' && m.text);
    const endedAt = Date.now();
    if (!spoken.length && endedAt - startedRef.current < 4000) return; // connected and left at once: nothing to record
    onFinishedRef.current?.({ info: infoRef.current, messages: spoken.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text })), startedAt: startedRef.current, endedAt, reason });
  }, []);

  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const cleanup = useCallback(() => {
    window.clearTimeout(hintTimerRef.current);
    const room = roomRef.current;
    roomRef.current = null;
    if (audioHostRef.current) audioHostRef.current.replaceChildren();
    if (room) { try { room.removeAllListeners(); } catch { /* already gone */ } room.disconnect().catch(() => {}); }
    setMedia({ mic: false, camera: false, screen: false });
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => { finish('closed'); aliveRef.current = false; cleanup(); };
  }, [cleanup, finish]);

  // ---- forms ----------------------------------------------------------------------------------------

  const onFormPacket = useCallback((raw, via) => {
    let packet;
    try { packet = JSON.parse(raw); } catch { log('Received a form message that is not JSON', 'warn'); return; }
    formViaRef.current = via;
    if (packet.type === 'form') {
      setForm({
        requestId: packet.request_id, title: packet.title || 'The agent needs some details', description: packet.description || '',
        fields: Array.isArray(packet.fields) ? packet.fields : [], submitLabel: packet.submit_label || 'Send', errors: {}, busy: false,
      });
      log(`The agent asked for a form: ${packet.title || packet.request_id}`);
    } else if (packet.type === 'form_errors') {
      setForm((old) => (old && old.requestId === packet.request_id ? { ...old, errors: packet.errors || {}, busy: false } : old));
    } else if (packet.type === 'form_accepted') {
      setForm((old) => (old && old.requestId === packet.request_id ? null : old));
      addSystem('Form sent.');
    }
  }, [addSystem, log]);

  const submitForm = useCallback(async (values) => {
    const room = roomRef.current;
    const current = form;
    if (!room || !current) return;
    setForm({ ...current, busy: true, errors: {} });
    const body = JSON.stringify({ request_id: current.requestId, values });
    try {
      if (formViaRef.current === 'stream') await room.localParticipant.sendText(body, { topic: TOPIC_FORM_SUBMIT });
      else await room.localParticipant.publishData(encoder.encode(body), { reliable: true, topic: TOPIC_FORM_SUBMIT });
    } catch (err) {
      setForm({ ...current, busy: false, errors: { _form: `Couldn’t send the form: ${err.message}` } });
    }
  }, [form]);

  const dismissForm = useCallback(() => setForm(null), []);

  // ---- starting and stopping -----------------------------------------------------------------------

  // `botId` is passed per call so one hook instance can serve whichever agent is open.
  const startFor = useCallback(async (botId, options = {}) => {
    if (roomRef.current || status === 'starting' || status === 'connecting') return;
    stoppingRef.current = false;
    setError(null); setMessages([]); setEvents([]); setForm(null); setAgentHint(false); setInfo(null);
    setStatus('starting');
    let session;
    try {
      session = await api.startSession(botId, { ref: options.ref || 'draft', identity: options.identity });
    } catch (err) {
      if (!aliveRef.current) return;
      setError(describeStartError(err, options.ref || 'draft'));
      setStatus('error');
      return;
    }
    if (!aliveRef.current) return;
    await connect(session, options.ref || 'draft');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function connect(session, ref) {
    const sessionInfo = { room: session.room, ref: session.ref || ref, version: session.version, channel: session.channel, expiresInS: session.expires_in_s };
    infoRef.current = sessionInfo;
    setInfo(sessionInfo);
    setStatus('connecting');
    log(`Joining room ${session.room} (${session.version || ref})`);
    try {
      if (!lkRef.current) lkRef.current = await import('livekit-client');
      const { Room, RoomEvent, Track } = lkRef.current;
      const room = new Room();
      roomRef.current = room;

      room.registerTextStreamHandler(TOPIC_TRANSCRIPTION, async (reader, participant) => {
        const attrs = reader.info?.attributes || {};
        const segment = attrs['lk.segment_id'] || reader.info?.id || nextId('seg');
        const mine = participant?.identity === room.localParticipant.identity;
        let text = '';
        try {
          for await (const chunk of reader) {
            text += chunk;
            upsertMessage(segment, { role: mine ? 'user' : 'bot', text, final: false });
          }
        } catch (err) { log(`A reply was cut off: ${err.message}`, 'warn'); }
        upsertMessage(segment, { role: mine ? 'user' : 'bot', text, final: true });
        if (!mine) { window.clearTimeout(hintTimerRef.current); setAgentHint(false); setStatus((s) => (s === 'waiting' || s === 'connecting' ? 'live' : s)); }
      });
      room.registerTextStreamHandler(TOPIC_FORM, async (reader) => {
        let text = '';
        for await (const chunk of reader) text += chunk;
        onFormPacket(text, 'stream');
      });

      room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
        if (topic === TOPIC_FORM) onFormPacket(decoder.decode(payload), 'data');
      });
      room.on(RoomEvent.ParticipantConnected, (p) => {
        log(`${p.identity} joined`);
        if (aliveRef.current) { window.clearTimeout(hintTimerRef.current); setAgentHint(false); setStatus((s) => (s === 'waiting' ? 'live' : s)); }
      });
      room.on(RoomEvent.ParticipantDisconnected, (p) => log(`${p.identity} left`));
      room.on(RoomEvent.Reconnecting, () => { setReconnecting(true); log('Connection lost, reconnecting…', 'warn'); });
      room.on(RoomEvent.Reconnected, () => { setReconnecting(false); log('Reconnected'); });
      room.on(RoomEvent.MediaDevicesError, (e) => { log(`Device problem: ${e.message}`, 'error'); setError({ title: 'A microphone or camera problem', body: e.message }); });
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio && audioHostRef.current) {
          const el = track.attach();
          el.dataset.agentAudio = 'true';
          audioHostRef.current.appendChild(el);
        }
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => { track.detach().forEach((el) => el.remove()); });
      room.on(RoomEvent.Disconnected, () => {
        window.clearTimeout(hintTimerRef.current);
        if (!aliveRef.current) return;
        if (stoppingRef.current) { setStatus('idle'); return; }
        log('The conversation ended', 'warn');
        finish('agent');
        addSystem('The agent ended the conversation.');
        setStatus('ended');
        cleanup();
      });

      await room.connect(session.livekit_url, session.token);
      if (!aliveRef.current) return;
      startedRef.current = Date.now();
      recordedRef.current = false;
      log('Connected. Waiting for the agent');
      setStatus((s) => (s === 'connecting' ? 'waiting' : s));
      hintTimerRef.current = window.setTimeout(() => setAgentHint(true), AGENT_JOIN_HINT_MS);
      await room.startAudio().catch(() => {});

      if (session.channel?.type === 'web_voice') {
        try { await room.localParticipant.setMicrophoneEnabled(true); setMedia((m) => ({ ...m, mic: true })); log('Microphone on'); } catch (err) {
          log(`Microphone: ${err.message}`, 'error');
          setError({ title: 'The microphone isn’t available', body: `${err.message} Allow microphone access in the browser, then end this conversation and start again. You can still type.` });
        }
      }
    } catch (err) {
      if (!aliveRef.current) return;
      log(`Connection failed: ${err.message}`, 'error');
      setError({ title: 'Couldn’t join the conversation', body: err.message });
      setStatus('error');
      cleanup();
    }
  }

  // The preview <video> only exists while the Test tab is open and the camera is on, so the tab asks for the
  // track to be attached whenever either changes.
  const attachPreview = useCallback(() => {
    const room = roomRef.current;
    const lk = lkRef.current;
    const video = localVideoRef.current;
    if (!room || !lk || !video) return;
    const pub = room.localParticipant.getTrackPublication(lk.Track.Source.Camera);
    if (pub?.track) pub.track.attach(video);
  }, []);

  const stop = useCallback(() => {
    stoppingRef.current = true;
    finish('user');
    cleanup();
    setStatus('idle');
    setForm(null);
    log('You ended the conversation');
  }, [cleanup, finish, log]);

  // ---- sending ---------------------------------------------------------------------------------------

  const sendText = useCallback(async (text) => {
    const room = roomRef.current;
    const body = String(text || '').trim();
    if (!room || !body) return false;
    upsertMessage(nextId('me'), { role: 'user', text: body, final: true });
    try { await room.localParticipant.sendText(body, { topic: TOPIC_CHAT }); return true; } catch (err) {
      log(`Couldn’t send: ${err.message}`, 'error');
      addSystem(`Your message wasn’t delivered: ${err.message}`);
      return false;
    }
  }, [addSystem, log, upsertMessage]);

  const sendImage = useCallback(async (file, topic) => {
    const room = roomRef.current;
    if (!room || !file) return;
    try {
      await room.localParticipant.sendFile(file, { topic });
      upsertMessage(nextId('me'), { role: 'user', text: `Sent a picture: ${file.name}`, final: true });
    } catch (err) {
      log(`Couldn’t send the picture: ${err.message}`, 'error');
      addSystem(`The picture wasn’t delivered: ${err.message}`);
    }
  }, [addSystem, log, upsertMessage]);

  const toggle = useCallback(async (what) => {
    const room = roomRef.current;
    if (!room) return;
    const next = !media[what];
    try {
      if (what === 'mic') await room.localParticipant.setMicrophoneEnabled(next);
      if (what === 'camera') {
        await room.localParticipant.setCameraEnabled(next);
      }
      if (what === 'screen') await room.localParticipant.setScreenShareEnabled(next);
      setMedia((m) => ({ ...m, [what]: next }));
      log(`${what === 'mic' ? 'Microphone' : what === 'camera' ? 'Camera' : 'Screen share'} ${next ? 'on' : 'off'}`);
    } catch (err) {
      log(`${what}: ${err.message}`, 'error');
      setError({ title: `Couldn’t turn the ${what === 'mic' ? 'microphone' : what === 'camera' ? 'camera' : 'screen share'} ${next ? 'on' : 'off'}`, body: err.message });
    }
  }, [media, log]);

  return {
    status, info, messages, events, error, form, media, agentHint, reconnecting, simulated: false, audioHostRef, localVideoRef,
    startFor, stop, attachPreview, sendText, sendImage, toggle, submitForm, dismissForm, clearError: () => setError(null),
  };
}
