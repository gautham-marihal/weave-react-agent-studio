// Which banking-gateway requests the dev/preview proxy (/gateway) lets through, and with which credential. Used by
// vite.config.js (Node), so no DOM here.
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
