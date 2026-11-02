import { describe, expect, it } from 'vitest';
import { gatewayRoute, runtimeGatewayAddress } from './gatewayProxy';

const REHEARSAL = `rehearsal_${'a'.repeat(32)}`;

describe('gatewayRoute', () => {
  it('adds the runtime token only to the read-only routes Studio needs', () => {
    expect(gatewayRoute('GET', '/v1/tools', undefined, false)).toBe('runtime');
    expect(gatewayRoute('GET', '/v1/agent-config', undefined, false)).toBe('runtime');
    expect(gatewayRoute('GET', '/v1/rooms/room-1/timeline', undefined, false)).toBe('runtime');
    expect(gatewayRoute('GET', '/v1/sessions/call-1/timeline', undefined, false)).toBe('runtime');
    expect(gatewayRoute('GET', '/health', undefined, false)).toBe('runtime');
    expect(gatewayRoute('GET', '/gateway/v1/tools', undefined, false)).toBe('runtime');
    expect(gatewayRoute('GET', '/v1/tools/', undefined, false)).toBe('runtime');
  });

  it('passes channel routes through with the browser\'s own room token', () => {
    expect(gatewayRoute('GET', '/v1/channel/events', undefined, false)).toBe('channel');
    expect(gatewayRoute('POST', '/v1/channel/capture', undefined, false)).toBe('channel');
    expect(gatewayRoute('DELETE', '/v1/channel/capture', undefined, false)).toBe('deny');
  });

  it('never lets the browser start sessions or run tools for a real call', () => {
    expect(gatewayRoute('POST', '/v1/sessions', undefined, true)).toBe('deny');
    expect(gatewayRoute('POST', '/v1/sessions/end', undefined, true)).toBe('deny');
    expect(gatewayRoute('POST', '/v1/tools/get_balance', 'call-123', true)).toBe('deny');
    expect(gatewayRoute('POST', '/v1/tools/get_balance', undefined, true)).toBe('deny');
    expect(gatewayRoute('GET', '/v1/../v1/tools', undefined, false)).toBe('deny');
  });

  it('allows rehearsal routes and rehearsal tool calls only when rehearsals are on', () => {
    expect(gatewayRoute('POST', '/dev/rehearsals', undefined, false)).toBe('deny');
    expect(gatewayRoute('POST', '/v1/tools/get_balance', REHEARSAL, false)).toBe('deny');
    expect(gatewayRoute('POST', '/dev/rehearsals', undefined, true)).toBe('runtime');
    expect(gatewayRoute('POST', '/v1/tools/get_balance', REHEARSAL, true)).toBe('runtime');
    expect(gatewayRoute('GET', `/dev/rehearsals/${REHEARSAL}/sms`, undefined, true)).toBe('runtime');
    expect(gatewayRoute('POST', `/dev/rehearsals/${REHEARSAL}/end`, undefined, true)).toBe('runtime');
    expect(gatewayRoute('GET', '/dev/rehearsals/call-1/sms', undefined, true)).toBe('deny');
  });

  it('forwards test logins and rehearsal account details only when rehearsals are on', () => {
    expect(gatewayRoute('GET', '/dev/test-logins', undefined, false)).toBe('deny');
    expect(gatewayRoute('GET', `/dev/rehearsals/${REHEARSAL}/account-details`, undefined, false)).toBe('deny');
    expect(gatewayRoute('GET', '/dev/test-logins', undefined, true)).toBe('runtime');
    expect(gatewayRoute('GET', `/dev/rehearsals/${REHEARSAL}/account-details`, undefined, true)).toBe('runtime');
    expect(gatewayRoute('GET', '/dev/rehearsals/call-1/account-details', undefined, true)).toBe('deny');
    expect(gatewayRoute('POST', '/dev/test-logins', undefined, true)).toBe('deny');
  });
});

describe('runtimeGatewayAddress (filled into banking agents, never typed)', () => {
  it('prefers the runtime address, then the gateway the Studio server uses, without a trailing slash', () => {
    expect(runtimeGatewayAddress({ BANKING_GATEWAY_RUNTIME_URL: 'https://gw.bank.example/', BANKING_GATEWAY_URL: 'http://localhost:8790' })).toBe('https://gw.bank.example');
    expect(runtimeGatewayAddress({ BANKING_GATEWAY_URL: ' http://localhost:8790 ' })).toBe('http://localhost:8790');
  });
  it('is empty when there is no http(s) address', () => {
    expect(runtimeGatewayAddress({})).toBe('');
    expect(runtimeGatewayAddress({ BANKING_GATEWAY_URL: 'localhost:8790', BANKING_GATEWAY_RUNTIME_URL: '' })).toBe('');
  });
  it('is Studio’s own route, never forwarded to the gateway', () => {
    expect(gatewayRoute('GET', '/_studio/address', undefined, true)).toBe('deny');
  });
});
