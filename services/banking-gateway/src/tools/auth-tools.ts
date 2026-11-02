import type { CustomerProfile } from '../domain/types.ts';
import type { LockReason, SessionState } from '../fsm/session-machine.ts';
import { digits, empty, object } from '../schema/schema.ts';
import type { CapturePurpose } from '../security/capture.ts';
import { safeEqual } from '../security/crypto.ts';
import { declined, defineTool, ok, type ToolContext, type ToolOutcome } from './define.ts';

// Deck p33 "Authentication Process (Common Module)" and p34 "TPIN & OTP 2". The model collects only the
// *identifier* (7-digit PhoneCode or 12-digit account number). Secrets (PIN, NRIC, OTP) arrive through secure
// capture (src/security/capture.ts) and are checked here, in code, by the host. The model never sees them and
// never decides whether they are right.

const LOCK_MESSAGES: Record<LockReason, string> = {
  too_many_failures: 'You have exceeded the maximum number of tries allowed. You may mail in a request for a new Phone PIN using the Corporate Electronic Services Update Form, or speak with a Service Manager.',
  host_locked: 'You have exceeded the maximum number of tries allowed. You may mail in a request for a new Phone PIN using the Corporate Electronic Services Update Form, or speak with a Service Manager.',
  otp_suspended: 'Your One-Time Password feature has been suspended. A Service Manager can help.',
  dormant_account: 'We are unable to proceed with your request. Please visit your nearest OCBC branch.',
  personal_customer: 'This line serves business banking customers. Please call the personal banking line instead.',
  unauthorised_usage: 'We are unable to proceed with your request. A Service Manager can help.',
};

export function authStatus(session: SessionState, maxFailures: number, activeCapture: CapturePurpose | null) {
  const attemptsRemaining = Math.max(0, maxFailures - session.failures);
  const auth = session.auth;
  switch (auth.kind) {
    case 'anonymous':
      return { status: 'not_started', authenticated: false, attempts_remaining: attemptsRemaining, secure_entry_active: false, next: 'start_authentication' as const, message: 'Ask for the seven-digit Phone Code or the twelve-digit account number.' };
    case 'awaiting_pin':
    case 'awaiting_nric':
    case 'awaiting_otp': {
      const step = auth.kind === 'awaiting_pin' ? 'Phone PIN' : auth.kind === 'awaiting_nric' ? 'NRIC or passport digits' : 'one-time password from the SMS';
      return {
        status: auth.kind,
        authenticated: false,
        attempts_remaining: attemptsRemaining,
        secure_entry_active: activeCapture !== null,
        next: 'wait_for_secure_entry' as const,
        message: `Ask the caller to key in their ${step} on the secure keypad. Never ask them to say it aloud.`,
      };
    }
    case 'authenticated':
      return { status: 'authenticated', authenticated: true, method: auth.method, attempts_remaining: attemptsRemaining, secure_entry_active: false, next: 'continue' as const, message: 'The caller is verified.' };
    case 'locked':
      return { status: 'locked', authenticated: false, attempts_remaining: 0, secure_entry_active: false, reason: auth.reason, next: (auth.reason === 'personal_customer' ? 'end_call' : 'offer_transfer') as 'end_call' | 'offer_transfer', message: LOCK_MESSAGES[auth.reason] };
  }
}

const STATUS_FIELDS = ['status', 'authenticated', 'method', 'attempts_remaining', 'secure_entry_active', 'reason', 'message'] as const;

export const startAuthentication = defineTool({
  name: 'start_authentication',
  agents: ['authenticator'],
  description:
    'Start identity verification. Pass EITHER the caller\'s 7-digit Phone Code OR their 12-digit business account number. A secure keypad then opens on the caller\'s device for the PIN (Phone Code route) or NRIC digits and SMS one-time password (account route). Afterwards call get_auth_status. Never ask the caller to say a PIN, NRIC or OTP aloud.',
  access: 'auth_flow',
  service: null,
  effect: 'session',
  params: object({
    phone_code: digits(7, 'The 7-digit Phone Code, if the caller uses one.', { identifier: true }),
    account_number: digits(12, 'The 12-digit account number, if the caller has no Phone Code.', { identifier: true }),
  }),
  llmFields: [...STATUS_FIELDS],
  timeoutMs: 3_000,
  legacy: 'p33 prompt 1172: "Please enter your seven digit Phone Code followed by the # key or enter your twelve digit Account Number"',
  async handler(ctx, args) {
    const { phone_code: phoneCode, account_number: accountNumber } = args;
    if (ctx.session.auth.kind === 'authenticated') return ok(authStatus(ctx.session, ctx.policy.maxAuthFailures, null));
    let next;
    if (phoneCode && !accountNumber) next = ctx.dispatch({ type: 'IDENTIFIED_BY_PHONECODE', phoneCode });
    else if (accountNumber && !phoneCode) next = ctx.dispatch({ type: 'IDENTIFIED_BY_ACCOUNT', accountNumber });
    else return declined('one_identifier', 'Provide exactly one of phone_code or account_number.', 'ask_again');
    const capture = ctx.requestCapture(phoneCode ? 'pin' : 'nric');
    return ok(authStatus(next, ctx.policy.maxAuthFailures, capture.purpose), 'wait_for_secure_entry');
  },
});

