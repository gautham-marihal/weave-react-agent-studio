// The "Describe it" assistant's way to an AI model, kept on the server like the Agent Builder key. Used by
// vite.config.ts (Node), so no DOM here. The browser asks GET /llm/status ("is an AI model set up, and which may I
// choose?") and posts one kind of request to POST /llm/v1/messages. ANTHROPIC_API_KEY is added here and never reaches
// the browser. Anything else under /llm is refused, the model is held to an allow-list, and the size of a request and
// of an answer is capped, so the route is not an open door to the provider. Like the /api proxy it is a dev/preview
// convenience: anyone who can open Studio can use the key through it.
//
//   ANTHROPIC_API_KEY  the key (unset: /llm/status says not configured and messages answer 503)
//   LLM_MODELS         comma-separated allow-list (default: the current Claude models, newest first)
//   LLM_MODEL          the model used when the browser names none (default: the first allowed)
//   LLM_BASE_URL       where the Messages API is (default https://api.anthropic.com; the browser tests point it at a
//                      local stand-in)
import type { IncomingMessage, ServerResponse } from 'node:http';

/** The current Claude models, newest and most capable first. */
export const DEFAULT_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
/** The schema and the draft are the biggest things sent; nothing else needs to be this big. */
export const MAX_BODY = 4 * 1024 * 1024;
/** The most an answer may be asked to hold. */
export const MAX_TOKENS = 32000;
/** The longest an answer may take before the request is given up. */
export const UPSTREAM_TIMEOUT_MS = 5 * 60 * 1000;

export interface LlmSettings {
  key: string;
  base: string;
  models: string[];
  model: string;
}

// The text without the slashes at its end, by walking back from the end (a pattern like /\/+$/ can take a long time on
// an address of many slashes, and this runs on a server).
const withoutTrailingSlashes = (text: string) => {
  let end = text.length;
  while (end > 0 && text[end - 1] === '/') end -= 1;
  return text.slice(0, end);
};

export function llmSettings(env: Record<string, string | undefined>): LlmSettings {
  const listed = (env.LLM_MODELS ?? '').split(',').map((m) => m.trim()).filter(Boolean);
  const models = listed.length ? listed : DEFAULT_MODELS;
  const model = env.LLM_MODEL && models.includes(env.LLM_MODEL) ? env.LLM_MODEL : models[0];
  return { key: (env.ANTHROPIC_API_KEY ?? '').trim(), base: withoutTrailingSlashes((env.LLM_BASE_URL ?? '').trim() || 'https://api.anthropic.com'), models, model };
}

/** What /llm/status says: never the key, only whether there is one. */
export const llmStatus = (s: LlmSettings) => ({ configured: !!s.key, model: s.model, models: s.models, provider: 'Anthropic' });

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Only what the assistant needs is passed on, with the model held to the allow-list and the answer's size capped.
 * A forced tool choice is not accepted by current models, so only "auto" and "none" pass. Null when it isn't a
 * messages request.
 */
export function upstreamBody(payload: unknown, s: LlmSettings): Json | null {
  if (!isObj(payload) || !Array.isArray(payload.messages) || payload.messages.length === 0) return null;
  const asked = Number(payload.max_tokens);
  const body: Json = {
    model: typeof payload.model === 'string' && s.models.includes(payload.model) ? payload.model : s.model,
    max_tokens: Math.min(Number.isFinite(asked) && asked > 0 ? Math.floor(asked) : 16000, MAX_TOKENS),
    messages: payload.messages
  };
  if (payload.system !== undefined) body.system = payload.system;
  if (Array.isArray(payload.tools)) body.tools = payload.tools;
  if (isObj(payload.tool_choice) && (payload.tool_choice.type === 'auto' || payload.tool_choice.type === 'none')) body.tool_choice = { type: payload.tool_choice.type };
  return body;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

type Fetch = (url: string, init: {method: string;headers: Record<string, string>;body: string;signal?: AbortSignal;}) => Promise<{status: number;text: () => Promise<string>;}>;

/** The connect-style handler mounted at /llm. `fetchImpl` is injectable for tests. */
export function llmMiddleware(env: Record<string, string | undefined>, fetchImpl: Fetch = fetch as unknown as Fetch) {
  const settings = llmSettings(env);
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const path = withoutTrailingSlashes((req.url ?? '').split('?')[0]);
    if (req.method === 'GET' && path === '/status') return send(res, 200, llmStatus(settings));
    if (!(req.method === 'POST' && path === '/v1/messages')) {
      if (next && path === '') return next();
      return send(res, 404, { error: 'not found' });
    }
    if (!settings.key) return send(res, 503, { error: 'No AI model is set up on this server (ANTHROPIC_API_KEY).' });
    let payload: unknown;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (error) {
      const status = (error as {status?: number;}).status === 413 ? 413 : 400;
      return send(res, status, { error: status === 413 ? 'The request is too large.' : 'The request is not valid JSON.' });
    }
    const body = upstreamBody(payload, settings);
    if (!body) return send(res, 400, { error: 'Expected a messages request.' });
    try {
      const upstream = await fetchImpl(`${settings.base}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': settings.key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
      });
      const text = await upstream.text();
      if (text.length > MAX_BODY) return send(res, 502, { error: 'The AI service answered with more than this server passes on.' });
      res.statusCode = upstream.status;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(text);
    } catch (error) {
      return send(res, 502, { error: `The AI service could not be reached (${error instanceof Error ? error.message : 'unknown error'}).` });
    }
  };
}
