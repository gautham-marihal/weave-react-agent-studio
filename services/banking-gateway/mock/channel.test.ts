import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostError } from '../src/ports/ports.ts';
import type { GatewayEvent } from '../src/session/events.ts';
import { createHarness } from './harness.ts';

// The caller's device: sign-in panel, structured attempt counts, keypad reissue, profile, sign-out, and the honest
// end states of a confirmed write (completed, failed, outcome unknown, cancelled, expired).

const FULL_ACCOUNT = /\b\d{12}\b/;
const of = <T extends GatewayEvent['type']>(events: GatewayEvent[], type: T) => events.filter((e): e is Extract<GatewayEvent, { type: T }> => e.type === type);

describe('channel: sign-in from the device', () => {
  it('shows the methods, help and environment before sign-in, and no profile', () => {
    const h = createHarness();
    const call = h.startCall();
    const state = h.orchestrator.channelState(call.sessionId);
    expect(state.hosts).toBe('mock');
    expect(state.policy_approved).toBe(false);
    expect(state.auth).toMatchObject({ state: 'not_started', authenticated: false, attempts_remaining: 3, max_attempts: 3, secure_entry: null });
    expect(state.methods.map((m) => [m.id, m.available, m.identifier.digits, m.identifier.reveal_allowed])).toEqual([
      ['phonecode_pin', true, 7, true],
      ['account_nric_otp', true, 12, true],
    ]);
    expect(state.profile).toBeNull();
    expect(state.services.needs_verification).toContain('Account balance');
    // Unknown procedures say so instead of inventing one.
    expect(state.help.find_phone_code).toMatchObject({ answer: null, source: 'unknown', approved: false });
  });

  it('lists no usable method on a phone call, with the reason', () => {
    const h = createHarness();
    const call = h.startCall('call-sip', 'sip_voice');
    const methods = h.orchestrator.channelState(call.sessionId).methods;
    expect(methods.every((m) => !m.available && m.unavailable_reason?.includes('not available on a phone call'))).toBe(true);
  });

  it('identifies by Phone Code through the same tool, masks it in the audit and marks the timeline as channel', async () => {
    const h = createHarness();
    const call = h.startCall();
    const timeline: GatewayEvent[] = [];
    h.orchestrator.subscribe(call.sessionId, 'timeline', (e) => timeline.push(e));
    const { result, state } = await h.orchestrator.identifyFromChannel(call.sessionId, { phone_code: '123 4567' });
    expect(result).toMatchObject({ ok: true, status: 'awaiting_pin' });
    expect(state.auth).toMatchObject({ state: 'awaiting_pin', secure_entry: { purpose: 'pin', min_digits: 6, max_digits: 6 } });
    expect(JSON.stringify(state)).not.toMatch(/token/);
    expect(call.keypad().purpose).toBe('pin');
    expect(of(timeline, 'tool')[0]).toMatchObject({ tool: 'start_authentication', origin: 'channel', outcome: 'ok' });
    expect(JSON.stringify(h.audit)).not.toContain('1234567');
  });

  it('refuses a malformed identifier without echoing it', async () => {
    const h = createHarness();
    const call = h.startCall();
    const { result } = await h.orchestrator.identifyFromChannel(call.sessionId, { phone_code: '12ab' });
    expect(result).toMatchObject({ ok: false, error_code: 'invalid_arguments', next: 'ask_again' });
    expect(JSON.stringify(result)).not.toContain('12ab');
  });

  it('reports remaining attempts as data, keeps the count across a restart, then locks', async () => {
    const h = createHarness();
    const call = h.startCall();
    await h.orchestrator.identifyFromChannel(call.sessionId, { phone_code: '1234567' });
    await call.key('000000');
    const first = of(call.channelEvents, 'capture_result').at(-1);
    expect(first).toMatchObject({ accepted: false, auth: { state: 'awaiting_pin', attempts_remaining: 2 } });
    expect(first?.auth.secure_entry?.purpose).toBe('pin'); // a fresh keypad for the same step

    await h.orchestrator.restartFromChannel(call.sessionId);
    await h.orchestrator.identifyFromChannel(call.sessionId, { phone_code: '1234567' });
    await call.key('000000');
    expect(of(call.channelEvents, 'capture_result').at(-1)?.auth.attempts_remaining).toBe(1);
    await call.key('000000');
    const locked = of(call.channelEvents, 'capture_result').at(-1);
    expect(locked?.auth).toMatchObject({ state: 'locked', lock_reason: 'too_many_failures', attempts_remaining: 0, secure_entry: null });
    expect(h.orchestrator.channelState(call.sessionId).auth.state).toBe('locked');
    // Locked is terminal for the call: the device cannot start again.
    expect((await h.orchestrator.identifyFromChannel(call.sessionId, { phone_code: '1234567' })).result).toMatchObject({ ok: false, error_code: 'locked' });
  });

  it('runs the account, NRIC and OTP route with resend limits and keypad reissue', async () => {
    const h = createHarness();
    const call = h.startCall();
    await h.orchestrator.identifyFromChannel(call.sessionId, { account_number: '500000000201' });
    expect(call.keypad().purpose).toBe('nric');
    await call.key('1234567');
    let state = h.orchestrator.channelState(call.sessionId);
    expect(state.auth).toMatchObject({ state: 'awaiting_otp', otp_resends_left: 1, secure_entry: { purpose: 'otp' } });

    // The keypad expires; the device asks for a new one and gets a token only in the response.
    h.advance(h.orchestrator.policy.captureTtlMs + 1);
    expect(h.orchestrator.channelState(call.sessionId).auth.secure_entry).toBeNull();
    const fresh = await h.orchestrator.reissueCapture(call.sessionId);
    expect(fresh).toMatchObject({ purpose: 'otp' });

    const resent = await h.orchestrator.resendOtpFromChannel(call.sessionId);
    expect(resent.state.auth.otp_resends_left).toBe(0);
    expect((await h.orchestrator.resendOtpFromChannel(call.sessionId)).result).toMatchObject({ ok: false, error_code: 'resend_limit' });

    await call.key(call.lastOtp());
    state = h.orchestrator.channelState(call.sessionId);
    expect(state.auth).toMatchObject({ state: 'authenticated', method: 'account_nric_otp' });
  });

  it('will not reissue a keypad when no step needs one', async () => {
    const h = createHarness();
    const call = h.startCall();
    await expect(h.orchestrator.reissueCapture(call.sessionId)).rejects.toMatchObject({ status: 409, code: 'nothing_to_enter' });
  });
});

