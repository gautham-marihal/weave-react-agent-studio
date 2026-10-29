import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Channel, Language } from '../domain/types.ts';
import type { Orchestrator } from '../orchestrator/orchestrator.ts';
import { ProtocolError } from '../orchestrator/orchestrator.ts';
import { newId, safeEqual, verifyLiveKitToken } from '../security/crypto.ts';
import type { GatewayEvent } from '../session/events.ts';
import type { ToolDefinition } from '../tools/define.ts';
import { manifest, toAgentConfigTools } from '../tools/registry.ts';

// HTTP surface. Two kinds of caller, two kinds of credential:
//   - the Agent Builder runtime and Weave Studio (server to server): `Authorization: Bearer <GATEWAY_TOKEN>`;
//   - the caller's device (chat widget, mobile app, Studio test console): `Authorization: Bearer <LiveKit token>`,
//     which proves it is a participant in that call's room. It can only reach its own session's channel routes.
//
//   GET  /health
//   GET  /v1/tools                       tool manifest (Studio node library)              runtime token
//   GET  /v1/agent-config                generated `tools`/`connections` for the agent    runtime token
//   POST /v1/sessions                    call start {call_id, room, channel, ...}         runtime token
//                                        (channel = the runtime's channel.type: sip_voice, web_voice, web_chat, custom)
//   POST /v1/sessions/end                call end {call_id}                               runtime token
//   POST /v1/tools/{name}                execute a tool (header X-Call-Id)                runtime token
//   GET  /v1/sessions/{call_id}/timeline server-sent events for Studio Test/Monitor       runtime token
//   GET  /v1/rooms/{room}/timeline       the same, found by LiveKit room (Studio Test)    runtime token
//   GET  /v1/channel/events              server-sent events: keypads, confirmations       LiveKit token
//   GET  /v1/channel/state               sign-in state, methods, help, profile, pending   LiveKit token
//   POST /v1/channel/identify            {phone_code} | {account_number}                  LiveKit token
//   POST /v1/channel/otp/resend          a fresh SMS one-time password                    LiveKit token
//   POST /v1/channel/restart             start sign-in again, or sign out                 LiveKit token
//   POST /v1/channel/capture/reissue     a fresh keypad for the step in progress          LiveKit token
//   POST /v1/channel/capture             {token, value}: PIN / NRIC / OTP                 LiveKit token
//   POST /v1/channel/confirm             {confirmation_id, decision}                      LiveKit token

export interface ServerConfig {
  readonly gatewayToken: string;
  readonly liveKitApiSecret: string | null;
  /** Browser origins allowed to call the channel routes (CORS). Empty = no browser access. */
  readonly channelOrigins: readonly string[];
  readonly maxBodyBytes?: number;
  readonly clock?: () => number;
}

const CHANNELS: readonly Channel[] = ['sip_voice', 'web_voice', 'web_chat', 'custom'];

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Fixed-window limiter per key. Enough for one instance; use the gateway/WAF limiter in front of several. */
class RateLimiter {
  readonly #hits = new Map<string, { count: number; resetAt: number }>();
  readonly #limit: number;
  readonly #windowMs: number;
  constructor(limit: number, windowMs: number) {
    this.#limit = limit;
    this.#windowMs = windowMs;
  }
  allow(key: string, now: number): boolean {
    const entry = this.#hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.#hits.set(key, { count: 1, resetAt: now + this.#windowMs });
      if (this.#hits.size > 10_000) for (const [k, v] of this.#hits) if (v.resetAt <= now) this.#hits.delete(k);
      return true;
    }
    entry.count += 1;
    return entry.count <= this.#limit;
  }
}

