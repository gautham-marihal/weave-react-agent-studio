import type { Policy } from '../domain/policy.ts';
import type { Account, ServiceId } from '../domain/types.ts';
import type { SessionEvent, SessionState } from '../fsm/session-machine.ts';
import type { Ports } from '../ports/ports.ts';
import type { Infer, Schema } from '../schema/schema.ts';
import type { CapturePurpose, CaptureRequest } from '../security/capture.ts';
import type { ServiceRequest } from '../ports/ports.ts';

/** The specialist agent that owns a tool. Mirrors `agents.items` in the generated agent config (≤ 8 tools each). */
export type AgentGroup = 'greeter' | 'authenticator' | 'accounts' | 'cheques' | 'rates_info' | 'appointments';

/**
 * - public: anyone, any time (rates, branches, callbacks).
 * - auth_flow: drives authentication; refused once the session is locked.
 * - authenticated: needs a verified caller (any service).
 * - entitled: needs a verified caller entitled to `service` (policy.entitlements).
 */
export type Access = 'public' | 'auth_flow' | 'authenticated' | 'entitled';

/**
 * - read: no side effects.
 * - prepare: records a pending write; nothing reaches a host until it is confirmed.
 * - commit: executes a confirmed write (idempotency key enforced).
 * - session: changes call state only (language choice, restart).
 */
export type Effect = 'read' | 'prepare' | 'commit' | 'session';

/** What the model should do next. Keeps recovery deterministic instead of improvised. */
export type NextStep =
  | 'continue'
  | 'retry'
  | 'ask_again'
  | 'wait_for_secure_entry'
  | 'start_authentication'
  | 'confirm_or_cancel'
  | 'offer_transfer'
  | 'offer_callback'
  | 'transfer_now'
  | 'end_call';

export type ToolOutcome =
  | { readonly status: 'ok'; readonly data: Readonly<Record<string, unknown>>; readonly next?: NextStep }
  | { readonly status: 'declined'; readonly code: string; readonly message: string; readonly next: NextStep; readonly data?: Readonly<Record<string, unknown>> };

export interface ToolContext {
  readonly session: SessionState;
  readonly policy: Policy;
  readonly ports: Ports;
  readonly now: number;
  readonly signal: AbortSignal;
  /** Applies an event through the state machine; throws TransitionRefused if the machine refuses it. */
  dispatch(event: SessionEvent): SessionState;
  /** Issues a one-time secure capture and sends it to the channel client (never to the model). */
  requestCapture(purpose: CapturePurpose): CaptureRequest;
  /** The purpose of the keypad currently open for this session, if any. */
  activeCapture(): CapturePurpose | null;
  /** Publishes a confirmation card to the channel client, for a deterministic tap-to-confirm in chat. */
  announceConfirmation(confirmationId: string, summary: string, expiresAt: number): void;
  /** Accounts the caller may use for a service (entitlement already checked by the executor). */
  eligibleAccounts(service: ServiceId): readonly Account[];
  /** Records a Siebel service request; failures are audited and never fail the caller's transaction. */
  recordServiceRequest(sr: Omit<ServiceRequest, 'channel'>, idempotencyKey: string): Promise<string | null>;
  audit(action: string, outcome: 'ok' | 'refused' | 'failed', detail: Record<string, unknown>): void;
}

export interface ToolDefinition<S extends Schema<object> = Schema<object>> {
  /** The name the model sees and calls. snake_case, unique. */
  readonly name: string;
  /** Agents that are offered this tool. Each agent stays within the runtime lint limit of 8 tools. */
  readonly agents: readonly AgentGroup[];
  /** Written for the model: when to call it and what it returns. */
  readonly description: string;
  readonly access: Access;
  readonly service: ServiceId | null;
  readonly effect: Effect;
  readonly params: S & { readonly properties: Readonly<Record<string, Schema<unknown>>> };
  /** Whitelist of result fields the model may see. Anything else a handler returns is dropped. */
  readonly llmFields: readonly string[];
  /** Result fields the runtime should copy into call state (`result.to_state`). Never sensitive. */
  readonly stateFields?: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  /** Where this behaviour comes from in the legacy deck, for traceability and test review. */
  readonly legacy: string;
  readonly handler: (ctx: ToolContext, args: Infer<S>) => Promise<ToolOutcome>;
}

/** Keeps the args type tied to the schema while storing tools in one list. */
export function defineTool<S extends Schema<object> & { readonly properties: Readonly<Record<string, Schema<unknown>>> }>(tool: ToolDefinition<S>): ToolDefinition {
  return tool as unknown as ToolDefinition;
}

export const ok = (data: Record<string, unknown>, next?: NextStep): ToolOutcome => ({ status: 'ok', data, ...(next ? { next } : {}) });

export const declined = (code: string, message: string, next: NextStep, data?: Record<string, unknown>): ToolOutcome => ({
  status: 'declined',
  code,
  message,
  next,
  ...(data ? { data } : {}),
});

/** Thrown by ToolContext.dispatch when the state machine refuses an event. */
export class TransitionRefused extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'TransitionRefused';
  }
}
