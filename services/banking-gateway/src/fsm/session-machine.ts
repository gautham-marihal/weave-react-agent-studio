import type { Policy } from '../domain/policy.ts';
import type { Account, AuthMethod, Channel, CustomerProfile, Language, PreparedTransaction, ServiceId } from '../domain/types.ts';

// The deterministic core. The language model decides what to say; this machine decides what is allowed.
// `transition` is a pure function: same state + event + policy + clock always gives the same result, and an
// event that is not allowed in the current state is refused rather than ignored.
//
// Auth (deck p33 "Authentication Process (Common Module)" and p34 "TPIN & OTP 2"):
//
//   anonymous ──phone code──▶ awaiting_pin ──PIN ok──▶ authenticated(phonecode_pin)
//       │                         │ wrong PIN: stay, count failure
//       └──account no.──▶ awaiting_nric ──NRIC ok──▶ awaiting_otp ──OTP ok──▶ authenticated(account_nric_otp)
//                                                        │ wrong OTP: stay, count failure
//   any state ──failures ≥ policy.maxAuthFailures, host lock, dormant, wrong line──▶ locked (terminal for auth)
//
// Transactions (every write is two-phase):
//
//   idle ──prepare──▶ pending ──confirm──▶ executing ──settled──▶ idle
//                       │ cancel / expiry ──▶ idle

export type LockReason =
  | 'too_many_failures' // cumulative IVR + host failures reached the limit
  | 'host_locked' // host code 62: "exceeded the maximum number of tries"
  | 'otp_suspended' // OTP host locked the feature
  | 'dormant_account' // deck p34/p19: dormant → "visit your nearest branch"
  | 'personal_customer' // deck p33: personal customers must call the personal banking line
  | 'unauthorised_usage'; // host code 50: valid PIN, bad CIF

export type AuthState =
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'awaiting_pin'; readonly phoneCode: string }
  | { readonly kind: 'awaiting_nric'; readonly accountNumber: string }
  | { readonly kind: 'awaiting_otp'; readonly customer: CustomerProfile; readonly otpSends: number }
  | {
      readonly kind: 'authenticated';
      readonly method: AuthMethod;
      readonly customer: CustomerProfile;
      readonly at: number;
      /** Kept server-side for the PIN-change host call; null on the account/OTP route. */
      readonly phoneCode: string | null;
    }
  | { readonly kind: 'locked'; readonly reason: LockReason; readonly at: number };

export type TxnState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'pending'; readonly txn: PreparedTransaction }
  | { readonly kind: 'executing'; readonly txn: PreparedTransaction };

export interface SessionState {
  readonly id: string;
  readonly callId: string;
  readonly room: string | null;
  readonly channel: Channel;
  readonly language: Language;
  readonly callerId: string | null;
  readonly createdAt: number;
  readonly lastActivityAt: number;
  readonly auth: AuthState;
  readonly txn: TxnState;
  /** Cumulative failed identification/credential attempts, host and IVR together. */
  readonly failures: number;
  readonly pinChangedThisCall: boolean;
  readonly toolCalls: number;
  /** Opaque reference → full account number. The model only ever sees the reference. */
  readonly accountRefs: Readonly<Record<string, string>>;
  readonly ended: boolean;
}

export type CredentialStage = 'phonecode' | 'pin' | 'account' | 'nric' | 'otp';

export type SessionEvent =
  | { readonly type: 'IDENTIFIED_BY_PHONECODE'; readonly phoneCode: string }
  | { readonly type: 'IDENTIFIED_BY_ACCOUNT'; readonly accountNumber: string }
  | { readonly type: 'PIN_ACCEPTED'; readonly customer: CustomerProfile }
  | { readonly type: 'NRIC_ACCEPTED'; readonly customer: CustomerProfile }
  | { readonly type: 'OTP_SENT' }
  | { readonly type: 'OTP_ACCEPTED' }
  | { readonly type: 'CREDENTIAL_REJECTED'; readonly stage: CredentialStage }
  | { readonly type: 'AUTH_BLOCKED'; readonly reason: LockReason }
  | { readonly type: 'AUTH_RESTART' }
  | { readonly type: 'ACCOUNTS_INDEXED'; readonly refs: Readonly<Record<string, string>> }
  | { readonly type: 'TXN_PREPARED'; readonly txn: PreparedTransaction }
  | { readonly type: 'TXN_CONFIRMED'; readonly id: string }
  | { readonly type: 'TXN_CANCELLED'; readonly id: string }
  | { readonly type: 'TXN_SETTLED'; readonly id: string }
  | { readonly type: 'PIN_CHANGED' }
  | { readonly type: 'TOOL_CALLED' }
  | { readonly type: 'ENDED' };

