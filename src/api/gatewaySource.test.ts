import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Where banking calls go (src/api/gateway.ts): Live uses the bank's real systems when a gateway on them answers, and
// the mock bank otherwise; Sandbox always uses the mock bank; Studio's own test sessions always run on the mock bank,
// and everything a rehearsal handed out follows it there.

let sandbox = false;
vi.mock('../sandbox/mode', () => ({ isSandbox: () => sandbox }));

type Answer = { status: number; body?: unknown } | 'down';
let routes: Record<string, Answer> = {};
const fetched: string[] = [];

const fakeFetch = vi.fn(async (url: string) => {
  fetched.push(url);
  const answer = routes[url.replace(/^\/gateway/, '')];
  if (!answer || answer === 'down') throw new TypeError('fetch failed');
  return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status, headers: { 'Content-Type': 'application/json' } });
});

const load = async () => {
  vi.resetModules();
  return import('./gateway');
};

beforeEach(() => {
  sandbox = false;
  routes = {};
  fetched.length = 0;
  vi.stubGlobal('fetch', fakeFetch);
});
afterEach(() => vi.unstubAllGlobals());

describe('bankingSource', () => {
  it('Live: the bank’s real systems when a gateway on them answers; rehearsals still go to the mock bank', async () => {
    routes['/health'] = { status: 200, body: { hosts: 'live' } };
    const g = await load();
    expect(await g.bankingSource()).toEqual({ kind: 'gateway', hosts: 'live', studio: 'live' });
    expect(await g.rehearsalSource()).toEqual({ kind: 'browser', hosts: 'mock', studio: 'live' });
  });

  it('Live: a mock gateway server that opens test sessions is used, as the mock bank', async () => {
    routes['/health'] = { status: 200, body: { hosts: 'mock' } };
    routes['/dev/test-logins'] = { status: 200, body: { logins: [] } };
    const g = await load();
    expect(await g.bankingSource()).toEqual({ kind: 'gateway', hosts: 'mock', studio: 'live' });
    expect(await g.rehearsalSource()).toEqual(await g.bankingSource());
  });

  it('Live: with no gateway server at all, the mock bank in this browser (never "unavailable")', async () => {
    routes['/health'] = 'down';
    const g = await load();
    const source = await g.bankingSource();
    expect(source).toEqual({ kind: 'browser', hosts: 'mock', studio: 'live' });
    expect(g.isMockBank(source)).toBe(true);
    expect(g.bankingSourceLabel(source)).toBe('Mock bank · banking gateway in this browser, test data only');
  });

  it('Sandbox: the mock bank, whatever gateway answers', async () => {
    sandbox = true;
    routes['/health'] = { status: 200, body: { hosts: 'live' } };
    const g = await load();
    expect(await g.bankingSource()).toEqual({ kind: 'browser', hosts: 'mock', studio: 'sandbox' });
    expect(g.bankingSourceLabel(await g.bankingSource())).toBe('Sandbox · banking gateway in this browser, mock bank systems');
  });

  it('labels: real systems say so; the mock bank in Live says "Mock bank" first', async () => {
    const g = await load();
    expect(g.bankingSourceLabel({ kind: 'gateway', hosts: 'live', studio: 'live' })).toBe('Banking gateway · the bank’s real systems');
    expect(g.bankingSourceLabel({ kind: 'gateway', hosts: 'mock', studio: 'live' })).toMatch(/^Mock bank · .*test data only$/);
    expect(g.bankingSourceLabel({ kind: 'gateway', hosts: 'mock', studio: 'sandbox' })).toBe('Banking gateway · mock bank systems, test data only');
  });
});

describe('routing with a gateway on the bank’s real systems connected (Live)', () => {
  it('a rehearsal and every call carrying its token, call id or room run on the mock bank; the real agent’s calls go to the real gateway', async () => {
    routes['/health'] = { status: 200, body: { hosts: 'live' } };
    routes['/v1/channel/state'] = { status: 200, body: { from: 'real gateway' } };
    const g = await load();

    const rehearsal = await g.gateway.rehearsal.start('web_chat');
    expect(rehearsal.hosts).toBe('mock');
    const state = await g.gateway.channel.state(rehearsal.channel_token);
    expect(state.auth.authenticated).toBe(false);
    const services = await g.gateway.rehearsal.runTool(rehearsal.call_id, 'list_services', {});
    expect(services.ok).toBe(true);
    // none of that reached the server
    expect(fetched.filter((u) => !u.endsWith('/health'))).toEqual([]);

    // the real agent's room token is not a rehearsal's: it goes to the gateway on real systems
    expect(await g.gateway.channel.state('room-token-from-livekit')).toEqual({ from: 'real gateway' });
    expect(fetched).toContain('/gateway/v1/channel/state');
  });
});
