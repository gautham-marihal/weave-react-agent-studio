import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createGateway } from '../app.ts';
import type { Ports } from '../ports/ports.ts';
import { createGatewayServer } from './server.ts';
import { testSessionRoutes } from './test-sessions.ts';

const TOKEN = 'runtime-token-runtime-token-runtime-token';
const SECRET = 'generated-for-this-run-only-0123456789';

// Ports are never reached by these routes; a gateway on real systems is all they need.
const noPorts = new Proxy({}, { get: () => new Proxy({}, { get: () => async () => { throw new Error('not used'); } }) }) as unknown as Ports;

let server: Server | null = null;
afterEach(() => server?.close());

async function start() {
  const { orchestrator, registry } = createGateway({ ports: noPorts, hosts: 'live', auditSinks: [] });
  const gateway = createGatewayServer(orchestrator, registry, { gatewayToken: TOKEN, liveKitApiSecret: SECRET, channelOrigins: [] });
  const routes = testSessionRoutes(orchestrator, { gatewayToken: TOKEN, mintSecret: SECRET, loginsNote: 'Sign in with your own details.' });
  server = createServer((req, res) => void routes(req, res).then((handled) => handled || gateway.emit('request', req, res)));
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown, auth: string | null = TOKEN) => {
    const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  return { call };
}

describe('Studio test sessions on real systems', () => {
  it('needs the runtime token', async () => {
    const { call } = await start();
    expect((await call('POST', '/dev/rehearsals', {}, null)).status).toBe(401);
    expect((await call('GET', '/dev/test-logins', undefined, 'wrong')).status).toBe(401);
  });

  it('starts a session whose channel token works on the channel routes, and ends it', async () => {
    const { call } = await start();
    const started = await call('POST', '/dev/rehearsals', { channel: 'web_voice' });
    expect(started.status).toBe(201);
    expect(started.body).toMatchObject({ channel: 'web_voice', hosts: 'live' });
    const callId = started.body.call_id as string;
    expect(callId).toMatch(/^rehearsal_[a-f0-9]{32}$/);

    const state = await fetch(`http://127.0.0.1:${(server!.address() as AddressInfo).port}/v1/channel/state`, { headers: { Authorization: `Bearer ${started.body.channel_token as string}` } });
    expect(state.status).toBe(200);
    expect(((await state.json()) as { hosts: string }).hosts).toBe('live');

    expect(await call('POST', `/dev/rehearsals/${callId}/end`)).toEqual({ status: 200, body: { ended: true } });
  });

  it('has no test logins or SMS, and refuses host faults and full account numbers', async () => {
    const { call } = await start();
    expect(await call('GET', '/dev/test-logins')).toEqual({ status: 200, body: { logins: [], otp_source: 'Sign in with your own details.' } });
    const callId = (await call('POST', '/dev/rehearsals', {})).body.call_id as string;
    expect(await call('GET', `/dev/rehearsals/${callId}/sms`)).toEqual({ status: 200, body: { messages: [] } });
    expect((await call('POST', `/dev/rehearsals/${callId}/host-fault`, { method: 'getBalance' })).status).toBe(403);
    expect((await call('GET', `/dev/rehearsals/${callId}/account-details`)).status).toBe(403);
    expect((await call('GET', '/dev/rehearsals/rehearsal_00000000000000000000000000000000/sms')).status).toBe(404);
  });
});
