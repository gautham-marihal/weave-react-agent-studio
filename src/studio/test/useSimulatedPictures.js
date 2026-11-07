import { useEffect, useCallback, useRef, useState } from 'react';
import { applyUiMessage, fileKey, readUiMessage, rejectedShort, REJECTED_WORDS, uploadProblem } from '../pictures/pictureProtocol.js';
import { measureFile, measureFrame } from '../pictures/measure.js';
import { channelRefuses, compareValues, conditionHolds, findPictureFlows, flowStartsOn, qualityVerdict, requestMessage } from '../../demo/simulatedPictures.js';

// The picture steps of a SIMULATED conversation (useSimulatedSession): a configuration's "Ask for a picture" opens the
// same card a real call does, a chosen photo or the camera's frames are measured here as the runtime measures them, and
// each step leaves the record a real call has (image, image_analysis, compare), so the call view can be tried too.
// Honest about what it can't do: nothing reads what is on a picture, so "Read a picture" leaves its values empty.
//   push(message), addRecord(event, fields), log(text), later(fn, ms): the session's own
//   agent(): the simulated agent (state, say, setState, end, act)
//   onEnded(): the steps ended the call
//   onAct(out, wait): what the agent did for a step that isn't a picture's (its lines, notes, a form), shown after
//   `wait`; returns the wait after them

const THINK_MS = 380;
const FRAMES = 5; // the runtime keeps the sharpest of about five frames over a second
const QUIET_SMALL = 2; // and retries quietly while a starting camera is still small

