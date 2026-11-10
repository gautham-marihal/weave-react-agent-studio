import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, resetState } from '../mock-api/src/app.mjs';

// The OCBC journey (mock-api/src/ocbc.mjs): the DB2 stand-in the copied banking specialists read, and an account opened
// by onboarding becoming a bank customer the specialists can serve on the same call.

const call = async (method, path, body = {}) => handle({ method, path, body, query: {}, headers: {} });
const db2 = (entity, method, columnMap) =>
  call('POST', '/ocbc/dboperations', { ucid: 'weave-agent', dnis: 'default', channel: 'IVR', entity, method, details: [{ columnMap }] });

async function openAccount({ bank = 'OCBC', amount = '300000' } = {}) {
  const app = (
    await call('POST', '/unbound/applications', {
      first_name: 'Wei Ming',
      last_name: 'Tan',
      date_of_birth: '14/03/1985',
      email: 'weiming.tan@example.com',
      mobile: '+6591234567',
      id_number: 'S8512345D',
      amount,
      currency: 'SGD',
      source_of_funds: 'Inheritance',
      pep: 'No',
    })
  ).body;
  const account = (
    await call('POST', '/unbound/accounts', {
      application_id: app.application_id,
      plan_name: 'Inheritance Holding Account',
      amount,
      currency: 'SGD',
      signed: 'true',
      ...(bank ? { bank } : {}),
    })
  ).body;
  const tqd = (
    await call('POST', '/tqd/cases', {
      application_id: app.application_id,
      customer_name: 'Wei Ming Tan',
      email: 'weiming.tan@example.com',
      account_number: account.account_number,
      plan_name: account.plan_name,
      relationship_manager: account.relationship_manager,
      ...(bank ? { bank } : {}),
    })
  ).body;
  const outbox = (await call('GET', '/tqd/outbox')).body.emails;
  return { account, tqd, outbox };
}

test('the DB2 stand-in answers like DB2 for a test customer: details with the TPIN, accounts with balances, history', async () => {
  resetState();
  const details = (await db2('customer', 'getCustomerDetails', { customerId: '5409881' })).body;
  assert.equal(details.responseCode, '0');
  assert.equal(details.responseList[0].name, 'Tan Wei Ming');
  assert.equal(details.responseList[0].passcode, '1234', 'the same TPIN as in DB2');
  const accounts = (await db2('account', 'getCustomerAccounts', { customerId: '540 9881' })).body.responseList;
  assert.deepEqual(
    accounts.map((a) => [a.accountId, a.accountType, a.currency]),
    [
      ['897350869921', 'Current Account', 'SGD'],
      ['923253456169', 'Savings Account', 'SGD'],
    ],
  );
  assert.ok(accounts.every((a) => typeof a.balance === 'number' && a.balance > 0));
  const history = (await db2('transaction', 'getTransactionHistory', { accountId: '897350869921' })).body.responseList;
  assert.ok(history.length >= 6);
  assert.ok(history.every((t) => ['DEBIT', 'CREDIT'].includes(t.type) && /^\d{4}-\d{2}-\d{2}$/.test(t.transactionDate)));
  const missing = (await db2('customer', 'getCustomerDetails', { customerId: '0000000' })).body;
  assert.deepEqual([missing.responseCode, missing.status, missing.description], ['-1', 'FAILED', 'Customer not found.']);
  assert.equal((await db2('customer', 'dropEverything', {})).status, 500, 'an unknown method, as DB2 answers it');
});