export type TransitionResult = { readonly ok: true; readonly state: SessionState } | { readonly ok: false; readonly reason: string };

export interface MachineContext {
  readonly policy: Policy;
  readonly now: number;
}

export function initialState(init: { id: string; callId: string; room: string | null; channel: Channel; language: Language; callerId: string | null; now: number }): SessionState {
  return {
    ...init,
    createdAt: init.now,
    lastActivityAt: init.now,
    auth: { kind: 'anonymous' },
    txn: { kind: 'idle' },
    failures: 0,
    pinChangedThisCall: false,
    toolCalls: 0,
    accountRefs: {},
    ended: false,
  };
}

const refuse = (reason: string): TransitionResult => ({ ok: false, reason });

export function transition(state: SessionState, event: SessionEvent, { policy, now }: MachineContext): TransitionResult {
  if (state.ended) return refuse('session_ended');
  const next = (patch: Partial<SessionState>): TransitionResult => ({ ok: true, state: { ...state, ...patch, lastActivityAt: now } });
  const auth = state.auth;
  const txn = expireTxn(state.txn, now);

  switch (event.type) {
    case 'IDENTIFIED_BY_PHONECODE':
      if (auth.kind !== 'anonymous') return refuse(`cannot identify while ${auth.kind}`);
      return next({ auth: { kind: 'awaiting_pin', phoneCode: event.phoneCode }, txn });

    case 'IDENTIFIED_BY_ACCOUNT':
      if (auth.kind !== 'anonymous') return refuse(`cannot identify while ${auth.kind}`);
      return next({ auth: { kind: 'awaiting_nric', accountNumber: event.accountNumber }, txn });

    case 'PIN_ACCEPTED':
      if (auth.kind !== 'awaiting_pin') return refuse('no PIN was requested');
      return next({ auth: { kind: 'authenticated', method: 'phonecode_pin', customer: event.customer, at: now, phoneCode: auth.phoneCode }, txn });

    case 'NRIC_ACCEPTED':
      if (auth.kind !== 'awaiting_nric') return refuse('no NRIC was requested');
      return next({ auth: { kind: 'awaiting_otp', customer: event.customer, otpSends: 0 }, txn });

    case 'OTP_SENT':
      if (auth.kind !== 'awaiting_otp') return refuse('no OTP step is active');
      if (auth.otpSends > policy.maxOtpResends) return refuse('OTP resend limit reached');
      return next({ auth: { ...auth, otpSends: auth.otpSends + 1 }, txn });

    case 'OTP_ACCEPTED':
      if (auth.kind !== 'awaiting_otp' || auth.otpSends === 0) return refuse('no OTP was sent');
      return next({ auth: { kind: 'authenticated', method: 'account_nric_otp', customer: auth.customer, at: now, phoneCode: null }, txn });

    case 'CREDENTIAL_REJECTED': {
      const expected: Record<CredentialStage, AuthState['kind']> = {
        phonecode: 'awaiting_pin', // the host reports a bad phone code only after the PIN is entered (code 83)
        pin: 'awaiting_pin',
        account: 'awaiting_nric',
        nric: 'awaiting_nric',
        otp: 'awaiting_otp',
      };
      if (auth.kind !== expected[event.stage]) return refuse(`no ${event.stage} step is active`);
      const failures = state.failures + 1;
      if (failures >= policy.maxAuthFailures) {
        return next({ failures, auth: { kind: 'locked', reason: 'too_many_failures', at: now }, txn: { kind: 'idle' } });
      }
      // A wrong identifier sends the caller back to the start; a wrong secret keeps the current step (deck p33).
      const restart = event.stage === 'phonecode' || event.stage === 'account';
      return next({ failures, auth: restart ? { kind: 'anonymous' } : auth, txn });
    }

    case 'AUTH_BLOCKED':
      return next({ auth: { kind: 'locked', reason: event.reason, at: now }, txn: { kind: 'idle' }, accountRefs: {} });

    case 'AUTH_RESTART':
      // Deck (MY flow): "to key in another phone code". Failures are kept so a restart cannot reset the counter.
      if (auth.kind === 'locked') return refuse('authentication is locked for this call');
      if (txn.kind === 'executing') return refuse('a transaction is in progress');
      return next({ auth: { kind: 'anonymous' }, txn: { kind: 'idle' }, accountRefs: {} });

    case 'ACCOUNTS_INDEXED':
      if (auth.kind !== 'authenticated') return refuse('not authenticated');
      return next({ accountRefs: event.refs, txn });

    case 'TXN_PREPARED':
      if (auth.kind !== 'authenticated') return refuse('not authenticated');
      if (txn.kind !== 'idle') return refuse('another request is waiting for confirmation');
      return next({ txn: { kind: 'pending', txn: event.txn } });

    case 'TXN_CONFIRMED':
      if (auth.kind !== 'authenticated') return refuse('not authenticated');
      if (txn.kind !== 'pending' || txn.txn.id !== event.id) return refuse('nothing with that confirmation id is waiting (it may have expired)');
      return next({ txn: { kind: 'executing', txn: txn.txn } });

    case 'TXN_CANCELLED':
      if (txn.kind !== 'pending' || txn.txn.id !== event.id) return refuse('nothing with that confirmation id is waiting');
      return next({ txn: { kind: 'idle' } });

    case 'TXN_SETTLED':
      if (txn.kind !== 'executing' || txn.txn.id !== event.id) return refuse('that transaction is not executing');
      return next({ txn: { kind: 'idle' } });

    case 'PIN_CHANGED':
      if (auth.kind !== 'authenticated' || auth.method !== 'phonecode_pin') return refuse('PIN change needs a PhoneCode login');
      return next({ pinChangedThisCall: true, txn });

    case 'TOOL_CALLED':
      return next({ toolCalls: state.toolCalls + 1, txn });

    case 'ENDED':
      // Drop everything sensitive the moment the call ends; keep only what the audit trail needs.
      return next({ ended: true, auth: { kind: 'anonymous' }, txn: { kind: 'idle' }, accountRefs: {} });
  }
}

