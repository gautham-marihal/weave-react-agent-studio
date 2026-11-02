// Production entry point: the gateway on a bank's real systems.
//
// Today that is CIMB's TetherfiDbRestApi (src/adapters/cimb.ts), chosen by CIMB_BASE_URL:
//   CIMB_BASE_URL=http://cimb-host:3322  CIMB_REGION=DB2  GATEWAY_TOKEN=<32+ chars>  npm start
// /health then reports hosts "live", and Weave Studio's Live mode uses this gateway as the bank's real systems.
//
// STUDIO_TEST_SESSIONS=on adds the routes Studio needs to hold its own banking test conversation on these systems
// (src/http/test-sessions.ts). They mint channel tokens with a secret generated for this run, so they stay off when
// LIVEKIT_API_SECRET is set (a deployment beside the agent runtime, where real calls carry real room tokens).
//
// Without a bank configured this entry refuses to start rather than silently running on anything else. For local
// development on the mock bank run `npm run start:mock` (mock/main.ts).

import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { cimbConfigFromEnv, cimbPolicy, createCimbPorts } from './adapters/cimb.ts';
import { createGateway, readEnv } from './app.ts';
import { createGatewayServer } from './http/server.ts';
import { testSessionRoutes } from './http/test-sessions.ts';

const cimb = cimbConfigFromEnv(process.env);
if (!cimb) {
  console.error('banking-gateway: no bank is configured. Set CIMB_BASE_URL (and CIMB_REGION) for CIMB, or run `npm run start:mock` for the mock bank.');
  process.exit(1);
}

const env = readEnv(process.env);
const wantTestSessions = process.env.STUDIO_TEST_SESSIONS === 'on';
if (wantTestSessions && env.liveKitApiSecret) console.warn('STUDIO_TEST_SESSIONS=on is ignored: LIVEKIT_API_SECRET is set, and test sessions would mint real room tokens.');
const mintSecret = wantTestSessions && !env.liveKitApiSecret ? randomBytes(24).toString('base64url') : null;

const { orchestrator, registry } = createGateway({ ports: createCimbPorts(cimb), policy: cimbPolicy(), hosts: 'live' });
const gateway = createGatewayServer(orchestrator, registry, {
  gatewayToken: env.gatewayToken,
  liveKitApiSecret: env.liveKitApiSecret ?? mintSecret,
  channelOrigins: env.channelOrigins,
});
const testSessions = mintSecret
  ? testSessionRoutes(orchestrator, {
      gatewayToken: env.gatewayToken,
      mintSecret,
      loginsNote: 'CIMB customers sign in with their own customer id (the 7-digit Phone Code) and passcode (the 6-digit PIN). There are no test logins or SMS codes on the bank’s systems.',
    })
  : null;

const server = createServer((req, res) => {
  if (!testSessions) return void gateway.emit('request', req, res);
  testSessions(req, res)
    .then((handled) => {
      if (!handled) gateway.emit('request', req, res);
    })
    .catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' }).end('{"error":"internal"}');
    });
});

server.listen(env.port, env.host, () => {
  console.log(`Banking gateway on CIMB (${cimb.baseUrl}, region ${cimb.region}) at http://${env.host}:${env.port} (${registry.size} tools). Policy approved: ${orchestrator.policy.approved}.`);
  console.log(testSessions ? 'Studio test sessions are on: Studio can hold banking test conversations on CIMB.' : 'Studio test sessions are off.');
});
