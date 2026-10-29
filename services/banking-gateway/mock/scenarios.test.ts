import { describe, expect, it } from 'vitest';
import { HostError } from '../src/ports/ports.ts';
import { MOCK_CUSTOMERS } from './fixtures.ts';
import { createHarness } from './harness.ts';

// End-to-end call flows from the legacy deck, run through the real orchestrator on mock host systems.

describe('authentication flows (deck p33, p34)', () => {
  it('PhoneCode + PIN: the PIN goes through the keypad, the model only learns "verified"', async () => {
    const h = createHarness();
    const call = h.startCall();
    const start = await call.tool('start_authentication', { phone_code: '1234567' });
    expect(start).toMatchObject({ ok: true, status: 'awaiting_pin', next: 'wait_for_secure_entry' });
    expect(call.keypad()).toMatchObject({ purpose: 'pin', minDigits: 6, maxDigits: 6 });
    expect(await call.key('135790')).toEqual({ accepted: true, message: 'Thank you. You are verified.' });
    expect(await call.tool('get_auth_status')).toMatchObject({ ok: true, authenticated: true, method: 'phonecode_pin' });
  });

  it('three wrong attempts (IVR + host, cumulative) lock the call and close every account service', async () => {
    const h = createHarness();
    const call = h.startCall();
    await call.tool('start_authentication', { phone_code: '1234567' });
    expect((await call.key('000000')).message).toContain('2 attempts left');
    expect((await call.key('000001')).message).toContain('1 attempt left');
    expect((await call.key('000002')).message).toContain('exceeded the maximum number of tries');
    expect(await call.tool('get_balance')).toMatchObject({ ok: false, error_code: 'locked', next: 'offer_transfer' });
    expect(await call.tool('start_authentication', { phone_code: '1234567' })).toMatchObject({ ok: false, error_code: 'locked' });
    expect(await call.tool('get_fx_rate', { currency: 'USD' })).toMatchObject({ ok: true }); // public services still work
  });

  it('account + NRIC + SMS OTP, with the first-login terms notice', async () => {
    const h = createHarness();
    const call = h.startCall();
    await call.tool('start_authentication', { account_number: '5000 0000 0201' });
    const nric = await call.key('1234567');
    expect(nric.message).toContain('terms and conditions');
    expect(call.keypad().purpose).toBe('otp');
    expect(await call.key(call.lastOtp())).toMatchObject({ accepted: true });
    expect(await call.tool('get_auth_status')).toMatchObject({ authenticated: true, method: 'account_nric_otp' });
  });

  it('a wrong NRIC sends the caller to a Service Manager (deck p34 invalidContact)', async () => {
    const h = createHarness();
    const call = h.startCall();
    await call.tool('start_authentication', { account_number: '500000000201' });
    expect(await call.key('1111111')).toMatchObject({ accepted: false, message: expect.stringContaining('Service Manager') });
  });

  it('personal customers are redirected, dormant accounts sent to a branch, host locks honoured', async () => {
    const h = createHarness();
    const personal = h.startCall('p');
    await personal.loginWithPhoneCode('7777777', '111111');
    expect(await personal.tool('get_auth_status')).toMatchObject({ status: 'locked', reason: 'personal_customer', next: 'end_call' });

    const dormant = h.startCall('d');
    await dormant.tool('start_authentication', { account_number: '500000000501' });
    expect((await dormant.key('9999999')).message).toContain('nearest OCBC branch');

    const locked = h.startCall('l');
    expect((await locked.loginWithPhoneCode('6666666', '222222')).message).toContain('exceeded');
  });

  it('a capture token works once and only for its own session', async () => {
    const h = createHarness();
    const a = h.startCall('a');
    const b = h.startCall('b');
    await a.tool('start_authentication', { phone_code: '1234567' });
    const token = a.keypad().token;
    expect(await h.orchestrator.submitCapture(b.sessionId, token, '135790')).toMatchObject({ accepted: false });
    expect(await h.orchestrator.submitCapture(a.sessionId, token, '135790')).toMatchObject({ accepted: true });
    expect(await h.orchestrator.submitCapture(a.sessionId, token, '135790')).toMatchObject({ accepted: false });
  });
});

