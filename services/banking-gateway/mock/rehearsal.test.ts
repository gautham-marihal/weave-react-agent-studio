import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGateway } from '../src/app.ts';
import { createGatewayServer } from '../src/http/server.ts';
import { createMockPorts } from './adapters.ts';
import { rehearsalRoutes } from './rehearsal.ts';

// The device routes and the mock-only rehearsal routes over a real socket, mounted the way mock/main.ts mounts them.

const RUNTIME = 'r'.repeat(40);
const SECRET = 'generated-for-this-run';

function mount(mintSecret: string | null) {
  const { ports, controls } = createMockPorts();
  const { orchestrator, registry } = createGateway({ ports, auditSinks: [], hosts: 'mock' });
  const gateway = createGatewayServer(orchestrator, registry, { gatewayToken: RUNTIME, liveKitApiSecret: SECRET, channelOrigins: [] });
  const dev = rehearsalRoutes(orchestrator, controls, { gatewayToken: RUNTIME, mintSecret });
  return createServer((req, res) => {
    void dev(req, res).then((handled) => {
      if (!handled) gateway.emit('request', req, res);
    });
  });
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
  return `http://localhost:${(server.address() as AddressInfo).port}`;
}

describe('rehearsals and device routes over HTTP', () => {
  const server = mount(SECRET);
  let base = '';
  beforeAll(async () => {
    base = await listen(server);
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const runtime = (path: string, body?: unknown) =>
    fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${RUNTIME}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const device = (token: string, path: string, body?: unknown) =>
    fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

  it('needs the runtime token to start a rehearsal', async () => {
    expect((await fetch(`${base}/dev/rehearsals`, { method: 'POST' })).status).toBe(401);
  });

  it('runs a whole Phone Code sign-in from the device and reports mock hosts', async () => {
    const started = (await (await runtime('/dev/rehearsals', { channel: 'web_chat' })).json()) as { call_id: string; room: string; channel_token: string; hosts: string };
    expect(started.call_id).toMatch(/^rehearsal_[a-f0-9]{32}$/);
    expect(started.hosts).toBe('mock');
    const token = started.channel_token;

    expect(await (await fetch(`${base}/health`)).json()).toMatchObject({ hosts: 'mock', policy_approved: false });
    const before = (await (await device(token, '/v1/channel/state')).json()) as { auth: { state: string } };
    expect(before.auth.state).toBe('not_started');

    expect((await device(token, '/v1/channel/identify', { phone_code: '1234567', account_number: '500000000201' })).status).toBe(400);
    const identified = (await (await device(token, '/v1/channel/identify', { phone_code: '1234567' })).json()) as { state: { auth: { state: string } } };
    expect(identified.state.auth.state).toBe('awaiting_pin');

    const { capture } = (await (await device(token, '/v1/channel/capture/reissue', {})).json()) as { capture: { token: string; purpose: string } };
    expect(capture.purpose).toBe('pin');
    expect(await (await device(token, '/v1/channel/capture', { token: capture.token, value: '135790' })).json()).toMatchObject({ accepted: true });
    const after = (await (await device(token, '/v1/channel/state')).json()) as { auth: { state: string }; profile: { accounts: unknown[] } };
    expect(after.auth.state).toBe('authenticated');
    expect(after.profile.accounts).toHaveLength(3);

    // The Studio timeline can be found by room. It is a stream; check it opens, then close it.
    const controller = new AbortController();
    const timeline = await fetch(`${base}/v1/rooms/${started.room}/timeline`, { headers: { Authorization: `Bearer ${RUNTIME}` }, signal: controller.signal });
    expect(timeline.status).toBe(200);
    expect(timeline.headers.get('content-type')).toContain('text/event-stream');
    controller.abort();

    expect(await (await runtime(`/dev/rehearsals/${started.call_id}/end`, {})).json()).toEqual({ ended: true });
    expect((await device(token, '/v1/channel/state')).status).toBe(404);
  });

  it('shows the mock SMS for the session\'s own customer only, and arms host faults', async () => {
    const started = (await (await runtime('/dev/rehearsals', {})).json()) as { call_id: string; channel_token: string };
    const sms = async () => ((await (await runtime(`/dev/rehearsals/${started.call_id}/sms`)).json()) as { messages: Array<{ text: string }> }).messages;
    expect(await sms()).toEqual([]);
    await device(started.channel_token, '/v1/channel/identify', { account_number: '500000000201' });
    const { capture } = (await (await device(started.channel_token, '/v1/channel/capture/reissue', {})).json()) as { capture: { token: string } };
    await device(started.channel_token, '/v1/channel/capture', { token: capture.token, value: '1234567' });
    expect((await sms())[0]?.text).toMatch(/^Your one-time password is \d{6}$/);

    expect((await runtime(`/dev/rehearsals/${started.call_id}/host-fault`, { method: 'nope' })).status).toBe(400);
    expect((await runtime(`/dev/rehearsals/${started.call_id}/host-fault`, { method: 'getBalance', kind: 'hang' })).status).toBe(400);
    expect(await (await runtime(`/dev/rehearsals/${started.call_id}/host-fault`, { method: 'stopCheques', kind: 'error', code: '196' })).json()).toEqual({ armed: 'stopCheques', kind: 'error' });
    // Only rehearsal sessions can be reached.
    expect((await runtime('/dev/rehearsals/call-1/sms')).status).toBe(404);

    // A later rehearsal for the same customer sees only its own SMS, not the earlier rehearsal's code.
    const next = (await (await runtime('/dev/rehearsals', {})).json()) as { call_id: string; channel_token: string };
    await device(next.channel_token, '/v1/channel/identify', { account_number: '500000000201' });
    const keypad = (await (await device(next.channel_token, '/v1/channel/capture/reissue', {})).json()) as { capture: { token: string } };
    await device(next.channel_token, '/v1/channel/capture', { token: keypad.capture.token, value: '1234567' });
    const nextSms = ((await (await runtime(`/dev/rehearsals/${next.call_id}/sms`)).json()) as { messages: Array<{ text: string }> }).messages;
    expect(nextSms).toHaveLength(1);
    expect(nextSms[0]?.text).not.toBe((await sms())[0]?.text);
  });

  it('lists the documented test logins, behind the runtime token', async () => {
    expect((await fetch(`${base}/dev/test-logins`)).status).toBe(401);
    const { logins } = (await (await runtime('/dev/test-logins')).json()) as { logins: Array<{ method: string; identifier: string; secret: string; otp: boolean }> };
    expect(logins).toContainEqual(expect.objectContaining({ method: 'phonecode_pin', identifier: '1234567', secret: '135790', otp: false }));
    expect(logins).toContainEqual(expect.objectContaining({ method: 'account_nric_otp', identifier: '500000000201', secret: '1234567', otp: true }));
  });

  it('gives full account details only to a verified rehearsal caller, for their own accounts', async () => {
    const started = (await (await runtime('/dev/rehearsals', {})).json()) as { call_id: string; channel_token: string };
    const details = () => runtime(`/dev/rehearsals/${started.call_id}/account-details`);
    expect((await details()).status).toBe(409);
    await device(started.channel_token, '/v1/channel/identify', { phone_code: '1234567' });
    const { capture } = (await (await device(started.channel_token, '/v1/channel/capture/reissue', {})).json()) as { capture: { token: string } };
    await device(started.channel_token, '/v1/channel/capture', { token: capture.token, value: '135790' });
    const body = (await (await details()).json()) as { display_name: string; accounts: Array<{ account_ref: string; number: string; currencies: string[] }> };
    expect(body.display_name).toBe('Acme Trading Pte Ltd');
    expect(body.accounts.map((a) => [a.account_ref, a.number])).toEqual([
      ['A1', '500000000101'],
      ['A2', '500000000102'],
      ['A3', '500000000103'],
    ]);
    expect((await runtime('/dev/rehearsals/call-1/account-details')).status).toBe(404);
  });
});

describe('rehearsals with a real LiveKit secret', () => {
  const server = mount(null);
  let base = '';
  beforeAll(async () => {
    base = await listen(server);
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('are off, because they would mint real room tokens', async () => {
    const response = await fetch(`${base}/dev/rehearsals`, { method: 'POST', headers: { Authorization: `Bearer ${RUNTIME}` } });
    expect(response.status).toBe(503);
  });
});
