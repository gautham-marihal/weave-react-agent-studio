import { describe, expect, it } from 'vitest';
import { createHarness } from './harness.ts';

// Call flows not covered by scenarios.test.ts: greeting and language (deck p1), the role-aware menu (p2/p3/p10),
// cheque enquiries (p11, p13), branches and announcements (p20/p21/p44) and appointments (p19/p45/p47).

describe('greeting, language and the menu (deck p1, p2, p3, p10)', () => {
  it('greets by time of day and reports service-centre hours', async () => {
    const call = createHarness().startCall();
    const context = await call.tool('get_caller_context');
    expect(context).toMatchObject({ ok: true, service_centre_open: true, channel: 'web_chat' });
    expect(String(context.greeting)).toMatch(/morning/i);
  });

  it('records a language choice and refuses languages it does not serve', async () => {
    const call = createHarness().startCall();
    expect(await call.tool('record_language_choice', { language: 'zh' })).toMatchObject({ ok: true });
    expect(await call.tool('record_language_choice', { language: 'fr' })).toMatchObject({ ok: false, error_code: 'invalid_arguments' });
  });

  it('lists services by what this caller may use: public before sign-in, role-aware after', async () => {
    const h = createHarness();
    const before = await h.startCall('c-before').tool('list_services');
    expect(before.authenticated).toBe(false);
    expect((before.available as Array<{ label: string }>).map((s) => s.label)).toContain('Rates');
    expect(before.needs_verification).toContain('Account balance');

    const phone = h.startCall('c-phone');
    await phone.loginWithPhoneCode();
    const asPhone = (await phone.tool('list_services')).available as Array<{ label: string }>;
    expect(asPhone.map((s) => s.label)).toEqual(expect.arrayContaining(['Account balance', 'Stop cheque payment', 'Change Phone PIN']));

    // Authorised Contact (deck p3: balances are P or AS only; p10: no stop cheque for AC).
    const contact = h.startCall('c-contact');
    await contact.loginWithAccount('500000000301', '7654321');
    const asContact = ((await contact.tool('list_services')).available as Array<{ label: string }>).map((s) => s.label);
    expect(asContact).not.toContain('Account balance');
    expect(asContact).not.toContain('Stop cheque payment');
    expect(asContact).toContain('Incoming funds');
  });
});

describe('cheque enquiries (deck p11, p13)', () => {
  it('lists deposited and returned cheques for the verified caller', async () => {
    const call = createHarness().startCall();
    await call.loginWithAccount();
    const deposited = await call.tool('get_deposited_cheques', { status: 'deposited' });
    expect(deposited).toMatchObject({ ok: true });
    const returned = await call.tool('get_deposited_cheques', { status: 'returned' });
    expect(returned).toMatchObject({ ok: true });
    expect(JSON.stringify([deposited, returned])).not.toMatch(/\b\d{12}\b/);
  });

  it('reads the latest cheque book status in the deck wording', async () => {
    const call = createHarness().startCall();
    await call.loginWithAccount();
    const status = await call.tool('get_chequebook_status');
    expect(status).toMatchObject({ ok: true });
    expect(typeof status.say).toBe('string');
  });

  it('refuses cheque enquiries before verification', async () => {
    const call = createHarness().startCall();
    expect(await call.tool('get_chequebook_status')).toMatchObject({ ok: false, error_code: 'not_authenticated', next: 'start_authentication' });
  });
});

describe('branches and announcements (deck p20, p21, p44)', () => {
  it('finds branches by name or region without verification', async () => {
    const call = createHarness().startCall();
    expect(await call.tool('find_branch', { region: 'north' })).toMatchObject({ ok: true, count: 1 });
    expect(await call.tool('find_branch', { query: 'Central' })).toMatchObject({ ok: true, count: 1 });
  });

  it('reads announcements of a known kind only', async () => {
    const call = createHarness().startCall();
    expect(await call.tool('get_announcements', { kind: 'promotions' })).toMatchObject({ ok: true });
    expect(await call.tool('get_announcements', { kind: 'lottery' })).toMatchObject({ ok: false, error_code: 'invalid_arguments' });
  });
});

describe('appointments (deck p19, p45, p47)', () => {
  it('finds a slot, books it on an explicit confirmation, lists it, then cancels it the same way', async () => {
    const h = createHarness();
    const call = h.startCall();
    await call.loginWithPhoneCode();
    const slots = await call.tool('find_appointment_slots', { service: 'foreign_worker_account', branch_id: 'br_central', from_date: '2026-10-29' });
    expect(slots).toMatchObject({ ok: true });
    const slot = (slots.slots as Array<{ slot_id: string; date: string }>)[0];
    expect(slot).toBeDefined();
    // Deck p19: at least 2 days ahead (today is Tuesday 27 October).
    expect(slot && slot.date >= '2026-10-29').toBe(true);

    const prepared = await call.tool('prepare_appointment_booking', { service: 'foreign_worker_account', slot_id: slot?.slot_id, branch_id: 'br_central', party_size: 2 });
    expect(prepared).toMatchObject({ ok: true, next: 'confirm_or_cancel' });
    expect(await call.tool('confirm_transaction', { confirmation_id: prepared.confirmation_id as string, caller_words: 'yes please' })).toMatchObject({ ok: true });

    const booked = (await call.tool('list_appointments')).appointments as Array<{ booking_id: string }>;
    expect(booked).toHaveLength(1);

    const cancel = await call.tool('prepare_appointment_cancellation', { booking_id: booked[0]?.booking_id });
    expect(cancel).toMatchObject({ ok: true, next: 'confirm_or_cancel' });
    expect(await call.tool('confirm_transaction', { confirmation_id: cancel.confirmation_id as string, caller_words: 'yes' })).toMatchObject({ ok: true });
    expect((await call.tool('list_appointments')).appointments).toEqual([]);
  });

  it('enforces the party limit and refuses a branch that does not offer the service', async () => {
    const call = createHarness().startCall();
    await call.loginWithPhoneCode();
    expect(await call.tool('find_appointment_slots', { service: 'velocity_trade_training', branch_id: 'br_north', from_date: '2026-10-29' })).toMatchObject({ ok: false, error_code: 'branch_not_offering' });
    const slots = await call.tool('find_appointment_slots', { service: 'velocity_payment_training', branch_id: 'br_central', from_date: '2026-10-29' });
    const slot = (slots.slots as Array<{ slot_id: string }>)[0];
    // Deck p45: at most 2 attendees for training.
    expect(await call.tool('prepare_appointment_booking', { service: 'velocity_payment_training', slot_id: slot?.slot_id, branch_id: 'br_central', party_size: 3 })).toMatchObject({ ok: false, error_code: 'party_too_large' });
  });

  it('cancelling a prepared booking leaves nothing booked', async () => {
    const call = createHarness().startCall();
    await call.loginWithPhoneCode();
    const slots = await call.tool('find_appointment_slots', { service: 'foreign_worker_account', branch_id: 'br_central', from_date: '2026-10-29' });
    const slot = (slots.slots as Array<{ slot_id: string }>)[0];
    const prepared = await call.tool('prepare_appointment_booking', { service: 'foreign_worker_account', slot_id: slot?.slot_id, branch_id: 'br_central', party_size: 1 });
    expect(await call.tool('cancel_transaction', { confirmation_id: prepared.confirmation_id as string })).toMatchObject({ ok: true, cancelled: true });
    expect((await call.tool('list_appointments')).appointments).toEqual([]);
  });
});
