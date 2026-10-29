import { AuditLog, type AuditSink } from '../audit/audit.ts';
import { authView, channelStateView, type ChannelStateView, type HostMode } from '../channel/views.ts';
import type { Policy } from '../domain/policy.ts';
import type { Channel, Language, ServiceId } from '../domain/types.ts';
import { INTERNAL_ENTRY, lookupHostError, OUTCOME_UNKNOWN_ENTRY, TIMEOUT_ENTRY } from '../executor/response-matrix.ts';
import { failure, shape, type ToolResponse } from '../executor/respond.ts';
import { currentTxn, entitlement, initialState, transition, type SessionEvent, type SessionState } from '../fsm/session-machine.ts';
import { HostError, type Ports } from '../ports/ports.ts';
import { validate } from '../schema/schema.ts';
import { CaptureService, type CapturePurpose, type CaptureRequest } from '../security/capture.ts';
import { newId } from '../security/crypto.ts';
import { redactArgs } from '../security/redact.ts';
import { EventBus, type ChannelEvent, type ConfirmationOutcome, type GatewayEvent, type TimelineEvent } from '../session/events.ts';
import type { SessionStore } from '../session/store.ts';
import { authStatus, handleCapture, type CaptureContext, type CaptureOutcome } from '../tools/auth-tools.ts';
import { declined, TransitionRefused, type ToolDefinition, type ToolOutcome } from '../tools/define.ts';
import { executeConfirmed } from '../tools/transaction-tools.ts';

// The orchestration engine. It owns everything that must be true regardless of what the model says:
//   - one session per call, mutated only through the state machine, one operation at a time per session;
//   - every tool call validated, authorised, time-boxed, whitelisted, audited and published to the timeline;
//   - secrets enter only through secure capture and leave nowhere.
// The conversation itself (speech, turn-taking, wording) belongs to the Agent Builder runtime.
//
// Two callers reach the same tools: the runtime (the model's tool calls) and the caller's own device (sign-in steps
// and confirmation taps). Both go through #execute, so validation, access, audit and timeline are identical.

export class ProtocolError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ProtocolError';
    this.status = status;
    this.code = code;
  }
}

export interface OrchestratorOptions {
  readonly ports: Ports;
  readonly policy: Policy;
  readonly registry: ReadonlyMap<string, ToolDefinition>;
  readonly store: SessionStore;
  readonly auditSinks: AuditSink[];
  readonly clock?: () => number;
  /** Which host systems the ports talk to. Reported to devices and Studio so a mock is never mistaken for the bank. */
  readonly hosts?: HostMode;
}

/** What a device action returns: the tool's (model-safe) response and the device's fresh view of its session. */
export interface ChannelActionResult {
  readonly result: ToolResponse;
  readonly state: ChannelStateView;
}

type Origin = 'runtime' | 'channel';

export class Orchestrator {
  readonly bus = new EventBus();
  readonly hosts: HostMode;
  readonly #ports: Ports;
  readonly #policy: Policy;
  readonly #registry: ReadonlyMap<string, ToolDefinition>;
  readonly #store: SessionStore;
  readonly #clock: () => number;
  readonly #audit: AuditLog;
  readonly #capture: CaptureService;
  readonly #locks = new Map<string, Promise<unknown>>();
  readonly #scratch = new Map<string, Map<string, string>>();
  /** Transactions that moved to `executing` during the current operation, per session; settled by #settle. */
  readonly #executing = new Map<string, { id: string; service: string }>();

  constructor(options: OrchestratorOptions) {
    this.#ports = options.ports;
    this.#policy = options.policy;
    this.#registry = options.registry;
    this.#store = options.store;
    this.#clock = options.clock ?? Date.now;
    this.hosts = options.hosts ?? 'live';
    this.#audit = new AuditLog(options.auditSinks, this.#clock);
    this.#capture = new CaptureService(options.policy.captureTtlMs);
  }

  get policy(): Policy {
    return this.#policy;
  }

  // ---- session lifecycle (called by the runtime's call-start / call-end events) ----

