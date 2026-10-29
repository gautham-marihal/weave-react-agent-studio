// Typed client for the banking gateway (services/banking-gateway), reached through the /gateway proxy.
// The proxy adds the runtime token to the few read-only routes Studio may use (src/utils/gatewayProxy.ts). Channel
// routes carry the caller's own LiveKit room token, which this client passes as given and never stores.

import type {
  AccountDetails,
  CaptureOutcome,
  CaptureRequest,
  ChannelActionResult,
  ChannelEvent,
  ChannelState,
  GatewayHealth,
  GeneratedAgentConfig,
  ManifestTool,
  Rehearsal,
  TestLogin,
  TimelineEvent,
  ToolResponse,
} from './gatewayTypes.ts';

const BASE = '/gateway';

export type GatewayErrorKind = 'not_configured' | 'unreachable' | 'unauthorised' | 'not_found' | 'refused' | 'rate_limited' | 'server';

export class GatewayError extends Error {
  readonly status: number;
  readonly kind: GatewayErrorKind;
  /** The gateway's own error code (e.g. no_session, nothing_to_enter), when it sent one. */
  readonly code: string | null;

  constructor(status: number, kind: GatewayErrorKind, message: string, code: string | null = null) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
    this.kind = kind;
    this.code = code;
  }
}

export function classifyGateway(status: number, body: unknown): GatewayError {
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const code = typeof record.error === 'string' ? record.error : null;
  const message = typeof record.message === 'string' ? record.message : `The banking service answered ${status}.`;
  if (status === 503 && code === 'gateway_not_configured')
    return new GatewayError(status, 'not_configured', 'The banking gateway is not set up for this Studio.', code);
  if (status === 0 || status === 502 || status === 504) return new GatewayError(status, 'unreachable', 'The banking gateway is not reachable.', code);
  if (status === 401) return new GatewayError(status, 'unauthorised', 'The banking gateway did not accept the credentials.', code);
  if (status === 404) return new GatewayError(status, 'not_found', message, code);
  if (status === 429) return new GatewayError(status, 'rate_limited', 'Too many attempts in a short time. Wait a minute and try again.', code);
  if (status === 400 || status === 403 || status === 409 || status === 415) return new GatewayError(status, 'refused', message, code);
  return new GatewayError(status, 'server', 'The banking gateway had a problem with this request.', code);
}

async function call<T>(
  method: 'GET' | 'POST',
  path: string,
  { token, body, callId, signal }: { token?: string; body?: unknown; callId?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (callId) headers['X-Call-Id'] = callId;
  if (method === 'POST') headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { method, headers, signal, body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new GatewayError(0, 'unreachable', 'The banking gateway is not reachable.');
  }
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // An HTML page here means /gateway is not proxied at all (no BANKING_GATEWAY_URL on an older dev server).
    throw new GatewayError(response.status, 'not_configured', 'The banking gateway is not set up for this Studio.');
  }
  if (!response.ok) throw classifyGateway(response.status, data);
  return data as T;
}

