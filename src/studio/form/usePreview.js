import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { assemblePrompt } from './promptPreview.js';
import { fromApproximate, normalizePrompt, normalizeResultPreview, promptRequest, withLocalOffset } from './serverPreview.js';

// The server's previews: what the model would be told (`POST /preview/prompt`) and what one tool would send and show the model
// (`POST /preview/result`). They call nothing and spend nothing, and read what is in the editor, saved or not. A change is sent after a
// short pause (400 ms) so typing doesn't ask on every key. If the server can't be asked, the prompt falls back to the studio's own
// APPROXIMATE copy and says so (`source`): the answer is never presented as exact when it is not.
const PAUSE_MS = 400;

// source: 'server' (exact) | 'demo' (an imitation) | 'approximate' (built here, the server could not be asked)
export function usePromptPreview({ config, agentId, channel = '', state, nowLocal = '', callerPhone = '', enabled = true }) {
  const [result, setResult] = useState({ data: null, loading: false, error: null, source: '', note: '' });
  const stateKey = JSON.stringify(state ?? null); // small; the config is compared by identity (it changes when something in it does)
  useEffect(() => {
    if (!enabled || !agentId || !config) return undefined;
    const controller = new AbortController();
    setResult((old) => ({ ...old, loading: true }));
    const timer = setTimeout(async () => {
      try {
        const raw = await api.previewPrompt(promptRequest({ config, agent: agentId, channel, state, now: withLocalOffset(nowLocal), callerPhone }), { signal: controller.signal });
        if (controller.signal.aborted) return;
        setResult({ data: normalizePrompt(raw), loading: false, error: null, source: raw?.demo ? 'demo' : 'server', note: typeof raw?.note === 'string' ? raw.note : '' });
      } catch (error) {
        if (error?.name === 'AbortError' || controller.signal.aborted) return;
        const local = assemblePrompt(config, agentId, { channelId: channel });
        setResult({ data: local ? fromApproximate(local, config) : null, loading: false, error, source: 'approximate', note: '' });
      }
    }, PAUSE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, config, agentId, channel, stateKey, nowLocal, callerPhone]);
  return result;
}

// What one tool would send and what the model would be shown of an answer. `response` is the sample answer (any JSON, even null);
// leave it `undefined` to ask only about the request.
export function useResultPreview({ config, tool, args, response, state, channel = '', nowLocal = '', enabled = true }) {
  const [result, setResult] = useState({ data: null, loading: false, error: null, source: '', note: '' });
  const stateKey = JSON.stringify(state ?? null);
  useEffect(() => {
    if (!enabled || !tool || !config) return undefined;
    const controller = new AbortController();
    setResult((old) => ({ ...old, loading: true }));
    const timer = setTimeout(async () => {
      try {
        const body = { config, tool, args: args || {}, ...(state && Object.keys(state).length ? { state } : {}), ...(channel ? { channel } : {}), ...(nowLocal ? { now: withLocalOffset(nowLocal) } : {}) };
        if (response !== undefined) body.response = response;
        const raw = await api.previewResult(body, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setResult({ data: normalizeResultPreview(raw), loading: false, error: null, source: raw?.demo ? 'demo' : 'server', note: typeof raw?.note === 'string' ? raw.note : '' });
      } catch (error) {
        if (error?.name === 'AbortError' || controller.signal.aborted) return;
        setResult({ data: null, loading: false, error, source: '', note: '' });
      }
    }, PAUSE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, config, tool, args, response, stateKey, channel, nowLocal]);
  return result;
}
