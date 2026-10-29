import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, SCENARIOS } from '../src/studio/banking/scenarios.ts';

// The banking rehearsal's scenarios are judged on what the gateway did in the session, never on what was typed.

test('every scenario starts not run', () => {
  for (const s of SCENARIOS) assert.equal(evaluate(s.id, []).status, 'not_run', s.id);
});

test('a sign-in passes only when the gateway verified the caller with that method', () => {
  const started = [{ type: 'auth', state: 'awaiting_pin' }];
  assert.equal(evaluate('phone_login', started).status, 'in_progress');
  assert.equal(evaluate('phone_login', [...started, { type: 'auth', state: 'authenticated', method: 'phonecode_pin' }]).status, 'passed');
  assert.equal(evaluate('otp_login', [...started, { type: 'auth', state: 'authenticated', method: 'phonecode_pin' }]).status, 'not_run');
});

test('several accounts: the gateway asked which one, then answered for the chosen one', () => {
  const asked = [{ type: 'tool', tool: 'get_balance', ok: false, code: 'choose_account' }];
  assert.equal(evaluate('multi_account', asked).status, 'in_progress');
  assert.equal(evaluate('multi_account', [...asked, { type: 'tool', tool: 'get_balance', ok: true, account: true }]).status, 'passed');
});

test('wrong entries are counted, and lockout passes only on the gateway’s lock', () => {
  const wrong = [{ type: 'capture', purpose: 'pin', accepted: false, via: 'keypad' }];
  const progress = evaluate('lockout', wrong);
  assert.equal(progress.status, 'in_progress');
  assert.match(progress.note, /1 wrong entry/);
  assert.equal(evaluate('lockout', [...wrong, { type: 'auth', state: 'locked', reason: 'too_many_failures' }]).status, 'passed');
});

test('confirmation needs one confirmed and one cancelled request', () => {
  assert.equal(evaluate('confirmation', [{ type: 'confirmation', outcome: 'confirmed' }]).status, 'in_progress');
  assert.equal(
    evaluate('confirmation', [
      { type: 'confirmation', outcome: 'confirmed' },
      { type: 'confirmation', outcome: 'cancelled' },
    ]).status,
    'passed',
  );
});

test('a failure passes on a host error or an unknown outcome, never on a refusal', () => {
  assert.equal(evaluate('failure', [{ type: 'tool', tool: 'get_balance', ok: false, code: 'choose_account' }]).status, 'not_run');
  assert.equal(evaluate('failure', [{ type: 'tool', tool: 'prepare_stop_cheque', ok: false, code: 'as400:196' }]).status, 'passed');
  assert.equal(evaluate('failure', [{ type: 'confirmation', outcome: 'unknown' }]).status, 'passed');
});

test('PIN entry modes need one spoken and one keyed entry, both accepted', () => {
  const spoken = { type: 'capture', purpose: 'pin', accepted: true, via: 'voice' };
  assert.equal(evaluate('pin_modes', [spoken]).status, 'in_progress');
  assert.equal(evaluate('pin_modes', [spoken, { type: 'capture', purpose: 'pin', accepted: false, via: 'keypad' }]).status, 'in_progress');
  assert.equal(evaluate('pin_modes', [spoken, { type: 'capture', purpose: 'pin', accepted: true, via: 'keypad' }]).status, 'passed');
});

test('masking passes after a reveal and then a hide', () => {
  assert.equal(evaluate('masking', [{ type: 'hide' }, { type: 'reveal' }]).status, 'in_progress');
  assert.equal(evaluate('masking', [{ type: 'reveal' }, { type: 'hide' }]).status, 'passed');
});