  startSession(input: { callId: string; room: string | null; channel: Channel; callerId: string | null; language: Language }): SessionState {
    const existing = this.#store.byCallId(input.callId);
    if (existing && !existing.ended) return existing; // idempotent: the runtime may retry
    const state = initialState({ ...input, id: newId('ses'), now: this.#clock() });
    this.#store.compareAndSet(undefined, state);
    this.#writeAudit(state, 'session', 'session.started', 'ok', { channel: input.channel, language: input.language, has_caller_id: Boolean(input.callerId) });
    this.#timeline(state.id, { type: 'session', state: 'started' });
    return state;
  }

  async endSession(callId: string): Promise<void> {
    const session = this.#store.byCallId(callId);
    if (!session || session.ended) return;
    await this.#withLock(session.id, async () => {
      const ctx = this.#context(session.id, new AbortController().signal);
      ctx.dispatch({ type: 'ENDED' });
      this.#forget(session.id);
      this.#timeline(session.id, { type: 'session', state: 'ended' });
    });
  }

  /** Drops idle sessions (no call-end event arrived) and revokes their captures. */
  sweep(): number {
    const removed = this.#store.sweep(this.#clock(), this.#policy.sessionTtlMs);
    for (const s of removed) {
      this.#forget(s.id);
      this.#writeAudit(s, 'session', 'session.expired', 'ok', {});
    }
    return removed.length;
  }

  sessionForRoom(room: string): SessionState | undefined {
    return this.#store.byRoom(room);
  }

  sessionForCall(callId: string): SessionState | undefined {
    return this.#store.byCallId(callId);
  }

  subscribe(sessionId: string, audience: GatewayEvent['audience'], listener: (event: GatewayEvent) => void): () => void {
    return this.bus.subscribe(sessionId, (event) => {
      if (event.audience === audience) listener(event);
    });
  }

  // ---- tool execution (called by the runtime's http tools) ----

  async executeTool(callId: string, toolName: string, rawArgs: unknown): Promise<ToolResponse> {
    const tool = this.#registry.get(toolName);
    if (!tool) throw new ProtocolError(404, 'unknown_tool', `No tool named ${toolName}`);
    const session = this.#store.byCallId(callId);
    if (!session) throw new ProtocolError(404, 'no_session', 'No session for this call. The runtime must call POST /v1/sessions at call start.');
    if (session.ended) throw new ProtocolError(409, 'session_ended', 'This call has ended.');
    return this.#withLock(session.id, () => this.#execute(session.id, tool, rawArgs, 'runtime'));
  }

