// Typed client for the banking gateway (services/banking-gateway), reached through the /gateway proxy.
// The proxy adds the runtime token to the few read-only routes Studio may use (src/utils/gatewayProxy.ts). Channel
// routes carry the caller's own LiveKit room token, which this client passes as given and never stores.
//
// Where the calls go (bankingSource) depends on the data source:
//   Live     a gateway on the bank's real systems when one answers. Without one, the mock bank, exactly as in
//            Sandbox, and every screen says so ("Mock bank · test data"): banking agents work end to end in both.
//   Sandbox  always the mock bank.
// The mock bank is the gateway server when it answers and lets Studio start test sessions; otherwise the same gateway,
// built from services/banking-gateway, running in this browser on its mock bank (src/sandbox/banking, loaded on use).
// Test sessions Studio starts itself (rehearsals: the tool runner, a banking rehearsal conversation, test logins) run
// where rehearsalSource() says: in Live, on the bank's real systems when the gateway on them opens test sessions
// (STUDIO_TEST_SESSIONS=on, e.g. the CIMB gateway), otherwise on the mock bank; in Sandbox always on the mock bank.
// Their routes, and every call made with a token, call or room a rehearsal handed out, go to rehearsalSource().

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
} from './gatewayTypes';
import { isSandbox } from '../sandbox/mode';

const BASE = '/gateway';

export type GatewayErrorKind = 'not_configured' | 'unreachable' | 'unavailable' | 'unauthorised' | 'not_found' | 'refused' | 'rate_limited' | 'server';

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
  if (status === 503 && code === 'gateway_not_configured') return new GatewayError(status, 'not_configured', 'The banking gateway is not set up for this Studio.', code);
  if (status === 0 || status === 502 || status === 504) return new GatewayError(status, 'unreachable', 'The banking gateway is not reachable.', code);
  if (status === 401) return new GatewayError(status, 'unauthorised', 'The banking gateway did not accept the credentials.', code);
  if (status === 404) return new GatewayError(status, 'not_found', message, code);
  if (status === 429) return new GatewayError(status, 'rate_limited', 'Too many attempts in a short time. Wait a minute and try again.', code);
  if (status === 400 || status === 403 || status === 409 || status === 415) return new GatewayError(status, 'refused', message, code);
  return new GatewayError(status, 'server', 'The banking gateway had a problem with this request.', code);
}

// ---- where banking calls go -----------------------------------------------------------------------------------

/** Which data source the studio runs on (src/sandbox/mode.ts), carried so the words can be pure. */
export type StudioMode = 'live' | 'sandbox';

export type BankingSource =
  /** The gateway server; `hosts` says whether it is on the bank's real systems or on mock ones. */
  | { kind: 'gateway'; hosts: 'live' | 'mock'; studio: StudioMode }
  /** The gateway's own code in this browser, on its mock bank. */
  | { kind: 'browser'; hosts: 'mock'; studio: StudioMode };

/** Whether banking answers are test data from the mock bank (anything but a gateway on the bank's real systems). */
export const isMockBank = (source: BankingSource): boolean => source.hosts !== 'live';

let sourcePromise: Promise<BankingSource> | null = null;
let rehearsalPromise: Promise<BankingSource> | null = null;

/** Where banking calls go on this page (asked once; switching the data source reloads the page). */
export function bankingSource(): Promise<BankingSource> {
  sourcePromise ||= resolveSource();
  return sourcePromise;
}

/**
 * Where Studio's own test sessions (rehearsals) go. The same as bankingSource() on the mock bank. On a gateway on the
 * bank's real systems (Live only), that gateway when it opens test sessions (its /dev/test-logins answers: the CIMB
 * gateway with STUDIO_TEST_SESSIONS=on), so a rehearsal signs in a real customer and reads their real accounts;
 * otherwise the mock bank in this browser.
 */
export function rehearsalSource(): Promise<BankingSource> {
  rehearsalPromise ||= bankingSource().then(async (s): Promise<BankingSource> => {
    if (isMockBank(s)) return s;
    try {
      await fetchCall('GET', '/dev/test-logins');
      return s;
    } catch {
      return { kind: 'browser', hosts: 'mock', studio: s.studio };
    }
  });
  return rehearsalPromise;
}

/** Asks again (after the gateway was started or set up). */
export function forgetBankingSource(): void {
  sourcePromise = null;
  rehearsalPromise = null;
}

