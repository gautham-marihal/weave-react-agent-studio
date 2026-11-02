import { describe, expect, it } from 'vitest';
import { createBrowserGateway } from './gatewayInBrowser.js';

// The banking gateway built for the browser (scripts/build-sandbox-gateway.mjs) answers as the gateway server does:
// the same routes, state machine, secure entry and mock bank.

const json = async (answer: Promise<{ status: number; body: string }>) => {
  const { status, body } = await answer;
  return { status, data: body ? JSON.parse(body) : null };
};

describe('the banking gateway in the browser', () => {
  it('says it runs on mock bank systems and lists its tools', async () => {
    const gw = createBrowserGateway();
    expect(gw.hosts).toBe('mock');
    const health = await json(gw.request({ method: 'GET', path: '/health' }));
    expect(health.status).toBe(200);
    expect(health.data.hosts).toBe('mock');
    const tools = await json(gw.request({ method: 'GET', path: '/v1/tools' }));
    expect(tools.data.tools.length).toBeGreaterThanOrEqual(30);
  });

  it('signs a caller in with Phone Code and PIN on the secure keypad, then reads their accounts and a balance', async () => {
    const gw = createBrowserGateway();
    const started = await json(gw.request({ method: 'POST', path: '/dev/rehearsals', body: JSON.stringify({ channel: 'web_chat' }) }));
    expect(started.status).toBe(201);
    const { call_id: callId, channel_token: channelToken } = started.data;
    const tool = (name: string, args: Record<string, unknown> = {}) =>
      json(gw.request({ method: 'POST', path: `/v1/tools/${name}`, headers: { 'X-Call-Id': callId }, body: JSON.stringify(args) }));
    const device = (path: string, body: Record<string, unknown> = {}) =>
      json(gw.request({ method: 'POST', path, headers: { Authorization: `Bearer ${channelToken}` }, body: JSON.stringify(body) }));

    // before sign-in, account tools are refused and point to sign-in
    const early = await tool('list_accounts');
    expect(early.data.ok).toBe(false);

    const begun = await tool('start_authentication', { phone_code: '1234567' });
    expect(begun.data.next).toBe('wait_for_secure_entry');
    const { data: keypad } = await device('/v1/channel/capture/reissue');
    const { data: entered } = await device('/v1/channel/capture', { token: keypad.capture.token, value: '135790' });
    expect(entered.accepted).toBe(true);
    const status = await tool('get_auth_status');
    expect(status.data.authenticated).toBe(true);

    const accounts = await tool('list_accounts');
    expect(accounts.data.ok).toBe(true);
    const balance = await tool('get_balance', { account_ref: 'A1' });
    expect(balance.data.ok).toBe(true);
    expect(typeof balance.data.say).toBe('string');
    // the model sees account references, never full account numbers
    expect(JSON.stringify(balance.data)).not.toMatch(/\d{12}/);
  });

  it('a wrong PIN keeps the step and counts against the caller', async () => {
    const gw = createBrowserGateway();
    const { data: started } = await json(gw.request({ method: 'POST', path: '/dev/rehearsals', body: '{}' }));
    const auth = { Authorization: `Bearer ${started.channel_token}` };
    await json(gw.request({ method: 'POST', path: '/v1/tools/start_authentication', headers: { 'X-Call-Id': started.call_id }, body: JSON.stringify({ phone_code: '1234567' }) }));
    const { data: keypad } = await json(gw.request({ method: 'POST', path: '/v1/channel/capture/reissue', headers: auth, body: '{}' }));
    const { data: wrong } = await json(gw.request({ method: 'POST', path: '/v1/channel/capture', headers: auth, body: JSON.stringify({ token: keypad.capture.token, value: '000000' }) }));
    expect(wrong.accepted).toBe(false);
    const { data: state } = await json(gw.request({ method: 'POST', path: '/v1/tools/get_auth_status', headers: { 'X-Call-Id': started.call_id }, body: '{}' }));
    expect(state.authenticated).toBe(false);
    expect(state.attempts_remaining).toBe(2);
  });

  it('streams the device events: a keypad is asked for when sign-in starts', async () => {
    const gw = createBrowserGateway();
    const { data: started } = await json(gw.request({ method: 'POST', path: '/dev/rehearsals', body: '{}' }));
    let text = '';
    const events = gw.stream({ method: 'GET', path: '/v1/channel/events', headers: { Authorization: `Bearer ${started.channel_token}` } }, (t) => {
      text += t;
    });
    expect((await events.opened).status).toBe(200);
    await json(gw.request({ method: 'POST', path: '/v1/tools/start_authentication', headers: { 'X-Call-Id': started.call_id }, body: JSON.stringify({ phone_code: '1234567' }) }));
    expect(text).toMatch(/event: capture_requested/);
    events.stop();
  });
});
