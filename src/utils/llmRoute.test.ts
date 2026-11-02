import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MODELS, MAX_BODY, MAX_TOKENS, llmMiddleware, llmSettings, llmStatus, upstreamBody } from './llmRoute';

type Result = {status: number | 'next';body: Record<string, unknown> | null;};

// Drives the connect-style handler with a fake request and response.
function call(handler: ReturnType<typeof llmMiddleware>, method: string, url: string, body?: unknown): Promise<Result> {
  const req = Object.assign(new EventEmitter(), { method, url, destroy: () => undefined }) as unknown as IncomingMessage;
  return new Promise((resolve) => {
    const res = {
      statusCode: 0,
      headers: {} as Record<string, string>,
      setHeader(k: string, v: string) {
        this.headers[k] = v;
      },
      end(text: string) {
        resolve({ status: this.statusCode, body: text ? JSON.parse(text) as Record<string, unknown> : null });
      }
    };
    void handler(req, res as unknown as ServerResponse, () => resolve({ status: 'next', body: null }));
    if (body !== undefined) req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
    req.emit('end');
  });
}

describe('the /llm route settings', () => {
  it('allows the current Claude models, newest first, and defaults to the newest', () => {
    expect(DEFAULT_MODELS).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
    const s = llmSettings({});
    expect([s.model, s.models, s.key, s.base]).toEqual(['claude-opus-5-5', DEFAULT_MODELS, '', 'https://api.anthropic.com']);
  });
  it('takes an allow-list and a default from the environment; a default not on the list is not used', () => {
    expect(llmSettings({ LLM_MODELS: ' a, b ,', LLM_MODEL: 'b' })).toMatchObject({ models: ['a', 'b'], model: 'b' });
    expect(llmSettings({ LLM_MODEL: 'nope' }).model).toBe('claude-opus-5-5');
    expect(llmSettings({ LLM_BASE_URL: 'http://localhost:9///' }).base).toBe('http://localhost:9');
  });
  it('says whether a key is set, never the key', () => {
    const status = llmStatus(llmSettings({ ANTHROPIC_API_KEY: 'sk-secret' }));
    expect(status).toEqual({ configured: true, model: 'claude-opus-5-5', models: DEFAULT_MODELS, provider: 'Anthropic' });
    expect(JSON.stringify(status)).not.toContain('sk-secret');
  });
});

describe('what is passed on', () => {
  const s = llmSettings({ ANTHROPIC_API_KEY: 'k' });
  it('holds the model to the allow-list and caps the size of an answer', () => {
    expect(upstreamBody({ model: 'gpt-evil', max_tokens: 999999, messages: [{ role: 'user', content: 'hi' }] }, s)).toEqual({
      model: 'claude-opus-5-5',
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: 'hi' }]
    });
    expect(upstreamBody({ model: 'claude-haiku-5-5', max_tokens: 100, messages: [{ role: 'user', content: 'x' }] }, s)?.model).toBe('claude-haiku-5-5');
  });
  it('drops everything else the browser sent, and a forced tool choice', () => {
    const body = upstreamBody({ messages: [{ role: 'user', content: 'x' }], system: 's', tools: [{ name: 't' }], tool_choice: { type: 'tool', name: 't' }, stream: true, metadata: { a: 1 }, temperature: 0.2 }, s);
    expect(Object.keys(body ?? {}).sort()).toEqual(['max_tokens', 'messages', 'model', 'system', 'tools']);
    expect(upstreamBody({ messages: [{ role: 'user', content: 'x' }], tool_choice: { type: 'auto', extra: 1 } }, s)?.tool_choice).toEqual({ type: 'auto' });
  });
  it('refuses what is not a messages request', () => {
    expect(upstreamBody({ nope: 1 }, s)).toBeNull();
    expect(upstreamBody({ messages: [] }, s)).toBeNull();
    expect(upstreamBody('text', s)).toBeNull();
  });
});

describe('the /llm route', () => {
  it('GET /status answers; a request for something else passes on only at its root', async () => {
    const none = await call(llmMiddleware({}), 'GET', '/status');
    expect(none.body).toMatchObject({ configured: false, model: 'claude-opus-5-5' });
    expect((await call(llmMiddleware({}), 'GET', '/status/')).status).toBe(200);
    expect((await call(llmMiddleware({}), 'GET', '')).status).toBe('next');
  });

  it('adds the key itself and passes the answer back', async () => {
    const seen: {url: string;init: {headers: Record<string, string>;body: string;};}[] = [];
    const handler = llmMiddleware({ ANTHROPIC_API_KEY: 'sk-secret', LLM_BASE_URL: 'https://llm.example/' }, async (url, init) => {
      seen.push({ url, init });
      return { status: 200, text: async () => JSON.stringify({ content: [], ok: true }) };
    });
    const out = await call(handler, 'POST', '/v1/messages', { model: 'gpt-evil', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] });
    expect(out).toEqual({ status: 200, body: { content: [], ok: true } });
    expect(seen[0].url).toBe('https://llm.example/v1/messages');
    expect(seen[0].init.headers['x-api-key']).toBe('sk-secret');
    expect(seen[0].init.headers['anthropic-version']).toBe('2023-06-01');
    expect(JSON.parse(seen[0].init.body).model).toBe('claude-opus-5-5');
  });

  it('refuses everything else, an unset key, bad bodies, and says when the service cannot be reached', async () => {
    const handler = llmMiddleware({ ANTHROPIC_API_KEY: 'k' }, async () => {
      throw new Error('boom');
    });
    expect((await call(handler, 'GET', '/v1/messages')).status).toBe(404);
    expect((await call(handler, 'POST', '/v1/complete', {})).status).toBe(404);
    expect((await call(handler, 'DELETE', '/anything')).status).toBe(404);
    expect((await call(handler, 'POST', '/v1/messages', 'not json')).status).toBe(400);
    expect((await call(handler, 'POST', '/v1/messages', { nope: 1 })).status).toBe(400);
    const down = await call(handler, 'POST', '/v1/messages', { messages: [{ role: 'user', content: 'x' }] });
    expect(down.status).toBe(502);
    expect(String(down.body?.error)).toMatch(/could not be reached/);
    expect((await call(llmMiddleware({}), 'POST', '/v1/messages', { messages: [] })).status).toBe(503);
  });

  it('refuses a request bigger than the cap', async () => {
    const handler = llmMiddleware({ ANTHROPIC_API_KEY: 'k' }, async () => ({ status: 200, text: async () => '{}' }));
    const big = await call(handler, 'POST', '/v1/messages', 'x'.repeat(MAX_BODY + 10));
    expect(big.status).toBe(413);
  });
});
