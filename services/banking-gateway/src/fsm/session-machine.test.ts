import { describe, expect, it } from 'vitest';
import { LEGACY_POLICY } from '../domain/policy.ts';
import type { CustomerProfile, PreparedTransaction } from '../domain/types.ts';
import { entitlement, initialState, transition, type SessionEvent, type SessionState } from './session-machine.ts';

const policy = LEGACY_POLICY;
const now = 1_800_000_000_000;

const customer = (over: Partial<CustomerProfile> = {}): CustomerProfile => ({
  customerId: 'C1',
  displayName: 'Test',
  segment: 'business',
  role: null,
  bizConn: false,
  firstOtpLogin: false,
  accounts: [{ number: '500000000101', type: 'CA', currencies: ['SGD'], dormant: false, omnibus: false }],
  ...over,
});

const fresh = () => initialState({ id: 's', callId: 'c', room: null, channel: 'web_chat', language: 'en', callerId: null, now });

function run(state: SessionState, ...events: SessionEvent[]): SessionState {
  return events.reduce((s, e) => {
    const r = transition(s, e, { policy, now });
    if (!r.ok) throw new Error(`refused ${e.type}: ${r.reason}`);
    return r.state;
  }, state);
}

const txn = (over: Partial<PreparedTransaction> = {}): PreparedTransaction => ({
  id: 'cnf_1',
  service: 'statement_request',
  summary: 's',
  charge: null,
  payload: {},
  idempotencyKey: 'k',
  preparedAt: now,
  expiresAt: now + 60_000,
  ...over,
});

describe('authentication', () => {
  it('PhoneCode + PIN authenticates and keeps the PhoneCode server-side for PIN change', () => {
    const s = run(fresh(), { type: 'IDENTIFIED_BY_PHONECODE', phoneCode: '1234567' }, { type: 'PIN_ACCEPTED', customer: customer() });
    expect(s.auth).toMatchObject({ kind: 'authenticated', method: 'phonecode_pin', phoneCode: '1234567' });
  });

  it('account + NRIC + OTP authenticates only after an OTP was sent', () => {
    const s = run(fresh(), { type: 'IDENTIFIED_BY_ACCOUNT', accountNumber: '500000000201' }, { type: 'NRIC_ACCEPTED', customer: customer({ role: 'AS' }) });
    expect(transition(s, { type: 'OTP_ACCEPTED' }, { policy, now }).ok).toBe(false);
    const done = run(s, { type: 'OTP_SENT' }, { type: 'OTP_ACCEPTED' });
    expect(done.auth).toMatchObject({ kind: 'authenticated', method: 'account_nric_otp' });
  });

  it('a wrong PIN keeps the step; a wrong identifier restarts; failures are cumulative and lock at the limit', () => {
    let s = run(fresh(), { type: 'IDENTIFIED_BY_PHONECODE', phoneCode: '1234567' }, { type: 'CREDENTIAL_REJECTED', stage: 'pin' });
    expect(s.auth.kind).toBe('awaiting_pin');
    s = run(s, { type: 'CREDENTIAL_REJECTED', stage: 'phonecode' });
    expect(s.auth.kind).toBe('anonymous');
    s = run(s, { type: 'IDENTIFIED_BY_PHONECODE', phoneCode: '1234567' }, { type: 'CREDENTIAL_REJECTED', stage: 'pin' });
    expect(s.failures).toBe(3);
    expect(s.auth).toMatchObject({ kind: 'locked', reason: 'too_many_failures' });
  });

  it('a restart cannot reset the failure counter, and nothing un-locks a locked call', () => {
    let s = run(fresh(), { type: 'IDENTIFIED_BY_PHONECODE', phoneCode: '1' }, { type: 'CREDENTIAL_REJECTED', stage: 'pin' }, { type: 'AUTH_RESTART' });
    expect(s.failures).toBe(1);
    s = run(s, { type: 'AUTH_BLOCKED', reason: 'host_locked' });
    for (const e of [{ type: 'AUTH_RESTART' }, { type: 'IDENTIFIED_BY_PHONECODE', phoneCode: '1' }, { type: 'PIN_ACCEPTED', customer: customer() }] as SessionEvent[]) {
      expect(transition(s, e, { policy, now }).ok).toBe(false);
    }
  });

  it('refuses credentials for a step that is not active', () => {
    expect(transition(fresh(), { type: 'PIN_ACCEPTED', customer: customer() }, { policy, now }).ok).toBe(false);
    expect(transition(fresh(), { type: 'CREDENTIAL_REJECTED', stage: 'otp' }, { policy, now }).ok).toBe(false);
  });

  it('limits OTP resends', () => {
    const s = run(fresh(), { type: 'IDENTIFIED_BY_ACCOUNT', accountNumber: 'x' }, { type: 'NRIC_ACCEPTED', customer: customer() }, { type: 'OTP_SENT' }, { type: 'OTP_SENT' });
    expect(transition(s, { type: 'OTP_SENT' }, { policy, now }).ok).toBe(false);
  });
});