export const getAuthStatus = defineTool({
  name: 'get_auth_status',
  agents: ['greeter', 'authenticator'],
  description: 'Check whether the caller is verified, what step is pending and how many attempts remain. Call after the caller says they have finished keying in, and before any account service.',
  access: 'public',
  service: null,
  effect: 'read',
  params: empty(),
  llmFields: [...STATUS_FIELDS],
  timeoutMs: 1_000,
  legacy: 'p33/p34 decision diamonds (Is Response = 00?)',
  async handler(ctx) {
    const status = authStatus(ctx.session, ctx.policy.maxAuthFailures, ctx.activeCapture());
    return ok(status, status.next);
  },
});

export const resendOtp = defineTool({
  name: 'resend_otp',
  agents: ['authenticator'],
  description: 'Send a fresh SMS one-time password when the caller did not receive it. Limited; afterwards offer a Service Manager.',
  access: 'auth_flow',
  service: null,
  effect: 'session',
  params: empty(),
  llmFields: [...STATUS_FIELDS],
  timeoutMs: 8_000,
  legacy: 'p34 "No Input (OTP#)" loop',
  async handler(ctx) {
    const auth = ctx.session.auth;
    if (auth.kind !== 'awaiting_otp') return declined('no_otp_step', 'There is no one-time password step in progress.', 'continue');
    if (auth.otpSends > ctx.policy.maxOtpResends) return declined('resend_limit', 'The one-time password cannot be sent again on this call.', 'offer_transfer');
    return sendOtp(ctx, auth.customer);
  },
});

export const restartAuthentication = defineTool({
  name: 'restart_authentication',
  agents: ['authenticator'],
  description: 'Start verification again with a different Phone Code or account number (for example the caller keyed in the wrong one). Failed attempts still count.',
  access: 'auth_flow',
  service: null,
  effect: 'session',
  params: empty(),
  llmFields: [...STATUS_FIELDS],
  timeoutMs: 1_000,
  legacy: 'MY BB flow p51 option 6: "key in another phone code"',
  async handler(ctx) {
    const next = ctx.dispatch({ type: 'AUTH_RESTART' });
    return ok(authStatus(next, ctx.policy.maxAuthFailures, null), 'start_authentication');
  },
});

// ---- capture handling (called by the orchestrator, never by the model) ----

export interface CaptureContext extends ToolContext {
  /** Per-session scratch for multi-step PIN change. Cleared on success, failure, lock and call end. */
  readonly scratch: Map<string, string>;
}

export interface CaptureOutcome {
  readonly accepted: boolean;
  /** Shown on the caller's keypad. Never contains the value. */
  readonly message: string;
}

export async function handleCapture(ctx: CaptureContext, purpose: CapturePurpose, value: string): Promise<CaptureOutcome> {
  switch (purpose) {
    case 'pin':
      return handlePin(ctx, value);
    case 'nric':
      return handleNric(ctx, value);
    case 'otp':
      return handleOtp(ctx, value);
    case 'current_pin':
    case 'new_pin':
    case 'confirm_new_pin':
      return handlePinChange(ctx, purpose, value);
  }
}

