import type { TimelineEvent } from '../../api/gatewayTypes.ts';

// The banking gateway's timeline (tool calls, sign-in, bank requests) as records of the Test tab's trace, in the shape
// the runtime's own records have ({ t, seq, elapsed_s, event, ...fields }), so what the gateway decided sits next to
// what the agent did. Names and codes only: the timeline never carries arguments, secrets or account numbers. Pure.

export const GATEWAY_KINDS = ['gateway_tool', 'gateway_sign_in', 'gateway_request', 'gateway_session', 'gateway_note'] as const;

export interface GatewayRecord {
  t: string;
  /** "gw-1", "gw-2"…: apart from the runtime's numbers, so the two can be listed together. */
  seq: string;
  elapsed_s: number;
  event: (typeof GATEWAY_KINDS)[number];
  [field: string]: unknown;
}

const SIGN_IN: Record<string, string> = {
  not_started: 'not signed in',
  anonymous: 'not signed in',
  awaiting_pin: 'waiting for the PIN',
  awaiting_nric: 'waiting for NRIC digits',
  awaiting_otp: 'waiting for the SMS code',
  authenticated: 'verified',
  locked: 'locked',
};

const REQUEST: Record<string, string> = {
  pending: 'waiting for confirmation',
  executing: 'sent to the bank',
  succeeded: 'completed',
  failed: 'failed',
  unknown: 'outcome unknown',
  cancelled: 'cancelled',
  expired: 'expired',
};

const at = (ms: number, startedAt: number) => ({ t: new Date(ms).toISOString(), elapsed_s: Math.max(0, ms - startedAt) / 1000 });

/** One timeline event as a record. `n` numbers the records of one conversation. */
export function recordFromGateway(event: TimelineEvent, startedAt: number, n: number): GatewayRecord {
  const base = { ...at(event.at, startedAt), seq: `gw-${n}` };
  switch (event.type) {
    case 'tool':
      return { ...base, event: 'gateway_tool', tool: event.tool, outcome: event.outcome, code: event.code, ms: event.ms, origin: event.origin };
    case 'auth':
      return { ...base, event: 'gateway_sign_in', state: event.state, failures: event.failures };
    case 'transaction':
      return { ...base, event: 'gateway_request', service: event.service, state: event.state };
    case 'session':
      return { ...base, event: 'gateway_session', state: event.state };
  }
}

/** Something about the gateway itself (not set up, no session for this conversation), as a record. */
export const gatewayNote = (text: string, problem: boolean, startedAt: number, n: number): GatewayRecord => ({
  ...at(Date.now(), startedAt),
  seq: `gw-${n}`,
  event: 'gateway_note',
  text,
  problem,
});

/** Two record lists as one, in time order (a stable sort keeps each list's own order for equal times). */
export function mergeRecords<T extends { elapsed_s?: unknown }>(a: readonly T[], b: readonly T[]): T[] {
  if (!b.length) return [...a];
  if (!a.length) return [...b];
  const time = (r: T) => (typeof r.elapsed_s === 'number' ? r.elapsed_s : 0);
  return [...a, ...b].sort((x, y) => time(x) - time(y));
}

type Row = { label: string; text: string; tone: string; problem: boolean; facts: Array<[string, string]> };

/** A gateway record as a trace row's words (records.js adds the rest); null for any other record. */
export function describeGatewayRecord(r: Record<string, unknown>): Row | null {
  switch (r.event) {
    case 'gateway_tool': {
      const bad = r.outcome === 'failed';
      return {
        label: 'Bank',
        text: `${String(r.tool ?? 'a tool')} ${r.outcome === 'ok' ? 'answered' : r.outcome === 'refused' ? 'was refused' : 'failed'}`,
        tone: bad ? 'bad' : 'plain',
        problem: bad,
        facts: [
          ...(r.code ? ([['code', String(r.code)]] as Array<[string, string]>) : []),
          ['asked by', r.origin === 'channel' ? 'the caller’s screen' : 'the agent'],
        ],
      };
    }
    case 'gateway_sign_in': {
      const state = String(r.state ?? '');
      return {
        label: 'Sign-in',
        text: `Caller ${SIGN_IN[state] ?? state.replace(/_/g, ' ')}`,
        tone: state === 'locked' ? 'bad' : state === 'authenticated' ? 'good' : 'plain',
        problem: state === 'locked',
        facts: typeof r.failures === 'number' && r.failures > 0 ? [['failed attempts', String(r.failures)]] : [],
      };
    }
    case 'gateway_request': {
      const state = String(r.state ?? '');
      const bad = state === 'failed' || state === 'unknown';
      return {
        label: 'Bank',
        text: `${String(r.service ?? 'A request').replace(/_/g, ' ')}: ${REQUEST[state] ?? state}`,
        tone: bad ? 'bad' : state === 'succeeded' ? 'good' : 'plain',
        problem: bad,
        facts: [],
      };
    }
    case 'gateway_session':
      return { label: 'Bank', text: `Banking session ${r.state === 'ended' ? 'ended' : 'started'}`, tone: 'muted', problem: false, facts: [] };
    case 'gateway_note':
      return { label: 'Bank', text: String(r.text ?? ''), tone: r.problem ? 'bad' : 'muted', problem: Boolean(r.problem), facts: [] };
    default:
      return null;
  }
}
