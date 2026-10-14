import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The browser only ever talks to /api. The dev/preview server forwards it to the Agent Builder
// API and adds the bearer key itself, so the key never reaches the browser bundle (and CORS is moot).
// This is a development convenience, not a security layer: anyone who can open the app can use the key through it.
// `vite preview` is not a production server either; production needs real sign-in in front (docs/PRODUCTION.md).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.AGENT_BUILDER_URL || 'http://localhost:8100';
  const apiKey = env.AGENT_BUILDER_API_KEY;
  // Who the API records as the user. Set here, on the server side, never taken from the browser. In production the
  // proxy in front of the app sets it from the verified sign-in (see docs/PRODUCTION.md).
  const trustedUser = env.AGENT_BUILDER_USER || '';
  const proxy = {
    '/api': {
      target,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/, ''),
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      configure: (proxy) => {
        proxy.on('proxyReq', (proxyReq) => {
          // Whatever the browser claims about who it is, is dropped; the proxy decides.
          proxyReq.removeHeader('x-user');
          if (trustedUser) proxyReq.setHeader('X-User', trustedUser);
          if (!apiKey) proxyReq.removeHeader('authorization');
        });
      },
    },
  };
  return { plugins: [react()], server: { proxy }, preview: { proxy } };
});
