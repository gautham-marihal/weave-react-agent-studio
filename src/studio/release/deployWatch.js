import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.ts';

// Following a deployment that came back "pending" until it is active or failed (the API guide: a deploy may become a
// slow job that answers 202 and is polled at GET /bots/{id}/deployments/{deployment_id}). Used wherever a version is
// put live: the Deploy page, the publish panel's "Put it live in Development" and the guided setup's last step.

export const POLL_MS = 2000;
// asking again can't help with these: the deployment is gone, the key is wrong, the request itself is refused, or the
// answer isn't one this app can read
const FINAL_KINDS = new Set(['not_found', 'auth', 'invalid', 'client_bug', 'unexpected']);
// a dropped connection or a restarting server is asked again, but not for ever: 15 misses in a row is 30 seconds
export const MAX_MISSES = 15;

// After a failed check: keep asking ('retry') or stop and say so ('stop').
export const afterMiss = (error, misses) => (FINAL_KINDS.has(error?.kind) || misses >= MAX_MISSES ? 'stop' : 'retry');

// The deployment in an answer: GET .../deployments/{id} may answer the deployment itself or { deployment, ... }.
export const deploymentOf = (answer) => (answer && typeof answer === 'object' ? answer.deployment || answer : null);

// Why a deployment failed, when the server says (the guide names no field yet, so the usual ones are read).
export function failureReason(deployment) {
  if (!deployment || typeof deployment !== 'object') return '';
  for (const key of ['error', 'detail', 'reason', 'message']) {
    const value = deployment[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object' && typeof value.message === 'string' && value.message.trim()) return value.message.trim();
  }
  return '';
}

// Asks how a pending deployment is going every POLL_MS, one request at a time, and hands each answer to onChange.
// It stops by itself once the deployment is no longer pending (the caller passes the new one in), and on an error
// asking again can't fix. checkError: why it stopped asking; retry(): ask again.
export function useDeploymentWatch(botId, deployment, onChange) {
  const id = deployment?.status === 'pending' ? deployment.id : null;
  const [stopped, setStopped] = useState(null); // { id, error }: the deployment it gave up on, and why
  const [round, setRound] = useState(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!id) return undefined;
    let timer = 0;
    let misses = 0;
    const controller = new AbortController();
    const ask = async () => {
      try {
        const next = deploymentOf(await api.getDeployment(botId, id, { signal: controller.signal }));
        if (controller.signal.aborted) return;
        misses = 0;
        if (next) onChangeRef.current?.(next);
        if (!next || next.status === 'pending') timer = window.setTimeout(ask, POLL_MS);
      } catch (error) {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        misses += 1;
        if (afterMiss(error, misses) === 'stop') setStopped({ id, error });
        else timer = window.setTimeout(ask, POLL_MS);
      }
    };
    timer = window.setTimeout(ask, POLL_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [botId, id, round]);

  const checkError = stopped && stopped.id === id ? stopped.error : null;
  return {
    checkError,
    retry: () => {
      setStopped(null);
      setRound((n) => n + 1);
    },
  };
}