async function handlePin(ctx: CaptureContext, pin: string): Promise<CaptureOutcome> {
  const auth = ctx.session.auth;
  if (auth.kind !== 'awaiting_pin') return { accepted: false, message: 'No PIN was requested.' };
  const result = await ctx.ports.core.loginWithPhoneCode(auth.phoneCode, pin, ctx.signal);
  switch (result.result) {
    case 'ok':
      if (result.customer.segment === 'personal') {
        ctx.dispatch({ type: 'AUTH_BLOCKED', reason: 'personal_customer' });
        return { accepted: false, message: LOCK_MESSAGES.personal_customer };
      }
      ctx.dispatch({ type: 'PIN_ACCEPTED', customer: result.customer });
      indexAccounts(ctx, result.customer);
      ctx.audit('auth.verified', 'ok', { method: 'phonecode_pin' });
      return { accepted: true, message: 'Thank you. You are verified.' };
    case 'invalid_pin':
      return rejected(ctx, 'pin', 'You have entered an invalid Phone PIN.');
    case 'invalid_phonecode':
      return rejected(ctx, 'phonecode', 'You have entered an invalid Phone Code.');
    case 'locked':
      ctx.dispatch({ type: 'AUTH_BLOCKED', reason: 'host_locked' });
      return { accepted: false, message: LOCK_MESSAGES.host_locked };
    case 'unauthorised':
      ctx.dispatch({ type: 'AUTH_BLOCKED', reason: 'unauthorised_usage' });
      return { accepted: false, message: LOCK_MESSAGES.unauthorised_usage };
  }
}

async function handleNric(ctx: CaptureContext, nric: string): Promise<CaptureOutcome> {
  const auth = ctx.session.auth;
  if (auth.kind !== 'awaiting_nric') return { accepted: false, message: 'No NRIC was requested.' };
  const result = await ctx.ports.crm.verifyAccountAndNric(auth.accountNumber, nric, ctx.signal);
  if (result.result === 'invalid_account') return rejected(ctx, 'account', 'You have entered an invalid account number.');
  if (result.result === 'invalid_nric') {
    // Deck p34: invalidAcct = N, invalidContact = Y → CSO transfer. The failure still counts.
    const after = ctx.dispatch({ type: 'CREDENTIAL_REJECTED', stage: 'nric' });
    ctx.audit('auth.rejected', 'refused', { stage: 'nric', failures: after.failures });
    return { accepted: false, message: 'We could not verify these details. A Service Manager can help you.' };
  }
  const account = result.customer.accounts.find((a) => a.number === auth.accountNumber);
  if (account?.dormant) {
    ctx.dispatch({ type: 'AUTH_BLOCKED', reason: 'dormant_account' });
    return { accepted: false, message: LOCK_MESSAGES.dormant_account };
  }
  ctx.dispatch({ type: 'NRIC_ACCEPTED', customer: result.customer });
  const sent = await sendOtp(ctx, result.customer);
  if (sent.status !== 'ok') return { accepted: false, message: sent.message };
  // Deck p34 prompt 1275: first OTP login hears the terms notice.
  const terms = result.customer.firstOtpLogin ? ' By using this service you accept the applicable terms and conditions.' : '';
  return { accepted: true, message: `A one-time password has been sent by SMS to your registered mobile number.${terms}` };
}

async function sendOtp(ctx: ToolContext, customer: CustomerProfile): Promise<ToolOutcome> {
  const sent = await ctx.ports.otp.send(customer.customerId, ctx.signal);
  if (sent.result === 'locked') {
    ctx.dispatch({ type: 'AUTH_BLOCKED', reason: 'otp_suspended' });
    return declined('otp_suspended', LOCK_MESSAGES.otp_suspended, 'offer_transfer');
  }
  const next = ctx.dispatch({ type: 'OTP_SENT' });
  const capture = ctx.requestCapture('otp');
  return ok(authStatus(next, ctx.policy.maxAuthFailures, capture.purpose), 'wait_for_secure_entry');
}

async function handleOtp(ctx: CaptureContext, otp: string): Promise<CaptureOutcome> {
  const auth = ctx.session.auth;
  if (auth.kind !== 'awaiting_otp') return { accepted: false, message: 'No one-time password was requested.' };
  const result = await ctx.ports.otp.verify(auth.customer.customerId, otp, ctx.signal);
  if (result.result === 'locked') {
    ctx.dispatch({ type: 'AUTH_BLOCKED', reason: 'otp_suspended' });
    return { accepted: false, message: LOCK_MESSAGES.otp_suspended };
  }
  if (result.result === 'invalid') return rejected(ctx, 'otp', 'You have entered an invalid One-Time Password.');
  ctx.dispatch({ type: 'OTP_ACCEPTED' });
  indexAccounts(ctx, auth.customer);
  ctx.audit('auth.verified', 'ok', { method: 'account_nric_otp' });
  return { accepted: true, message: 'Thank you. You are verified.' };
}

