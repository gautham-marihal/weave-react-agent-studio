import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, classify, headerSafe, setApiUser } from './client';

/** The headers of the one request `run` makes. */
async function sentHeaders(run: () => Promise<unknown>): Promise<Record<string, string>> {
  let headers: Record<string, string> = {};
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    headers = (init?.headers ?? {}) as Record<string, string>;
    return { ok: true, status: 200, text: async () => '[]' } as Response;
  });
  await run();
  return headers;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setApiUser('');
});

describe('X-User', () => {
  it('goes with every request, reads and writes alike', async () => {
    setApiUser('alex@example.com', 'Alex Morgan');
    expect((await sentHeaders(() => api.listBots()))['X-User']).toBe('alex@example.com');
    expect((await sentHeaders(() => api.listNumbers()))['X-User']).toBe('alex@example.com');
  });

  it('falls back when the first choice cannot be a header, and is left out with neither', async () => {
    setApiUser('王小明', 'xiaoming@example.com');
    expect((await sentHeaders(() => api.listBots()))['X-User']).toBe('xiaoming@example.com');
    setApiUser('', '');
    expect('X-User' in (await sentHeaders(() => api.listBots()))).toBe(false);
  });

  it('headerSafe keeps Latin-1, tidies spaces, and refuses anything else', () => {
    expect(headerSafe('José  Núñez\n')).toBe('José Núñez');
    expect(headerSafe('a’b')).toBe('');
    expect(headerSafe('x'.repeat(201))).toBe('');
  });
});

describe('classify, 5xx', () => {
  it('treats an empty answer or a gateway status as the API being down', () => {
    expect(classify(500, null).kind).toBe('network');
    expect(classify(502, '<html>bad gateway</html>').kind).toBe('network');
    expect(classify(504, null).kind).toBe('network');
  });

  it('treats any other 5xx without detail as a server failure that may have half-happened', () => {
    const answer = classify(500, 'Internal Server Error');
    expect(answer.kind).toBe('server');
    expect(answer.message).toMatch(/check whether it went through/);
  });

  it('keeps the API’s own detail', () => {
    expect(classify(500, { detail: 'Disk full' })).toMatchObject({ kind: 'server', message: 'Disk full' });
  });
});
