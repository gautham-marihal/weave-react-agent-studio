import { describe, expect, it } from 'vitest';
import type { AuthView } from '../api/gatewayTypes';
import { guidanceFor, type GuidanceActionId } from './bankingGuidance';

const ALL = new Set<GuidanceActionId>(['choose_method', 'new_keypad', 'resend_otp', 'use_other_method', 'ask_for_person', 'request_callback', 'reconnect', 'show_help']);

const auth = (patch: Partial<AuthView>): AuthView => ({
  state: 'not_started',
  authenticated: false,
  method: null,
  attempts_remaining: 3,
  max_attempts: 3,
  lock_reason: null,
  otp_resends_left: null,
  next: 'start_authentication',
  message: '',
  secure_entry: null,
  ...patch,
});

const ids = (g: { actions: readonly { id: string }[] }) => g.actions.map((a) => a.id);

describe('guidanceFor', () => {
  it('no authentication: explains why and offers the sign-in choices', () => {
    const g = guidanceFor({ kind: 'auth', auth: auth({}) }, ALL);
    expect(g.title).toMatch(/Verify your identity/);
    expect(ids(g)).toContain('choose_method');
  });

  it('wrong PIN: shows the gateway\'s own message, which carries the real remaining attempts', () => {
    const g = guidanceFor({ kind: 'capture_failed', message: 'You have entered an invalid Phone PIN. You have 2 attempts left.', auth: auth({ state: 'awaiting_pin', attempts_remaining: 2 }) }, ALL);
    expect(g.body).toBe('You have entered an invalid Phone PIN. You have 2 attempts left.');
    expect(g.announce).toBe('assertive');
  });

  it('a step in progress states the attempts as reported, and offers a new keypad only once it has expired', () => {
    const open = guidanceFor({ kind: 'auth', auth: auth({ state: 'awaiting_pin', attempts_remaining: 1, secure_entry: { purpose: 'pin', label: 'PIN', min_digits: 6, max_digits: 6, expires_at: 0 } }) }, ALL);
    expect(open.body).toContain('1 attempt left');
    expect(ids(open)).not.toContain('new_keypad');
    const expired = guidanceFor({ kind: 'auth', auth: auth({ state: 'awaiting_pin', attempts_remaining: 1 }) }, ALL);
    expect(ids(expired)).toContain('new_keypad');
  });

  it('OTP: offers a resend only while the gateway says resends are left', () => {
    expect(ids(guidanceFor({ kind: 'auth', auth: auth({ state: 'awaiting_otp', otp_resends_left: 1 }) }, ALL))).toContain('resend_otp');
    expect(ids(guidanceFor({ kind: 'auth', auth: auth({ state: 'awaiting_otp', otp_resends_left: 0 }) }, ALL))).not.toContain('resend_otp');
  });

  it('locked: uses the gateway\'s lock wording; personal customers get no transfer offer', () => {
    const locked = guidanceFor({ kind: 'auth', auth: auth({ state: 'locked', lock_reason: 'too_many_failures', message: 'You have exceeded the maximum number of tries allowed.' }) }, ALL);
    expect(locked.body).toBe('You have exceeded the maximum number of tries allowed.');
    expect(ids(locked)).toEqual(['ask_for_person', 'request_callback', 'show_help']);
    expect(ids(guidanceFor({ kind: 'auth', auth: auth({ state: 'locked', lock_reason: 'personal_customer', message: 'Call the personal line.' }) }, ALL))).toEqual([]);
  });

  it('entitlement refusal does not leak policy details', () => {
    const g = guidanceFor({ kind: 'tool', response: { ok: false, error_code: 'not_entitled', error_message: "This service is not available for this caller's access level.", next: 'offer_transfer' } }, ALL);
    expect(g.body).not.toMatch(/AS|AC|role|policy|entitle/);
    expect(ids(g)).toEqual(['ask_for_person']);
  });

  it('timeouts and unknown outcomes never claim success', () => {
    const timeout = guidanceFor({ kind: 'tool', response: { ok: false, error_code: 'timeout', error_message: 'took too long', next: 'offer_transfer' } }, ALL);
    expect(timeout.tone).toBe('danger');
    expect(timeout.body).not.toMatch(/success|completed|done/i);
    const unknown = guidanceFor({ kind: 'confirmation', outcome: 'unknown' }, ALL);
    expect(unknown.title).toMatch(/could not confirm/);
    expect(unknown.body).toMatch(/do not repeat/i);
  });

  it('gateway disconnected: says the service is unavailable', () => {
    const g = guidanceFor({ kind: 'gateway', error: 'unreachable' }, ALL);
    expect(g.title).toBe('Banking services are unavailable');
    expect(g.body).toMatch(/no result is shown/);
  });

  it('only offers actions the screen can perform', () => {
    const g = guidanceFor({ kind: 'needs_person' }, new Set<GuidanceActionId>(['show_help']));
    expect(ids(g)).toEqual(['show_help']);
  });

  it('host matrix messages pass through as written, with the next step the gateway chose', () => {
    const g = guidanceFor({ kind: 'tool', response: { ok: false, error_code: 'as400:196', error_message: 'Some or all of these cheques have already been presented or cleared, so they cannot be stopped.', next: 'continue' } }, ALL);
    expect(g.body).toMatch(/already been presented/);
    expect(ids(g)).toEqual([]);
  });
});