export function useSimulatedPictures({ push, addRecord, log, later, agent, onEnded, onAct }) {
  const [picture, setPicture] = useState(null);
  const [cameraOn, setCameraOn] = useState(false);
  const pictureRef = useRef(null);
  const lastKindRef = useRef(null); // the kind of the picture request that ended last (a camera's retake is known by it)
  const waitingRef = useRef(null); // { actions, next, action }: where the steps carry on once the picture is in
  const flowsRef = useRef([]); // the configuration's picture flows (findPictureFlows), each run once
  const ranRef = useRef(new Set());
  const channelRef = useRef(null);
  const configRef = useRef(null);
  const timeoutRef = useRef(0);
  const cameraTimerRef = useRef(0);
  const streamRef = useRef(null);
  // each time the camera is asked for; anything that turns it off (or ends the conversation, or leaves) moves it on, so a
  // camera the browser hands over late (after its permission prompt) is stopped at once instead of left on
  const cameraAskRef = useRef(0);
  const videoRef = useRef(null);
  const heldRef = useRef(new Set()); // picture ids held in the call's memory
  const sentRef = useRef(new Set());
  const thumbsRef = useRef([]);
  const countRef = useRef(0);
  const smallRef = useRef(0);

  // ---- the screen: the same messages a runtime sends on agent-builder.ui
  const tell = useCallback(
    (packet) => {
      const message = readUiMessage(packet);
      const before = pictureRef.current;
      const { request, done } = applyUiMessage(before, message, Date.now(), lastKindRef.current);
      if (done) lastKindRef.current = done.kind;
      else if (before && request && request.id !== before.id) lastKindRef.current = before.kind;
      pictureRef.current = request;
      setPicture(request);
      if (done) push({ role: 'picture', text: '', picture: { kind: done.kind, status: done.status, sent: done.sent } });
    },
    [push],
  );

  const stopCamera = useCallback(() => {
    cameraAskRef.current += 1;
    window.clearTimeout(cameraTimerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }, []);

  // ---- running steps
  const runSteps = useCallback(
    (actions, from = 0, delay = 0) => {
      let wait = delay;
      const steps = Array.isArray(actions) ? actions : [];
      for (let i = from; i < steps.length; i += 1) {
        const action = steps[i];
        const sim = agent();
        if (!sim || !action || typeof action !== 'object') continue;
        const holds = conditionHolds(action.when, sim.state, sim.channel?.id);
        if (holds === false) continue;
        if (holds === null) {
          log('Simulated: a step was skipped, because its condition (“Only when…”) can’t be known in a simulation');
          continue;
        }
        switch (action.type) {
          case 'say': {
            const text = sim.say(action.text);
            if (text) later(() => push({ role: 'bot', text, simulated: true }), (wait += THINK_MS));
            break;
          }
          case 'set_state':
            sim.setState(action.values);
            Object.entries(action.values || {}).forEach(([name, value]) => addRecord('state_changed', { name, value, simulated: true }));
            break;
          case 'request_image': {
            countRef.current += 1;
            const id = `sim_${countRef.current}`;
            if (action.into) sim.setState({ [action.into]: null }); // emptied first, so a retry never sees the last picture
            // a channel that can't take it: refused, as the runtime refuses it, and nothing is shown or asked of the camera
            const refused = channelRefuses(action.kind === 'camera' ? 'camera' : 'upload', channelRef.current);
            if (refused) {
              later(
                () => {
                  addRecord('image', { step: 'request_ended', request_id: id, status: 'not_accepted', simulated: true });
                  push({ role: 'system', text: `Simulated: the agent can’t ask for ${action.kind === 'camera' ? 'the camera' : 'a photo'} here: ${refused}.` });
                  // "If nothing comes in time" runs instead of carrying on; without it, the steps stop here
                  if (Array.isArray(action.on_timeout) && action.on_timeout.length) runSteps(action.on_timeout, 0, 0);
                },
                (wait += THINK_MS),
              );
              return;
            }
            const packet = requestMessage(action, channelRef.current, id, (speech) => sim.say(speech));
            waitingRef.current = { actions: steps, next: i + 1, action, id };
            later(() => {
              addRecord('image', {
                step: 'requested',
                request_id: id,
                kind: packet.kind,
                into: action.into || null,
                timeout_s: packet.timeout_s,
                quality: action.quality || null,
                simulated: true,
              });
              tell(packet);
              smallRef.current = 0;
              window.clearTimeout(timeoutRef.current);
              timeoutRef.current = window.setTimeout(() => {
                const waiting = waitingRef.current;
                if (!waiting || waiting.id !== id) return;
                waitingRef.current = null;
                stopCamera();
                addRecord('image', { step: 'request_ended', request_id: id, status: 'timeout', simulated: true });
                tell({ type: 'request_done', request_id: id, kind: packet.kind, status: 'timeout' });
                // "If nothing comes in time" runs instead of carrying on; without it, the steps stop here
                if (Array.isArray(action.on_timeout) && action.on_timeout.length) runSteps(action.on_timeout, 0, 0);
              }, packet.timeout_s * 1000);
            }, wait + THINK_MS);
            return; // the rest runs once the picture is in
          }
          case 'analyze_image': {
            const fields = Object.keys(action.fields && typeof action.fields === 'object' ? action.fields : {});
            const into = action.into && typeof action.into === 'object' ? action.into : {};
            sim.setState(Object.fromEntries(fields.map((f) => [into[f] || f, null])));
            if (action.ok_into) sim.setState({ [action.ok_into]: false });
            later(
              () => {
                addRecord('image_analysis', { images: action.images || [], fields, read: [], ok: false, tokens: 0, simulated: true });
                push({
                  role: 'system',
                  text: `Simulated: a real agent’s vision model would read ${fields.join(', ') || 'the values'} from the picture. A simulation can’t read pictures, so they stay empty.`,
                });
              },
              (wait += THINK_MS),
            );
            break;
          }
          case 'compare_values': {
            const result = compareValues(action, sim.state);
            const into = action.into && typeof action.into === 'object' ? action.into : {};
            sim.setState({
              ...(into.matched ? { [into.matched]: result.matched } : {}),
              ...(into.score ? { [into.score]: result.score } : {}),
              ...(into.differences ? { [into.differences]: result.differences.join(', ') } : {}),
            });
            later(
              () =>
                addRecord('compare', {
                  matched: result.matched,
                  score: result.score,
                  require: action.require || 'all',
                  pairs: result.pairs.map((p) => ({ label: p.label, matched: p.matched })),
                  simulated: true,
                }),
              (wait += 120),
            );
            break;
          }
          case 'discard_image': {
            const names = (Array.isArray(action.images) ? action.images : []).filter(Boolean);
            const state = sim.state;
            const ids = names.map((n) => state[n]).filter(Boolean);
            ids.forEach((id) => heldRef.current.delete(id));
            sim.setState(Object.fromEntries(names.map((n) => [n, null])));
            // like the server: one record per picture forgotten, by its id
            ids.forEach((id) => later(() => addRecord('image', { step: 'discarded', id, simulated: true }), (wait += 120)));
            break;
          }
          case 'end_call': {
            const text = action.say ? sim.say(action.say) : '';
            if (text) later(() => push({ role: 'bot', text, simulated: true }), (wait += THINK_MS));
            sim.end();
            later(() => onEnded(), wait + THINK_MS);
            return;
          }
          default: {
            // every other step is the agent's own (a form, a hand-over, a transfer…): it runs it, and its lines show
            const out = typeof sim.act === 'function' ? sim.act([action]) : null;
            if (!out) {
              log(`Simulated: the step “${action.type}” is not run in a simulation`);
              break;
            }
            wait = onAct ? onAct(out, wait) : wait;
            if (out.ended) {
              later(() => onEnded(), wait + THINK_MS);
              return;
            }
            if (out.steps.length) {
              runSteps(out.steps, 0, wait);
              return;
            }
          }
        }
      }
    },
    [addRecord, agent, later, log, onEnded, onAct, push, stopCamera, tell],
  );

  // A picture is in: kept in the call's memory under a new id, the request ends, and the steps carry on.
  const receive = useCallback(
    (measured, extra = {}) => {
      const waiting = waitingRef.current;
      if (!waiting) return;
      waitingRef.current = null;
      window.clearTimeout(timeoutRef.current);
      const kind = waiting.action.kind === 'camera' ? 'camera' : 'upload';
      const pictureId = `img_${waiting.id}`;
      heldRef.current.add(pictureId);
      if (waiting.action.into) agent()?.setState({ [waiting.action.into]: pictureId });
      if (kind === 'camera') stopCamera();
      // the server's shape: a picture names its `source` and `id`; the request's end names its `kind`
      addRecord('image', { step: 'received', id: pictureId, source: kind, ...measured, ...extra, simulated: true });
      addRecord('image', { step: 'request_ended', request_id: waiting.id, kind, status: 'received', simulated: true });
      tell({ type: 'request_done', request_id: waiting.id, kind, status: 'received' });
      runSteps(waiting.actions, waiting.next, 0);
    },
    [addRecord, agent, runSteps, stopCamera, tell],
  );
  const reject = useCallback(
    (code, measured = {}) => {
      const waiting = waitingRef.current;
      if (!waiting) return;
      addRecord('image', { step: 'rejected', code, source: waiting.action.kind === 'camera' ? 'camera' : 'upload', ...measured, simulated: true });
      log(`Simulated: the picture was turned down (${rejectedShort(code)})`);
      tell({ type: 'image_rejected', request_id: waiting.id, code, message: REJECTED_WORDS[code] });
    },
    [addRecord, log, tell],
  );

  // ---- the person's side
  const sendImage = useCallback(
    async (file) => {
      if (!file) return '';
      const request = pictureRef.current;
      if (!request) return null; // nothing asked for: the session answers it as a plain picture
      if (request.kind === 'camera') return 'The agent wants the camera now, so a photo chosen from your device is not used. Turn the camera on instead.';
      const problem = uploadProblem(file, request);
      if (problem) return problem;
      const key = fileKey(file);
      if (sentRef.current.has(key)) return 'You have already sent this photo. Choose another one.';
      sentRef.current.add(key);
      let thumb = '';
      try {
        thumb = URL.createObjectURL(file);
        thumbsRef.current.push(thumb);
      } catch {
        /* no preview */
      }
      const sent = { name: file.name, size: file.size, thumb };
      pictureRef.current = { ...request, sent, phase: 'sent', rejection: null };
      setPicture(pictureRef.current);
      const measured = await measureFile(file);
      later(() => {
        if (pictureRef.current?.id !== request.id) return;
        if (measured.error) return reject('not_an_image', { bytes: file.size });
        const facts = { width: measured.width, height: measured.height, bytes: file.size, sharpness: measured.sharpness, brightness: measured.brightness };
        const code = qualityVerdict(waitingRef.current?.action?.quality, measured);
        if (code) return reject(code, facts);
        receive(facts);
      }, 700);
      return '';
    },
    [later, receive, reject],
  );

  // the camera: a few frames over a second, the sharpest kept; tried again until one passes or time runs out
  const takeFrames = useCallback(() => {
    const frames = [];
    const grab = (n) => {
      if (!streamRef.current || !waitingRef.current) return;
      const frame = measureFrame(videoRef.current);
      if (frame) frames.push(frame);
      if (n + 1 < FRAMES) {
        cameraTimerRef.current = window.setTimeout(() => grab(n + 1), 220);
        return;
      }
      const best = frames.sort((a, b) => b.sharpness - a.sharpness)[0];
      if (!best) {
        cameraTimerRef.current = window.setTimeout(() => grab(0), 600);
        return;
      }
      const facts = { width: best.width, height: best.height, sharpness: best.sharpness, brightness: best.brightness, frames: frames.length };
      const code = qualityVerdict(waitingRef.current.action?.quality, best);
      if (code === 'too_small' && smallRef.current < QUIET_SMALL) {
        smallRef.current += 1; // a camera starts small and sharpens: retried quietly at first
      } else if (code) {
        reject(code, facts);
      } else {
        receive(facts);
        return;
      }
      cameraTimerRef.current = window.setTimeout(() => takeFrames(), 1400);
    };
    grab(0);
  }, [receive, reject]);

  const pictureCamera = useCallback(
    async (on) => {
      if (!on) {
        stopCamera();
        return '';
      }
      if (!navigator.mediaDevices?.getUserMedia) return 'This browser can’t use a camera here.';
      const ask = (cameraAskRef.current += 1);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        // turned off, ended or left while the browser asked: this camera isn't wanted any more
        if (ask !== cameraAskRef.current || !waitingRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return '';
        }
        streamRef.current = stream;
        setCameraOn(true);
        cameraTimerRef.current = window.setTimeout(() => takeFrames(), 1200);
        return '';
      } catch (err) {
        return /denied|permission|notallowed/i.test(`${err.name} ${err.message}`)
          ? 'The browser was not allowed to use the camera. Allow it in the address bar, then press Turn on camera again.'
          : `The camera didn’t start: ${err.message}`;
      }
    },
    [stopCamera, takeFrames],
  );
  const attachCamera = useCallback((video) => {
    videoRef.current = video;
    if (video && streamRef.current && video.srcObject !== streamRef.current) {
      video.srcObject = streamRef.current;
      video.play?.().catch(() => {});
    }
  }, []);

  // ---- the conversation's side
  // a new conversation: the configuration's picture steps that a caller's words may start (a tool's or a task's). Those
  // with a trigger of their own run from it: an agent's as it takes over, a form's once it is sent, a transfer's, an
  // event's (the session runs them through the agent).
  const begin = useCallback((config, channel) => {
    configRef.current = config;
    channelRef.current = channel;
    flowsRef.current = findPictureFlows(config).filter((f) => !f.start && ['tools', 'tasks'].includes(f.path[0]));
    ranRef.current = new Set();
  }, []);
  // What the caller said starts a picture flow (a tool's or task's): true when it did, so the session doesn't also reply.
  const onSaid = useCallback(
    (text) => {
      if (pictureRef.current) return false;
      const flow = flowsRef.current.find((f) => !f.start && !ranRef.current.has(f) && flowStartsOn(f, text));
      if (!flow) return false;
      ranRef.current.add(flow);
      log(`Simulated: what you said starts the picture steps of “${flow.label}”`);
      runSteps(flow.actions, 0, 0);
      return true;
    },
    [log, runSteps],
  );
  // the end of a conversation: an open request is cancelled, the camera goes off, the pictures are forgotten
  const reset = useCallback(() => {
    window.clearTimeout(timeoutRef.current);
    stopCamera();
    const open = pictureRef.current;
    if (open) push({ role: 'picture', text: '', picture: { kind: open.kind, status: 'cancelled', sent: open.sent } });
    waitingRef.current = null;
    pictureRef.current = null;
    lastKindRef.current = null;
    setPicture(null);
    heldRef.current = new Set();
    sentRef.current = new Set();
    thumbsRef.current.forEach((url) => URL.revokeObjectURL?.(url));
    thumbsRef.current = [];
  }, [push, stopCamera]);
  const held = useCallback(() => heldRef.current.size, []);
  // leaving the page: the camera goes off, also one still being asked for
  useEffect(
    () => () => {
      cameraAskRef.current += 1;
      window.clearTimeout(cameraTimerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    },
    [],
  );

  return { picture, cameraOn, sendImage, pictureCamera, attachCamera, begin, onSaid, reset, held, runSteps };
}