async function resolveSource(): Promise<BankingSource> {
  const studio: StudioMode = isSandbox() ? 'sandbox' : 'live';
  let health: GatewayHealth | null = null;
  try {
    health = await fetchCall<GatewayHealth>('GET', '/health');
  } catch {
    // no gateway server answers: the mock bank in this browser
  }
  // Live: the bank's real systems whenever a gateway on them answers
  if (studio === 'live' && health?.hosts === 'live') return { kind: 'gateway', hosts: 'live', studio };
  if (health) {
    try {
      // Sandbox (or a gateway that is not on real systems): a mock gateway server that lets Studio start its own test
      // sessions. A gateway on real systems is never Sandbox's, even when it opens test sessions.
      if (health.hosts !== 'live') {
        await fetchCall('GET', '/dev/test-logins');
        return { kind: 'gateway', hosts: 'mock', studio };
      }
    } catch {
      // no test sessions there: the gateway in this browser
    }
  }
  return { kind: 'browser', hosts: 'mock', studio };
}

/** Where a banking answer came from, in words for the screen. Live says "Mock bank" first whenever it is test data. */
export function bankingSourceLabel(source: BankingSource): string {
  if (source.hosts === 'live') return 'Banking gateway · the bank’s real systems';
  if (source.studio === 'live')
    return source.kind === 'browser' ? 'Mock bank · banking gateway in this browser, test data only' : 'Mock bank · banking gateway on mock bank systems, test data only';
  return source.kind === 'browser' ? 'Sandbox · banking gateway in this browser, mock bank systems' : 'Banking gateway · mock bank systems, test data only';
}

let addressPromise: Promise<string> | null = null;

/**
 * The gateway address a deployed banking agent calls (its banking_gateway_url), as the Studio server is set up
 * (BANKING_GATEWAY_RUNTIME_URL, else BANKING_GATEWAY_URL; src/utils/gatewayProxy.ts). Studio fills it in when it makes
 * or refreshes a banking agent, so nobody types it. '' when this Studio has no gateway server.
 */
export function runtimeAddress(): Promise<string> {
  addressPromise ||= fetch(`${BASE}/_studio/address`, { headers: { Accept: 'application/json' } })
    .then(async (response) => {
      if (!response.ok) return '';
      const body = (await response.json()) as { address?: unknown };
      return typeof body.address === 'string' && /^https?:\/\/\S+$/.test(body.address) ? body.address : '';
    })
    .catch(() => '');
  return addressPromise;
}

// What rehearsals handed out on this page: calls made with them belong to the rehearsal, so they go where it went.
const rehearsalTokens = new Set<string>();
const rehearsalCalls = new Set<string>();
const rehearsalRooms = new Set<string>();

/** Where one call goes: a rehearsal's own routes and anything carrying what a rehearsal handed out, to the mock bank. */
function sourceFor(path: string, ids: { token?: string; callId?: string; room?: string } = {}): Promise<BankingSource> {
  const rehearsal =
    path.startsWith('/dev/') ||
    (!!ids.token && rehearsalTokens.has(ids.token)) ||
    (!!ids.callId && rehearsalCalls.has(ids.callId)) ||
    (!!ids.room && rehearsalRooms.has(ids.room));
  return rehearsal ? rehearsalSource() : bankingSource();
}

type BrowserGateway = import('../sandbox/banking/gatewayInBrowser.js').BrowserGateway;
let browserGateway: Promise<BrowserGateway> | null = null;
const inBrowser = (): Promise<BrowserGateway> => {
  browserGateway ||= import('../sandbox/banking/gatewayInBrowser.js').then((m) => m.createBrowserGateway());
  return browserGateway;
};

async function call<T>(method: 'GET' | 'POST', path: string, options: { token?: string; body?: unknown; callId?: string; signal?: AbortSignal } = {}): Promise<T> {
  const source = await sourceFor(path, options);
  if (source.kind === 'gateway') return fetchCall<T>(method, path, options);
  const gw = await inBrowser();
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.callId) headers['X-Call-Id'] = options.callId;
  const answer = await gw.request({ method, path, headers, body: method === 'POST' ? JSON.stringify(options.body ?? {}) : undefined });
  const data: unknown = answer.body ? JSON.parse(answer.body) : null;
  if (answer.status >= 400) throw classifyGateway(answer.status, data);
  return data as T;
}