describe('account services (deck p4–p8)', () => {
  it('refuses account tools before verification', async () => {
    const call = createHarness().startCall();
    expect(await call.tool('get_balance')).toMatchObject({ ok: false, error_code: 'not_authenticated', next: 'start_authentication' });
  });

  it('asks which account when there are several, then reads the balance with the deck wording', async () => {
    const call = createHarness().startCall();
    await call.loginWithPhoneCode();
    const choose = await call.tool('get_balance');
    expect(choose).toMatchObject({ ok: false, error_code: 'choose_account' });
    expect(JSON.stringify(choose)).not.toMatch(/\d{12}/);
    const a1 = await call.tool('get_balance', { account_ref: 'A1' });
    expect(a1.say).toBe(
      'Your account balance is 12,500 dollars and 40 cents. Your available balance is 11,250 dollars and 40 cents. The difference is due to cheques pending clearance of 250 dollars and a hold amount of 1,000 dollars.',
    );
    expect(a1).toMatchObject({ current: 'SGD 12,500.40', available: 'SGD 11,250.40', hold: 'SGD 1,000.00', pending_clearance: 'SGD 250.00', overdraft_limit: null, in_debit: false, facility_notice: false });
    const a2 = await call.tool('get_balance', { account_ref: 'A2' });
    expect(a2).toMatchObject({ current: '-SGD 1,820.05', in_debit: true, hold: null, overdraft_limit: 'SGD 5,000.00', facility_notice: true });
    expect(a2.say).toContain('Please take note that the availability of balances');
    expect(a2.say).toContain('Your account balance is in debit of 1,820 dollars and 5 cents.');
    expect(a2.say).toContain('Your overdraft limit is 5,000 dollars.');
  });

  it('asks for the currency of a multi-currency account and reads FCY as "point"', async () => {
    const call = createHarness().startCall();
    await call.loginWithPhoneCode();
    expect(await call.tool('get_balance', { account_ref: 'A3' })).toMatchObject({ ok: false, error_code: 'choose_currency', currencies: ['USD', 'EUR'] });
    expect((await call.tool('get_balance', { account_ref: 'A3', currency: 'EUR' })).say).toContain('980 point 50 euros');
  });

  it('pages incoming funds 9 at a time, newest first', async () => {
    const call = createHarness().startCall();
    await call.loginWithPhoneCode();
    const page1 = await call.tool('get_incoming_funds', { account_ref: 'A1' });
    expect(page1).toMatchObject({ ok: true, page: 1, has_more: true, total: 12 });
    expect(page1.items as unknown[]).toHaveLength(9);
    expect((page1.items as Array<{ today: boolean }>)[0]?.today).toBe(true);
    expect(await call.tool('get_incoming_funds', { account_ref: 'A1', page: 2 })).toMatchObject({ page: 2, has_more: false });
  });

  it('statement request: prepare, read back, confirm on an explicit yes, record the Siebel SR', async () => {
    const h = createHarness();
    const call = h.startCall();
    await call.loginWithPhoneCode();
    const prepared = await call.tool('prepare_statement_request', { account_ref: 'A1', period: 'current_month' });
    expect(prepared).toMatchObject({ ok: true, next: 'confirm_or_cancel', summary: 'A statement from 1 October 2026 to 27 October 2026 for the current account ending 0101, sent to you within 7 working days.' });
    const id = prepared.confirmation_id as string;
    expect(await call.tool('confirm_transaction', { confirmation_id: id, caller_words: 'hmm, maybe' })).toMatchObject({ ok: false, error_code: 'not_confirmed' });
    expect(await call.tool('confirm_transaction', { confirmation_id: id, caller_words: 'Yes, go ahead' })).toMatchObject({ ok: true, done: true });
    expect(h.controls.serviceRequests.at(-1)).toMatchObject({ category: 'ACCOUNT SERVICES', subCategory: 'COPY OF STATEMENT (C/P/I)' });
    expect(await call.tool('confirm_transaction', { confirmation_id: id, caller_words: 'yes' })).toMatchObject({ ok: false, error_code: 'no_pending_confirmation' });
  });

  it('older statements go to a Service Manager; a confirmation expires', async () => {
    const h = createHarness();
    const call = h.startCall();
    await call.loginWithPhoneCode();
    expect(await call.tool('prepare_statement_request', { period: 'older' })).toMatchObject({ ok: false, next: 'offer_transfer' });
    const prepared = await call.tool('prepare_statement_request', { account_ref: 'A1', period: 'previous_month' });
    h.advance(h.orchestrator.policy.confirmationTtlMs + 1);
    expect(await call.tool('confirm_transaction', { confirmation_id: prepared.confirmation_id as string, caller_words: 'yes' })).toMatchObject({ ok: false, error_code: 'no_pending_confirmation' });
  });

  it('Authorised Contacts are not offered balances (deck p3: P or AS only)', async () => {
    const call = createHarness().startCall();
    await call.loginWithAccount('500000000301', '7654321');
    expect(await call.tool('get_balance')).toMatchObject({ ok: false, error_code: 'not_entitled' });
    expect(await call.tool('get_recent_transactions')).toMatchObject({ ok: true, message: 'There is no account activity.' });
  });
});