export const gateway = {
  health: (signal?: AbortSignal) => call<GatewayHealth>('GET', '/health', { signal }),
  manifest: async (signal?: AbortSignal) => (await call<{ tools: ManifestTool[] }>('GET', '/v1/tools', { signal })).tools,
  agentConfig: (signal?: AbortSignal) => call<GeneratedAgentConfig>('GET', '/v1/agent-config', { signal }),

  // The caller's device. `token` is the LiveKit room token of the conversation (or a rehearsal's channel token).
  channel: {
    state: (token: string, signal?: AbortSignal) => call<ChannelState>('GET', '/v1/channel/state', { token, signal }),
    identify: (token: string, identifier: { phone_code: string } | { account_number: string }) =>
      call<ChannelActionResult>('POST', '/v1/channel/identify', { token, body: identifier }),
    resendOtp: (token: string) => call<ChannelActionResult>('POST', '/v1/channel/otp/resend', { token }),
    restart: (token: string) => call<ChannelActionResult>('POST', '/v1/channel/restart', { token }),
    reissueCapture: async (token: string) => (await call<{ capture: CaptureRequest }>('POST', '/v1/channel/capture/reissue', { token })).capture,
    /** `value` goes straight into the request body and nowhere else. */
    capture: (token: string, captureToken: string, value: string) =>
      call<CaptureOutcome>('POST', '/v1/channel/capture', { token, body: { token: captureToken, value } }),
    confirm: (token: string, confirmationId: string, decision: 'confirm' | 'cancel') =>
      call<ToolResponse>('POST', '/v1/channel/confirm', { token, body: { confirmation_id: confirmationId, decision } }),
  },

  // Mock gateway only, behind BANKING_GATEWAY_REHEARSALS=on.
  rehearsal: {
    start: (channel: 'web_chat' | 'web_voice' = 'web_chat') => call<Rehearsal>('POST', '/dev/rehearsals', { body: { channel } }),
    sms: async (callId: string, signal?: AbortSignal) =>
      (await call<{ messages: Array<{ text: string }> }>('GET', `/dev/rehearsals/${encodeURIComponent(callId)}/sms`, { signal })).messages,
    hostFault: (callId: string, fault: { method: string; kind: 'error' | 'hang'; code?: string }) =>
      call<{ armed: string }>('POST', `/dev/rehearsals/${encodeURIComponent(callId)}/host-fault`, { body: fault }),
    end: (callId: string) => call<{ ended: boolean }>('POST', `/dev/rehearsals/${encodeURIComponent(callId)}/end`, {}),
    /** The documented mock test logins (README "Test logins"). */
    testLogins: (signal?: AbortSignal) => call<{ logins: TestLogin[]; otp_source: string }>('GET', '/dev/test-logins', { signal }),
    /** The verified rehearsal customer's own accounts in full, for the eye icon. 409 until verified. */
    accountDetails: (callId: string, signal?: AbortSignal) =>
      call<AccountDetails>('GET', `/dev/rehearsals/${encodeURIComponent(callId)}/account-details`, { signal }),
    /** Staff play the runtime's part. The proxy forwards tool calls for rehearsal sessions only. */
    runTool: (callId: string, tool: string, args: Record<string, unknown>) =>
      call<ToolResponse>('POST', `/v1/tools/${encodeURIComponent(tool)}`, { callId, body: args }),
  },
};

/** Parses a server-sent event stream into (event, data) pairs. Exported for tests. */
export function parseSse(buffer: string): { events: Array<{ event: string; data: string }>; rest: string } {
  const events: Array<{ event: string; data: string }> = [];
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? '';
  for (const block of blocks) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (data.length) events.push({ event, data: data.join('\n') });
  }
  return { events, rest };
}

/**
 * Follows a gateway event stream. EventSource cannot send an Authorization header, so this reads SSE over fetch.
 * Resolves when the stream ends; rejects with a GatewayError if it cannot open. Stop it with the signal.
 */
async function follow<T>(path: string, token: string | undefined, onEvent: (event: T) => void, onOpen: () => void, signal: AbortSignal): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { headers: { Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    throw new GatewayError(0, 'unreachable', 'The banking gateway is not reachable.');
  }
  if (!response.ok || !response.body) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    throw classifyGateway(response.status, body);
  }
  onOpen();
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      const parsed = parseSse(buffer + value);
      buffer = parsed.rest;
      for (const e of parsed.events) {
        try {
          onEvent(JSON.parse(e.data) as T);
        } catch {
          // A malformed event is skipped; the stream carries on.
        }
      }
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    throw new GatewayError(0, 'unreachable', 'The connection to the banking gateway dropped.');
  }
}

export const followChannel = (token: string, onEvent: (e: ChannelEvent) => void, onOpen: () => void, signal: AbortSignal) =>
  follow<ChannelEvent>('/v1/channel/events', token, onEvent, onOpen, signal);
export const followRoomTimeline = (room: string, onEvent: (e: TimelineEvent) => void, onOpen: () => void, signal: AbortSignal) =>
  follow<TimelineEvent>(`/v1/rooms/${encodeURIComponent(room)}/timeline`, undefined, onEvent, onOpen, signal);
