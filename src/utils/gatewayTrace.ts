import type { TimelineEvent } from '../api/gatewayTypes';
import type { TraceEvent } from '../types/testConsole';

// Turns the banking gateway's timeline (tool calls, sign-in state, transactions) into rows of the Test stage's live
// trace, so what the gateway decided sits next to what the model did. Names and codes only: the timeline never
// carries arguments, secrets or account numbers.

const AUTH_LABEL: Record<string, string> = {
  anonymous: 'not signed in',
  awaiting_pin: 'waiting for the PIN',
  awaiting_nric: 'waiting for NRIC digits',
  awaiting_otp: 'waiting for the SMS code',
  authenticated: 'verified',
  locked: 'locked',
};

const TXN_LABEL: Record<string, string> = {
  pending: 'waiting for confirmation',
  executing: 'sent to the bank',
  succeeded: 'completed',
  failed: 'failed',
  unknown: 'outcome unknown',
  cancelled: 'cancelled',
  expired: 'expired',
};

export function traceFromGateway(event: TimelineEvent, startedAt: number, id: string): TraceEvent {
  const at_ms = Math.max(0, event.at - startedAt);
  switch (event.type) {
    case 'tool':
      return {
        id,
        at_ms,
        kind: 'tool',
        label: `Gateway · ${event.tool}`,
        detail: [event.outcome, event.code, `${event.ms} ms`, event.origin === 'channel' ? 'from the caller\'s screen' : 'from the agent'].filter(Boolean).join(' · '),
        status: event.outcome === 'ok' ? 'ok' : event.outcome === 'failed' ? 'error' : 'info',
      };
    case 'auth':
      return { id, at_ms, kind: 'session', label: `Gateway · sign-in ${AUTH_LABEL[event.state] ?? event.state}`, detail: `failed attempts: ${event.failures}`, status: event.state === 'locked' ? 'error' : event.state === 'authenticated' ? 'ok' : 'info' };
    case 'transaction':
      return {
        id,
        at_ms,
        kind: 'tool',
        label: `Gateway · ${event.service.replace(/_/g, ' ')} ${TXN_LABEL[event.state] ?? event.state}`,
        status: event.state === 'succeeded' ? 'ok' : event.state === 'failed' || event.state === 'unknown' ? 'error' : 'info',
      };
    case 'session':
      return { id, at_ms, kind: 'session', label: `Gateway · session ${event.state}`, status: 'info' };
  }
}
