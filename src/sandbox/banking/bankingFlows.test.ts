import { describe, expect, it } from 'vitest';
import { createBrowserGateway } from './gatewayInBrowser.js';
import { describeLookup, describeSuccess, lookupFor, toolFor, understand, type BankingRequest } from './bankingAssistant';

// The engine's rules against the gateway's own code (built for the browser): every tool call the rules make is one
// the gateway accepts, and the documented flows run end to end: sign-in both ways, lockout and restart, and
// appointments from booking to cancelling, each write only after an explicit confirmation.

/** The value, or the test fails here. */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('missing');
  return value;
}

const json = async (answer: Promise<{ status: number; body: string }>) => {
  const { status, body } = await answer;
  return { status, data: body ? JSON.parse(body) : null };
};

async function session() {
  const gw = createBrowserGateway();
  const { data } = await json(gw.request({ method: 'POST', path: '/dev/rehearsals', body: JSON.stringify({ channel: 'web_chat' }) }));
  const tool = async (name: string, args: Record<string, unknown> = {}) =>
    (await json(gw.request({ method: 'POST', path: `/v1/tools/${name}`, headers: { 'X-Call-Id': data.call_id }, body: JSON.stringify(args) }))).data;
  const device = async (path: string, body: Record<string, unknown> = {}) =>
    (await json(gw.request({ method: 'POST', path, headers: { Authorization: `Bearer ${data.channel_token}` }, body: JSON.stringify(body) }))).data;
  const key = async (value: string) => {
    const { capture } = await device('/v1/channel/capture/reissue');
    return device('/v1/channel/capture', { token: capture.token, value });
  };
  const sms = async () => (await json(gw.request({ method: 'GET', path: `/dev/rehearsals/${data.call_id}/sms` }))).data.messages as Array<{ text: string }>;
  return { tool, device, key, sms };
}