function rejected(ctx: CaptureContext, stage: 'pin' | 'phonecode' | 'account' | 'otp', message: string): CaptureOutcome {
  const after = ctx.dispatch({ type: 'CREDENTIAL_REJECTED', stage });
  ctx.audit('auth.rejected', 'refused', { stage, failures: after.failures });
  if (after.auth.kind === 'locked') return { accepted: false, message: LOCK_MESSAGES.too_many_failures };
  // A wrong secret re-opens the keypad for the same step; a wrong identifier sends the caller back to the model.
  if (stage === 'pin') ctx.requestCapture('pin');
  if (stage === 'otp') ctx.requestCapture('otp');
  const left = ctx.policy.maxAuthFailures - after.failures;
  return { accepted: false, message: `${message} You have ${left} attempt${left === 1 ? '' : 's'} left.` };
}

function indexAccounts(ctx: ToolContext, customer: CustomerProfile): void {
  const refs: Record<string, string> = {};
  customer.accounts.filter((a) => !a.dormant).forEach((a, i) => (refs[`A${i + 1}`] = a.number));
  ctx.dispatch({ type: 'ACCOUNTS_INDEXED', refs });
}

// Deck p9: current PIN → new PIN (6 digits, not equal to old) → re-enter (must match) → AS400 login → PIN change.
async function handlePinChange(ctx: CaptureContext, purpose: 'current_pin' | 'new_pin' | 'confirm_new_pin', value: string): Promise<CaptureOutcome> {
  const auth = ctx.session.auth;
  if (auth.kind !== 'authenticated' || auth.method !== 'phonecode_pin') return { accepted: false, message: 'PIN change is not available.' };
  if (purpose === 'current_pin') {
    ctx.scratch.set('current', value);
    ctx.requestCapture('new_pin');
    return { accepted: true, message: 'Now key in a new six-digit Phone PIN.' };
  }
  const current = ctx.scratch.get('current');
  if (current === undefined) {
    ctx.scratch.clear();
    return { accepted: false, message: 'Please start the PIN change again.' };
  }
  if (purpose === 'new_pin') {
    if (safeEqual(value, current)) {
      ctx.requestCapture('new_pin');
      return { accepted: false, message: 'The new Phone PIN must be different from the current one. Key in a new PIN.' };
    }
    ctx.scratch.set('new', value);
    ctx.requestCapture('confirm_new_pin');
    return { accepted: true, message: 'Please key in the new Phone PIN again.' };
  }
  const fresh = ctx.scratch.get('new');
  if (fresh === undefined || !safeEqual(value, fresh)) {
    ctx.scratch.delete('new');
    ctx.requestCapture('new_pin');
    return { accepted: false, message: 'The PINs did not match. Key in a new six-digit Phone PIN.' };
  }
  ctx.scratch.clear();
  if (!auth.phoneCode) return { accepted: false, message: 'PIN change is not available.' };
  const result = await ctx.ports.core.changePin(auth.customer.customerId, auth.phoneCode, current, fresh, ctx.signal);
  if (result.result !== 'ok') return rejected(ctx, 'pin', 'The current Phone PIN was not accepted.');
  ctx.dispatch({ type: 'PIN_CHANGED' });
  ctx.audit('pin.changed', 'ok', {});
  return { accepted: true, message: 'Your Phone PIN has been changed. Please use your new Phone PIN for future phone banking transactions.' };
}

export const startPinChange = defineTool({
  name: 'start_pin_change',
  agents: ['accounts'],
  description: 'Let a Phone Code caller change their 6-digit Phone PIN. Opens the secure keypad for the current PIN, then the new PIN twice. Only once per call.',
  access: 'entitled',
  service: 'pin_change',
  effect: 'session',
  params: empty(),
  llmFields: ['status', 'message'],
  timeoutMs: 1_000,
  legacy: 'p9 TPIN Change (15000000)',
  async handler(ctx) {
    if (ctx.session.pinChangedThisCall) {
      return declined('already_changed', 'You have already changed your Phone PIN during this call.', 'continue');
    }
    ctx.requestCapture('current_pin');
    return ok({ status: 'secure_entry_started', message: 'Ask the caller to key in their current Phone PIN on the secure keypad.' }, 'wait_for_secure_entry');
  },
});

export const AUTH_TOOLS = [startAuthentication, getAuthStatus, resendOtp, restartAuthentication, startPinChange];
