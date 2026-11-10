import { useCallback, useEffect, useRef, useState } from 'react';
import { createSimulatedAgent, widenQuestion } from '../../demo/simulatedAgent.js';
import { isDemoMode } from '../../demo/demoMode.js';
import { api } from '../../api/client.ts';
import { chooseSimulatedChannel } from './simulatedChannel.js';
import { useSimulatedPictures } from './useSimulatedPictures.js';
import { addForm, formValues, removeForm, updateForm } from './formQueue.js';

// A SIMULATED conversation shaped like useLiveSession, so the Test tab and the editor's preview can show either. No
// server or LiveKit: replies come from demo/simulatedAgent.js, each marked `simulated`, on `getConfig(ref)` (for the
// draft, the editor's current contents, so unsaved edits show at once). It plays what the config says: the forms it
// shows (in the same card as a real call), the check-ins on a quiet caller and the call limits, on their own clocks.

let counter = 0;
const nextId = (prefix) => {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
};
const THINK_MS = 380;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);

// What its documents say about what was said, best first, from the demo's own search, so the simulation can answer
// from them (demo mode only: with a real server, try the real agent). Only the bases the agent answering now reads.
// Nothing found or no index yet means no hits.
async function searchDocuments(playing, bases, query) {
  if (!isDemoMode() || !playing?.botId || !bases.length) return [];
  const found = await Promise.all(
    bases.map((base) =>
      api
        .searchKnowledge(playing.botId, base, { query: widenQuestion(query), ref: playing.ref })
        .then((result) => (Array.isArray(result?.hits) ? result.hits : []))
        .catch(() => []),
    ),
  );
  return found.flat().sort((a, b) => (b.score || 0) - (a.score || 0));
}

// The clocks of a quiet caller and of the call, from the config: the check-ins (`defaults.conversation.inactivity`)
// and the limits (`guardrails.limits`). A simulation is typed, so a check-in waits from the caller's last message.
function clocksOf(config) {
  const q = config?.defaults?.conversation?.inactivity;
  const limits = isObj(config?.guardrails?.limits) ? config.guardrails.limits : {};
  const wait = isObj(q) && q.enabled !== false && typeof q.timeout_s === 'number' && q.timeout_s > 0 ? q.timeout_s : null;
  return {
    wait,
    nudges: list(q?.nudges),
    most: Number.isInteger(q?.max_nudges) ? q.max_nudges : list(q?.nudges).length,
    exhausted: list(q?.on_exhausted?.do),
    silence: typeof limits.max_silence_s === 'number' ? limits.max_silence_s : null,
    length: typeof limits.max_call_duration_s === 'number' ? limits.max_call_duration_s : null,
    limitSay: limits.say,
  };
}

