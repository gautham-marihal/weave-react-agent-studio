import test from 'node:test';
import assert from 'node:assert/strict';
import { guidanceFor } from '../src/studio/banking/guidance.ts';
import {
  confirmationIntent,
  describeRefusal,
  describeSuccess,
  greeting,
  maskDigits,
  missingSlot,
  pickAccount,
  pickCurrency,
  spokenDigits,
  toolFor,
  understand,
} from '../src/studio/banking/assistantModel.ts';
import { extractIdentifier, maskIdentifier, normalizeDigitSequence } from '../src/studio/banking/digits.ts';
import { gatewayNote, mergeRecords, recordFromGateway } from '../src/studio/banking/gatewayRecords.ts';
import { describeRecord, groupCounts, describeRecords } from '../src/studio/trace/records.js';

// The banking surfaces of the Test tab: what the caller is told (guidance), how the rehearsal assistant understands a
// request and words a gateway result, and how the gateway's timeline joins the trace.

const ALL = new Set(['choose_method', 'new_keypad', 'resend_otp', 'use_other_method', 'ask_for_person', 'request_callback', 'reconnect', 'show_help']);
const auth = (patch) => ({
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
const ids = (g) => g.actions.map((a) => a.id);

test('guidance: a wrong PIN shows the gateway’s own words (with the real attempts left), and interrupts', () => {
  const message = 'You have entered an invalid Phone PIN. You have 2 attempts left.';
  const g = guidanceFor({ kind: 'capture_failed', message, auth: auth({ state: 'awaiting_pin', attempts_remaining: 2 }) }, ALL);
  assert.equal(g.body, message);
  assert.equal(g.announce, 'assertive');
});

test('guidance: a new keypad is offered only once the open one has gone; an SMS resend only while resends are left', () => {
  const keypad = { purpose: 'pin', label: 'PIN', min_digits: 6, max_digits: 6, expires_at: 0 };
  assert.ok(!ids(guidanceFor({ kind: 'auth', auth: auth({ state: 'awaiting_pin', secure_entry: keypad }) }, ALL)).includes('new_keypad'));
  assert.ok(ids(guidanceFor({ kind: 'auth', auth: auth({ state: 'awaiting_pin' }) }, ALL)).includes('new_keypad'));
  assert.ok(ids(guidanceFor({ kind: 'auth', auth: auth({ state: 'awaiting_otp', otp_resends_left: 1 }) }, ALL)).includes('resend_otp'));
  assert.ok(!ids(guidanceFor({ kind: 'auth', auth: auth({ state: 'awaiting_otp', otp_resends_left: 0 }) }, ALL)).includes('resend_otp'));
});

test('guidance: no policy details leak, an unknown outcome never claims success, and only possible actions are offered', () => {
  const refused = guidanceFor(
    {
      kind: 'tool',
      response: {
        ok: false,
        error_code: 'not_entitled',
        error_message: 'This service is not available for this caller’s access level.',
        next: 'offer_transfer',
      },
    },
    ALL,
  );
  assert.doesNotMatch(refused.body, /AS|AC|role|policy|entitle/);
  const unknown = guidanceFor({ kind: 'confirmation', outcome: 'unknown' }, ALL);
  assert.match(unknown.body, /do not repeat/i);
  assert.doesNotMatch(unknown.body, /success|completed/i);
  assert.deepEqual(ids(guidanceFor({ kind: 'needs_person' }, new Set(['show_help']))), ['show_help']);
  assert.equal(guidanceFor({ kind: 'gateway', error: 'unreachable' }, ALL).title, 'Banking services are unavailable');
});

test('the assistant understands banking requests, and says nothing for words that are not one', () => {
  const cases = [
    ['What is my account balance?', 'balance'],
    ['I want to see my recent transactions.', 'transactions'],
    ['any incoming funds this week?', 'incoming'],
    ['money received yesterday?', 'incoming'],
    ['please stop cheque 100060', 'stop_cheque'],
    ['I need a new cheque book', 'chequebook_request'],
    ['what is the USD exchange rate', 'fx'],
    ['can I talk to a person', 'agent'],
    ['log out', 'sign_out'],
  ];
  for (const [text, topic] of cases) assert.equal(understand(text)?.topic, topic, text);
  assert.equal(understand('the weather is nice'), null);
  assert.deepEqual(understand('stop cheques 100060 to 100065')?.cheques, ['100060', '100065']);
  assert.equal(understand('euro exchange rate')?.currency, 'EUR');
});

test('the assistant maps a request to the gateway’s tool, asks for what is missing, and picks accounts and currencies offered', () => {
  const accounts = [
    { account_ref: 'A1', type: 'Current account', ending: '••••0101', currencies: ['SGD'] },
    { account_ref: 'A2', type: 'Current account', ending: '••••0102', currencies: ['SGD'] },
    { account_ref: 'A3', type: 'Foreign currency checking account', ending: '••••0103', currencies: ['USD', 'EUR'] },
  ];
  assert.deepEqual(toolFor({ topic: 'balance', words: '' }, 'A1'), { tool: 'get_balance', args: { account_ref: 'A1' } });
  assert.deepEqual(toolFor({ topic: 'stop_cheque', words: '', cheques: ['100060', '100065'] }, null), {
    tool: 'prepare_stop_cheque',
    args: { first_cheque: '100060', last_cheque: '100065' },
  });
  assert.equal(missingSlot({ topic: 'stop_cheque', words: '' }), 'cheque_number');
  assert.equal(pickAccount('the one ending 0102', accounts)?.account_ref, 'A2');
  assert.equal(pickAccount('whichever', accounts), null);
  assert.equal(pickCurrency('yen', ['USD', 'EUR']), null);
  assert.equal(confirmationIntent('yes but cancel'), 'no', 'any no wins');
  assert.equal(confirmationIntent('yes go ahead'), 'maybe_yes', 'a yes is the gateway’s to judge');
});

test('the assistant’s replies are the gateway’s words and figures, with masked account endings only', () => {
  const reply = describeSuccess(
    'get_balance',
    {
      ok: true,
      say: 'Your account balance is 12,500 dollars and 40 cents.',
      account: { account_ref: 'A1', type: 'Current account', ending: '••••0101', currencies: ['SGD'] },
      currency: 'SGD',
      current: 'SGD 12,500.40',
      available: 'SGD 11,250.40',
      hold: 'SGD 1,000.00',
      pending_clearance: null,
      overdraft_limit: null,
      in_debit: false,
      facility_notice: false,
    },
    1_000,
  );
  assert.equal(reply.text, 'Your account balance is 12,500 dollars and 40 cents.');
  assert.equal(reply.card.kind, 'balance');
  assert.equal(reply.card.balance.current, 'SGD 12,500.40');
  const choose = describeRefusal({
    ok: false,
    error_code: 'choose_account',
    error_message: 'Ask which account.',
    accounts: [{ account_ref: 'A1', type: 'Current', ending: '••••0101', currencies: [] }],
  });
  assert.equal(choose.card.kind, 'choices');
  assert.doesNotMatch(JSON.stringify(choose), /\d{12}/);
  assert.doesNotMatch(greeting(null), /Acme|Tess/);
});

test('digits: spoken or typed, identifiers recognised by length, and masked for the transcript', () => {
  assert.equal(spokenDigits('one three five seven nine zero'), '135790');
  assert.equal(spokenDigits('I want to go'), '');
  assert.equal(normalizeDigitSequence('5000 0000 0201', { context: 'digit_sequence' }), '500000000201');
  assert.deepEqual(extractIdentifier('my phone code is 1234567'), { value: '1234567', type: 'phone_code' });
  assert.equal(extractIdentifier('account 500000000201')?.type, 'account_number');
  assert.equal(maskIdentifier('500000000201'), '••••••••0201');
  assert.equal(maskDigits('1234567'), '•••4567');
});

test('the gateway’s timeline joins the trace as its own group, in time order, without arguments or secrets', () => {
  const started = Date.UTC(2026, 9, 29, 10, 0, 0);
  const tool = recordFromGateway({ type: 'tool', at: started + 2_500, tool: 'get_balance', outcome: 'ok', ms: 40, origin: 'runtime' }, started, 1);
  const signIn = recordFromGateway({ type: 'auth', at: started + 1_000, state: 'locked', failures: 3 }, started, 2);
  const request = recordFromGateway({ type: 'transaction', at: started + 3_000, service: 'stop_cheque', state: 'unknown' }, started, 3);
  assert.equal(tool.seq, 'gw-1', 'numbered apart from the runtime’s records');
  assert.equal(tool.elapsed_s, 2.5);

  const runtime = [
    { seq: 1, elapsed_s: 0.5, event: 'user_said', text: 'balance please' },
    { seq: 2, elapsed_s: 2, event: 'agent_said', text: 'one moment' },
  ];
  const merged = mergeRecords(runtime, [tool, signIn, request]);
  assert.deepEqual(
    merged.map((r) => r.seq),
    [1, 'gw-2', 2, 'gw-1', 'gw-3'],
  );

  const rows = describeRecords(merged);
  assert.equal(groupCounts(rows).banking, 3);
  assert.equal(describeRecord(tool).text, 'get_balance answered');
  const locked = describeRecord(signIn);
  assert.equal(locked.problem, true);
  assert.match(locked.text, /locked/);
  assert.equal(describeRecord(request).problem, true, 'an unknown outcome is a problem, not a success');
  assert.equal(describeRecord(gatewayNote('No banking gateway is set up for this studio.', false, started, 4)).problem, false);
});