describe('transactions', () => {
  const authed = () => run(fresh(), { type: 'IDENTIFIED_BY_PHONECODE', phoneCode: '1' }, { type: 'PIN_ACCEPTED', customer: customer() });

  it('runs prepare → confirm → settle and refuses a second prepare while one is pending', () => {
    let s = run(authed(), { type: 'TXN_PREPARED', txn: txn() });
    expect(transition(s, { type: 'TXN_PREPARED', txn: txn({ id: 'cnf_2' }) }, { policy, now }).ok).toBe(false);
    s = run(s, { type: 'TXN_CONFIRMED', id: 'cnf_1' }, { type: 'TXN_SETTLED', id: 'cnf_1' });
    expect(s.txn.kind).toBe('idle');
  });

  it('refuses to confirm an unknown or expired confirmation', () => {
    const s = run(authed(), { type: 'TXN_PREPARED', txn: txn({ expiresAt: now + 10 }) });
    expect(transition(s, { type: 'TXN_CONFIRMED', id: 'cnf_x' }, { policy, now }).ok).toBe(false);
    expect(transition(s, { type: 'TXN_CONFIRMED', id: 'cnf_1' }, { policy, now: now + 11 }).ok).toBe(false);
  });

  it('cannot prepare before authentication', () => {
    expect(transition(fresh(), { type: 'TXN_PREPARED', txn: txn() }, { policy, now }).ok).toBe(false);
  });

  it('ending the call drops the customer, references and pending work, and refuses everything after', () => {
    const s = run(authed(), { type: 'ACCOUNTS_INDEXED', refs: { A1: '500000000101' } }, { type: 'TXN_PREPARED', txn: txn() }, { type: 'ENDED' });
    expect(s).toMatchObject({ ended: true, auth: { kind: 'anonymous' }, txn: { kind: 'idle' }, accountRefs: {} });
    expect(transition(s, { type: 'TOOL_CALLED' }, { policy, now }).ok).toBe(false);
  });
});

describe('entitlements (deck p3 / p10)', () => {
  const as = (role: 'AS' | 'AC', bizConn = false) =>
    run(fresh(), { type: 'IDENTIFIED_BY_ACCOUNT', accountNumber: 'x' }, { type: 'NRIC_ACCEPTED', customer: customer({ role, bizConn }) }, { type: 'OTP_SENT' }, { type: 'OTP_ACCEPTED' });

  it('public services need nothing; private ones need authentication', () => {
    expect(entitlement(fresh(), 'rates', policy).ok).toBe(true);
    expect(entitlement(fresh(), 'account_balance', policy)).toEqual({ ok: false, reason: 'not_authenticated' });
  });

  it('Authorised Contacts may see incoming funds but not balances, statements or stop cheques', () => {
    const s = as('AC');
    expect(entitlement(s, 'incoming_funds', policy).ok).toBe(true);
    expect(entitlement(s, 'account_balance', policy).ok).toBe(false);
    expect(entitlement(s, 'statement_request', policy).ok).toBe(false);
    expect(entitlement(s, 'stop_cheque', policy).ok).toBe(false);
  });

  it('PIN change is for PhoneCode users only; FD & loan needs BizConn', () => {
    expect(entitlement(as('AS'), 'pin_change', policy).ok).toBe(false);
    expect(entitlement(as('AS'), 'fd_loan', policy).ok).toBe(false);
    expect(entitlement(as('AS', true), 'fd_loan', policy).ok).toBe(true);
  });

  it('dormant accounts are never eligible', () => {
    const s = run(fresh(), { type: 'IDENTIFIED_BY_PHONECODE', phoneCode: '1' }, { type: 'PIN_ACCEPTED', customer: customer({ accounts: [{ number: '1', type: 'CA', currencies: ['SGD'], dormant: true, omnibus: false }] }) });
    expect(entitlement(s, 'account_balance', policy)).toEqual({ ok: false, reason: 'no_eligible_account' });
  });
});