test('an account opened for OCBC becomes a bank customer: phone banking number by e-mail, temporary TPIN by SMS, awaiting the deposit', async () => {
  resetState();
  const { account, tqd, outbox } = await openAccount();
  assert.match(tqd.email_subject, /^Welcome to OCBC: your Inheritance Holding Account is open$/);
  const [sms, mail] = outbox;
  assert.equal(sms.channel, 'sms');
  assert.equal(sms.to, '+6591234567');
  const code = mail.body.match(/phone banking number is (\d{7})/)[1];
  const tpin = sms.body.match(/PIN is (\d{6})/)[1];
  assert.match(mail.body, /SMS to your mobile ending 4567/);
  assert.doesNotMatch(mail.body, new RegExp(tpin), 'the TPIN is never in the e-mail');
  assert.match(mail.body, /\nOCBC$/);
  assert.equal(account.account_number.length, 10);
  assert.equal(account.pin, undefined, 'the account answer gives no credentials');

  const details = (await db2('customer', 'getCustomerDetails', { customerId: code })).body.responseList[0];
  assert.deepEqual([details.name, details.passcode, details.email], ['Wei Ming Tan', tpin, 'weiming.tan@example.com']);
  const [row] = (await db2('account', 'getCustomerAccounts', { customerId: code })).body.responseList;
  assert.deepEqual([row.accountId, row.accountType, row.balance, row.currency], [account.account_number, 'Inheritance Holding Account', 0, 'SGD']);
  assert.match(row.note, /first deposit of SGD 300,000\.00 has not arrived yet: Priya Nair arranges it/);
  const none = (await db2('transaction', 'getTransactionHistory', { accountId: account.account_number })).body;
  assert.equal(none.description, 'No transactions found.');

  // the debit card is on its way; activating it works once, and stays active
  const [card] = (await call('GET', `/ocbc/customers/${code}/cards`)).body.cards;
  assert.deepEqual([card.kind, card.status, card.linkedAccountEnding], ['Debit', 'NOT_ACTIVATED', account.account_number.slice(-4)]);
  assert.equal((await call('POST', `/ocbc/cards/${card.cardId}/activate`, { confirmed: true })).body.status, 'ACTIVE');
  assert.equal((await call('POST', `/ocbc/cards/${card.cardId}/activate`, { confirmed: true })).status, 409);
  assert.equal((await call('GET', `/ocbc/customers/${code}/cards`)).body.cards[0].status, 'ACTIVE');

  // changing the temporary TPIN: from then on the new one is the TPIN
  assert.equal((await call('POST', `/ocbc/customers/${code}/phone-pin`, { newPin: '135790', confirmPin: '135791' })).status, 400);
  assert.equal((await call('POST', `/ocbc/customers/${code}/phone-pin`, { newPin: '135790', confirmPin: '135790' })).body.ok, true);
  assert.equal((await db2('customer', 'getCustomerDetails', { customerId: code })).body.responseList[0].passcode, '135790');

  // statements: none from before the account opened
  assert.equal((await call('POST', `/ocbc/accounts/${account.account_number}/statements`, { month: '2026-01' })).status, 409);
});

test('an OCBC hand-over a human completes: the bank customer gets the names the human confirmed', async () => {
  resetState();
  const app = (
    await call('POST', '/unbound/applications', {
      first_name: 'Ming',
      last_name: 'Tan Wei',
      date_of_birth: '14/03/1985',
      email: 'weiming.tan@example.com',
      mobile: '+6591234567',
      id_number: 'S8512345D',
      amount: '1,200,000',
      currency: 'SGD',
      pep: 'No',
    })
  ).body;
  const ho = (
    await call('POST', '/mx/handovers', {
      bank: 'OCBC',
      application_id: app.application_id,
      reason: 'face_match_failed',
      customer: { first_name: 'Ming', last_name: 'Tan Wei', email: 'weiming.tan@example.com', mobile: '+6591234567' },
    })
  ).body;
  const done = (
    await call('POST', `/mx/handovers/${ho.handover_id}/complete`, { plan_id: 'private_wealth', signed: true, first_name: 'Wei Ming', last_name: 'Tan' })
  ).body;
  const tqd = (
    await call('POST', '/tqd/cases', {
      bank: 'OCBC',
      customer_name: 'Wei Ming Tan',
      email: 'weiming.tan@example.com',
      account_number: done.account_number,
      plan_name: 'Private Wealth Account',
    })
  ).body;
  assert.match(tqd.email_subject, /^Welcome to OCBC/);
  const [sms, mail] = (await call('GET', '/tqd/outbox')).body.emails;
  const code = mail.body.match(/phone banking number is (\d{7})/)[1];
  const details = (await db2('customer', 'getCustomerDetails', { customerId: code })).body.responseList[0];
  assert.equal(details.name, 'Wei Ming Tan');
  assert.equal(details.passcode, sms.body.match(/PIN is (\d{6})/)[1]);
  const [row] = (await db2('account', 'getCustomerAccounts', { customerId: code })).body.responseList;
  assert.match(row.note, /first deposit of SGD 1,200,000\.00 has not arrived yet: Daniel Lim arranges it/);
});

test('an amount below every account: the offers say from what amount they start; otherwise nothing new', async () => {
  const offers = async (amount) => (await handle({ method: 'GET', path: '/unbound/offers', query: { amount, currency: 'SGD' }, headers: {} })).body;
  const small = await offers('50000');
  assert.deepEqual(small.offers, []);
  assert.match(small.none_for_this_amount, /^These accounts start at SGD 100,000\./);
  assert.equal((await offers('1000000')).none_for_this_amount, undefined);
});

test('use case 1 (no bank sent) is unchanged: Unbound Bank e-mail, no SMS, no bank customer', async () => {
  resetState();
  const { account, tqd, outbox } = await openAccount({ bank: '' });
  assert.match(tqd.email_subject, /^Welcome to Unbound Bank:/);
  assert.equal(outbox.length, 1);
  assert.doesNotMatch(outbox[0].body, /phone banking/);
  assert.match(outbox[0].body, /\nUnbound Bank$/);
  assert.equal((await db2('account', 'getAccountDetails', { accountId: account.account_number })).body.description, 'Account not found.');
});

