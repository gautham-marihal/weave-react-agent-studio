// Testing a connection from the Integrations page: one GET to its address plus the test path (its "Test request"), with
// its plain headers (a secret header's key is on the Agent Builder server, so the test goes without it). In the browser
// the call goes through the studio's own server (/api-pass, see apiPass.js), since most APIs refuse calls from web
// pages; elsewhere (tests, scripts) it goes straight to the API. The answer comes back as plain words. Pure: no React.

import { connectionParts, isWebAddress, plainHeaders } from '../connectionParts.js';

export const PASS_PATH = '/api-pass';

/** The address the test calls: the connection's address with the test path after it ('' calls the address itself). */
export function testUrl(url, path) {
  const base = String(url || '')
    .trim()
    .replace(/\/+$/, '');
  const tail = String(path || '').trim();
  if (!tail) return base;
  return `${base}${tail.startsWith('/') ? '' : '/'}${tail}`;
}

/** What a saved connection is tested with: { url, path, headers (plain), secret (the secret header's name, or '') }. */
export function testOf(saved, id) {
  const parts = connectionParts(saved, id);
  return { url: parts.url, path: String(saved?.testPath || '').trim(), headers: plainHeaders(parts), secret: parts.headers.find((h) => h.secret)?.name || '' };
}

const shown = (path) => `GET ${String(path || '').trim() || '/'}`;

/**
 * One test call: { ok, text }. ok when the API answered 2xx or 3xx; text says what it answered, and how fast, in words.
 *   pass: through the studio's server (the default in a browser)
 */
export async function testConnection(
  { url, path = '', headers = {}, secret = '' },
  { signal, fetchImpl = globalThis.fetch, pass = typeof window !== 'undefined', now = () => Date.now() } = {},
) {
  if (!isWebAddress(url)) return { ok: false, text: 'The address must start with http:// or https://.' };
  const target = testUrl(url, path);
  // without its key, a refusal may only mean the secret header is missing here
  const without = secret ? ` Tested without ${secret}: its key is on the Agent Builder server.` : '';
  const started = now();
  let response;
  try {
    response = await fetchImpl(pass ? PASS_PATH : target, {
      method: 'GET',
      headers: pass ? { 'X-Api-Url': target, 'X-Api-Headers': encodeURIComponent(JSON.stringify(headers)) } : headers,
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return {
      ok: false,
      text: pass
        ? 'The studio’s server did not answer. Check that it is running (npm run dev).'
        : 'It did not answer. Check that it is running at this address.',
    };
  }
  const ms = Math.max(0, Math.round(now() - started));
  if (response.headers?.get?.('x-api-pass-refused')) {
    let problem = '';
    try {
      problem = (await response.json())?.problem || '';
    } catch {
      /* no words: the status says enough */
    }
    return { ok: false, text: problem || `The studio’s server would not call it (HTTP ${response.status}).` };
  }
  const answered = `${shown(path)} answered ${response.status}`;
  if (response.status >= 200 && response.status < 400) return { ok: true, text: `Test passed: ${answered} in ${ms} ms.` };
  return { ok: false, text: `${answered}.${without}` };
}

/** A saved connection's test, from its card. */
export const testSaved = (saved, id, options) => testConnection(testOf(saved, id), options);
