import { jsonLineSink, type AuditSink } from './audit/audit.ts';
import type { HostMode } from './channel/views.ts';
import { LEGACY_POLICY, type Policy } from './domain/policy.ts';
import { Orchestrator } from './orchestrator/orchestrator.ts';
import type { Ports } from './ports/ports.ts';
import { MemorySessionStore, type SessionStore } from './session/store.ts';
import { buildRegistry } from './tools/registry.ts';

// Composition root shared by the production entry (src/main.ts) and the mock entry (mock/main.ts). The only thing
// that differs between them is which `ports` they pass in.

export interface GatewayOptions {
  readonly ports: Ports;
  readonly policy?: Policy;
  readonly store?: SessionStore;
  readonly auditSinks?: AuditSink[];
  readonly clock?: () => number;
  /** 'mock' only from mock/main.ts and the tests; devices and Studio show it so mock data is never taken for real. */
  readonly hosts?: HostMode;
}

export function createGateway(options: GatewayOptions) {
  const registry = buildRegistry();
  const orchestrator = new Orchestrator({
    ports: options.ports,
    policy: options.policy ?? LEGACY_POLICY,
    registry,
    store: options.store ?? new MemorySessionStore(),
    auditSinks: options.auditSinks ?? [jsonLineSink],
    clock: options.clock,
    hosts: options.hosts ?? 'live',
  });
  return { orchestrator, registry };
}

export interface EnvConfig {
  readonly port: number;
  readonly host: string;
  readonly gatewayToken: string;
  readonly liveKitApiSecret: string | null;
  readonly channelOrigins: string[];
}

export function readEnv(env: NodeJS.ProcessEnv): EnvConfig {
  const gatewayToken = env.GATEWAY_TOKEN ?? '';
  if (gatewayToken.length < 32) throw new Error('GATEWAY_TOKEN must be set to a random value of at least 32 characters.');
  return {
    port: Number(env.PORT ?? 8790),
    host: env.HOST ?? 'localhost',
    gatewayToken,
    liveKitApiSecret: env.LIVEKIT_API_SECRET || null,
    channelOrigins: (env.CHANNEL_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}
