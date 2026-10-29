import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGateway } from '../src/app.ts';
import { createGatewayServer } from '../src/http/server.ts';
import { signLiveKitToken } from '../src/security/crypto.ts';
import { createMockPorts } from './adapters.ts';

// The HTTP surface, over a real socket: runtime token for server routes, LiveKit token for the caller's device.

const RUNTIME = 'r'.repeat(40);
const LIVEKIT = 'livekit-test-secret';
const ORIGIN = 'http://localhost:5173';

describe('gateway HTTP API', () => {
  const { ports, controls } = createMockPorts();
  const { orchestrator, registry } = createGateway({ ports, auditSinks: [] });
  const server = createGatewayServer(orchestrator, registry, { gatewayToken: RUNTIME, liveKitApiSecret: LIVEKIT, channelOrigins: [ORIGIN] });
  let base = '';

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const runtime = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${RUNTIME}`, 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const device = (room: string, path: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${signLiveKitToken({ identity: 'u', room, ttlS: 60 }, LIVEKIT, Date.now())}`, 'Content-Type': 'application/json', Origin: ORIGIN },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it('requires the runtime token, compared in constant time', async () => {
    expect((await fetch(`${base}/v1/tools`)).status).toBe(401);
    expect((await fetch(`${base}/v1/tools`, { headers: { Authorization: `Bearer ${'x'.repeat(40)}` } })).status).toBe(401);
    expect((await runtime('/v1/tools')).status).toBe(200);
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it('runs a whole PhoneCode login across runtime and device, with the keypad delivered over the event stream', async () => {
    expect((await runtime('/v1/sessions', { call_id: 'h1', room: 'room-h1', channel: 'web_chat' })).status).toBe(201);

    // The device opens its event stream first.
    const stream = await device('room-h1', '/v1/channel/events');
    expect(stream.headers.get('content-type')).toBe('text/event-stream');
    const reader = stream.body!.getReader();

    const start = await (await runtime('/v1/tools/start_authentication', { phone_code: '1234567' }, { 'X-Call-Id': 'h1' })).json();
    expect(start).toMatchObject({ ok: true, status: 'awaiting_pin' });
    expect(JSON.stringify(start)).not.toContain('token');

    let text = '';
    while (!text.includes('capture_requested')) text += new TextDecoder().decode((await reader.read()).value);
    const token = /"token":"([^"]+)"/.exec(text)?.[1];
    expect(token).toBeTruthy();
    await reader.cancel();

    // A device in another room cannot use it.
    await runtime('/v1/sessions', { call_id: 'h2', room: 'room-h2', channel: 'web_chat' });
    expect(await (await device('room-h2', '/v1/channel/capture', { token, value: '135790' })).json()).toMatchObject({ accepted: false });
    // ...but issuing nothing new there, the original device still can, once.
    expect(await (await device('room-h1', '/v1/channel/capture', { token, value: '135790' })).json()).toMatchObject({ accepted: true });

    const balance = (await (await runtime('/v1/tools/get_balance', { account_ref: 'A1' }, { 'X-Call-Id': 'h1' })).json()) as { say: string };
    expect(balance.say).toContain('12,500 dollars and 40 cents');
  });

  it('confirms a transaction from the chat card without the model', async () => {
    await runtime('/v1/sessions', { call_id: 'h3', room: 'room-h3', channel: 'web_chat' });
    await runtime('/v1/tools/start_authentication', { account_number: '500000000201' }, { 'X-Call-Id': 'h3' });
    const session = orchestrator.sessionForCall('h3')!;
    const keypad = () => new Promise<string>((resolve) => {
      const off = orchestrator.subscribe(session.id, 'channel', (e) => {
        if (e.type === 'capture_requested') {
          off();
          resolve(e.capture.token);
        }
      });
    });
    // The NRIC keypad was issued before we subscribed: restart to get a fresh one we can observe.
    const nextKeypad = keypad();
    await runtime('/v1/tools/restart_authentication', {}, { 'X-Call-Id': 'h3' });
    await runtime('/v1/tools/start_authentication', { account_number: '500000000201' }, { 'X-Call-Id': 'h3' });
    const otpKeypad = keypad();
    await device('room-h3', '/v1/channel/capture', { token: await nextKeypad, value: '1234567' });
    await device('room-h3', '/v1/channel/capture', { token: await otpKeypad, value: controls.otpOutbox.at(-1)!.otp });

    const prepared = (await (await runtime('/v1/tools/prepare_stop_cheque', { first_cheque: '100070' }, { 'X-Call-Id': 'h3' })).json()) as { confirmation_id: string };
    const confirmed = await (await device('room-h3', '/v1/channel/confirm', { confirmation_id: prepared.confirmation_id, decision: 'confirm' })).json();
    expect(confirmed).toMatchObject({ ok: true, message: 'Your cheque has been stopped.' });
  });

  it('rejects bad tokens, unknown origins, wrong content types and oversized bodies', async () => {
    expect((await fetch(`${base}/v1/channel/events`, { headers: { Authorization: 'Bearer nope' } })).status).toBe(401);
    expect((await fetch(`${base}/v1/channel/events`, { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
    expect((await fetch(`${base}/v1/sessions`, { method: 'POST', headers: { Authorization: `Bearer ${RUNTIME}`, 'Content-Type': 'text/plain' }, body: '{}' })).status).toBe(415);
    expect((await runtime('/v1/sessions', { call_id: 'x'.repeat(20_000), channel: 'web_chat' })).status).toBe(413);
    expect((await runtime('/v1/tools/nope', {}, { 'X-Call-Id': 'h1' })).status).toBe(404);
  });
});