async function fetchCall<T>(method: 'GET' | 'POST', path: string, { token, body, callId, signal }: { token?: string; body?: unknown; callId?: string; signal?: AbortSignal } = {}): Promise<T> {
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
  let data: unknown = null;
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
    identify: (token: string, identifier: { phone_code: string } | { account_number: string }) => call<ChannelActionResult>('POST', '/v1/channel/identify', { token, body: identifier }),
    resendOtp: (token: string) => call<ChannelActionResult>('POST', '/v1/channel/otp/resend', { token }),
    restart: (token: string) => call<ChannelActionResult>('POST', '/v1/channel/restart', { token }),
    reissueCapture: async (token: string) => (await call<{ capture: CaptureRequest }>('POST', '/v1/channel/capture/reissue', { token })).capture,
    /** `value` goes straight into the request body and nowhere else. */
    capture: (token: string, captureToken: string, value: string) => call<CaptureOutcome>('POST', '/v1/channel/capture', { token, body: { token: captureToken, value } }),
    confirm: (token: string, confirmationId: string, decision: 'confirm' | 'cancel') => call<ToolResponse>('POST', '/v1/channel/confirm', { token, body: { confirmation_id: confirmationId, decision } }),
  },

  // The mock bank only (rehearsalSource): the gateway server behind BANKING_GATEWAY_REHEARSALS=on, or the one in this browser.
  rehearsal: {
    start: async (channel: 'web_chat' | 'web_voice' = 'web_chat') => {
      const rehearsal = await call<Rehearsal>('POST', '/dev/rehearsals', { body: { channel } });
      rehearsalTokens.add(rehearsal.channel_token);
      rehearsalCalls.add(rehearsal.call_id);
      rehearsalRooms.add(rehearsal.room);
      return rehearsal;
    },
    sms: async (callId: string, signal?: AbortSignal) => (await call<{ messages: Array<{ text: string }> }>('GET', `/dev/rehearsals/${encodeURIComponent(callId)}/sms`, { signal })).messages,
    hostFault: (callId: string, fault: { method: string; kind: 'error' | 'hang'; code?: string }) => call<{ armed: string }>('POST', `/dev/rehearsals/${encodeURIComponent(callId)}/host-fault`, { body: fault }),
    end: (callId: string) => call<{ ended: boolean }>('POST', `/dev/rehearsals/${encodeURIComponent(callId)}/end`, {}),
    /** The documented mock test logins (README "Test logins"). */
    testLogins: (signal?: AbortSignal) => call<{ logins: TestLogin[]; otp_source: string }>('GET', '/dev/test-logins', { signal }),
    /** The verified rehearsal customer's own accounts in full, for the eye icon. 409 until verified. */
    accountDetails: (callId: string, signal?: AbortSignal) => call<AccountDetails>('GET', `/dev/rehearsals/${encodeURIComponent(callId)}/account-details`, { signal }),
    /** Staff play the runtime's part. The proxy forwards tool calls for rehearsal sessions only. */
    runTool: (callId: string, tool: string, args: Record<string, unknown>) => call<ToolResponse>('POST', `/v1/tools/${encodeURIComponent(tool)}`, { callId, body: args }),
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
async function follow<T>(path: string, token: string | undefined, onEvent: (event: T) => void, onOpen: () => void, signal: AbortSignal, room?: string): Promise<void> {
  const source = await sourceFor(path, { token, room });
  if (source.kind === 'browser') return followInBrowser(path, token, onEvent, onOpen, signal);
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { headers: { Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    throw new GatewayError(0, 'unreachable', 'The banking gateway is not reachable.');
  }
  if (!response.ok || !response.body) {
    let body: unknown = null;
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

/** The same stream from the gateway in this browser. */
async function followInBrowser<T>(path: string, token: string | undefined, onEvent: (event: T) => void, onOpen: () => void, signal: AbortSignal): Promise<void> {
  const gw = await inBrowser();
  if (signal.aborted) return;
  let buffer = '';
  const live = gw.stream({ method: 'GET', path, headers: token ? { Authorization: `Bearer ${token}` } : {} }, (text) => {
    const parsed = parseSse(buffer + text);
    buffer = parsed.rest;
    for (const e of parsed.events) {
      try {
        onEvent(JSON.parse(e.data) as T);
      } catch {
        // A malformed event is skipped; the stream carries on.
      }
    }
  });
  const opened = await live.opened;
  if (opened.status !== 200) {
    live.stop();
    throw classifyGateway(opened.status, opened.body ? JSON.parse(opened.body) : null);
  }
  onOpen();
  await new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });
  live.stop();
}

export const followChannel = (token: string, onEvent: (e: ChannelEvent) => void, onOpen: () => void, signal: AbortSignal) => follow<ChannelEvent>('/v1/channel/events', token, onEvent, onOpen, signal);
export const followRoomTimeline = (room: string, onEvent: (e: TimelineEvent) => void, onOpen: () => void, signal: AbortSignal) =>
  follow<TimelineEvent>(`/v1/rooms/${encodeURIComponent(room)}/timeline`, undefined, onEvent, onOpen, signal, room);
