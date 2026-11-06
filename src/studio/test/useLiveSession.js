import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import { drawsVoice } from './channels.ts';
import { IMAGE_TOPIC, UI_TOPIC, applyUiMessage, fileKey, readUiMessage, uploadProblem } from '../pictures/pictureProtocol.js';
import { addForm, readForm, removeForm, updateForm } from './formQueue.js';

// One conversation with an agent over LiveKit: get a join token (POST /sessions), connect, and turn what arrives into
// messages. Bot text arrives on `lk.transcription`, chat goes out on `lk.chat`, forms use `agent-builder.form` and
// `agent-builder.form.submit`, and a picture the agent asks for is `agent-builder.ui` (see pictures/pictureProtocol.js):
// an upload goes back on `agent-builder.image`, the camera is the normal camera track. The join token is a secret for
// this session: used to connect, never kept or logged.

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
  // the forms the agent has open, oldest first (formQueue.js); the screen shows the first
  const [forms, setForms] = useState([]); // [{ requestId, title, description, fields, submitLabel, errors, busy }]
  const form = forms[0] || null;
  const [media, setMedia] = useState({ mic: false, camera: false, screen: false });
  const [agentHint, setAgentHint] = useState(false);
  const [reconnecting, setReconnecting] = useState(false); // the connection dropped and LiveKit is trying to restore it
  // what the agent says it is doing ('listening' | 'thinking' | 'speaking'), from its lk.agent.state attribute; '' until it says
  const [agentState, setAgentState] = useState('');
  // the picture the agent is asking for, if any (pictures/pictureProtocol.js openRequest); one at a time
  const [picture, setPicture] = useState(null);
  const pictureRef = useRef(null);
  const sentFilesRef = useRef(new Set()); // the photos sent in this call: the same file is never sent twice
  const thumbsRef = useRef([]); // small local previews of sent photos (object URLs), released when the call is over
  const cameraForPictureRef = useRef(false); // the camera was switched on for a request, so it goes off when that ends

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
    setAgentState('');
    pictureRef.current = null;
    setPicture(null);
    cameraForPictureRef.current = false;
  }, []);
  // the previews of sent photos are released when the hook goes (a new call keeps none either)
  const releaseThumbs = useCallback(() => {
    thumbsRef.current.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* already released */
      }
    });
    thumbsRef.current = [];
    sentFilesRef.current = new Set();
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      finish('closed');
      aliveRef.current = false;
      cleanup();
      releaseThumbs();
    };
  }, [cleanup, finish, releaseThumbs]);

  // ---- pictures (MEDIA_PROTOCOL): the runtime asks, the screen reacts; every request ends with request_done
  const setRequest = useCallback((next) => {
    pictureRef.current = next;
    if (aliveRef.current) setPicture(next);
  }, []);
  const cameraOff = useCallback(async () => {
    const room = roomRef.current;
    cameraForPictureRef.current = false;
    if (!room) return;
    try {
      await room.localParticipant.setCameraEnabled(false);
    } catch {
      /* already off */
    }
    if (aliveRef.current) setMedia((m) => ({ ...m, camera: false }));
  }, []);
  const onUiPacket = useCallback(
    (raw) => {
      const message = readUiMessage(raw);
      if (!message) return; // not JSON, or a type this screen doesn't know: ignored, as the protocol asks
      const before = pictureRef.current;
      const { request, done, note } = applyUiMessage(before, message);
      // a new request while the camera was on for an older one: that one is over
      if (before && request && request.id !== before.id && before.kind === 'camera' && request.kind !== 'camera' && cameraForPictureRef.current) cameraOff();
      setRequest(request);
      if (message.type === 'request_image') log(`The agent asked for ${message.kind === 'camera' ? 'the camera' : 'a photo'}`);
      if (message.type === 'image_rejected') log(`The agent turned a picture down: ${message.code}`, 'warn');
      if (note) upsertMessage(nextId('pic'), { role: 'system', text: `A photo was not used: ${note}`, final: true });
      if (done) {
        log(`The picture request ended: ${done.status}`);
        if (done.kind === 'camera' || cameraForPictureRef.current) cameraOff();
        upsertMessage(nextId('pic'), { role: 'picture', text: '', final: true, picture: { kind: done.kind, status: done.status, sent: done.sent } });
      }
    },
    [cameraOff, log, setRequest, upsertMessage],
  );

  // A photo: for the open upload request, or (with nothing asked) as the channel allows. Returns why it wasn't sent, in
  // words, or '' when it went. `topic` is the channel's inputs.image.topic when it sets one.
  const sendImage = useCallback(
    async (file, topic) => {
      const room = roomRef.current;
      if (!room || !file) return '';
      const request = pictureRef.current;
      if (request?.kind === 'camera') return 'The agent wants the camera now, so a photo chosen from your device is not used. Turn the camera on instead.';
      const problem = uploadProblem(file, request || {});
      if (problem) return problem;
      const key = fileKey(file);
      if (sentFilesRef.current.has(key)) return 'You have already sent this photo. Choose another one.';
      let thumb = '';
      try {
        thumb = URL.createObjectURL(file);
        thumbsRef.current.push(thumb);
      } catch {
        /* no preview: the line says the name */
      }
      const sent = { name: file.name, size: file.size, thumb };
      if (request) setRequest({ ...request, sent, phase: 'sending', rejection: null });
      try {
        await room.localParticipant.sendFile(file, { topic: topic || IMAGE_TOPIC });
        sentFilesRef.current.add(key);
        if (request && pictureRef.current?.id === request.id) setRequest({ ...pictureRef.current, phase: 'sent' });
        if (!request) upsertMessage(nextId('me'), { role: 'picture', text: '', final: true, picture: { kind: 'upload', status: 'sent', sent } });
        log(`Sent a photo: ${file.name}`);
        return '';
      } catch (err) {
        if (request && pictureRef.current?.id === request.id) setRequest({ ...pictureRef.current, sent: null, phase: 'open' });
        log(`Couldn’t send the picture: ${err.message}`, 'error');
        return `The photo wasn’t delivered: ${err.message}`;
      }
    },
    [log, setRequest, upsertMessage],
  );

  // The camera for the open camera request: switched on by the person's press (browsers ask for that), kept on until the
  // request ends, then switched off. Returns why it couldn't start, or ''.
  const pictureCamera = useCallback(
    async (on) => {
      const room = roomRef.current;
      if (!room) return '';
      if (!on) {
        await cameraOff();
        log('Camera off');
        return '';
      }
      try {
        await room.localParticipant.setCameraEnabled(true);
        cameraForPictureRef.current = true;
        if (aliveRef.current) setMedia((m) => ({ ...m, camera: true }));
        log('Camera on');
        return '';
      } catch (err) {
        log(`Camera: ${err.message}`, 'error');
        return /denied|permission|notallowed/i.test(`${err.name} ${err.message}`)
          ? 'The browser was not allowed to use the camera. Allow it in the address bar, then press Turn on camera again.'
          : `The camera didn’t start: ${err.message}`;
      }
    },
    [cameraOff, log],
  );
  // A request still open when the call ends is over too (the runtime cancels it): it leaves its line in the conversation.
  const endOpenPicture = useCallback(() => {
    const open = pictureRef.current;
    if (!open) return;
    upsertMessage(nextId('pic'), { role: 'picture', text: '', final: true, picture: { kind: open.kind, status: 'cancelled', sent: open.sent } });
  }, [upsertMessage]);
  // Shows the camera in a <video> of the card asking for it.
  const attachCamera = useCallback((video) => {
    const room = roomRef.current;
    const lk = lkRef.current;
    if (!room || !lk || !video) return;
    const pub = room.localParticipant.getTrackPublication(lk.Track.Source.Camera);
    if (pub?.track) pub.track.attach(video);
  }, []);

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
        const next = readForm(packet);
        if (!next) return;
        setForms((old) => addForm(old, next));
        log(`The agent asked for a form: ${packet.title || packet.request_id}`);
      } else if (packet.type === 'form_errors') {
        setForms((old) => updateForm(old, packet.request_id, { errors: packet.errors || {}, busy: false }));
      } else if (packet.type === 'form_accepted') {
        setForms((old) => removeForm(old, packet.request_id));
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
      setForms((old) => updateForm(old, current.requestId, { busy: true, errors: {} }));
      const body = JSON.stringify({ request_id: current.requestId, values });
      try {
        if (formViaRef.current === 'stream') await room.localParticipant.sendText(body, { topic: TOPIC_FORM_SUBMIT });
        else await room.localParticipant.publishData(encoder.encode(body), { reliable: true, topic: TOPIC_FORM_SUBMIT });
      } catch (err) {
        setForms((old) => updateForm(old, current.requestId, { busy: false, errors: { _form: `Couldn’t send the form: ${err.message}` } }));
      }
    },
    [form],
  );

  // Closing the form is an answer: the bot is told it was cancelled (FORM_PROTOCOL: `{request_id, cancelled: true}`),
  // so it can run the form's `otherwise` instead of waiting for values that will never come.
  const dismissForm = useCallback(async () => {
    const room = roomRef.current;
    const current = form;
    if (current) setForms((old) => removeForm(old, current.requestId));
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
      setForms([]);
      setAgentHint(false);
      setInfo(null);
      releaseThumbs();
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
    [status, releaseThumbs],
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

      // what the agent asks of the screen about pictures: only from the agent, never from the visitor's own side
      room.registerTextStreamHandler(UI_TOPIC, async (reader, participant) => {
        if (participant?.identity === room.localParticipant.identity) return;
        let text = '';
        for await (const chunk of reader) text += chunk;
        onUiPacket(text);
      });

      room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
        if (topic === TOPIC_FORM) onFormPacket(decoder.decode(payload), 'data');
        if (topic === UI_TOPIC) onUiPacket(decoder.decode(payload));
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
      room.on(RoomEvent.ParticipantAttributesChanged, (_changed, p) => {
        const said = p?.attributes?.['lk.agent.state'];
        if (aliveRef.current && p !== room.localParticipant && said) setAgentState(said);
      });
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
        endOpenPicture();
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
    endOpenPicture();
    cleanup();
    setStatus('idle');
    setForms([]);
    log('You ended the conversation');
  }, [cleanup, endOpenPicture, finish, log]);

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

  const toggle = useCallback(
    async (what) => {
      const room = roomRef.current;
      if (!room) return;
      const next = !media[what];
      try {
        if (what === 'mic') await room.localParticipant.setMicrophoneEnabled(next);
        if (what === 'camera') {
          await room.localParticipant.setCameraEnabled(next);
          if (!next) cameraForPictureRef.current = false;
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

  // How loud the agent is right now, 0 to 1, read many times a second by the voice view (so it is not React state).
  const agentLevel = useCallback(() => {
    const room = roomRef.current;
    if (!room) return 0;
    let level = 0;
    for (const p of room.remoteParticipants?.values() || []) level = Math.max(level, p.audioLevel || 0);
    return level;
  }, []);
  // How loud the person testing is, 0 to 1 (their microphone), for the orb while it listens.
  const userLevel = useCallback(() => roomRef.current?.localParticipant?.audioLevel || 0, []);

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
    agentState,
    agentLevel,
    userLevel,
    simulated: false,
    audioHostRef,
    localVideoRef,
    startFor,
    stop,
    attachPreview,
    sendText,
    sendImage,
    picture,
    pictureCamera,
    attachCamera,
    toggle,
    submitForm,
    dismissForm,
    clearError: () => setError(null),
  };
}
