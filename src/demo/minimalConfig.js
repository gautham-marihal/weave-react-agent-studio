// The smallest valid agent: one web chat channel and one agent that answers briefly. New agents start from it (the demo API, the draft assistant,
// the starters). It lives in its own file so a screen that only needs it doesn't pull the whole imitation API into the main bundle.

export const minimalConfig = (id, name) => ({
  schema_version: '1.2',
  meta: { id, name, version: '0.1.0', status: 'draft' },
  runtime: { engine: 'livekit-agents', provider_mode: 'plugins' },
  defaults: { models: { llm: { provider: 'openai', model: 'gpt-4.1-mini', api_key: { secret: 'OPENAI_API_KEY' } } }, conversation: {} },
  persona: { name },
  channels: [
    {
      id: 'web-chat',
      type: 'web_chat',
      enabled: true,
      entry: { widget_id: `${id}-widget` },
      modalities: { input: ['text'], output: ['text'] },
      greeting: { say: 'Hello! How can I help you today?' },
    },
  ],
  agents: {
    entry: 'assistant',
    items: [{ id: 'assistant', name, kind: 'standalone', instructions: { role: 'You are a helpful assistant. Answer briefly and politely.' }, tools: [] }],
  },
});
