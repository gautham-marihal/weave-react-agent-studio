import { describe, expect, it } from 'vitest';
import { connectivityStrip, nextCheckDelay, readHealthAnswer, readHealthFailure } from './health';

const at = 1_700_000_000_000;

describe('readHealthAnswer', () => {
  it('is healthy only when the API says ok: true', () => {
    expect(readHealthAnswer({ ok: true }, 31, at)).toMatchObject({ state: 'healthy', latencyMs: 31, checkedAt: at });
  });

  it('is degraded when the API answers without ok: true', () => {
    expect(readHealthAnswer({ ok: false }, 12, at).state).toBe('degraded');
    expect(readHealthAnswer('<html>', 12, at).state).toBe('degraded');
    expect(readHealthAnswer(null, 12, at).state).toBe('degraded');
  });
});

describe('readHealthFailure', () => {
  it('is down when the API could not be reached', () => {
    const error = Object.assign(new Error('Could not reach the Agent Builder API.'), { status: 0, kind: 'network' });
    expect(readHealthFailure(error, 250, at)).toMatchObject({ state: 'down', detail: 'Could not reach the Agent Builder API.' });
  });

  it('is down when the proxy reports a 5xx with no detail (backend not answering)', () => {
    const error = Object.assign(new Error('The Agent Builder API is not responding.'), { status: 502, kind: 'network' });
    expect(readHealthFailure(error, 40, at)).toMatchObject({ state: 'down', detail: 'HTTP 502: The Agent Builder API is not responding.' });
  });

  it('is down on a timeout and says how long it waited', () => {
    expect(readHealthFailure(new DOMException('aborted', 'AbortError'), 5000, at)).toMatchObject({
      state: 'down',
      detail: 'No answer within 5 s.',
    });
  });

  it('is degraded when the API answered with an error status', () => {
    const error = Object.assign(new Error('Missing API key'), { status: 401, kind: 'auth' });
    expect(readHealthFailure(error, 20, at)).toMatchObject({ state: 'degraded', detail: 'HTTP 401: Missing API key' });
  });

  it('never reports healthy', () => {
    expect(readHealthFailure('anything', 1, at).state).not.toBe('healthy');
  });
});

describe('how often, and which strip', () => {
  it('asks again every 15 s while the API is unreachable, else every minute', () => {
    expect(nextCheckDelay('down')).toBe(15_000);
    expect(nextCheckDelay('healthy')).toBe(60_000);
    expect(nextCheckDelay('degraded')).toBe(60_000);
    expect(nextCheckDelay('unknown')).toBe(60_000);
  });

  it('says "offline" without a network, "can’t reach the server" when only the API is gone, and nothing otherwise', () => {
    expect(connectivityStrip(false, 'healthy')).toBe('offline');
    expect(connectivityStrip(false, 'down')).toBe('offline');
    expect(connectivityStrip(true, 'down')).toBe('server_down');
    expect(connectivityStrip(true, 'degraded')).toBe(null);
    expect(connectivityStrip(true, 'unknown')).toBe(null);
    expect(connectivityStrip(true, 'healthy')).toBe(null);
  });
});
