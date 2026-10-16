// The "Describe" assistant's way to an AI model, kept on the server side like the Agent Builder key: the browser asks /llm/status ("is an AI model set up,
// and which ones may I choose?") and posts one kind of request to /llm/v1/messages. The key is added here and never reaches the browser. Anything else under
// /llm is refused, the model is limited to the ones listed, and the size of an answer is capped, so this is not an open door to the provider.
// Like the /api proxy it is a development convenience: anyone who can open the app can use the key through it (see docs/PRODUCTION.md).

const DEFAULT_MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'];
const MAX_BODY = 4 * 1024 * 1024; // the schema and the draft; nothing else needs to be this big
const MAX_TOKENS = 32000;

export function llmSettings(env) {
  const models = (env.LLM_MODELS ? env.LLM_MODELS.split(',').map((m) => m.trim()).filter(Boolean) : DEFAULT_MODELS);
  const model = models.includes(env.LLM_MODEL) ? env.LLM_MODEL : models[0];
  return { key: env.ANTHROPIC_API_KEY || '', base: (env.LLM_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, ''), models, model };
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (chunk) => { size += chunk.length; if (size > MAX_BODY) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(chunk); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// `use` is a connect-style `app.use`; `fetchImpl` is injectable for tests.
export function llmMiddleware(env, fetchImpl = fetch) {
  const settings = llmSettings(env);
  return async (req, res, next) => {
    const path = (req.url || '').split('?')[0].replace(/\/+$/, '');
    if (req.method === 'GET' && path === '/status') return send(res, 200, { configured: !!settings.key, model: settings.model, models: settings.models, provider: 'Anthropic' });
    if (!(req.method === 'POST' && path === '/v1/messages')) { if (next && path === '') return next(); return send(res, 404, { error: 'not found' }); }
    if (!settings.key) return send(res, 503, { error: 'No AI model is set up on this server (ANTHROPIC_API_KEY).' });
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (error) { return send(res, error.status || 400, { error: error.status === 413 ? 'The request is too large.' : 'The request is not valid JSON.' }); }
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.messages)) return send(res, 400, { error: 'Expected a messages request.' });
    // only what the assistant needs, with the model and size held to what this server allows
    const body = {
      model: settings.models.includes(payload.model) ? payload.model : settings.model,
      max_tokens: Math.min(Number(payload.max_tokens) || 16000, MAX_TOKENS),
      system: payload.system, messages: payload.messages, tools: payload.tools, tool_choice: payload.tool_choice, temperature: payload.temperature,
    };
    try {
      const upstream = await fetchImpl(`${settings.base}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': settings.key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body),
      });
      const text = await upstream.text();
      res.statusCode = upstream.status;
      res.setHeader('content-type', 'application/json');
      res.setHeader('cache-control', 'no-store');
      res.end(text);
    } catch (error) {
      return send(res, 502, { error: `The AI service could not be reached (${error.message}).` });
    }
  };
}

// A Vite plugin: the same route on the dev server and on `vite preview`.
export function llmPlugin(env) {
  const handler = llmMiddleware(env);
  return {
    name: 'weave-llm-route',
    configureServer(server) { server.middlewares.use('/llm', handler); },
    configurePreviewServer(server) { server.middlewares.use('/llm', handler); },
  };
}