test('moving money changes the balances and shows in the history; a blocked card stays blocked', async () => {
  resetState();
  const before = (await db2('account', 'getCustomerAccounts', { customerId: '5409881' })).body.responseList;
  const [current, savings] = before;
  const done = (await call('POST', '/ocbc/transfers', { fromAccount: current.accountId, toAccount: savings.accountId, amount: '500', confirmed: true })).body;
  assert.equal(done.ok, true);
  assert.match(done.reference, /^TRF-\d{5}$/);
  const after = (await db2('account', 'getCustomerAccounts', { customerId: '5409881' })).body.responseList;
  assert.equal(after[0].balance, Math.round((current.balance - 500) * 100) / 100);
  assert.equal(after[1].balance, Math.round((savings.balance + 500) * 100) / 100);
  const [latest] = (await db2('transaction', 'getTransactionHistory', { accountId: current.accountId })).body.responseList;
  assert.deepEqual([latest.type, latest.amount, latest.description], ['DEBIT', 500, `FUNDS TRANSFER TO A/C ENDING ${savings.accountId.slice(-4)}`]);
  // the last four digits alone are not enough; with the customer they are (an agent just handed the caller has those)
  const endingOnly = (await call('POST', '/ocbc/transfers', { fromAccount: current.accountId.slice(-4), toAccount: savings.accountId, amount: '5' })).body;
  assert.match(endingOnly.reason, /Use the full account number .*or its last four digits together with the customer id/);
  const byEndings = (
    await call('POST', '/ocbc/transfers', {
      fromAccount: current.accountId.slice(-4),
      toAccount: savings.accountId.slice(-4),
      customerId: '5409881',
      amount: '5',
    })
  ).body;
  assert.equal(byEndings.ok, true);
  assert.equal(
    (
      await call('POST', '/ocbc/transfers', {
        fromAccount: current.accountId.slice(-4),
        toAccount: savings.accountId.slice(-4),
        customerId: '1449287',
        amount: '5',
      })
    ).status,
    400,
    'another customer’s endings fit none of theirs',
  );
  await call('POST', '/ocbc/transfers', { fromAccount: savings.accountId, toAccount: current.accountId, amount: '5' }); // put the 5 back
  const tooMuch = (await call('POST', '/ocbc/transfers', { fromAccount: current.accountId, toAccount: savings.accountId, amount: '99999999' })).body;
  assert.match(tooMuch.reason, /There isn’t enough money in the account ending/);
  assert.equal(
    (await call('POST', '/ocbc/transfers', { fromAccount: current.accountId, toAccount: '480311686099', amount: '5' })).status,
    409,
    'another customer’s account',
  );

  const payees = (await call('GET', '/ocbc/customers/5409881/payees')).body.payees;
  const bill = payees.find((p) => p.type === 'BILL');
  const paid = (await call('POST', '/ocbc/payments', { fromAccount: current.accountId, payeeId: bill.id, amount: '120.50' })).body;
  assert.equal(paid.balanceNow, Math.round((current.balance - 500 - 120.5) * 100) / 100);

  const debit = (await call('GET', '/ocbc/customers/5409881/cards')).body.cards.find((c) => c.kind === 'Debit');
  assert.equal((await call('POST', `/ocbc/cards/${debit.cardId}/block`, { reason: 'Lost', confirmed: true })).body.ok, true);
  assert.equal((await call('GET', '/ocbc/customers/5409881/cards')).body.cards.find((c) => c.kind === 'Debit').status, 'BLOCKED');
  assert.match((await call('POST', `/ocbc/cards/${debit.cardId}/block`, {})).body.reason, /already blocked/);

  // a call-back once; a second while it is open says so
  assert.match((await call('POST', '/ocbc/callbacks', { customerId: '5409881', reason: 'Fixed deposit' })).body.reference, /^CB-\d{5}$/);
  assert.equal((await call('POST', '/ocbc/callbacks', { customerId: '5409881' })).status, 409);

  // the demo reset: the customer as they were
  assert.equal((await call('POST', '/ocbc/demo/reset', { customerId: '5409881' })).body.ok, true);
  assert.deepEqual(
    (await db2('account', 'getCustomerAccounts', { customerId: '5409881' })).body.responseList.map((a) => a.balance),
    before.map((a) => a.balance),
  );
  assert.equal((await call('GET', '/ocbc/customers/5409881/cards')).body.cards.find((c) => c.kind === 'Debit').status, 'ACTIVE');
  assert.equal((await call('POST', '/ocbc/callbacks', { customerId: '5409881' })).body.ok, true);
});
