// Which banking-gateway requests the dev/preview proxy (/gateway) lets through, and with which credential. Used by
// vite.config.ts (Node), so no DOM here.
//
// The gateway has two credentials (services/banking-gateway/src/http/server.ts):
//   - the runtime token (BANKING_GATEWAY_TOKEN), which can run any tool for any call. It must never reach the
//     browser, so the proxy adds it, and only for the read-only routes Studio needs: the tool manifest, the generated
//     config and the timeline streams;
//   - the caller's LiveKit room token, which the browser already holds for its own test conversation. Channel routes
//     pass it through unchanged; the gateway checks it.
// Everything else is refused here. Rehearsals (mock gateway only) are off unless BANKING_GATEWAY_REHEARSALS=on, and
// then tool calls are allowed only for rehearsal sessions, never for a real call.

export type GatewayRoute = 'runtime' | 'channel' | 'deny';

/** Studio's own read-only route under /gateway: the gateway address the agent runtime uses (never forwarded). */
export const RUNTIME_ADDRESS_PATH = '/_studio/address';

/**
 * The address a deployed banking agent calls (its `banking_gateway_url`), from the Studio server's environment:
 * BANKING_GATEWAY_RUNTIME_URL when the runtime reaches the gateway at another address than this server does (a public
 * one), otherwise BANKING_GATEWAY_URL. '' when neither is an http(s) address. Studio fills it into banking agents
 * itself, so nobody types it.
 */
export function runtimeGatewayAddress(env: Record<string, string | undefined>): string {
  for (const value of [env.BANKING_GATEWAY_RUNTIME_URL, env.BANKING_GATEWAY_URL]) {
    const address = (value ?? '').trim().replace(/\/+$/, '');
    if (/^https?:\/\/[^\s/]+/.test(address)) return address;
  }
  return '';
}

export const REHEARSAL_CALL_PREFIX = 'rehearsal_';

/** `path` is the gateway path (after /gateway is removed). `callId` is the request's X-Call-Id header. */
export function gatewayRoute(method: string, path: string, callId: string | string[] | undefined, rehearsals: boolean): GatewayRoute {
  const rawPath = path.split('?')[0] ?? '';
  const pathname = rawPath.replace(/^\/gateway/, '').replace(/\/+$/, '') || '/';
  if (pathname.includes('..') || pathname.includes('//')) return 'deny';
  if (pathname.startsWith('/v1/channel/')) return method === 'GET' || method === 'POST' || method === 'OPTIONS' ? 'channel' : 'deny';
  if (method === 'GET') {
    if (pathname === '/health' || pathname === '/v1/tools' || pathname === '/v1/agent-config') return 'runtime';
    if (/^\/v1\/(rooms|sessions)\/[^/]+\/timeline$/.test(pathname)) return 'runtime';
    if (rehearsals && /^\/dev\/rehearsals\/rehearsal_[a-f0-9]{32}\/(sms|account-details)$/.test(pathname)) return 'runtime';
    if (rehearsals && pathname === '/dev/test-logins') return 'runtime';
    return 'deny';
  }
  if (method !== 'POST' || !rehearsals) return 'deny';
  if (pathname === '/dev/rehearsals') return 'runtime';
  if (/^\/dev\/rehearsals\/rehearsal_[a-f0-9]{32}\/(host-fault|end)$/.test(pathname)) return 'runtime';
  const id = Array.isArray(callId) ? callId[0] : callId;
  if (/^\/v1\/tools\/[a-z0-9_]+$/.test(pathname) && typeof id === 'string' && /^rehearsal_[a-f0-9]{32}$/.test(id)) return 'runtime';
  return 'deny';
}