describe('banking flows on the gateway', () => {
  it('signs in by account number, NRIC and the SMS one-time password', async () => {
    const s = await session();
    expect((await s.device('/v1/channel/identify', { account_number: '500000000201' })).ok).not.toBe(false);
    expect((await s.key('1234567')).accepted).toBe(true);
    const otp = /\b(\d{6})\b/.exec((await s.sms()).map((m) => m.text).join(' '))?.[1];
    expect(otp).toBeTruthy();
    expect((await s.key(otp as string)).accepted).toBe(true);
    expect((await s.tool('get_auth_status')).authenticated).toBe(true);
  });

  it('restarts sign-in with another identifier, keeping failed attempts; three wrong PINs lock it until a new conversation', async () => {
    const s = await session();
    await s.device('/v1/channel/identify', { phone_code: '1234567' });
    expect((await s.key('000000')).accepted).toBe(false);
    await s.device('/v1/channel/restart');
    expect((await s.tool('get_auth_status')).attempts_remaining).toBe(2);
    await s.device('/v1/channel/identify', { phone_code: '1234567' });
    expect((await s.key('000001')).accepted).toBe(false);
    expect((await s.key('000002')).accepted).toBe(false);
    expect(await s.tool('get_auth_status')).toMatchObject({ authenticated: false, status: 'locked' });
    // a new conversation is a new gateway session
    const next = await session();
    await next.device('/v1/channel/identify', { phone_code: '1234567' });
    expect((await next.key('135790')).accepted).toBe(true);
  });

  it('books an appointment step by step, lists it, and cancels it, each after a confirmation', async () => {
    const s = await session();
    await s.device('/v1/channel/identify', { phone_code: '1234567' });
    expect((await s.key('135790')).accepted).toBe(true);

    let request: BankingRequest = understand('I want to book a foreign worker account appointment') as BankingRequest;
    expect(request).toMatchObject({ topic: 'appointment_book', service: 'foreign_worker_account' });

    // the branch, then the slot, from the gateway's own lookups
    let lookup = must(lookupFor(request));
    const branches = describeLookup(lookup.purpose as 'branch', await s.tool(lookup.tool, lookup.args));
    request = { ...request, branchId: must(branches.options.find((o) => o.id === 'br_central')).id };
    lookup = must(lookupFor(request));
    const slots = describeLookup(lookup.purpose as 'slot', await s.tool(lookup.tool, lookup.args));
    expect(slots.options.length).toBeGreaterThan(0);
    request = { ...request, slotId: must(slots.options[0]).id, maxParty: slots.maxParty, party: 2 };

    const booking = must(toolFor(request, null));
    const prepared = await s.tool(booking.tool, booking.args);
    expect(prepared.ok).toBe(true);
    expect(typeof prepared.confirmation_id).toBe('string');
    // nothing is booked until the explicit yes
    expect((await s.tool('list_appointments')).appointments).toEqual([]);
    expect((await s.tool('confirm_transaction', { confirmation_id: prepared.confirmation_id, caller_words: 'yes please' })).ok).toBe(true);

    const listed = await s.tool('list_appointments');
    expect(describeSuccess('list_appointments', listed, 0).text).toMatch(/one appointment: foreign worker account opening/);

    let cancel: BankingRequest = understand('cancel my appointment') as BankingRequest;
    lookup = must(lookupFor(cancel));
    const bookings = describeLookup('booking', await s.tool(lookup.tool, lookup.args));
    cancel = { ...cancel, bookingId: must(bookings.options[0]).id };
    const cancelling = must(toolFor(cancel, null));
    const preparedCancel = await s.tool(cancelling.tool, cancelling.args);
    expect(preparedCancel.ok).toBe(true);
    expect((await s.tool('confirm_transaction', { confirmation_id: preparedCancel.confirmation_id, caller_words: 'yes' })).ok).toBe(true);
    expect((await s.tool('list_appointments')).appointments).toEqual([]);
  });

  it('runs every read the rules map a request to', async () => {
    const s = await session();
    await s.device('/v1/channel/identify', { phone_code: '1234567' });
    await s.key('135790');
    const asks = ['incoming funds', 'recent transactions', 'did my cheque clear', 'has cheque 100005 been presented', 'has my cheque book been sent', 'USD exchange rate', 'prime rate', 'fixed deposit rates', 'branches in the east'];
    for (const words of asks) {
      const call = must(toolFor(must(understand(words)), 'A1'));
      const response = await s.tool(call.tool, call.args);
      expect(response.ok, `${words} → ${call.tool}: ${response.error_code ?? ''}`).toBe(true);
    }
  });
});

describe('a transfer between the customer’s own accounts, as the rules make it', () => {
  it('understands it, asks where from, reads back the summary, and moves the money only on confirmation', async () => {
    const s = await session();
    await s.device('/v1/channel/identify', { phone_code: '1234567' });
    expect((await s.key('135790')).accepted).toBe(true);
    const request = must(understand('Please transfer 1,250.50 to my other account'));
    expect(request).toMatchObject({ topic: 'transfer', amount: '1250.50' });
    const ask = await s.tool(must(toolFor(request, null)).tool, must(toolFor(request, null)).args);
    expect(ask).toMatchObject({ ok: false, error_code: 'choose_from_account' });
    const call = must(toolFor({ ...request, fromRef: 'A1' }, null));
    expect(call).toEqual({ tool: 'prepare_own_transfer', args: { amount: '1250.50', from_account_ref: 'A1' } });
    const prepared = await s.tool(call.tool, call.args);
    expect(describeSuccess(call.tool, prepared, Date.now()).text).toMatch(/^Transfer SGD 1,250\.50 from your current account ending 0101 to your current account ending 0102\. Shall I go ahead\?/);
    expect(await s.tool('confirm_transaction', { confirmation_id: prepared.confirmation_id, caller_words: 'yes' })).toMatchObject({ ok: true, done: true });
    expect(await s.tool('get_balance', { account_ref: 'A1' })).toMatchObject({ available: 'SGD 9,999.90' });
  });
});