export function useSimulatedSession({ onFinished, getConfig } = {}) {
  const [status, setStatus] = useState('idle'); // idle | starting | connecting | waiting | live | ended | error
  const [info, setInfo] = useState(null);
  const [messages, setMessages] = useState([]);
  const [events, setEvents] = useState([]);
  const [records, setRecords] = useState([]); // what happened, as the records a real call has (see studio/trace)
  const [error, setError] = useState(null);
  const [forms, setForms] = useState([]); // the forms it shows, as a real call's (formQueue.js)
  const formsRef = useRef([]);
  const agentRef = useRef(null);
  const playingRef = useRef(null); // what is being simulated: { botId, ref }
  const timersRef = useRef(new Set());
  const aliveRef = useRef(true);
  const attemptRef = useRef(0); // which start is the current one (see startFor)
  const startedRef = useRef(null);
  const infoRef = useRef(null);
  const messagesRef = useRef([]);
  const recordedRef = useRef(true);
  const recordsRef = useRef([]);
  const seqRef = useRef(0);
  const clocksRef = useRef(null); // clocksOf(config) for the conversation going on
  const quietRef = useRef({ timer: 0, silence: 0, length: 0, nudged: 0 });
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const getConfigRef = useRef(getConfig);
  getConfigRef.current = getConfig;
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    formsRef.current = forms;
  }, [forms]);

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
    const id = window.setTimeout(
      () => {
        timersRef.current.delete(id);
        if (aliveRef.current) fn();
      },
      Math.max(0, ms),
    );
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

  // the quiet-caller clocks stop (the conversation ended, or was started again)
  const stopClocks = useCallback(() => {
    const q = quietRef.current;
    [q.timer, q.silence, q.length].forEach((id) => window.clearTimeout(id));
    quietRef.current = { timer: 0, silence: 0, length: 0, nudged: 0 };
  }, []);

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

  // What the agent did (simulatedAgent's output): its lines and notes in order, a form to show. -> when the last shows
  const show = useCallback(
    (out, wait = 0) => {
      let at = wait;
      list(out?.lines).forEach((line) => {
        at += line.role === 'system' ? 120 : THINK_MS;
        later(() => push(line.role === 'system' ? { role: 'system', text: line.text } : { ...line, role: 'bot' }), at);
      });
      if (out?.form) {
        const form = out.form;
        at += 120;
        later(() => {
          setForms((old) => addForm(old, form));
          addRecord('form_requested', { form: form.title, fields: list(form.fields).map((f) => f?.name), simulated: true });
          log(`The agent asked for a form: ${form.title}`);
        }, at);
      }
      return at;
    },
    [addRecord, later, log, push],
  );

  // the picture steps of the configuration (useSimulatedPictures): the same card, refusals and records as a real call
  const endedBySteps = useCallback(() => {
    stopClocks();
    finish('agent');
    push({ role: 'system', text: 'The simulated agent ended the conversation.' });
    setStatus('ended');
  }, [finish, push, stopClocks]);
  const pictures = useSimulatedPictures({ push, addRecord, log, later, agent: () => agentRef.current, onEnded: endedBySteps, onAct: show });
  const { reset: resetPictures, begin: beginPictures, onSaid: picturesOnSaid, runSteps } = pictures;

  // After the agent's lines: its picture steps run, or the conversation ends.
  const carryOn = useCallback(
    (out, at) => {
      if (out?.steps?.length) runSteps(out.steps, 0, at);
      if (out?.ended)
        later(() => {
          // an open picture request ends with the conversation: its clock, its card and any camera
          resetPictures();
          setForms([]);
          endedBySteps();
        }, at + THINK_MS);
    },
    [endedBySteps, later, resetPictures, runSteps],
  );
  // what an outside clock does (a check-in, a limit): the agent's steps, shown, then carried on
  const actNow = useCallback(
    (actions) => {
      const agent = agentRef.current;
      if (!agent || agent.ended) return;
      const out = agent.act(actions);
      carryOn(out, show(out, 0));
    },
    [carryOn, show],
  );

  // ---- the quiet caller and the call's limits, on their own clocks; anything the caller does starts them again
  const armQuiet = useCallback(() => {
    const c = clocksRef.current;
    if (!c || !agentRef.current || agentRef.current.ended) return;
    const q = quietRef.current;
    window.clearTimeout(q.timer);
    window.clearTimeout(q.silence);
    if (c.wait) {
      q.timer = window.setTimeout(() => {
        if (!aliveRef.current) return;
        if (q.nudged < c.most) {
          const line = c.nudges[Math.min(q.nudged, c.nudges.length - 1)];
          q.nudged += 1;
          addRecord('inactivity', { nudge: q.nudged, simulated: true });
          if (line) actNow([line]);
          armQuiet();
        } else {
          addRecord('inactivity', { exhausted: true, simulated: true });
          if (c.exhausted.length) actNow(c.exhausted);
        }
      }, c.wait * 1000);
    }
    if (c.silence)
      q.silence = window.setTimeout(() => {
        addRecord('limit_reached', { limit: 'max_silence_s', simulated: true });
        actNow([{ type: 'end_call', ...(c.limitSay !== undefined ? { say: c.limitSay } : {}) }]);
      }, c.silence * 1000);
  }, [actNow, addRecord]);
  const callerActed = useCallback(() => {
    quietRef.current.nudged = 0;
    armQuiet();
  }, [armQuiet]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      finish('closed');
      resetPictures();
      stopClocks();
      aliveRef.current = false;
      clearTimers();
    };
  }, [clearTimers, finish, resetPictures, stopClocks]);

  const startFor = useCallback(
    async (botId, options = {}) => {
      if (['starting', 'connecting', 'waiting', 'live'].includes(status)) return;
      // which start is the current one: End moves it on, so a start still reading the configuration stops where it is
      attemptRef.current += 1;
      const attempt = attemptRef.current;
      clearTimers();
      stopClocks();
      resetPictures();
      setError(null);
      setMessages([]);
      setEvents([]);
      setForms([]);
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
      // every channel switched off: nobody can reach it, so there is nothing to play
      if (!played) {
        setError({ title: 'No channel is switched on', body: 'Switch a channel on in Build › Channels: with all of them off, nobody can reach this agent.' });
        setStatus('error');
        return;
      }
      const agent = createSimulatedAgent(config, { ...options, channelId: played.id });
      agentRef.current = agent;
      playingRef.current = { botId, ref };
      clocksRef.current = clocksOf(config);
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
      if (played.voice)
        log(
          options.channelId === played.id
            ? `Simulated as the voice channel “${played.id}”, written out as text: a simulation has no microphone.`
            : `This agent has no text channel, so it is simulated on its voice channel “${played.id}”, written out as text.`,
        );
      // the agent's first lines and steps, one at a time, and then the conversation is live
      const greet = () => {
        beginPictures(config, channel);
        const out = agent.start();
        const at = show(out, -THINK_MS);
        later(() => setStatus('live'), 0);
        carryOn(out, at);
        later(() => {
          const c = clocksRef.current;
          if (c?.length)
            quietRef.current.length = window.setTimeout(() => {
              addRecord('limit_reached', { limit: 'max_call_duration_s', simulated: true });
              actNow([{ type: 'end_call', ...(c.limitSay !== undefined ? { say: c.limitSay } : {}) }]);
            }, c.length * 1000);
          armQuiet();
        }, at);
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
    [actNow, addRecord, armQuiet, beginPictures, carryOn, clearTimers, later, log, resetPictures, show, status, stopClocks],
  );

  const stop = useCallback(() => {
    attemptRef.current += 1;
    finish('user');
    resetPictures();
    stopClocks();
    clearTimers();
    setForms([]);
    setStatus('idle');
    log('You ended the simulated conversation');
  }, [clearTimers, finish, log, resetPictures, stopClocks]);

  // the tool calls and hand-overs of a turn, as a real call records them
  const recordCalls = useCallback(
    (out) => {
      list(out?.toolCalls).forEach((call) => {
        log(`Simulated tool call: ${call.tool}${call.handoff ? ` (hand-off to ${call.handoff})` : ''}`);
        addRecord('tool_called', { tool: call.tool, args: call.args || {}, ...(call.handoff ? { handoff: call.handoff } : {}), simulated: true });
        if (call.handoff) addRecord('agent_entered', { agent: call.handoff, first: false });
      });
      if (out?.handoff && !list(out.toolCalls).some((c) => c.handoff)) addRecord('agent_entered', { agent: out.handoff, first: false });
    },
    [addRecord, log],
  );

  const sendText = useCallback(
    async (text) => {
      const body = String(text || '').trim();
      const agent = agentRef.current;
      if (!agent || !body) return false;
      push({ role: 'user', text: body });
      callerActed();
      // what was said starts the configuration's picture steps (a tool's or a task's): they answer instead
      if (picturesOnSaid(body)) return true;
      const hits = await searchDocuments(playingRef.current, agent.bases, body);
      // ended, or started again, while its documents were searched: this answer belongs to no conversation now
      if (!aliveRef.current || agentRef.current !== agent) return false;
      const out = agent.reply(body, { hits });
      recordCalls(out);
      carryOn(out, show(out, 0));
      return true;
    },
    [callerActed, carryOn, picturesOnSaid, push, recordCalls, show],
  );

  // The form on the screen sent: checked as the server checks it (its errors shown on the form), then its steps
  const submitForm = useCallback(
    async (values) => {
      const agent = agentRef.current;
      const current = formsRef.current[0];
      if (!agent || !current) return;
      const out = agent.submitForm(current.requestId, formValues(current.fields, values));
      if (out.errors) {
        setForms((old) => updateForm(old, current.requestId, { errors: out.errors, busy: false }));
        return;
      }
      setForms((old) => removeForm(old, current.requestId));
      addRecord('form_submitted', { form: current.title, simulated: true });
      log(`You sent the form: ${current.title}`);
      callerActed();
      recordCalls(out);
      carryOn(out, show(out, 0));
    },
    [addRecord, callerActed, carryOn, log, recordCalls, show],
  );
  // Closing it is an answer too: the form's "otherwise" runs
  const dismissForm = useCallback(async () => {
    const agent = agentRef.current;
    const current = formsRef.current[0];
    if (!current) return;
    setForms((old) => removeForm(old, current.requestId));
    push({ role: 'system', text: 'You closed the form. The agent was told.' });
    if (!agent) return;
    const out = agent.dismissForm(current.requestId);
    callerActed();
    carryOn(out, show(out, 0));
  }, [callerActed, carryOn, push, show]);

  // A picture sent in the preview: for the picture the agent asked for (measured and checked as the runtime would), or
  // with nothing asked, as the channel says (`inputs.image.on_receive`): attached to the next message (the usual), or
  // answered at once. Returns why it wasn't sent, or ''.
  const sendPicture = pictures.sendImage;
  const sendImage = useCallback(
    async (file) => {
      const agent = agentRef.current;
      if (!agent || !file) return '';
      const asked = await sendPicture(file);
      if (asked !== null) return asked;
      const channel = agent.channel;
      if (!list(channel?.modalities?.input).includes('image')) return 'This channel doesn’t take photos.';
      callerActed();
      push({ role: 'picture', text: '', picture: { kind: 'upload', status: 'sent', sent: { name: file.name, size: file.size } } });
      addRecord('user_sent_image', { name: file.name, type: file.type, size: file.size, simulated: true });
      const replies = channel?.inputs?.image?.on_receive === 'reply';
      // the server sends pictures only to a model marked as seeing them (`vision: true`)
      const blind = agent.sees === false;
      later(
        () =>
          blind
            ? push({ role: 'system', text: 'Simulated: this agent’s model isn’t marked as seeing pictures, so the real agent never gets this one.' })
            : replies
              ? push({
                  role: 'bot',
                  text: 'Thanks, I received your picture. (A simulated reply: the real agent would look at it and answer.)',
                  simulated: true,
                })
              : push({
                  role: 'system',
                  text: 'Simulated: the picture goes with your next message, as this channel is set to; the real agent looks at it then.',
                }),
        THINK_MS,
      );
      return '';
    },
    [addRecord, callerActed, later, push, sendPicture],
  );

  const noop = useCallback(() => {}, []);
  return {
    status,
    info,
    messages,
    events,
    records,
    error,
    form: forms[0] || null,
    media: { mic: false, camera: pictures.cameraOn, screen: false },
    picture: pictures.picture,
    pictureCamera: pictures.pictureCamera,
    attachCamera: pictures.attachCamera,
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
    submitForm,
    dismissForm,
    clearError: () => setError(null),
  };
}
