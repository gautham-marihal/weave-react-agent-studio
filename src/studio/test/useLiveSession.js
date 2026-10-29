import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import { drawsVoice } from './channels.ts';

// One conversation with an agent over LiveKit: get a join token (POST /sessions), connect, and turn what arrives into
// messages. Bot text arrives on `lk.transcription`, chat goes out on `lk.chat`, forms use `agent-builder.form` and
// `agent-builder.form.submit`. The join token is a secret for this session: used to connect and, while in the room,
// to prove to the banking gateway that the banking panel is this conversation's caller. Never stored or logged.

const TOPIC_TRANSCRIPTION = 'lk.transcription';
const TOPIC_CHAT = 'lk.chat';
const TOPIC_FORM = 'agent-builder.form';
const TOPIC_FORM_SUBMIT = 'agent-builder.form.submit';
const AGENT_JOIN_HINT_MS = 30000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let counter = 0;
const nextId = (prefix) => {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
};

// What went wrong starting a session, in words a person can act on.
export function describeStartError(error, ref) {
  if (!error) return { title: 'Couldn’t start the conversation', body: '' };
  switch (error.kind) {
    case 'not_found':
      return ref === 'draft' || !ref
        ? { title: 'This agent has no draft to test', body: error.message }
        : { title: `Nothing is deployed to “${ref}” yet`, body: 'Deploy a version there first, or test the draft instead.' };
    case 'invalid': {
      // a channel not offered to browsers: the server's message lists the ones that are, so it is shown as it is
      if (/offer/i.test(error.message) && /channel/i.test(error.message) && !error.errors?.length)
        return { title: 'That channel can’t be tried in a browser', body: error.message };
      const noChannel = /web|channel/i.test(error.message) && !error.errors?.length;
      return noChannel
        ? {
            title: 'This agent can’t be tried in a browser',
            body: `${error.message} The Test panel needs a web chat or web voice channel. Phone-only agents are tested by calling them.`,
          }
        : { title: 'The configuration has errors, so it can’t be tried', body: 'Fix them, save the draft and try again.', errors: error.errors };
    }
    case 'unavailable':
      // A customer needs what to do; the server's setting names are for whoever runs it, one click away.
      return {
        title: 'Live conversations aren’t set up on this server yet',
        body: 'Ask whoever runs the server to turn them on. Until then you can try the agent with the simulated preview.',
        details: error.message,
      };
    case 'network':
      return { title: 'Can’t reach the server', body: 'It may be down or restarting. Try again in a moment, or use the simulated preview meanwhile.' };
    case 'auth':
      return {
        title: 'The server didn’t accept the studio’s access key',
        body: 'Ask the person who runs Weave to check the studio’s settings.',
        details: error.message,
      };
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
  // While in the room: its join token and when it was joined. The banking panel shows the token to the banking gateway
  // (only there) to prove it is this conversation's caller; it is dropped the moment the room is left.
  const [joined, setJoined] = useState(null); // { token, at }

  const roomRef = useRef(null);
  const lkRef = useRef(null);
  const aliveRef = useRef(true);
  const stoppingRef = useRef(false);
  // which start is current: End (or another start) moves it on, so one still in flight stops (no room, no microphone)
  const attemptRef = useRef(0);
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
    onFinishedRef.current?.({
      info: infoRef.current,
      messages: spoken.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text })),
      startedAt: startedRef.current,
      endedAt,
      reason,
    });
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const cleanup = useCallback(() => {
    window.clearTimeout(hintTimerRef.current);
    const room = roomRef.current;
    roomRef.current = null;
    if (audioHostRef.current) audioHostRef.current.replaceChildren();
    if (room) {
      try {
        room.removeAllListeners();
      } catch {
        /* already gone */
      }
      room.disconnect().catch(() => {});
    }
    setMedia({ mic: false, camera: false, screen: false });
    setJoined(null);
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      finish('closed');
      aliveRef.current = false;
      cleanup();
    };
  }, [cleanup, finish]);

  // ---- forms

  const onFormPacket = useCallback(
    (raw, via) => {
      let packet;
      try {
        packet = JSON.parse(raw);
      } catch {
        log('Received a form message that is not JSON', 'warn');
        return;
      }
      formViaRef.current = via;
      if (packet.type === 'form') {
        setForm({
          requestId: packet.request_id,
          title: packet.title || 'The agent needs some details',
          description: packet.description || '',
          fields: Array.isArray(packet.fields) ? packet.fields : [],
          submitLabel: packet.submit_label || 'Send',
          errors: {},
          busy: false,
        });
        log(`The agent asked for a form: ${packet.title || packet.request_id}`);
      } else if (packet.type === 'form_errors') {
        setForm((old) => (old && old.requestId === packet.request_id ? { ...old, errors: packet.errors || {}, busy: false } : old));
      } else if (packet.type === 'form_accepted') {
        setForm((old) => (old && old.requestId === packet.request_id ? null : old));
        addSystem('Form sent.');
      }
    },
    [addSystem, log],
  );

  const submitForm = useCallback(
    async (values) => {
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
    },
    [form],
  );

  // Closing the form is an answer: the bot is told it was cancelled (FORM_PROTOCOL: `{request_id, cancelled: true}`),
  // so it can run the form's `otherwise` instead of waiting for values that will never come.
  const dismissForm = useCallback(async () => {
    const room = roomRef.current;
    const current = form;
    setForm(null);
    if (!room || !current) return;
    const body = JSON.stringify({ request_id: current.requestId, cancelled: true });
    try {
      if (formViaRef.current === 'stream') await room.localParticipant.sendText(body, { topic: TOPIC_FORM_SUBMIT });
      else await room.localParticipant.publishData(encoder.encode(body), { reliable: true, topic: TOPIC_FORM_SUBMIT });
      addSystem('You closed the form. The agent was told.');
    } catch {
      addSystem('You closed the form, but the agent couldn’t be told: it may still wait for it.');
    }
  }, [form, addSystem]);

  // ---- starting and stopping

  // `botId` is passed per call so one hook instance can serve whichever agent is open.
  // `connect` is remade every render; startFor reaches the newest through this ref, so startFor doesn't change with it
  const connectRef = useRef(null);
  connectRef.current = connect;
  const startFor = useCallback(
    async (botId, options = {}) => {
      if (roomRef.current || status === 'starting' || status === 'connecting') return;
      attemptRef.current += 1;
      const attempt = attemptRef.current;
      stoppingRef.current = false;
      setError(null);
      setMessages([]);
      setEvents([]);
      setForm(null);
      setAgentHint(false);
      setInfo(null);
      setStatus('starting');
      let session;
      try {
        session = await api.startSession(botId, { ref: options.ref || 'draft', identity: options.identity, channel: options.channel });
      } catch (err) {
        if (!aliveRef.current || attempt !== attemptRef.current) return;
        setError(describeStartError(err, options.ref || 'draft'));
        setStatus('error');
        return;
      }
      if (!aliveRef.current || attempt !== attemptRef.current) return;
      await connectRef.current(session, options.ref || 'draft', attempt);
    },
    [status],
  );

  async function connect(session, ref, attempt) {
    const current = () => aliveRef.current && attempt === attemptRef.current;
    const sessionInfo = {
      room: session.room,
      ref: session.ref || ref,
      version: session.version,
      channel: session.channel,
      channels: Array.isArray(session.channels) ? session.channels : [],
      expiresInS: session.expires_in_s,
    };
    infoRef.current = sessionInfo;
    setInfo(sessionInfo);
    setStatus('connecting');
    log(`Joining room ${session.room} (${session.version || ref})`);
    try {
      if (!lkRef.current) lkRef.current = await import('livekit-client');
      if (!current()) return;
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
        } catch (err) {
          log(`A reply was cut off: ${err.message}`, 'warn');
        }
        upsertMessage(segment, { role: mine ? 'user' : 'bot', text, final: true });
        if (!mine) {
          window.clearTimeout(hintTimerRef.current);
          setAgentHint(false);
          setStatus((s) => (s === 'waiting' || s === 'connecting' ? 'live' : s));
        }
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
        if (aliveRef.current) {
          window.clearTimeout(hintTimerRef.current);
          setAgentHint(false);
          setStatus((s) => (s === 'waiting' ? 'live' : s));
        }
      });
      room.on(RoomEvent.ParticipantDisconnected, (p) => log(`${p.identity} left`));
      room.on(RoomEvent.Reconnecting, () => {
        setReconnecting(true);
        log('Connection lost, reconnecting…', 'warn');
      });
      room.on(RoomEvent.Reconnected, () => {
        setReconnecting(false);
        log('Reconnected');
      });
      room.on(RoomEvent.MediaDevicesError, (e) => {
        log(`Device problem: ${e.message}`, 'error');
        setError({ title: 'A microphone or camera problem', body: e.message });
      });
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio && audioHostRef.current) {
          const el = track.attach();
          el.dataset.agentAudio = 'true';
          audioHostRef.current.appendChild(el);
        }
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((el) => el.remove());
      });
      room.on(RoomEvent.Disconnected, () => {
        window.clearTimeout(hintTimerRef.current);
        if (!aliveRef.current) return;
        if (stoppingRef.current) {
          setStatus('idle');
          return;
        }
        log('The conversation ended', 'warn');
        finish('agent');
        addSystem('The agent ended the conversation.');
        setStatus('ended');
        cleanup();
      });

      await room.connect(session.livekit_url, session.token);
      if (!current()) {
        // ended while it was joining: leave the room it has just joined
        room.removeAllListeners();
        room.disconnect().catch(() => {});
        return;
      }
      startedRef.current = Date.now();
      recordedRef.current = false;
      setJoined({ token: session.token, at: startedRef.current });
      log('Connected. Waiting for the agent');
      setStatus((s) => (s === 'connecting' ? 'waiting' : s));
      hintTimerRef.current = window.setTimeout(() => setAgentHint(true), AGENT_JOIN_HINT_MS);
      await room.startAudio().catch(() => {});
      if (!current()) return;

      if (drawsVoice(session.channel)) {
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
          if (!current()) {
            room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
            return;
          }
          setMedia((m) => ({ ...m, mic: true }));
          log('Microphone on');
        } catch (err) {
          if (!current()) return;
          log(`Microphone: ${err.message}`, 'error');
          setError({
            title: 'The microphone isn’t available',
            body: `${err.message} Allow microphone access in the browser, then end this conversation and start again. You can still type.`,
          });
        }
      }
    } catch (err) {
      if (!current()) return;
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
    attemptRef.current += 1;
    stoppingRef.current = true;
    finish('user');
    cleanup();
    setStatus('idle');
    setForm(null);
    log('You ended the conversation');
  }, [cleanup, finish, log]);

  // ---- sending

  const sendText = useCallback(
    async (text) => {
      const room = roomRef.current;
      const body = String(text || '').trim();
      if (!room || !body) return false;
      upsertMessage(nextId('me'), { role: 'user', text: body, final: true });
      try {
        await room.localParticipant.sendText(body, { topic: TOPIC_CHAT });
        return true;
      } catch (err) {
        log(`Couldn’t send: ${err.message}`, 'error');
        addSystem(`Your message wasn’t delivered: ${err.message}`);
        return false;
      }
    },
    [addSystem, log, upsertMessage],
  );

  const sendImage = useCallback(
    async (file, topic) => {
      const room = roomRef.current;
      if (!room || !file) return;
      try {
        await room.localParticipant.sendFile(file, { topic });
        upsertMessage(nextId('me'), { role: 'user', text: `Sent a picture: ${file.name}`, final: true });
      } catch (err) {
        log(`Couldn’t send the picture: ${err.message}`, 'error');
        addSystem(`The picture wasn’t delivered: ${err.message}`);
      }
    },
    [addSystem, log, upsertMessage],
  );

  const toggle = useCallback(
    async (what) => {
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
        setError({
          title: `Couldn’t turn the ${what === 'mic' ? 'microphone' : what === 'camera' ? 'camera' : 'screen share'} ${next ? 'on' : 'off'}`,
          body: err.message,
        });
      }
    },
    [media, log],
  );

  return {
    status,
    info,
    messages,
    events,
    error,
    form,
    media,
    agentHint,
    reconnecting,
    channelToken: joined?.token ?? null,
    startedAt: joined?.at ?? null,
    simulated: false,
    audioHostRef,
    localVideoRef,
    startFor,
    stop,
    attachPreview,
    sendText,
    sendImage,
    toggle,
    submitForm,
    dismissForm,
    clearError: () => setError(null),
  };
}
