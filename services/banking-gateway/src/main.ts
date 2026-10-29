// Production entry point. It wires the gateway to the real AS400 / Siebel / CMM / OTP adapters.
//
// No real adapters exist yet: they need the SOA/ESB endpoint contracts from the bank's integration team (see
// docs/BANKING-AGENT-DESIGN.md §9). Until then this entry refuses to start rather than silently running on anything
// else. For local development run the mock instead: `npm run start:mock` (mock/main.ts).
//
// When the adapters exist:
//   import { createGateway, readEnv } from './app.ts';
//   import { createGatewayServer } from './http/server.ts';
//   import { createSoaPorts } from './adapters/soa.ts';
//   const env = readEnv(process.env);
//   const { orchestrator, registry } = createGateway({ ports: createSoaPorts(process.env) });
//   createGatewayServer(orchestrator, registry, env).listen(env.port, env.host);

console.error('banking-gateway: no production adapters are wired yet. Run `npm run start:mock` for local development.');
process.exit(1);
