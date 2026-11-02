import { describe, expect, it } from 'vitest';
import type { AccountView } from '../../api/gatewayTypes';
import {
  askParty,
  confirmationIntent,
  describeLookup,
  describeRefusal,
  describeSuccess,
  greeting,
  lookupFor,
  maskDigits,
  missingSlot,
  pickAccount,
  pickCurrency,
  pickOption,
  pickParty,
  pickService,
  secureEntryPrompt,
  spokenDigits,
  toolFor,
  understand,
  goodbye,
} from './bankingAssistant';

const ACCOUNTS: AccountView[] = [
  { account_ref: 'A1', type: 'Current account', ending: '••••0101', currencies: ['SGD'] },
  { account_ref: 'A2', type: 'Current account', ending: '••••0102', currencies: ['SGD'] },
  { account_ref: 'A3', type: 'Foreign currency checking account', ending: '••••0103', currencies: ['USD', 'EUR'] },
];

describe('understand', () => {
  it.each([
    ["What's my balance?", 'balance'],
    ['What is my account balance?', 'balance'],
    ['how much money do I have', 'balance'],
    ['Show me my accounts.', 'accounts'],
    ['I want to see my recent transactions.', 'transactions'],
    ['Did my cheque clear?', 'deposited_cheques'],
    ['I want to change my PIN.', 'pin_change'],
    ['any incoming funds this week?', 'incoming'],
    ['I need a statement for last month', 'statement'],
    ['please stop cheque 100060', 'stop_cheque'],
    ['has cheque 100005 been presented', 'issued_cheque'],
    ['I need a new cheque book', 'chequebook_request'],
    ['has my cheque book been sent', 'chequebook_status'],
    ['what is the USD exchange rate', 'fx'],
    ['prime rate please', 'prime'],
    ['fixed deposit rates', 'deposit_rates'],
    ['where is your nearest branch in the east', 'branch'],
    ['I lost my card', 'lost_card'],
    ['can I talk to a person', 'agent'],
    ['please call me back', 'callback'],
    ['what can you do', 'services'],
    ['log out', 'sign_out'],
    ['I want to book an appointment', 'appointment_book'],
    ['book a Velocity trade training session', 'appointment_book'],
    ['what appointments do I have', 'appointment_list'],
    ['show my appointments', 'appointment_list'],
    ['cancel my appointment', 'appointment_cancel'],
  ])('%s → %s', (text, topic) => {
    expect(understand(text)?.topic).toBe(topic);
  });

  it('returns null for words that are not a banking request, so the assistant never guesses', () => {
    expect(understand('the weather is nice')).toBeNull();
    expect(understand('')).toBeNull();
  });

  it('extracts what the tools need', () => {
    expect(understand('stop cheques 100060 to 100065')).toMatchObject({ topic: 'stop_cheque', cheques: ['100060', '100065'] });
    expect(understand('statement for this month')).toMatchObject({ topic: 'statement', period: 'current_month' });
    expect(understand('euro exchange rate')).toMatchObject({ topic: 'fx', currency: 'EUR' });
    expect(understand('returned cheques')).toMatchObject({ topic: 'deposited_cheques', chequeStatus: 'returned' });
    expect(understand('call me back on 9123 4567')).toMatchObject({ topic: 'callback', phone: '91234567' });
  });
});