describe('channel: profile and sign-out', () => {
  it('shows only masked, gateway-authorised profile data', async () => {
    const h = createHarness();
    const call = h.startCall();
    await call.loginWithPhoneCode();
    const { profile, services } = h.orchestrator.channelState(call.sessionId);
    expect(profile?.method).toBe('phonecode_pin');
    expect(profile?.role).toBeNull();
    expect(profile?.accounts.map((a) => a.account_ref)).toEqual(['A1', 'A2', 'A3']);
    expect(profile?.accounts.every((a) => a.ending.startsWith('••••'))).toBe(true);
    expect(profile?.business_name_masked).toMatch(/^\S•*( \S•*)*$/);
    expect(JSON.stringify(profile)).not.toMatch(FULL_ACCOUNT);
    expect(services.available).toContain('Account balance');
  });

  it('signs out: drops the profile and any pending confirmation, keeps the failure count', async () => {
    const h = createHarness();
    const call = h.startCall();
    await call.loginWithAccount();
    const prepared = await call.tool('prepare_stop_cheque', { first_cheque: '100060' });
    expect(h.orchestrator.channelState(call.sessionId).confirmation).toMatchObject({ confirmation_id: prepared.confirmation_id, state: 'pending' });
    const { state } = await h.orchestrator.restartFromChannel(call.sessionId);
    expect(state.auth.state).toBe('not_started');
    expect(state.profile).toBeNull();
    expect(state.confirmation).toBeNull();
    expect(of(call.channelEvents, 'confirmation_closed').at(-1)).toMatchObject({ confirmationId: prepared.confirmation_id, outcome: 'expired' });
    expect(of(call.channelEvents, 'auth_changed').at(-1)?.auth.state).toBe('not_started');
  });
});

