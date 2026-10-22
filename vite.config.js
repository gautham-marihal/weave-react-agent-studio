import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { llmPlugin } from './llmRoute.js';

// The browser only ever talks to /api. The dev/preview server forwards it to the Agent Builder
// API and adds the bearer key itself, so the key never reaches the browser bundle (and CORS is moot).
// This is a development convenience, not a security layer: anyone who can open the app can use the key through it.
// `vite preview` is not a production server either; production needs real sign-in in front (docs/PRODUCTION.md).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.AGENT_BUILDER_URL || 'http://localhost:8100';
  const apiKey = env.AGENT_BUILDER_API_KEY;
  // Who the API records as the user. The browser sends the person signed in to the Studio (the API guide asks for it); when
  // AGENT_BUILDER_USER is set it replaces that, as the proxy in front of the app does in production from the verified sign-in
  // (see docs/PRODUCTION.md).
  const trustedUser = env.AGENT_BUILDER_USER || '';
  const proxy = {
    '/api': {
      target,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/, ''),
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      configure: (proxy) => {
        proxy.on('proxyReq', (proxyReq) => {
          // A trusted name set on this server wins over whatever the browser claims.
          if (trustedUser) {
            proxyReq.removeHeader('x-user');
            proxyReq.setHeader('X-User', trustedUser);
          }
          if (!apiKey) proxyReq.removeHeader('authorization');
        });
      },
    },
  };
  // /llm: the Describe assistant's way to an AI model, with the key added here (see llmRoute.js)
  return { plugins: [react(), llmPlugin(env)], server: { proxy }, preview: { proxy } };
});
