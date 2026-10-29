// MOCK ENTRY POINT: runs the real gateway (state machine, executor, security) on top of the in-memory mock
// adapters, so Weave Studio and the agent runtime can be developed before the bank's SOA/Siebel/CMM endpoints exist.
//
//   npm run start:mock              (from services/banking-gateway)
//
// It refuses to run with NODE_ENV=production. Mock OTPs are printed to this console: there is no real SMS.

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway } from '../src/app.ts';
import { createGatewayServer } from '../src/http/server.ts';
import { signLiveKitToken } from '../src/security/crypto.ts';
import { createMockPorts } from './adapters.ts';
import { rehearsalRoutes } from './rehearsal.ts';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to start the MOCK banking gateway with NODE_ENV=production.');
  process.exit(1);
}

function resolveGatewayToken(): string {
  if (process.env.GATEWAY_TOKEN && process.env.GATEWAY_TOKEN.trim().length >= 32) {
    return process.env.GATEWAY_TOKEN.trim();
  }
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(fileURLToPath(new URL('../../.env', import.meta.url))),
  ];
  for (const envPath of candidates) {
    try {
      if (existsSync(envPath)) {
        const text = readFileSync(envPath, 'utf8');
        const match = text.match(/^\s*(?:BANKING_)?GATEWAY_TOKEN\s*=\s*["']?([A-Za-z0-9_-]{32,})["']?/m);
        if (match && match[1]) {
          return match[1].trim();
        }
      }
    } catch {
      // Ignore file reading errors
    }
  }
  return randomBytes(24).toString('base64url');
}

const gatewayToken = resolveGatewayToken();
const generatedSecret = process.env.LIVEKIT_API_SECRET ? null : randomBytes(24).toString('base64url');
const liveKitApiSecret = process.env.LIVEKIT_API_SECRET || (generatedSecret as string);
const port = Number(process.env.PORT ?? 8790);
const host = process.env.HOST ?? 'localhost';
const channelOrigins = (process.env.CHANNEL_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean);

const { ports, controls } = createMockPorts(Date.now, (customerId, otp) => console.log(`[MOCK SMS] OTP for ${customerId}: ${otp}`));
const { orchestrator, registry } = createGateway({ ports, hosts: 'mock' });
const gateway = createGatewayServer(orchestrator, registry, { gatewayToken, liveKitApiSecret, channelOrigins });
const rehearsals = rehearsalRoutes(orchestrator, controls, { gatewayToken, mintSecret: generatedSecret });

// The gateway's own server handles everything except the mock-only /dev/ rehearsal routes.
const server = createServer((req, res) => {
  rehearsals(req, res)
    .then((handled) => {
      if (!handled) gateway.emit('request', req, res);
    })
    .catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' }).end('{"error":"internal"}');
    });
});

server.listen(port, host, () => {
  const url = `http://${host}:${port}`;
  console.log(`MOCK banking gateway on ${url} (${registry.size} tools). Policy approved: ${orchestrator.policy.approved}.`);
  if (!process.env.GATEWAY_TOKEN) console.log(`GATEWAY_TOKEN (generated for this run): ${gatewayToken}`);
  if (generatedSecret) {
    // Without a real LiveKit secret the channel routes need a token we mint ourselves; print one for room "dev-room".
    console.log(`Channel token for room "dev-room": ${signLiveKitToken({ identity: 'dev-tester', room: 'dev-room', ttlS: 3600 }, generatedSecret, Date.now())}`);
    console.log('Rehearsal routes (/dev/rehearsals) are on: the Test page of the studio can start mock sessions (Banking rehearsal).');
  } else {
    console.log('LIVEKIT_API_SECRET is set: rehearsal routes are off (they would mint real room tokens).');
  }
  console.log('Test logins: PhoneCode 1234567 / PIN 135790; account 500000000201 / NRIC digits 1234567 (+ OTP from this console). See README.');
});