describe('channel: confirmed writes end honestly', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function prepared() {
    const h = createHarness();
    const call = h.startCall();
    await call.loginWithAccount();
    const p = await call.tool('prepare_stop_cheque', { first_cheque: '100060' });
    const timeline: GatewayEvent[] = [];
    h.orchestrator.subscribe(call.sessionId, 'timeline', (e) => timeline.push(e));
    return { h, call, id: p.confirmation_id as string, timeline };
  }

  it('processing, then completed only after the host succeeded', async () => {
    const { h, call, id, timeline } = await prepared();
    const response = await h.orchestrator.confirmFromChannel(call.sessionId, id, 'confirm');
    expect(response).toMatchObject({ ok: true });
    expect(of(call.channelEvents, 'confirmation_processing')).toEqual([expect.objectContaining({ confirmationId: id })]);
    expect(of(call.channelEvents, 'confirmation_closed').at(-1)).toMatchObject({ confirmationId: id, outcome: 'confirmed', message: 'Your cheque has been stopped.' });
    expect(of(timeline, 'transaction').map((e) => e.state)).toEqual(['executing', 'succeeded']);
  });

  it('a host refusal is reported as failed, not expired', async () => {
    const { h, call, id, timeline } = await prepared();
    h.controls.failNext('stopCheques', new HostError('as400', '196'));
    expect(await h.orchestrator.confirmFromChannel(call.sessionId, id, 'confirm')).toMatchObject({ ok: false, error_code: 'as400:196' });
    expect(of(call.channelEvents, 'confirmation_closed').at(-1)).toMatchObject({ outcome: 'failed' });
    expect(of(timeline, 'transaction').at(-1)?.state).toBe('failed');
  });

  it('a host that never answers gives outcome unknown, on the card and through the model', async () => {
    const { h, call, id, timeline } = await prepared();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    h.controls.hangNext('stopCheques');
    const pending = h.orchestrator.confirmFromChannel(call.sessionId, id, 'confirm');
    await vi.advanceTimersByTimeAsync(16_000);
    const response = await pending;
    expect(response).toMatchObject({ ok: false, error_code: 'outcome_unknown', next: 'offer_transfer' });
    expect(of(call.channelEvents, 'confirmation_closed').at(-1)).toMatchObject({ outcome: 'unknown' });
    expect(of(timeline, 'transaction').at(-1)?.state).toBe('unknown');

    // The same through the runtime's confirm_transaction (voice).
    vi.useRealTimers();
    const again = await call.tool('prepare_stop_cheque', { first_cheque: '100061' });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    h.controls.hangNext('stopCheques');
    const viaModel = call.tool('confirm_transaction', { confirmation_id: again.confirmation_id as string, caller_words: 'yes please' });
    await vi.advanceTimersByTimeAsync(16_000);
    expect(await viaModel).toMatchObject({ ok: false, error_code: 'outcome_unknown' });
  });

  it('cancel closes the card as cancelled; a replayed confirmation is refused as expired', async () => {
    const { h, call, id } = await prepared();
    expect(await h.orchestrator.confirmFromChannel(call.sessionId, id, 'cancel')).toMatchObject({ ok: true, cancelled: true });
    expect(of(call.channelEvents, 'confirmation_closed').at(-1)).toMatchObject({ outcome: 'cancelled' });
    expect(await h.orchestrator.confirmFromChannel(call.sessionId, id, 'confirm')).toMatchObject({ ok: false, error_code: 'no_pending_confirmation' });
    expect(of(call.channelEvents, 'confirmation_closed').at(-1)).toMatchObject({ outcome: 'expired' });
    expect(h.controls.stopped).toEqual([]);
  });

  it('a confirmation that expired before the tap is refused and nothing runs', async () => {
    const { h, call, id } = await prepared();
    h.advance(h.orchestrator.policy.confirmationTtlMs + 1);
    expect(await h.orchestrator.confirmFromChannel(call.sessionId, id, 'confirm')).toMatchObject({ ok: false, error_code: 'no_pending_confirmation' });
    expect(h.controls.stopped).toEqual([]);
  });
});