function expireTxn(txn: TxnState, now: number): TxnState {
  return txn.kind === 'pending' && txn.txn.expiresAt <= now ? { kind: 'idle' } : txn;
}

/** The transaction state as of `now` (an expired confirmation reads as idle). */
export const currentTxn = (state: SessionState, now: number): TxnState => expireTxn(state.txn, now);

export type EntitlementResult =
  | { readonly ok: true; readonly customer: CustomerProfile | null; readonly accounts: readonly Account[] }
  | { readonly ok: false; readonly reason: 'locked' | 'not_authenticated' | 'not_entitled' | 'no_eligible_account' };

/** May this session use this service right now, and with which accounts? Server-side; the UI never decides this. */
export function entitlement(state: SessionState, service: ServiceId, policy: Policy): EntitlementResult {
  const rule = policy.entitlements[service];
  if (rule === 'public') return { ok: true, customer: null, accounts: [] };
  if (state.auth.kind === 'locked') return { ok: false, reason: 'locked' };
  if (state.auth.kind !== 'authenticated') return { ok: false, reason: 'not_authenticated' };
  const { customer, method } = state.auth;
  const granted = rule.anyOf.some(
    (r) => r.method === method && (!r.roles || (customer.role !== null && r.roles.includes(customer.role))) && (!r.bizConn || customer.bizConn),
  );
  if (!granted) return { ok: false, reason: 'not_entitled' };
  const accounts = customer.accounts.filter((a) => !a.dormant && (!rule.accountTypes || rule.accountTypes.includes(a.type)));
  if (rule.accountTypes && accounts.length === 0) return { ok: false, reason: 'no_eligible_account' };
  return { ok: true, customer, accounts };
}