describe('cheque services (deck p10–p16)', () => {
  it('stop payment on a range: charge, explicit confirmation, host success', async () => {
    const h = createHarness();
    const call = h.startCall();
    await call.loginWithAccount();
    const prepared = await call.tool('prepare_stop_cheque', { first_cheque: '100060', last_cheque: '100062' });
    expect(prepared.summary).toBe('Stop payment on cheque numbers 100060 to 100062 for the account ending 0201, with a charge of 30 dollars.');
    expect(await call.tool('confirm_transaction', { confirmation_id: prepared.confirmation_id as string, caller_words: 'yes' })).toMatchObject({ ok: true, message: 'Your cheques have been stopped.' });
    expect(h.controls.stopped).toEqual([{ account: '500000000201', from: '100060', to: '100062' }]);
  });

  it('enforces the range rules before the host and maps host codes 196 / 192', async () => {
    const call = createHarness().startCall();
    await call.loginWithAccount();
    expect(await call.tool('prepare_stop_cheque', { first_cheque: '100001', last_cheque: '100060' })).toMatchObject({ error_code: 'range_too_large' });
    expect(await call.tool('prepare_stop_cheque', { first_cheque: '100045', last_cheque: '100055' })).toMatchObject({ error_code: 'range_across_books' });
    const p = await call.tool('prepare_stop_cheque', { first_cheque: '100005' });
    expect(await call.tool('confirm_transaction', { confirmation_id: p.confirmation_id as string, caller_words: 'yes' })).toMatchObject({ ok: false, error_code: 'as400:196', next: 'continue' });
    // The failed transaction is settled, so a new one can be prepared.
    expect(await call.tool('prepare_stop_cheque', { first_cheque: '100007' })).toMatchObject({ ok: true });
  });

  it('Authorised Contacts cannot stop cheques', async () => {
    const call = createHarness().startCall();
    await call.loginWithAccount('500000000301', '7654321');
    expect(await call.tool('prepare_stop_cheque', { first_cheque: '100060' })).toMatchObject({ ok: false, error_code: 'not_entitled' });
  });

  it('offers cheque book delivery options by cut-off time', async () => {
    const h = createHarness();
    const call = h.startCall();
    await call.loginWithAccount();
    expect(await call.tool('prepare_chequebook_request')).toMatchObject({ error_code: 'choose_delivery', options: ['same_day', 'next_day', 'standard'] });
    h.advance(60 * 60_000); // 10:30: the same-day option has closed
    expect(await call.tool('prepare_chequebook_request', { delivery: 'same_day' })).toMatchObject({ error_code: 'choose_delivery', options: ['next_day', 'standard'] });
    expect((await call.tool('prepare_chequebook_request', { delivery: 'next_day' })).summary).toContain('charge of 18 dollars');
  });

  it('reads issued cheque status', async () => {
    const call = createHarness().startCall();
    await call.loginWithPhoneCode();
    expect((await call.tool('get_issued_cheque_status', { account_ref: 'A1', cheque_number: '100006' })).say).toContain('was returned due to signature differs');
  });
});

describe('PIN change (deck p9)', () => {
  it('runs current → new → re-enter through the keypad, then refuses a second change in the same call', async () => {
    const h = createHarness();
    const call = h.startCall();
    await call.loginWithPhoneCode();
    await call.tool('start_pin_change');
    expect((await call.key('135790')).accepted).toBe(true);
    expect(await call.key('135790')).toMatchObject({ accepted: false, message: expect.stringContaining('different') });
    expect((await call.key('246801')).accepted).toBe(true);
    expect(await call.key('246800')).toMatchObject({ accepted: false, message: expect.stringContaining('did not match') });
    await call.key('246801');
    expect(await call.key('246801')).toMatchObject({ accepted: true, message: expect.stringContaining('has been changed') });
    expect(await call.tool('start_pin_change')).toMatchObject({ ok: false, error_code: 'already_changed' });
    // The new PIN works on a new call.
    const next = h.startCall('call-2');
    expect((await next.loginWithPhoneCode('1234567', '246801')).accepted).toBe(true);
  });
});

