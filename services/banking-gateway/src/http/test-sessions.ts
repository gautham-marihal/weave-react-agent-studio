// STUDIO TEST SESSIONS ON THE BANK'S REAL SYSTEMS. Opt-in (STUDIO_TEST_SESSIONS=on, src/main.ts) for a gateway that
// runs on a bank's real systems, so Weave Studio can hold a banking test conversation on them from a browser, as it
// does on the mock bank (mock/rehearsal.ts), before the Agent Builder runtime can reach this gateway.
//
// The same paths as the mock's rehearsal routes, so Studio needs one client; on real systems they do less:
//   POST /dev/rehearsals                       start a session; returns its call id, room and a channel token
//   POST /dev/rehearsals/{call_id}/end         end it (as the runtime's call_ended event would)
//   GET  /dev/rehearsals/{call_id}/sms         always empty: real SMS go to the customer's real phone
//   GET  /dev/test-logins                      always empty: there are no test logins on real systems
//   POST /dev/rehearsals/{call_id}/host-fault  refused: faults are staged on the mock bank only
//   GET  /dev/rehearsals/{call_id}/account-details  refused: full account numbers never go to a screen (O13)
//
// Everything that matters stays as on a real call: the customer signs in with their own credentials on the secure
// keypad, the state machine, entitlements, confirmations and audit all apply. All routes need the runtime token, and
// channel tokens are minted with a secret generated for this run only: with a real LIVEKIT_API_SECRET these routes
// are off (main.ts), since a token minted with it would be a real room token.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Orchestrator } from '../orchestrator/orchestrator.ts';
import { safeEqual, signLiveKitToken } from '../security/crypto.ts';

export const TEST_SESSION_PREFIX = 'rehearsal_';
const TOKEN_TTL_S = 3600;

export interface TestSessionOptions {
  readonly gatewayToken: string;
  /** The channel-token secret generated for this run (never a real LiveKit secret). */
  readonly mintSecret: string;
  /** Words for Studio's test-logins panel: where sign-in details come from on these systems. */
  readonly loginsNote: string;
  readonly clock?: () => number;
}

/** Returns a handler that answers /dev/ routes (true) or leaves the request to the gateway (false). */
export function testSessionRoutes(orchestrator: Orchestrator, options: TestSessionOptions) {
  const clock = options.clock ?? Date.now;
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const path = new URL(req.url ?? '/', 'http://gateway.invalid').pathname;
    if (!path.startsWith('/dev/')) return false;
    const method = req.method ?? 'GET';
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer ') || !safeEqual(header.slice(7), options.gatewayToken)) return send(res, 401, { error: 'unauthorised', message: 'A valid runtime token is required' });

    if (method === 'POST' && path === '/dev/rehearsals') {
      const body = await readJson(req);
      const channel = body.channel === 'web_voice' ? 'web_voice' : 'web_chat';
      const callId = `${TEST_SESSION_PREFIX}${randomUUID().replace(/-/g, '')}`;
      orchestrator.startSession({ callId, room: callId, channel, callerId: null, language: 'en' });
      const channelToken = signLiveKitToken({ identity: 'studio-test', room: callId, ttlS: TOKEN_TTL_S }, options.mintSecret, clock());
      return send(res, 201, { call_id: callId, room: callId, channel, channel_token: channelToken, expires_in_s: TOKEN_TTL_S, hosts: orchestrator.hosts });
    }
    if (method === 'GET' && path === '/dev/test-logins') return send(res, 200, { logins: [], otp_source: options.loginsNote });

    const match = /^\/dev\/rehearsals\/([^/]+)\/(sms|host-fault|end|account-details)$/.exec(path);
    const callId = match ? decodeURIComponent(match[1] as string) : '';
    if (!match || !callId.startsWith(TEST_SESSION_PREFIX)) return send(res, 404, { error: 'not_found', message: 'Not found' });
    if (!orchestrator.sessionForCall(callId)) return send(res, 404, { error: 'no_session', message: 'No test session with this id' });

    if (method === 'GET' && match[2] === 'sms') return send(res, 200, { messages: [] });
    if (method === 'GET' && match[2] === 'account-details') return send(res, 403, { error: 'real_hosts', message: 'Full account numbers are not shown from the bank’s real systems.' });
    if (method === 'POST' && match[2] === 'host-fault') return send(res, 403, { error: 'real_hosts', message: 'Host faults can be staged on the mock bank only, never on the bank’s real systems.' });
    if (method === 'POST' && match[2] === 'end') {
      await orchestrator.endSession(callId);
      return send(res, 200, { ended: true });
    }
    return send(res, 404, { error: 'not_found', message: 'Not found' });
  };
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 4096) return {};
    chunks.push(chunk as Buffer);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function send(res: ServerResponse, status: number, body: unknown): true {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
  return true;
}