  /** Runs one tool for one session. Callers hold the session lock. */
  async #execute(sessionId: string, tool: ToolDefinition, rawArgs: unknown, origin: Origin): Promise<ToolResponse> {
    const started = this.#clock();
    const controller = new AbortController();
    const ctx = this.#context(sessionId, controller.signal);
    const args = (typeof rawArgs === 'object' && rawArgs !== null ? rawArgs : {}) as Record<string, unknown>;
    const redacted = redactArgs(args, tool.params.properties);
    let outcome: ToolOutcome;
    let failed = false; // a host, timeout or internal failure, as opposed to a business refusal
    try {
      ctx.dispatch({ type: 'TOOL_CALLED' });
      outcome = await this.#run(tool, ctx, args, controller);
    } catch (error) {
      outcome = this.#errorOutcome(error, this.#executing.has(sessionId));
      failed = !(error instanceof TransitionRefused);
      if (!(error instanceof HostError) && !(error instanceof TransitionRefused) && !isTimeout(error)) {
        this.#writeAudit(ctx.session, 'security', 'tool.internal_error', 'error', { tool: tool.name, error: error instanceof Error ? error.name : 'unknown' });
      }
    } finally {
      controller.abort();
    }
    const shaped = shape(tool, outcome);
    let response = shaped.response;
    if (shaped.leak) {
      // Defence in depth: a handler bug must not hand the model a full account number or NRIC.
      this.#writeAudit(ctx.session, 'security', 'tool.identifier_leak_blocked', 'refused', { tool: tool.name });
      response = failure(INTERNAL_ENTRY.code, INTERNAL_ENTRY.message, INTERNAL_ENTRY.next);
      failed = true;
    }
    const ms = this.#clock() - started;
    const result = response.ok ? 'ok' : failed ? 'failed' : 'refused';
    this.#writeAudit(ctx.session, 'tool', `tool.${tool.name}`, result, { args: redacted, ms, origin, ...(response.ok ? {} : { code: response.error_code }) });
    this.#timeline(sessionId, { type: 'tool', tool: tool.name, outcome: result, ms, origin, ...(response.ok ? {} : { code: String(response.error_code) }) });
    this.#settle(sessionId, response);
    return response;
  }

  async #run(tool: ToolDefinition, ctx: CaptureContext, args: Record<string, unknown>, controller: AbortController): Promise<ToolOutcome> {
    const session = ctx.session;
    if (session.toolCalls > this.#policy.maxToolCallsPerSession) {
      return declined('too_many_requests', 'This call has reached its limit of requests. Offer a Service Manager.', 'offer_transfer');
    }
    const parsed = validate(tool.params, args);
    if (!parsed.ok) {
      // Paths and rules only, never the submitted values.
      return declined('invalid_arguments', parsed.issues.map((i) => `${i.path} ${i.message}`).join('; '), 'ask_again');
    }
    const gate = this.#gate(tool, session);
    if (gate) return gate;
    return timeBox(tool.handler(ctx, parsed.value), tool.timeoutMs, controller);
  }

  /** Access control, decided here from server state. Nothing the model says can change it. */
  #gate(tool: ToolDefinition, session: SessionState): ToolOutcome | null {
    const auth = session.auth;
    if (tool.access === 'public') return null;
    if (auth.kind === 'locked') {
      const status = authStatus(session, this.#policy.maxAuthFailures, null);
      return declined('locked', status.message, status.next);
    }
    if (tool.access === 'auth_flow') return null;
    if (auth.kind !== 'authenticated') return declined('not_authenticated', 'The caller must be verified first. Hand over to verification (start_authentication).', 'start_authentication');
    if (tool.access === 'authenticated') return null;
    const e = entitlement(session, tool.service as ServiceId, this.#policy);
    if (e.ok) return null;
    if (e.reason === 'no_eligible_account') return declined('no_eligible_account', 'The caller has no account that can use this service.', 'offer_transfer');
    return declined('not_entitled', 'This service is not available for this caller\'s access level.', 'offer_transfer');
  }

  /** `writing`: a confirmed write was in flight, so a timeout means its outcome is unknown, not that it failed. */
  #errorOutcome(error: unknown, writing: boolean): ToolOutcome {
    if (error instanceof TransitionRefused) return declined('not_allowed_now', error.message, 'continue');
    const entry = error instanceof HostError ? lookupHostError(error) : isTimeout(error) ? (writing ? OUTCOME_UNKNOWN_ENTRY : TIMEOUT_ENTRY) : INTERNAL_ENTRY;
    return declined(entry.code, entry.message, entry.next, { retryable: entry.retryable, prompt: entry.prompt });
  }

  // ---- channel endpoints (called by the caller's device, bound to the call by its LiveKit token) ----

  /** The device's view of its own session: sign-in state, methods, help, profile, pending confirmation. */
  channelState(sessionId: string): ChannelStateView {
    const session = this.#store.get(sessionId);
    if (!session) throw new ProtocolError(404, 'no_session', 'Session not found');
    const now = this.#clock();
    return channelStateView(session, this.#policy, this.hosts, this.#capture.active(sessionId, now), now);
  }

  /**
   * Sign-in started on the device: the caller types the Phone Code or account number into the sign-in panel, so the
   * identifier never passes through the model. Same tool, same validation and counters as the model's route.
   */
  async identifyFromChannel(sessionId: string, input: { phone_code?: unknown; account_number?: unknown }): Promise<ChannelActionResult> {
    const args = input.phone_code !== undefined ? { phone_code: input.phone_code } : { account_number: input.account_number };
    return this.#channelTool(sessionId, 'start_authentication', args);
  }

  resendOtpFromChannel(sessionId: string): Promise<ChannelActionResult> {
    return this.#channelTool(sessionId, 'resend_otp', {});
  }

  /** "Use a different Phone Code / account" before verification, and "Sign out" after it. Failures are kept. */
  restartFromChannel(sessionId: string): Promise<ChannelActionResult> {
    return this.#channelTool(sessionId, 'restart_authentication', {});
  }

  async #channelTool(sessionId: string, name: string, args: Record<string, unknown>): Promise<ChannelActionResult> {
    const tool = this.#registry.get(name);
    if (!tool) throw new ProtocolError(500, 'misconfigured', `${name} is not registered`);
    return this.#withLock(sessionId, async () => {
      const result = await this.#execute(sessionId, tool, args, 'channel');
      return { result, state: this.channelState(sessionId) };
    });
  }

  /**
   * A fresh keypad for the step in progress: the keypad expired ("I need more time", WCAG 2.2.1) or the device
   * reconnected and lost the one-time token. The token goes back only to the device that asked.
   */
  async reissueCapture(sessionId: string): Promise<CaptureRequest> {
    return this.#withLock(sessionId, async () => {
      const ctx = this.#context(sessionId, new AbortController().signal);
      const auth = ctx.session.auth;
      const implied: CapturePurpose | null = auth.kind === 'awaiting_pin' ? 'pin' : auth.kind === 'awaiting_nric' ? 'nric' : auth.kind === 'awaiting_otp' ? 'otp' : null;
      const purpose = implied ?? (auth.kind === 'authenticated' ? this.#capture.lastPurpose(sessionId) : null);
      if (!purpose) throw new ProtocolError(409, 'nothing_to_enter', 'No secure entry is in progress');
      if (implied === 'otp' && auth.kind === 'awaiting_otp' && auth.otpSends === 0) throw new ProtocolError(409, 'nothing_to_enter', 'No one-time password has been sent');
      this.#writeAudit(ctx.session, 'capture', 'capture.reissued', 'ok', { purpose });
      return ctx.requestCapture(purpose);
    });
  }

  async submitCapture(sessionId: string, token: string, value: string): Promise<CaptureOutcome> {
    return this.#withLock(sessionId, async () => {
      const controller = new AbortController();
      const ctx = this.#context(sessionId, controller.signal);
      const claim = this.#capture.claim(token, value, sessionId, this.#clock());
      if (!claim.ok) {
        this.#writeAudit(ctx.session, 'capture', 'capture.refused', 'refused', { reason: claim.reason });
        if (claim.purpose && claim.reason !== 'wrong_session') ctx.requestCapture(claim.purpose);
        const message = claim.reason === 'bad_format' ? 'That entry has the wrong number of digits. Please try again.' : 'This keypad has expired. A new one is on its way.';
        return this.#captureResult(ctx, claim.purpose ?? 'unknown', { accepted: false, message });
      }
      try {
        const outcome = await timeBox(handleCapture(ctx, claim.purpose, claim.value), 15_000, controller);
        this.#writeAudit(ctx.session, 'capture', `capture.${claim.purpose}`, outcome.accepted ? 'ok' : 'refused', {});
        return this.#captureResult(ctx, claim.purpose, outcome);
      } catch (error) {
        const entry = error instanceof HostError ? lookupHostError(error) : isTimeout(error) ? TIMEOUT_ENTRY : INTERNAL_ENTRY;
        this.#writeAudit(ctx.session, 'capture', `capture.${claim.purpose}`, 'failed', { code: entry.code });
        if (ctx.session.auth.kind !== 'locked') ctx.requestCapture(claim.purpose);
        return this.#captureResult(ctx, claim.purpose, { accepted: false, message: entry.message });
      } finally {
        controller.abort();
      }
    });
  }

  #captureResult(ctx: CaptureContext, purpose: string, outcome: CaptureOutcome): CaptureOutcome {
    const auth = authView(ctx.session, this.#policy, this.#capture.active(ctx.session.id, this.#clock()));
    this.#channel(ctx.session.id, { type: 'capture_result', purpose, accepted: outcome.accepted, message: outcome.message, auth });
    return outcome;
  }

  /** Tap-to-confirm from the chat card. The model is not involved in this decision at all. */
  async confirmFromChannel(sessionId: string, confirmationId: string, decision: 'confirm' | 'cancel'): Promise<ToolResponse> {
    const tool = this.#registry.get(decision === 'confirm' ? 'confirm_transaction' : 'cancel_transaction');
    if (!tool) throw new ProtocolError(500, 'misconfigured', 'Transaction tools are not registered');
    return this.#withLock(sessionId, async () => {
      const controller = new AbortController();
      const ctx = this.#context(sessionId, controller.signal);
      const pending = currentTxn(ctx.session, this.#clock());
      let outcome: ToolOutcome;
      try {
        const gate = this.#gate(tool, ctx.session);
        if (gate) outcome = gate;
        else if (pending.kind !== 'pending' || pending.txn.id !== confirmationId) {
          outcome = declined('no_pending_confirmation', 'This request is no longer waiting for confirmation; it may have expired. Ask for it again.', 'continue');
        } else if (decision === 'confirm') outcome = await timeBox(executeConfirmed(ctx, confirmationId), tool.timeoutMs, controller);
        else {
          ctx.dispatch({ type: 'TXN_CANCELLED', id: confirmationId });
          outcome = { status: 'ok', data: { cancelled: true, message: 'You have cancelled your request.' } };
        }
      } catch (error) {
        outcome = this.#errorOutcome(error, this.#executing.has(sessionId));
      } finally {
        controller.abort();
      }
      const response = shape(tool, outcome).response;
      this.#writeAudit(ctx.session, 'transaction', `channel.${decision}`, response.ok ? 'ok' : 'refused', response.ok ? {} : { code: response.error_code });
      if (!response.ok && response.error_code === 'no_pending_confirmation') {
        this.#channel(sessionId, { type: 'confirmation_closed', confirmationId, outcome: 'expired', message: response.error_message });
      }
      this.#settle(sessionId, response);
      return response;
    });
  }

  /**
   * Tells the device and the timeline how a confirmed write ended, from the actual result: completed only on a real
   * success; `unknown` when the host did not answer in time (it may have run, so the caller must not just retry).
   */
  #settle(sessionId: string, response: ToolResponse): void {
    const executing = this.#executing.get(sessionId);
    if (!executing) return;
    this.#executing.delete(sessionId);
    const outcome: ConfirmationOutcome = response.ok ? 'confirmed' : response.error_code === OUTCOME_UNKNOWN_ENTRY.code ? 'unknown' : 'failed';
    const message = response.ok ? (typeof response.message === 'string' ? response.message : undefined) : response.error_message;
    const reference = response.ok && typeof response.reference === 'string' ? response.reference : undefined;
    this.#channel(sessionId, { type: 'confirmation_closed', confirmationId: executing.id, outcome, ...(message ? { message } : {}), ...(reference ? { reference } : {}) });
    this.#timeline(sessionId, { type: 'transaction', service: executing.service, state: outcome === 'confirmed' ? 'succeeded' : outcome === 'unknown' ? 'unknown' : 'failed' });
  }

  // ---- internals ----

  #context(sessionId: string, signal: AbortSignal): CaptureContext {
    const now = this.#clock();
    const read = () => {
      const s = this.#store.get(sessionId);
      if (!s) throw new ProtocolError(404, 'no_session', 'Session not found');
      return s;
    };
    const scratch = this.#scratch.get(sessionId) ?? new Map<string, string>();
    this.#scratch.set(sessionId, scratch);
    return {
      get session() {
        return read();
      },
      policy: this.#policy,
      ports: this.#ports,
      now,
      signal,
      scratch,
      dispatch: (event: SessionEvent) => {
        const before = read();
        const result = transition(before, event, { policy: this.#policy, now: this.#clock() });
        if (!result.ok) throw new TransitionRefused(result.reason);
        if (!this.#store.compareAndSet(before, result.state)) throw new TransitionRefused('the session changed concurrently');
        this.#afterTransition(before, result.state, event);
        return result.state;
      },
      requestCapture: (purpose: CapturePurpose) => {
        const capture = this.#capture.issue(sessionId, purpose, this.#clock());
        this.#channel(sessionId, { type: 'capture_requested', capture });
        return capture;
      },
      activeCapture: () => this.#capture.activePurpose(sessionId, this.#clock()),
      announceConfirmation: (confirmationId, summary, expiresAt) => this.#channel(sessionId, { type: 'confirmation_requested', confirmationId, summary, expiresAt }),
      eligibleAccounts: (service) => {
        const e = entitlement(read(), service, this.#policy);
        if (!e.ok) throw new TransitionRefused(e.reason);
        return e.accounts;
      },
      recordServiceRequest: async (sr, idempotencyKey) => {
        try {
          const { srNumber } = await this.#ports.crm.createServiceRequest({ ...sr, channel: read().channel }, idempotencyKey, signal);
          return srNumber;
        } catch (error) {
          // Deck: the SR is a record of the call, not part of the caller's transaction. Audit and carry on.
          this.#writeAudit(read(), 'transaction', 'siebel.sr_failed', 'failed', { category: sr.category, error: error instanceof HostError ? error.code : 'unknown' });
          return null;
        }
      },
      audit: (action, outcome, detail) => this.#writeAudit(read(), 'auth', action, outcome, detail),
    };
  }

  #afterTransition(before: SessionState, after: SessionState, event: SessionEvent): void {
    if (before.auth.kind !== after.auth.kind || before.failures !== after.failures) {
      this.#timeline(after.id, { type: 'auth', state: after.auth.kind, failures: after.failures });
      if (after.auth.kind === 'locked' || after.auth.kind === 'anonymous') {
        this.#scratch.get(after.id)?.clear();
      }
      if (after.auth.kind === 'locked' || (after.auth.kind === 'anonymous' && before.auth.kind !== 'anonymous')) this.#capture.revokeSession(after.id);
      this.#channel(after.id, { type: 'auth_changed', auth: authView(after, this.#policy, this.#capture.active(after.id, this.#clock())) });
    }
    if (before.txn.kind === after.txn.kind) return;
    if (after.txn.kind === 'pending') {
      this.#timeline(after.id, { type: 'transaction', service: after.txn.txn.service, state: 'pending' });
    } else if (after.txn.kind === 'executing') {
      this.#executing.set(after.id, { id: after.txn.txn.id, service: after.txn.txn.service });
      this.#timeline(after.id, { type: 'transaction', service: after.txn.txn.service, state: 'executing' });
      this.#channel(after.id, { type: 'confirmation_processing', confirmationId: after.txn.txn.id });
    } else if (before.txn.kind === 'pending') {
      // pending → idle without executing: cancelled by the caller, expired, or dropped (sign-out, lock, call end).
      const txn = before.txn.txn;
      const outcome = event.type === 'TXN_CANCELLED' ? 'cancelled' : 'expired';
      this.#timeline(after.id, { type: 'transaction', service: txn.service, state: outcome });
      this.#channel(after.id, { type: 'confirmation_closed', confirmationId: txn.id, outcome });
    }
    // executing → idle is reported by #settle, which knows whether the host call succeeded.
  }

  #forget(sessionId: string): void {
    this.#capture.revokeSession(sessionId);
    this.#scratch.get(sessionId)?.clear();
    this.#scratch.delete(sessionId);
    this.#executing.delete(sessionId);
  }

  #writeAudit(session: SessionState, kind: 'session' | 'tool' | 'capture' | 'transaction' | 'auth' | 'security', action: string, outcome: 'ok' | 'refused' | 'failed' | 'error', detail: Record<string, unknown>): void {
    this.#audit.write({ sessionId: session.id, callId: session.callId, kind, action, outcome, detail });
  }

  #channel(sessionId: string, event: ChannelEvent): void {
    this.bus.publish({ audience: 'channel', sessionId, at: this.#clock(), ...event });
  }

  #timeline(sessionId: string, event: TimelineEvent): void {
    this.bus.publish({ audience: 'timeline', sessionId, at: this.#clock(), ...event });
  }

  /** One operation per session at a time: tool calls, captures and confirmations never interleave. */
  async #withLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(sessionId) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const tail = run.catch(() => undefined);
    this.#locks.set(sessionId, tail);
    try {
      return await run;
    } finally {
      if (this.#locks.get(sessionId) === tail) this.#locks.delete(sessionId);
    }
  }

  /** For tests and the Studio timeline: the pending confirmation of a session, if any. */
  pendingConfirmation(sessionId: string): string | null {
    const s = this.#store.get(sessionId);
    if (!s) return null;
    const t = currentTxn(s, this.#clock());
    return t.kind === 'pending' ? t.txn.id : null;
  }
}

class TimeoutError extends Error {
  constructor() {
    super('Tool timed out');
    this.name = 'TimeoutError';
  }
}

/** Rejects with TimeoutError after `ms` and aborts the work's signal, so host calls stop too. */
async function timeBox<T>(work: Promise<T>, ms: number, controller: AbortController): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError());
    }, ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const isTimeout = (error: unknown) => error instanceof TimeoutError || (error instanceof DOMException && error.name === 'AbortError');