describe('appointments', () => {
  it('knows the service from the words', () => {
    expect(pickService('opening a foreign worker account')).toBe('foreign_worker_account');
    expect(pickService('the trade training')).toBe('velocity_trade_training');
    expect(pickService('velocity payment module')).toBe('velocity_payment_training');
    expect(pickService('tomorrow')).toBeNull();
    expect(understand('book a foreign worker account appointment')).toMatchObject({ topic: 'appointment_book', service: 'foreign_worker_account' });
  });

  it('asks for the service, looks up a branch and a slot, asks how many, then prepares the booking', () => {
    const base = { topic: 'appointment_book' as const, words: 'book an appointment' };
    expect(missingSlot(base)).toBe('service');
    const service = { ...base, service: 'foreign_worker_account' as const };
    expect(missingSlot(service)).toBeNull();
    expect(lookupFor(service)).toEqual({ purpose: 'branch', tool: 'find_branch', args: {} });
    const branch = { ...service, branchId: 'br_central' };
    expect(lookupFor(branch)).toEqual({ purpose: 'slot', tool: 'find_appointment_slots', args: { service: 'foreign_worker_account', branch_id: 'br_central' } });
    const slot = { ...branch, slotId: 'slot_1', maxParty: 6 };
    expect(lookupFor(slot)).toBeNull();
    expect(missingSlot(slot)).toBe('party');
    expect(toolFor(slot, null)).toBeNull();
    expect(toolFor({ ...slot, party: 2 }, 'A1')).toEqual({ tool: 'prepare_appointment_booking', args: { service: 'foreign_worker_account', branch_id: 'br_central', slot_id: 'slot_1', party_size: 2 } });
  });

  it('lists bookings, and cancels one only after it is chosen', () => {
    expect(toolFor({ topic: 'appointment_list', words: '' }, null)).toEqual({ tool: 'list_appointments', args: {} });
    expect(lookupFor({ topic: 'appointment_cancel', words: '' })).toEqual({ purpose: 'booking', tool: 'list_appointments', args: {} });
    expect(toolFor({ topic: 'appointment_cancel', words: '', bookingId: 'bk_1' }, null)).toEqual({ tool: 'prepare_appointment_cancellation', args: { booking_id: 'bk_1' } });
  });

  it('offers the looked-up branches, slots and bookings as choices, or says there are none', () => {
    const branches = describeLookup('branch', { ok: true, branches: [{ branch_id: 'br_central', name: 'Mock Central Branch', address: '1 Mock Street' }, { branch_id: 'br_north', name: 'Mock North Branch' }] });
    expect(branches.options.map((o) => o.id)).toEqual(['br_central', 'br_north']);
    expect(branches.card).toMatchObject({ kind: 'choices', purpose: 'branch' });
    const slots = describeLookup('slot', { ok: true, slots: [{ slot_id: 's1', date: '2026-11-05', start: '09:30', end: '10:30', branch: 'Mock Central Branch' }], max_party: 6 });
    expect(slots).toMatchObject({ maxParty: 6, options: [{ id: 's1', label: '2026-11-05, 09:30 to 10:30' }] });
    expect(describeLookup('slot', { ok: true, slots: [], message: 'There are no available appointments from that date.' })).toMatchObject({ options: [], text: 'There are no available appointments from that date.' });
    expect(describeLookup('booking', { ok: true, appointments: [] }).text).toMatch(/no appointments booked/);
    const booked = describeSuccess('list_appointments', { ok: true, appointments: [{ booking_id: 'bk_1', service: 'foreign worker account opening', date: '2026-11-05', start: '09:30', end: '10:30', party_size: 2 }] }, 0);
    expect(booked.text).toMatch(/one appointment: foreign worker account opening on 2026-11-05/);
  });

  it('understands which option and how many', () => {
    const options = [
      { id: 'br_central', label: 'Mock Central Branch' },
      { id: 'br_north', label: 'Mock North Branch' },
    ];
    expect(pickOption('the north one', options)?.id).toBe('br_north');
    expect(pickOption('the first one', options)?.id).toBe('br_central');
    expect(pickOption('mock branch', options)).toBeNull();
    expect(pickParty('two', 6)).toBe(2);
    expect(pickParty('for 3 people', 6)).toBe(3);
    expect(pickParty('7', 6)).toBeNull();
    expect(askParty(2).card).toMatchObject({ kind: 'choices', purpose: 'party', options: [{ id: '1' }, { id: '2' }] });
  });

  it('prepares bookings and cancellations for an explicit confirmation', () => {
    expect(describeSuccess('prepare_appointment_booking', { ok: true, summary: 'An appointment on 2026-11-05.', confirmation_id: 'c1' }, 0).text).toMatch(/Shall I go ahead\? Say yes to confirm, or no to cancel/);
    expect(describeSuccess('prepare_appointment_cancellation', { ok: true, summary: 'Cancel the appointment.', confirmation_id: 'c2' }, 0).text).toMatch(/^Cancel the appointment\. Shall I go ahead/);
  });
});

describe('secure entry', () => {
  it('asks for every secret on the keypad, never in the conversation', () => {
    ['pin', 'nric', 'otp', 'current_pin', 'new_pin', 'confirm_new_pin', 'other'].forEach((purpose) => expect(secureEntryPrompt(purpose)).not.toMatch(/say|speak|type/i));
    expect(secureEntryPrompt('pin')).toMatch(/secure keypad/);
  });
});

describe('spoken and typed digits', () => {
  it.each([
    ['1 3 5 7 9 0', '135790'],
    ['one three five seven nine zero', '135790'],
    ['my PIN is 135790', '135790'],
    ['one two three four five six seven', '1234567'],
    ['double three four', '334'],
    ['I want to go', ''],
  ])('%s → %s', (text, digits) => {
    expect(spokenDigits(text)).toBe(digits);
  });

  it('masks identifiers for the transcript', () => {
    expect(maskDigits('1234567')).toBe('•••4567');
    expect(maskDigits('500000000201')).toBe('••••0201');
  });
});