describe('public services, routing and failures', () => {
  it('rates with deck wording; host code 33 maps to prompt 1119', async () => {
    const h = createHarness();
    const call = h.startCall();
    expect((await call.tool('get_time_deposit_rates')).say).toBe('Minimum deposit 5,000 dollars. For 1 to 2 months, 0 point 05 percent. For 3 months, 0 point 1 percent. For 6 months, 0 point 25 percent. For 12 months, 0 point 5 percent.');
    expect((await call.tool('get_fx_rate', { currency: 'JPY' })).say).toContain('For 100 JPY');
    h.controls.failNext('primeRate', new HostError('as400', '33'));
    expect(await call.tool('get_prime_rate')).toMatchObject({ ok: false, error_code: 'as400:33', error_message: 'Rates for this option are currently unavailable.' });
  });

  it('transfers within hours with a CTI context; offers a callback outside hours; refuses duplicate callbacks', async () => {
    const h = createHarness();
    const call = h.startCall();
    expect(await call.tool('prepare_agent_transfer', { topic: 'stop_cheque', reason: 'wants to discuss charges' })).toMatchObject({ ok: true, within_hours: true, route: 'bi_segment', context_id: 'SR-MOCK-00001', next: 'transfer_now' });
    h.advance(10 * 60 * 60_000); // 19:30
    expect(await call.tool('prepare_agent_transfer', { topic: 'general', reason: 'question' })).toMatchObject({ within_hours: false, next: 'offer_callback' });
    expect(await call.tool('request_callback', { reason: 'question' })).toMatchObject({ created: true, number_ending: '••••4567' });
    expect(await call.tool('request_callback', { reason: 'again' })).toMatchObject({ created: false });
  });

  it('lost card goes to a high-priority transfer even after hours', async () => {
    const h = createHarness(Date.parse('2026-10-27T14:00:00Z')); // 22:00 SGT
    const call = h.startCall();
    expect(await call.tool('report_lost_card', { account_number: '500000000101' })).toMatchObject({ route: 'card_ops_after_hours', priority: 'high', next: 'transfer_now' });
  });

  it('rejects malformed and smuggled arguments without echoing them', async () => {
    const call = createHarness().startCall();
    const r = await call.tool('get_fx_rate', { currency: 'XAU', pin: '135790' });
    expect(r).toMatchObject({ ok: false, error_code: 'invalid_arguments', next: 'ask_again' });
    expect(JSON.stringify(r)).not.toContain('135790');
  });

  it('caps tool calls per session', async () => {
    const h = createHarness();
    const call = h.startCall();
    for (let i = 0; i < h.orchestrator.policy.maxToolCallsPerSession; i++) await call.tool('get_prime_rate');
    expect(await call.tool('get_prime_rate')).toMatchObject({ ok: false, error_code: 'too_many_requests' });
  });

  it('times out a slow host and says so safely', async () => {
    const h = createHarness();
    const call = h.startCall();
    const tool = h.registry.get('get_prime_rate')!;
    const slow = { ...tool, timeoutMs: 5, handler: () => new Promise<never>(() => undefined) };
    (h.registry as Map<string, typeof tool>).set('get_prime_rate', slow);
    expect(await call.tool('get_prime_rate')).toMatchObject({ ok: false, error_code: 'timeout', next: 'offer_transfer' });
  });
});

describe('secrets never leak', () => {
  it('no PIN, NRIC, OTP, capture token or full account number appears in tool responses, audit records or the timeline', async () => {
    const h = createHarness();
    const timeline: unknown[] = [];
    const a = h.startCall('a');
    h.orchestrator.subscribe(a.sessionId, 'timeline', (e) => timeline.push(e));
    const responses: unknown[] = [];
    responses.push(await a.tool('start_authentication', { phone_code: '1234567' }));
    const tokens = [a.keypad().token];
    await a.key('000000');
    tokens.push(a.keypad().token);
    await a.key('135790');
    responses.push(await a.tool('list_accounts'), await a.tool('get_balance', { account_ref: 'A1' }), await a.tool('get_recent_transactions', { account_ref: 'A1' }));

    const b = h.startCall('b');
    responses.push(await b.tool('start_authentication', { account_number: '500000000201' }));
    tokens.push(b.keypad().token);
    await b.key('1234567');
    const otp = b.lastOtp();
    tokens.push(b.keypad().token);
    await b.key(otp);
    responses.push(await b.tool('get_balance'));

    const visible = JSON.stringify({ responses, audit: h.audit, timeline });
    const accountNumbers = MOCK_CUSTOMERS.flatMap((c) => c.profile.accounts.map((acc) => acc.number));
    for (const secret of ['135790', '000000', otp, ...tokens, ...accountNumbers]) expect(visible).not.toContain(secret);
    expect(visible).toContain('••••0101'); // identifiers appear masked, not at all or in full
  });
});
