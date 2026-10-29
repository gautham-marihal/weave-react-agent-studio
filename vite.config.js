import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { llmPlugin } from './llmRoute.js';
import { gatewayRoute } from './src/studio/banking/gatewayRoute.ts';

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

  // /gateway: the banking gateway (services/banking-gateway, docs/BANKING.md). Optional: without BANKING_GATEWAY_URL and
  // BANKING_GATEWAY_TOKEN it answers 503 and the banking surfaces say so (or stay hidden). Which requests may pass, and with
  // which credential, is decided in src/studio/banking/gatewayRoute.ts: the runtime token is added here, only to the
  // read-only routes the studio needs, and never reaches the browser; the caller's channel routes carry the conversation's
  // own room token, which the gateway checks. Rehearsals (mock gateway only) need BANKING_GATEWAY_REHEARSALS=on.
  const gatewayTarget = (env.BANKING_GATEWAY_URL || '').trim();
  const gatewayToken = (env.BANKING_GATEWAY_TOKEN || '').trim();
  const rehearsals = env.BANKING_GATEWAY_REHEARSALS === 'on';
  if (gatewayTarget) {
    proxy['/gateway'] = {
      target: gatewayTarget,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/gateway/, ''),
      configure: (proxy) => {
        proxy.on('proxyReq', (proxyReq, req) => {
          const route = gatewayRoute(req.method ?? 'GET', (req.url ?? '/').replace(/^\/gateway/, ''), req.headers['x-call-id'], rehearsals);
          // Same origin as the studio already; the gateway's CORS list is for browsers calling it directly.
          proxyReq.removeHeader('origin');
          proxyReq.removeHeader('cookie');
          proxyReq.removeHeader('x-user');
          if (route === 'runtime') proxyReq.setHeader('Authorization', `Bearer ${gatewayToken}`);
          else if (route !== 'channel') proxyReq.destroy(); // the guard below has refused it already: never forward
        });
      },
    };
  }

  // Answers the /gateway requests that must not be forwarded, before the proxy sees them.
  const gatewayGuard = (req, res, next) => {
    const refuse = (status, error, message) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error, message }));
    };
    if (!gatewayTarget || !gatewayToken) {
      return refuse(503, 'gateway_not_configured', 'BANKING_GATEWAY_URL and BANKING_GATEWAY_TOKEN are required for this studio server.');
    }
    if (gatewayRoute(req.method ?? 'GET', req.url ?? '/', req.headers['x-call-id'], rehearsals) === 'deny') {
      return refuse(403, 'route_not_allowed', 'The studio does not forward this gateway route.');
    }
    next();
  };
  const gatewayGuardPlugin = {
    name: 'weave-gateway-guard',
    configureServer: (server) => void server.middlewares.use('/gateway', gatewayGuard),
    configurePreviewServer: (server) => void server.middlewares.use('/gateway', gatewayGuard),
  };

  // /llm: the Describe assistant's way to an AI model, with the key added here (see llmRoute.js)
  return { plugins: [react(), llmPlugin(env), gatewayGuardPlugin], server: { proxy }, preview: { proxy } };
});