describe('choosing an account and a currency', () => {
  it('matches by last digits, position, or a type only one account has', () => {
    expect(pickAccount('the one ending 0102', ACCOUNTS)?.account_ref).toBe('A2');
    expect(pickAccount('account ending in zero one zero three', ACCOUNTS)?.account_ref).toBe('A3');
    expect(pickAccount('the second one', ACCOUNTS)?.account_ref).toBe('A2');
    expect(pickAccount('my foreign currency account', ACCOUNTS)?.account_ref).toBe('A3');
    expect(pickAccount('whichever', ACCOUNTS)).toBeNull();
  });

  it('only offers currencies that are in the list', () => {
    expect(pickCurrency('euros please', ['USD', 'EUR'])).toBe('EUR');
    expect(pickCurrency('yen', ['USD', 'EUR'])).toBeNull();
  });
});

describe('confirmation routing', () => {
  it('treats a clear no as cancel and leaves any yes to the gateway', () => {
    expect(confirmationIntent('no, cancel that')).toBe('no');
    expect(confirmationIntent('yes go ahead')).toBe('maybe_yes');
    expect(confirmationIntent('yes but cancel')).toBe('no');
    expect(confirmationIntent('hmm')).toBeNull();
  });
});

describe('tools for requests', () => {
  it('maps requests to the gateway schema, with the chosen account', () => {
    expect(toolFor({ topic: 'balance', words: '' }, 'A1')).toEqual({ tool: 'get_balance', args: { account_ref: 'A1' } });
    expect(toolFor({ topic: 'balance', words: '', currency: 'EUR' }, 'A3')).toEqual({ tool: 'get_balance', args: { account_ref: 'A3', currency: 'EUR' } });
    expect(toolFor({ topic: 'stop_cheque', words: '', cheques: ['100060', '100065'] }, null)).toEqual({ tool: 'prepare_stop_cheque', args: { first_cheque: '100060', last_cheque: '100065' } });
    expect(toolFor({ topic: 'statement', words: '' }, null)).toBeNull();
  });

  it('asks for what a request is missing', () => {
    expect(missingSlot({ topic: 'stop_cheque', words: '' })).toBe('cheque_number');
    expect(missingSlot({ topic: 'fx', words: '' })).toBe('currency');
    expect(missingSlot({ topic: 'balance', words: '' })).toBeNull();
  });
});

describe('replies', () => {
  it('reads the gateway balance wording and shows every amount it returned', () => {
    const reply = describeSuccess(
      'get_balance',
      {
        ok: true,
        say: 'Your account balance is 12,500 dollars and 40 cents.',
        account: ACCOUNTS[0],
        currency: 'SGD',
        current: 'SGD 12,500.40',
        available: 'SGD 11,250.40',
        hold: 'SGD 1,000.00',
        pending_clearance: 'SGD 250.00',
        overdraft_limit: null,
        in_debit: false,
        facility_notice: false,
      },
      1_000
    );
    expect(reply.text).toBe('Your account balance is 12,500 dollars and 40 cents.');
    expect(reply.card).toMatchObject({ kind: 'balance', balance: { accountRef: 'A1', current: 'SGD 12,500.40', hold: 'SGD 1,000.00', pendingClearance: 'SGD 250.00', overdraftLimit: null, retrievedAt: 1_000 } });
  });

  it('turns the gateway\'s account question into choices with masked endings only', () => {
    const reply = describeRefusal({ ok: false, error_code: 'choose_account', error_message: 'Ask which account.', accounts: ACCOUNTS });
    expect(reply.card).toMatchObject({ kind: 'choices', purpose: 'account' });
    expect(JSON.stringify(reply)).not.toMatch(/\d{12}/);
  });

  it('uses the gateway\'s message for refusals and host failures', () => {
    expect(describeRefusal({ ok: false, error_code: 'not_entitled', error_message: 'This service is not available for this caller\'s access level.', next: 'offer_transfer' }).text).toContain('not available');
    const host = describeRefusal({ ok: false, error_code: 'as400:196', error_message: 'Some or all of these cheques have already been presented or cleared, so they cannot be stopped.', next: 'continue' });
    expect(host.text).toContain('cannot be stopped');
    expect(host.card).toMatchObject({ kind: 'notice', tone: 'danger' });
  });

  it('greets as the labelled rehearsal bank, never a template company', () => {
    expect(greeting('morning')).toMatch(/^Good morning, thank you for calling Weave Demo Bank Business Banking\. I'm your virtual banking assistant\./);
    expect(greeting(null)).not.toMatch(/Acme|Tess/);
    // the rehearsal speaks as the agent being tested
    expect(greeting('evening', 'SG Investigations')).toBe("Good evening, thank you for calling SG Investigations. I'm your virtual banking assistant. How can I help you today?");
    expect(goodbye('SG Investigations')).toBe('Thank you for calling SG Investigations. Goodbye.');
    expect(goodbye()).toBe('Thank you for calling Weave Demo Bank. Goodbye.');
  });
});
