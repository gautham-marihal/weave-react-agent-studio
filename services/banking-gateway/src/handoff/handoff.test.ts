import { describe, expect, it } from 'vitest';
import { initialState, type SessionState } from '../fsm/session-machine.ts';
import { buildHandoffContext, NO_HANDOFF } from './handoff.ts';

const anonymous = initialState({ id: 'ses_1', callId: 'call-1', room: 'room-1', channel: 'web_voice', language: 'en', callerId: null, now: 0 });
const verified: SessionState = {
  ...anonymous,
  auth: {
    kind: 'authenticated',
    method: 'phonecode_pin',
    at: 0,
    phoneCode: '1234567',
    customer: { customerId: 'CIF0001', displayName: 'Tan Trading Pte Ltd', segment: 'business', role: null, bizConn: false, firstOtpLogin: false, accounts: [{ number: '500000000101', type: 'CA', currencies: ['SGD'], dormant: false, omnibus: false }] },
  },
  accountRefs: { A1: '500000000101' },
};

describe('handoff context', () => {
  it('carries only what another assistant may know, from server state', () => {
    const context = buildHandoffContext(verified, { intent: 'Wants to stop a cheque', accountRef: 'A1', lastErrorCode: 'as400:196' });
    expect(context).toEqual({
      intent: 'Wants to stop a cheque',
      completed_steps: ['verified', 'account_selected'],
      authenticated: true,
      method: 'phonecode_pin',
      account_ref: 'A1',
      last_error_code: 'as400:196',
      channel: 'web_voice',
      language: 'en',
    });
    const text = JSON.stringify(context);
    for (const secret of ['1234567', '500000000101', 'CIF0001', 'Tan Trading']) expect(text).not.toContain(secret);
  });

  it('strips digit runs from the free-text intent and refuses foreign account refs and odd error codes', () => {
    const context = buildHandoffContext(anonymous, { intent: 'my PIN is 135790 and account 5000-0000-0101', accountRef: 'A1', lastErrorCode: 'Error: stack at foo()' });
    expect(context.intent).toBe('my PIN is [number removed] and account [number removed]');
    expect(context.account_ref).toBeNull();
    expect(context.authenticated).toBe(false);
    expect(context.last_error_code).toBeNull();
  });

  it('the default port never claims a handoff', async () => {
    expect(await NO_HANDOFF.handOff('voice_ai_banking_assistant', buildHandoffContext(anonymous, { intent: 'help' }), new AbortController().signal)).toEqual({ accepted: false, reason: 'not_configured' });
  });
});