export function createGatewayServer(orchestrator: Orchestrator, registry: ReadonlyMap<string, ToolDefinition>, config: ServerConfig): Server {
  if (config.gatewayToken.length < 32) throw new Error('GATEWAY_TOKEN must be at least 32 characters');
  const clock = config.clock ?? Date.now;
  const maxBody = config.maxBodyBytes ?? 16 * 1024;
  const captureLimiter = new RateLimiter(10, 60_000);
  const sweeper = setInterval(() => orchestrator.sweep(), 60_000);
  sweeper.unref();

  const server = createServer(async (req, res) => {
    const requestId = newId('req');
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      await route(req, res);
    } catch (error) {
      const status = error instanceof HttpError || error instanceof ProtocolError ? error.status : 500;
      const code = error instanceof HttpError || error instanceof ProtocolError ? error.code : 'internal';
      const message = status === 500 ? 'Internal error' : (error as Error).message;
      if (!res.headersSent) send(res, status, { error: code, message, request_id: requestId });
      else res.end();
    }
  });
  server.on('close', () => clearInterval(sweeper));
  return server;

  async function route(req: IncomingMessage, res: ServerResponse) {
    // eslint-disable-next-line sonarjs/no-clear-text-protocols -- only a base to parse the request path against; never contacted
    const url = new URL(req.url ?? '/', 'http://gateway.invalid');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    if (path.startsWith('/v1/channel/')) {
      if (!cors(req, res)) throw new HttpError(403, 'origin_not_allowed', 'Origin not allowed');
      if (method === 'OPTIONS') return void res.writeHead(204).end();
      const session = channelSession(req);
      if (method === 'GET' && path === '/v1/channel/events') return stream(req, res, session, 'channel');
      if (method === 'GET' && path === '/v1/channel/state') return send(res, 200, orchestrator.channelState(session));
      if (method === 'POST' && path === '/v1/channel/identify') {
        if (!captureLimiter.allow(session, clock())) throw new HttpError(429, 'rate_limited', 'Too many attempts');
        const body = await readJson(req);
        // Exactly one identifier. The tool schema validates it again (digits, length) without echoing the value.
        const hasPhone = body.phone_code !== undefined;
        if (hasPhone === (body.account_number !== undefined)) throw new HttpError(400, 'bad_request', 'Send exactly one of phone_code or account_number');
        const value = text(hasPhone ? body.phone_code : body.account_number, 32, hasPhone ? 'phone_code' : 'account_number');
        return send(res, 200, await orchestrator.identifyFromChannel(session, hasPhone ? { phone_code: value } : { account_number: value }));
      }
      if (method === 'POST' && path === '/v1/channel/otp/resend') {
        if (!captureLimiter.allow(session, clock())) throw new HttpError(429, 'rate_limited', 'Too many attempts');
        return send(res, 200, await orchestrator.resendOtpFromChannel(session));
      }
      if (method === 'POST' && path === '/v1/channel/restart') return send(res, 200, await orchestrator.restartFromChannel(session));
      if (method === 'POST' && path === '/v1/channel/capture/reissue') {
        if (!captureLimiter.allow(session, clock())) throw new HttpError(429, 'rate_limited', 'Too many attempts');
        return send(res, 200, { capture: await orchestrator.reissueCapture(session) });
      }
      if (method === 'POST' && path === '/v1/channel/capture') {
        if (!captureLimiter.allow(session, clock())) throw new HttpError(429, 'rate_limited', 'Too many attempts');
        const body = await readJson(req);
        const token = text(body.token, 64, 'token');
        const value = text(body.value, 32, 'value');
        const outcome = await orchestrator.submitCapture(session, token, value);
        return send(res, 200, outcome);
      }
      if (method === 'POST' && path === '/v1/channel/confirm') {
        const body = await readJson(req);
        const decision = body.decision === 'confirm' || body.decision === 'cancel' ? body.decision : null;
        if (!decision) throw new HttpError(400, 'bad_request', 'decision must be confirm or cancel');
        return send(res, 200, await orchestrator.confirmFromChannel(session, text(body.confirmation_id, 40, 'confirmation_id'), decision));
      }
      throw new HttpError(404, 'not_found', 'Not found');
    }

    if (method === 'GET' && path === '/health') return send(res, 200, { ok: true, policy_approved: orchestrator.policy.approved, hosts: orchestrator.hosts });

    requireRuntime(req);
    if (method === 'GET' && path === '/v1/tools') return send(res, 200, { tools: manifest(registry) });
    if (method === 'GET' && path === '/v1/agent-config') return send(res, 200, toAgentConfigTools(registry));
    if (method === 'POST' && path === '/v1/sessions') {
      const body = await readJson(req);
      const channel = CHANNELS.find((c) => c === body.channel);
      if (!channel) throw new HttpError(400, 'bad_request', `channel must be one of ${CHANNELS.join(', ')}`);
      const language: Language = body.language === 'zh' ? 'zh' : 'en';
      const session = orchestrator.startSession({
        callId: text(body.call_id, 128, 'call_id'),
        room: body.room ? text(body.room, 128, 'room') : null,
        channel,
        callerId: body.caller_id ? text(body.caller_id, 32, 'caller_id') : null,
        language,
      });
      return send(res, 201, { session_id: session.id });
    }
    if (method === 'POST' && path === '/v1/sessions/end') {
      const body = await readJson(req);
      await orchestrator.endSession(text(body.call_id, 128, 'call_id'));
      return send(res, 200, { ended: true });
    }
    const tool = /^\/v1\/tools\/([a-z0-9_]+)$/.exec(path);
    if (method === 'POST' && tool) {
      const callId = req.headers['x-call-id'];
      if (typeof callId !== 'string' || !callId) throw new HttpError(400, 'bad_request', 'X-Call-Id header is required');
      const body = await readJson(req);
      return send(res, 200, await orchestrator.executeTool(callId, tool[1] as string, body));
    }
    const timeline = /^\/v1\/sessions\/([^/]+)\/timeline$/.exec(path);
    if (method === 'GET' && timeline) {
      const callId = decodeURIComponent(timeline[1] as string);
      const session = orchestrator.sessionForCall(callId);
      if (!session) throw new HttpError(404, 'no_session', 'No session for this call');
      return stream(req, res, session.id, 'timeline');
    }
    const roomTimeline = /^\/v1\/rooms\/([^/]+)\/timeline$/.exec(path);
    if (method === 'GET' && roomTimeline) {
      const session = orchestrator.sessionForRoom(decodeURIComponent(roomTimeline[1] as string));
      if (!session) throw new HttpError(404, 'no_session', 'No session for this room');
      return stream(req, res, session.id, 'timeline');
    }
    throw new HttpError(404, 'not_found', 'Not found');
  }

  function requireRuntime(req: IncomingMessage) {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token || !safeEqual(token, config.gatewayToken)) throw new HttpError(401, 'unauthorised', 'A valid runtime token is required');
  }

  /** Resolves the caller's device to its session through the LiveKit token's room claim. */
  function channelSession(req: IncomingMessage): string {
    if (!config.liveKitApiSecret) throw new HttpError(503, 'channel_disabled', 'Channel routes need LIVEKIT_API_SECRET');
    const header = req.headers.authorization ?? '';
    const claims = header.startsWith('Bearer ') ? verifyLiveKitToken(header.slice(7), config.liveKitApiSecret, clock()) : null;
    if (!claims) throw new HttpError(401, 'unauthorised', 'A valid call token is required');
    const session = orchestrator.sessionForRoom(claims.room);
    if (!session || session.ended) throw new HttpError(404, 'no_session', 'No active session for this call');
    return session.id;
  }

  function cors(req: IncomingMessage, res: ServerResponse): boolean {
    const origin = req.headers.origin;
    if (!origin) return true; // native apps and server-to-server
    if (!config.channelOrigins.includes(origin)) return false;
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    return true;
  }

  function stream(req: IncomingMessage, res: ServerResponse, sessionId: string, audience: GatewayEvent['audience']) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': connected\n\n');
    const unsubscribe = orchestrator.subscribe(sessionId, audience, (event) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    req.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  }

  async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
    const type = req.headers['content-type'] ?? '';
    if (!type.startsWith('application/json')) throw new HttpError(415, 'unsupported_media_type', 'Content-Type must be application/json');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > maxBody) throw new HttpError(413, 'too_large', 'Request body too large');
      chunks.push(chunk as Buffer);
    }
    try {
      const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
      return parsed as Record<string, unknown>;
    } catch {
      throw new HttpError(400, 'bad_json', 'Body must be a JSON object');
    }
  }
}

function text(value: unknown, max: number, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new HttpError(400, 'bad_request', `${field} is required (text, at most ${max} characters)`);
  return value.trim();
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
