import { describe, expect, it, vi } from 'vitest';
import { cimbPolicy } from '../src/adapters/cimb.ts';
import { createHarness } from './harness.ts';

// Transfers between the caller's own accounts, and a policy for a bank that offers less (CIMB), through the real
// orchestrator on the mock bank. PhoneCode user 1234567: A1 = …0101 SGD (available 11,250.40), A2 = …0102 SGD
// (overdrawn, available -1,820.05), A3 = …0103 USD/EUR (multi-currency: not used for transfers).

async function signedIn(h = createHarness()) {
  const call = h.startCall();
  await call.loginWithPhoneCode();
  return { h, call };
}

describe('own-account transfer', () => {
  it('asks where from, picks the only matching target, reads back, and moves the money only on confirmation', async () => {
    const { call } = await signedIn();
    const ask = await call.tool('prepare_own_transfer', { amount: '250.50' });
    expect(ask).toMatchObject({ ok: false, error_code: 'choose_from_account', next: 'ask_again' });
    expect((ask as unknown as { accounts: Array<{ account_ref: string }> }).accounts.map((a) => a.account_ref)).toEqual(['A1', 'A2']);

    const prepared = await call.tool('prepare_own_transfer', { from_account_ref: 'A1', amount: '250.50' });
    expect(prepared).toMatchObject({ ok: true, summary: 'Transfer SGD 250.50 from your current account ending 0101 to your current account ending 0102.' });
    // nothing has moved yet
    expect(await call.tool('get_balance', { account_ref: 'A1' })).toMatchObject({ available: 'SGD 11,250.40' });

    const done = await call.tool('confirm_transaction', { confirmation_id: (prepared as unknown as { confirmation_id: string }).confirmation_id, caller_words: 'yes' });
    expect(done).toMatchObject({ ok: true, done: true, reference: 'TRF000001' });
    expect(await call.tool('get_balance', { account_ref: 'A1' })).toMatchObject({ available: 'SGD 10,999.90' });
    expect(await call.tool('get_balance', { account_ref: 'A2' })).toMatchObject({ available: '-SGD 1,569.55' });
  });

  it('checks every amount in code: zero, over the limit, more than is available, too precise', async () => {
    const { call } = await signedIn();
    expect(await call.tool('prepare_own_transfer', { from_account_ref: 'A1', amount: '0' })).toMatchObject({ ok: false, error_code: 'bad_amount' });
    expect(await call.tool('prepare_own_transfer', { from_account_ref: 'A1', amount: '50000.01' })).toMatchObject({ ok: false, error_code: 'over_limit' });
    expect(await call.tool('prepare_own_transfer', { from_account_ref: 'A2', amount: '10' })).toMatchObject({ ok: false, error_code: 'insufficient_funds' });
    expect(await call.tool('prepare_own_transfer', { from_account_ref: 'A1', amount: '-5' })).toMatchObject({ ok: false, error_code: 'invalid_arguments' });
    expect(await call.tool('prepare_own_transfer', { from_account_ref: 'A1', amount: '1.005' })).toMatchObject({ ok: false, error_code: 'invalid_arguments' });
    expect(await call.tool('prepare_own_transfer', { from_account_ref: 'A1', to_account_ref: 'A1', amount: '5' })).toMatchObject({ ok: false, error_code: 'account_not_eligible' });
    expect(await call.tool('prepare_own_transfer', { from_account_ref: 'A3', amount: '5' })).toMatchObject({ ok: false, error_code: 'account_not_eligible' });
  });

  it('needs a verified caller', async () => {
    const h = createHarness();
    const call = h.startCall();
    expect(await call.tool('prepare_own_transfer', { from_account_ref: 'A1', amount: '5' })).toMatchObject({ ok: false, error_code: 'not_authenticated' });
  });

  it('a host that does not answer in time leaves the outcome unknown, never "failed"', async () => {
    const { h, call } = await signedIn();
    const prepared = (await call.tool('prepare_own_transfer', { from_account_ref: 'A1', amount: '10' })) as unknown as { confirmation_id: string };
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    h.controls.hangNext('transferOwn');
    const pending = call.tool('confirm_transaction', { confirmation_id: prepared.confirmation_id, caller_words: 'yes' });
    await vi.advanceTimersByTimeAsync(16_000);
    vi.useRealTimers();
    expect(await pending).toMatchObject({ ok: false, error_code: 'outcome_unknown' });
  });

  it('a 4-digit PIN reaches the host (the keypad takes 4 to 6 digits); 3 digits do not', async () => {
    const h = createHarness();
    const call = h.startCall();
    await call.tool('start_authentication', { phone_code: '1234567' });
    expect(await call.key('1234')).toMatchObject({ accepted: false, message: expect.stringContaining('invalid Phone PIN') });
    expect(await call.key('123')).toMatchObject({ accepted: false });
    expect(await call.key('135790')).toMatchObject({ accepted: true });
  });
});

describe('a bank that offers less (the CIMB policy)', () => {
  it('refuses what it does not offer before any host call, and leaves it out of the menu', async () => {
    const h = createHarness(undefined, cimbPolicy());
    const call = h.startCall();
    expect(await call.tool('get_fx_rate', { currency: 'USD' })).toMatchObject({ ok: false, error_code: 'not_offered', next: 'continue' });
    expect(await call.tool('find_branch', {})).toMatchObject({ ok: false, error_code: 'not_offered' });
    const menu = (await call.tool('list_services')) as unknown as { available: Array<{ label: string }>; needs_verification: string[] };
    expect(menu.available.map((s) => s.label)).not.toContain('Rates');
    expect(menu.needs_verification).toContain('Transfer between your own accounts');
    expect(menu.needs_verification).not.toContain('Stop cheque payment');

    await call.loginWithPhoneCode();
    expect(await call.tool('prepare_chequebook_request', { account_ref: 'A1' })).toMatchObject({ ok: false, error_code: 'not_offered' });
    expect(await call.tool('get_balance', { account_ref: 'A1' })).toMatchObject({ ok: true });
    const after = (await call.tool('list_services')) as unknown as { available: Array<{ label: string }> };
    expect(after.available.map((s) => s.label)).toEqual(['Account balance', 'Incoming funds', 'Recent account activity', 'Transfer between your own accounts', 'Report a lost card']);
  });

  it('offers only the Phone Code sign-in: the account route is refused up front and not shown on the device', async () => {
    const h = createHarness(undefined, cimbPolicy());
    const call = h.startCall();
    expect(await call.tool('start_authentication', { account_number: '500000000201' })).toMatchObject({ ok: false, error_code: 'method_not_offered', next: 'ask_again' });
    const state = h.orchestrator.channelState(call.sessionId);
    expect(state.methods.map((m) => m.id)).toEqual(['phonecode_pin']);
  });
});
