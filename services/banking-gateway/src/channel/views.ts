import { authMethods, HELP, type AuthMethodView, type HelpEntry } from '../domain/help.ts';
import type { Policy } from '../domain/policy.ts';
import type { Money } from '../domain/types.ts';
import { currentTxn, entitlement, type LockReason, type SessionState } from '../fsm/session-machine.ts';
import { CAPTURE_FORMAT, type CapturePurpose } from '../security/capture.ts';
import { maskTail } from '../security/redact.ts';
import { authStatus } from '../tools/auth-tools.ts';
import type { NextStep } from '../tools/define.ts';
import { MENU } from '../tools/greeter-tools.ts';

// What the caller's own device may see about its session (GET /v1/channel/state). Built from server state only, so
// the screen shows what the gateway decided, never what the model said. No secret, capture token or full account
// number appears here; the keypad token travels only in a capture_requested event or a reissue response.

export type HostMode = 'mock' | 'live';

export interface SecureEntryView {
  readonly purpose: CapturePurpose;
  readonly label: string;
  readonly min_digits: number;
  readonly max_digits: number;
  readonly expires_at: number;
}

export interface AuthView {
  readonly state: 'not_started' | 'awaiting_pin' | 'awaiting_nric' | 'awaiting_otp' | 'authenticated' | 'locked';
  readonly authenticated: boolean;
  readonly method: 'phonecode_pin' | 'account_nric_otp' | null;
  readonly attempts_remaining: number;
  readonly max_attempts: number;
  readonly lock_reason: LockReason | null;
  readonly otp_resends_left: number | null;
  readonly next: NextStep;
  readonly message: string;
  readonly secure_entry: SecureEntryView | null;
}

export interface AccountView {
  readonly account_ref: string;
  readonly type: string;
  readonly ending: string;
  readonly currencies: readonly string[];
}

export interface ProfileView {
  /** First letter of each word, the rest masked: the caller recognises their business; a shoulder-surfer learns little. */
  readonly business_name_masked: string;
  readonly customer_ref_ending: string;
  readonly method: 'phonecode_pin' | 'account_nric_otp';
  /** AS / AC as returned by the CRM; null for Phone Code users. Meaning unconfirmed (open decision O3). */
  readonly role: 'AS' | 'AC' | null;
  readonly accounts: readonly AccountView[];
  readonly language: 'en' | 'zh';
}

export interface ConfirmationView {
  readonly confirmation_id: string;
  readonly service: string;
  readonly summary: string;
  readonly charge: Money | null;
  readonly expires_at: number;
  readonly state: 'pending' | 'executing';
}

export interface ChannelStateView {
  readonly hosts: HostMode;
  readonly policy_approved: boolean;
  readonly channel: SessionState['channel'];
  readonly auth: AuthView;
  readonly methods: readonly AuthMethodView[];
  readonly profile: ProfileView | null;
  readonly services: { readonly available: readonly string[]; readonly needs_verification: readonly string[] };
  readonly confirmation: ConfirmationView | null;
  readonly help: Readonly<Record<string, HelpEntry>>;
}

const TYPE_LABEL: Record<string, string> = {
  CA: 'Current account',
  ACU: 'Foreign currency account',
  ACU_CHQ: 'Foreign currency checking account',
  ACU_CALL: 'Foreign currency call account',
};

export function maskName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((word) => `${word.slice(0, 1)}${'•'.repeat(Math.min(5, Math.max(0, word.length - 1)))}`)
    .join(' ');
}

export function authView(session: SessionState, policy: Policy, active: { purpose: CapturePurpose; expiresAt: number } | null): AuthView {
  const status = authStatus(session, policy.maxAuthFailures, active?.purpose ?? null);
  const auth = session.auth;
  const state: AuthView['state'] = auth.kind === 'anonymous' ? 'not_started' : auth.kind;
  return {
    state,
    authenticated: status.authenticated,
    method: auth.kind === 'authenticated' ? auth.method : null,
    attempts_remaining: status.attempts_remaining,
    max_attempts: policy.maxAuthFailures,
    lock_reason: auth.kind === 'locked' ? auth.reason : null,
    // OTP_SENT is allowed while otpSends <= maxOtpResends, so sends = 1 + resends.
    otp_resends_left: auth.kind === 'awaiting_otp' ? Math.max(0, policy.maxOtpResends + 1 - auth.otpSends) : null,
    next: status.next,
    // The model-facing text speaks to the agent ("Ask the caller…"); the device gets wording for the caller.
    message: deviceMessage(state, status.message),
    secure_entry: active
      ? { purpose: active.purpose, label: CAPTURE_FORMAT[active.purpose].label, min_digits: CAPTURE_FORMAT[active.purpose].min, max_digits: CAPTURE_FORMAT[active.purpose].max, expires_at: active.expiresAt }
      : null,
  };
}

function deviceMessage(state: AuthView['state'], agentMessage: string): string {
  switch (state) {
    case 'not_started':
      return 'Choose how you want to verify your identity.';
    case 'awaiting_pin':
      return 'Key in your 6-digit Phone PIN on the secure keypad.';
    case 'awaiting_nric':
      return 'Key in the digits of your NRIC or passport number on the secure keypad.';
    case 'awaiting_otp':
      return 'Key in the one-time password we sent to your registered mobile number.';
    case 'authenticated':
      return 'You are verified.';
    case 'locked':
      return agentMessage; // already written for the caller (deck wording)
  }
}

export function profileView(session: SessionState): ProfileView | null {
  const auth = session.auth;
  if (auth.kind !== 'authenticated') return null;
  const accounts = Object.entries(session.accountRefs).flatMap(([ref, number]) => {
    const account = auth.customer.accounts.find((a) => a.number === number);
    return account ? [{ account_ref: ref, type: TYPE_LABEL[account.type] ?? account.type, ending: maskTail(account.number), currencies: account.currencies }] : [];
  });
  return {
    business_name_masked: maskName(auth.customer.displayName),
    customer_ref_ending: maskTail(auth.customer.customerId),
    method: auth.method,
    role: auth.customer.role,
    accounts,
    language: session.language,
  };
}

export function confirmationView(session: SessionState, now: number): ConfirmationView | null {
  const txn = currentTxn(session, now);
  if (txn.kind === 'idle') return null;
  return { confirmation_id: txn.txn.id, service: txn.txn.service, summary: txn.txn.summary, charge: txn.txn.charge, expires_at: txn.txn.expiresAt, state: txn.kind };
}

export function servicesView(session: SessionState, policy: Policy) {
  const available: string[] = [];
  const needsVerification: string[] = [];
  for (const item of MENU) {
    const e = entitlement(session, item.service, policy);
    if (e.ok) available.push(item.label);
    else if (e.reason === 'not_authenticated') needsVerification.push(item.label);
  }
  return { available, needs_verification: needsVerification };
}

export function channelStateView(session: SessionState, policy: Policy, hosts: HostMode, active: { purpose: CapturePurpose; expiresAt: number } | null, now: number): ChannelStateView {
  return {
    hosts,
    policy_approved: policy.approved,
    channel: session.channel,
    auth: authView(session, policy, active),
    methods: authMethods(session.channel, policy),
    profile: profileView(session),
    services: servicesView(session, policy),
    confirmation: confirmationView(session, now),
    help: HELP,
  };
}
