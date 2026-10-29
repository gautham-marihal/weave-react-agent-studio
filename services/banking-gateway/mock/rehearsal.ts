// MOCK-ONLY REHEARSAL ROUTES. Lets Weave Studio exercise the real gateway (state machine, secure capture,
// confirmations, timeline) from a browser before the Agent Builder runtime can reach it: staff play the runtime's part
// (tool calls) and the caller's device (sign-in panel, keypad, confirmation card) against a real session.
//
//   POST /dev/rehearsals                       start a session; returns its call id, room and a channel token
//   GET  /dev/rehearsals/{call_id}/sms         the mock SMS outbox for that session's customer (stands in for a phone)
//   POST /dev/rehearsals/{call_id}/host-fault  {method, kind: 'error' | 'hang', code?}: the next host call fails
//   POST /dev/rehearsals/{call_id}/end         end the session (as the runtime's call_ended event would)
//   GET  /dev/rehearsals/{call_id}/account-details  the verified customer's own accounts in full (Studio's eye icon)
//   GET  /dev/test-logins                      the documented test logins (README "Test logins")
//
// Account details: the production gateway never sends a full account number to a screen (open decision O13). In a
// rehearsal the numbers are mock host data, so Studio may show them on request, for the verified customer only.
//
// Mounted only by mock/main.ts, which refuses NODE_ENV=production, and only when the LiveKit secret was generated for
// this run: a channel token minted with a real LiveKit secret would be a real room token.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Orchestrator } from '../src/orchestrator/orchestrator.ts';
import { HostError } from '../src/ports/ports.ts';
import { safeEqual, signLiveKitToken } from '../src/security/crypto.ts';
import type { MockControls } from './adapters.ts';
import { MOCK_TEST_LOGINS } from './fixtures.ts';

export const REHEARSAL_PREFIX = 'rehearsal_';
const TOKEN_TTL_S = 3600;
const FAULT_METHODS = [
  'loginWithPhoneCode',
  'verifyAccountAndNric',
  'otpSend',
  'getBalance',
  'incomingFunds',
  'recentTransactions',
  'chequebooks',
  'stopCheques',
  'requestStatement',
  'requestChequebook',
  'primeRate',
  'fxRate',
  'timeDepositRates',
] as const;
const HANG_METHODS = ['stopCheques', 'requestStatement', 'requestChequebook'];

export interface RehearsalOptions {
  readonly gatewayToken: string;
  /** The secret this run generated for channel tokens; null disables the routes (a real secret was configured). */
  readonly mintSecret: string | null;
  readonly clock?: () => number;
}

/** Returns a handler that answers /dev/ routes (true) or leaves the request to the gateway (false). */
export function rehearsalRoutes(orchestrator: Orchestrator, controls: MockControls, options: RehearsalOptions) {
  const clock = options.clock ?? Date.now;
  // Where the shared mock SMS outbox stood when each rehearsal started: its phone shows only what came after.
  const outboxStart = new Map<string, number>();

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const path = new URL(req.url ?? '/', 'http://gateway.invalid').pathname;
    if (!path.startsWith('/dev/')) return false;
    const method = req.method ?? 'GET';
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer ') || !safeEqual(header.slice(7), options.gatewayToken))
      return send(res, 401, { error: 'unauthorised', message: 'A valid runtime token is required' });
    if (!options.mintSecret)
      return send(res, 503, { error: 'rehearsal_disabled', message: 'Rehearsals need the generated channel secret; LIVEKIT_API_SECRET is set.' });

    if (method === 'POST' && path === '/dev/rehearsals') {
      const body = await readJson(req);
      const channel = body.channel === 'web_voice' ? 'web_voice' : 'web_chat';
      const callId = `${REHEARSAL_PREFIX}${randomUUID().replace(/-/g, '')}`;
      orchestrator.startSession({ callId, room: callId, channel, callerId: null, language: 'en' });
      outboxStart.set(callId, controls.otpOutbox.length);
      const channelToken = signLiveKitToken({ identity: 'studio-rehearsal', room: callId, ttlS: TOKEN_TTL_S }, options.mintSecret, clock());
      return send(res, 201, { call_id: callId, room: callId, channel, channel_token: channelToken, expires_in_s: TOKEN_TTL_S, hosts: orchestrator.hosts });
    }

    if (method === 'GET' && path === '/dev/test-logins')
      return send(res, 200, { logins: MOCK_TEST_LOGINS, otp_source: 'The Phone (SMS codes) panel beside the conversation, and the gateway console.' });

    const match = /^\/dev\/rehearsals\/([^/]+)\/(sms|host-fault|end|account-details)$/.exec(path);
    const callId = match ? decodeURIComponent(match[1] as string) : '';
    if (!match || !callId.startsWith(REHEARSAL_PREFIX)) return send(res, 404, { error: 'not_found', message: 'Not found' });
    const session = orchestrator.sessionForCall(callId);
    if (!session) return send(res, 404, { error: 'no_session', message: 'No rehearsal with this id' });

    if (method === 'GET' && match[2] === 'sms') {
      const auth = session.auth;
      const customerId = auth.kind === 'awaiting_otp' || auth.kind === 'authenticated' ? auth.customer.customerId : null;
      const sent = controls.otpOutbox.slice(outboxStart.get(callId) ?? controls.otpOutbox.length);
      const messages = customerId ? sent.filter((m) => m.customerId === customerId).map((m) => ({ text: `Your one-time password is ${m.otp}` })) : [];
      return send(res, 200, { messages });
    }
    if (method === 'GET' && match[2] === 'account-details') {
      const auth = session.auth;
      if (auth.kind !== 'authenticated') return send(res, 409, { error: 'not_authenticated', message: 'The caller is not verified.' });
      // Only the accounts this session handed out references for: the same set the caller's screen lists.
      const accounts = Object.entries(session.accountRefs).flatMap(([ref, number]) => {
        const account = auth.customer.accounts.find((a) => a.number === number);
        return account
          ? [
              {
                account_ref: ref,
                number: account.number,
                type: account.type,
                currencies: account.currencies,
                dormant: account.dormant,
                omnibus: account.omnibus,
              },
            ]
          : [];
      });
      return send(res, 200, {
        display_name: auth.customer.displayName,
        customer_id: auth.customer.customerId,
        segment: auth.customer.segment,
        role: auth.customer.role,
        accounts,
      });
    }
    if (method === 'POST' && match[2] === 'host-fault') {
      const body = await readJson(req);
      const target = FAULT_METHODS.find((m) => m === body.method);
      if (!target) return send(res, 400, { error: 'bad_request', message: `method must be one of ${FAULT_METHODS.join(', ')}` });
      if (body.kind === 'hang') {
        if (!HANG_METHODS.includes(target)) return send(res, 400, { error: 'bad_request', message: `hang is available for ${HANG_METHODS.join(', ')}` });
        controls.hangNext(target);
      } else {
        const code = typeof body.code === 'string' && /^[a-z0-9_]{1,20}$/i.test(body.code) ? body.code : 'unavailable';
        const system = target === 'verifyAccountAndNric' ? 'siebel' : target === 'otpSend' ? 'otp' : 'as400';
        controls.failNext(target, new HostError(system, code));
      }
      return send(res, 200, { armed: target, kind: body.kind === 'hang' ? 'hang' : 'error' });
    }
    if (method === 'POST' && match[2] === 'end') {
      await orchestrator.endSession(callId);
      outboxStart.delete(callId);
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
