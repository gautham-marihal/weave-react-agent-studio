import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import { forwardedUser } from './src/utils/forwardedUser'
import { gatewayRoute, RUNTIME_ADDRESS_PATH, runtimeGatewayAddress } from './src/utils/gatewayProxy'
import { llmMiddleware } from './src/utils/llmRoute'

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // No default address: the proxy target comes from the environment only. A build needs no target.
  const target = env.AGENT_BUILDER_URL
  if (command === 'serve' && !target) {
    throw new Error('AGENT_BUILDER_URL is not set. Copy .env.example to .env and set it to the Agent Builder API address.')
  }
  const apiKey = env.AGENT_BUILDER_API_KEY || ''
  const fallbackUser = env.AGENT_BUILDER_USER || ''

  // The banking gateway is optional: without BANKING_GATEWAY_URL and BANKING_GATEWAY_TOKEN, /gateway answers 503.
  const gatewayTarget = (env.BANKING_GATEWAY_URL || '').trim()
  const gatewayToken = (env.BANKING_GATEWAY_TOKEN || '').trim()
  const rehearsals = env.BANKING_GATEWAY_REHEARSALS === 'on'
  const runtimeAddress = runtimeGatewayAddress(env)

  const proxy: Record<string, ProxyOptions> = {
    '/api': {
      target: target ?? '',
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/api/, ''),
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      configure: (proxyServer) => {
        proxyServer.on('proxyReq', (proxyReq, req) => {
          // The signed-in user (temporary sign-in) is who saves, publishes and deploys; AGENT_BUILDER_USER is the
          // fallback for requests without one. The API key is only ever added here, never by the browser.
          const user = forwardedUser(req.headers['x-user'], fallbackUser)
          proxyReq.removeHeader('x-user')
          if (user) proxyReq.setHeader('X-User', user)
          if (!apiKey) proxyReq.removeHeader('authorization')
        })
      },
    },
  }

  if (gatewayTarget) {
    proxy['/gateway'] = {
      target: gatewayTarget,
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/gateway/, ''),
      configure: (proxyServer) => {
        proxyServer.on('proxyReq', (proxyReq, req) => {
          const path = (req.url ?? '/').replace(/^\/gateway/, '')
          const route = gatewayRoute(req.method ?? 'GET', path, req.headers['x-call-id'], rehearsals)
          // Same-origin to Studio already; the gateway's CORS list is for browsers calling it directly.
          proxyReq.removeHeader('origin')
          proxyReq.removeHeader('cookie')
          proxyReq.removeHeader('x-user')
          if (route === 'runtime') proxyReq.setHeader('Authorization', `Bearer ${gatewayToken}`)
          else if (route !== 'channel') proxyReq.destroy() // the guard below already refused it; never forward
        })
      },
    }
  }

  /** Answers /gateway requests the proxy must not forward, before the proxy sees them. */
  const gatewayGuard = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const refuse = (status: number, error: string, message: string) => {
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error, message }))
    }
    // Studio's own answer, not the gateway's: where the agent runtime reaches the gateway (filled into banking agents).
    if (req.method === 'GET' && (req.url ?? '').split('?')[0] === RUNTIME_ADDRESS_PATH) {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      return res.end(JSON.stringify({ address: runtimeAddress }))
    }
    if (!gatewayTarget || !gatewayToken) {
      return refuse(503, 'gateway_not_configured', 'BANKING_GATEWAY_URL and BANKING_GATEWAY_TOKEN are required for this Studio server.')
    }
    if (gatewayRoute(req.method ?? 'GET', req.url ?? '/', req.headers['x-call-id'], rehearsals) === 'deny') {
      return refuse(403, 'route_not_allowed', 'Studio does not forward this gateway route.')
    }
    next()
  }
  const gatewayGuardPlugin: Plugin = {
    name: 'weave-gateway-guard',
    configureServer: (server) => void server.middlewares.use('/gateway', gatewayGuard),
    configurePreviewServer: (server) => void server.middlewares.use('/gateway', gatewayGuard),
  }

  // /llm: the "Describe it" assistant's way to an AI model; ANTHROPIC_API_KEY is added there, never sent to the browser.
  const llm = llmMiddleware(env)
  const llmPlugin: Plugin = {
    name: 'weave-llm-route',
    configureServer: (server) => void server.middlewares.use('/llm', llm),
    configurePreviewServer: (server) => void server.middlewares.use('/llm', llm),
  }

  return {
    plugins: [react(), gatewayGuardPlugin, llmPlugin],
    resolve: {
      // Matches "paths" in tsconfig.json; shadcn components import from "@/…".
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      proxy,
    },
    preview: {
      proxy,
    },
  }
})
