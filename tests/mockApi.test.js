import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, resetState } from '../mock-api/src/app.mjs';
import customersFile from '../mock-api/data/customers.json' with { type: 'json' };
import services from '../mock-api/data/services.json' with { type: 'json' };

// The mock bank services (mock-api/): what the bank database doesn't have yet, for the same test customers and
// account numbers, following the bank's IVR call flows. Actions answer with a reference; they change no balance.

const call = (method, path, body = {}, extra = {}) => handle({ method, path, body, query: extra.query || {}, headers: extra.headers || {} });
const { customers } = customersFile;
const withCheques = services.cheques[0].accountId;
const sgCheques = services.cheques.find((c) => customers.find((x) => x.accounts.some((a) => a.accountId === c.accountId)).country === 'SG').accountId;
const identity = (pred) => services.identities.find(pred);

test('its records belong to the bank database’s test customers, and no TPIN is kept', () => {
  assert.ok(customers.length >= 10);
  const accounts = new Set(customers.flatMap((c) => c.accounts.map((a) => a.accountId)));
  for (const list of ['cheques', 'chequeBooks', 'chequeDeposits', 'fpxDirectDebits', 'balanceDetails', 'incomingFunds', 'lastServiceManagers'])
    for (const r of services[list]) assert.ok(accounts.has(r.accountId), `${list}: ${r.accountId}`);
  for (const card of services.cards) assert.ok(customers.some((c) => c.customerId === card.customerId));
  for (const id of services.identities) assert.ok(customers.some((c) => c.customerId === id.customerId));
  assert.equal(JSON.stringify(customersFile).includes('passcode'), false);
  assert.equal(JSON.stringify(services).includes('passcode'), false);
});

test('health and the route list need no key; with a key set, everything else does', () => {
  assert.equal(call('GET', '/health').status, 200);
  assert.equal(call('GET', '/').status, 200, 'the bare address answers');
  process.env.MOCK_API_KEY = 'test-key';
  try {
    assert.equal(call('GET', '/health').status, 200);
    assert.equal(call('GET', `/accounts/${withCheques}/cheques`).status, 401);
    assert.equal(call('GET', `/accounts/${withCheques}/cheques`, {}, { headers: { 'x-api-key': 'test-key' } }).status, 200);
  } finally {
    delete process.env.MOCK_API_KEY;
  }
  assert.equal(call('GET', '/nowhere').status, 404);
  assert.equal(call('DELETE', '/health').status, 405);
  assert.equal(call('POST', '/payments', '{not json').status, 400);
});

test('with x-refusals: in-body, a refusal comes back as 200 with ok: false and its reason (the agents ask for this)', () => {
  resetState();
  const asked = { headers: { 'x-refusals': 'in-body' } };
  const refused = call('POST', '/callbacks', { phone: '12' }, asked);
  assert.equal(refused.status, 200);
  assert.deepEqual([refused.body.ok, refused.body.refused, refused.body.status], [false, true, 400]);
  assert.match(refused.body.reason, /5 to 15 digits/);
  assert.equal(call('POST', '/callbacks', { phone: '12' }).status, 400, 'without the header, the usual status');
  assert.equal(call('GET', '/nowhere', {}, asked).status, 404, 'an unknown route stays an error');
});

test('a cheque: its status, stopping it once, and a cleared one can’t be stopped (SG pack pp. 12, 15–16)', () => {
  resetState();
  const cheques = services.cheques.filter((c) => c.accountId === sgCheques);
  const open = cheques.find((c) => c.status === 'NOT_PRESENTED');
  const cleared = cheques.find((c) => c.status === 'CLEARED');
  assert.equal(call('GET', `/accounts/${sgCheques}/cheques/${open.chequeNo}`).body.status, 'NOT_PRESENTED');
  assert.equal(call('GET', `/accounts/${sgCheques}/cheques/${cheques.find((c) => c.status === 'RETURNED').chequeNo}`).body.returnReason.length > 0, true);
  const stop = call('POST', `/accounts/${sgCheques}/cheques/${open.chequeNo}/stop`, { reason: 'Lost' });
  assert.equal(stop.status, 200);
  assert.match(stop.body.reference, /^STP-/);
  assert.deepEqual([stop.body.fee, stop.body.currency], [15, 'SGD'], 'one cheque: SGD 15');
  assert.equal(call('GET', `/accounts/${sgCheques}/cheques/${open.chequeNo}`).body.status, 'STOPPED', 'the stop is remembered');
  assert.equal(call('POST', `/accounts/${sgCheques}/cheques/${open.chequeNo}/stop`).body.code, 192);
  assert.equal(call('POST', `/accounts/${sgCheques}/cheques/${cleared.chequeNo}/stop`).body.code, 196);
  assert.equal(call('GET', `/accounts/${sgCheques}/cheques/999999`).status, 404);
});

test('stopping a range: up to 50 cheques within one cheque book, SGD 30', () => {
  resetState();
  const book = services.chequeBooks.find((b) => b.accountId === sgCheques);
  const from = String(Number(book.from) + 10).padStart(6, '0');
  const range = call('POST', `/accounts/${sgCheques}/cheques/${from}/stop`, { lastChequeNo: String(Number(from) + 4) });
  assert.equal(range.status, 200);
  assert.deepEqual([range.body.count, range.body.fee], [5, 30]);
  assert.equal(call('POST', `/accounts/${sgCheques}/cheques/${book.from}/stop`, { lastChequeNo: String(Number(book.to) + 5) }).body.code, 343, 'past the book');
});

test('balances, incoming funds and deposited or returned cheques (SG pack pp. 4–6, 11)', () => {
  const detail = services.balanceDetails.find((d) => d.holdAmount > 0);
  const balance = call('GET', `/accounts/${detail.accountId}/balance`).body;
  assert.equal(balance.availableBalance, Math.round((balance.balance - detail.holdAmount - detail.pendingClearance) * 100) / 100);
  const withFunds = services.incomingFunds[0].accountId;
  const funds = call('GET', `/accounts/${withFunds}/incoming-funds`).body;
  assert.ok(funds.count > 0 && funds.funds.every((f) => f.date && f.status === 'CREDITED'));
  const none = customers.flatMap((c) => c.accounts).find((a) => !services.incomingFunds.some((f) => f.accountId === a.accountId));
  assert.match(call('GET', `/accounts/${none.accountId}/incoming-funds`).body.message, /no incoming funds/);
  assert.ok(call('GET', `/accounts/${sgCheques}/cheque-deposits`).body.cheques.every((c) => c.status !== 'RETURNED'));
  assert.ok(call('GET', `/accounts/${sgCheques}/cheque-deposits`, {}, { query: { kind: 'returned' } }).body.cheques.every((c) => c.returnReason));
});

test('cheque books: the delivery choices offered now, and normal delivery is always there (SG pack p. 14)', () => {
  resetState();
  const options = call('GET', `/accounts/${sgCheques}/cheque-books/options`).body.options;
  assert.ok(options.some((o) => o.delivery === 'normal' && o.fee === 0));
  for (const o of options) if (o.delivery !== 'normal') assert.ok([27, 18].includes(o.fee));
  assert.equal(call('POST', `/accounts/${sgCheques}/cheque-books`, { delivery: 'normal' }).status, 200);
});

test('statements: this month or the two before; earlier ones need a service manager (SG pack p. 8)', () => {
  const sg = customers.find((c) => c.country === 'SG').accounts[0].accountId;
  const now = new Date();
  const month = (back) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)).toISOString().slice(0, 7);
  assert.equal(call('POST', `/accounts/${sg}/statements`, { month: month(1) }).status, 200);
  assert.equal(call('POST', `/accounts/${sg}/statements`, { month: month(5) }).body.olderThanTwoMonths, true);
});

test('logins: account + NRIC (then a one-time password), key code, IC number; personal and dormant callers (SG pp. 33–34, MY pp. 50, 52)', () => {
  resetState();
  const business = identity((i) => i.idType === 'NRIC' && i.customerType === 'business' && !i.dormantAccounts.length);
  const account = customers.find((c) => c.customerId === business.customerId).accounts[0].accountId;
  const ok = call('POST', '/login/account', { accountId: account, nricLast4: business.idNumber.slice(-4) }).body;
  assert.equal(ok.match, true);
  assert.equal(ok.customerId, business.customerId);
  assert.equal(call('POST', '/login/account', { accountId: account, nricLast4: '0000' }).body.match, false);
  assert.equal(call('POST', '/login/account', { accountId: '123' }).status, 400);
  const personal = identity((i) => i.customerType === 'personal');
  const pAccount = customers.find((c) => c.customerId === personal.customerId).accounts[0].accountId;
  assert.match(call('POST', '/login/account', { accountId: pAccount, nricLast4: personal.idNumber.slice(-4) }).body.reason, /1800 363 3333/);
  const dormant = identity((i) => i.dormantAccounts.length);
  assert.equal(call('POST', '/login/account', { accountId: dormant.dormantAccounts[0], nricLast4: dormant.idNumber.slice(-4) }).body.dormant, true);
  // one-time password: three tries
  call('POST', '/otp/send', { customerId: business.customerId });
  call('POST', '/otp/verify', { customerId: business.customerId, otp: '1' });
  call('POST', '/otp/verify', { customerId: business.customerId, otp: '2' });
  assert.equal(call('POST', '/otp/verify', { customerId: business.customerId, otp: '3' }).body.locked, true);
  const my = identity((i) => i.keyCode);
  assert.equal(call('POST', '/login/key-code', { keyCode: my.keyCode }).body.customerId, my.customerId);
  assert.equal(call('POST', '/login/key-code', { keyCode: '00000000' }).body.match, false);
  assert.equal(call('POST', '/login/ic', { ic: my.idNumber }).body.customerId, my.customerId);
  assert.equal(call('POST', '/login/ic', { ic: '12' }).status, 400);
});

test('changing the phone PIN: 6 digits, entered twice, nothing kept (SG p. 9, MY p. 52)', () => {
  resetState();
  const id = customers[0].customerId;
  assert.equal(call('POST', `/customers/${id}/phone-pin`, { newPin: '1234', confirmPin: '1234' }).status, 400);
  assert.equal(call('POST', `/customers/${id}/phone-pin`, { newPin: '135790', confirmPin: '135791' }).status, 400);
  const done = call('POST', `/customers/${id}/phone-pin`, { newPin: '135790', confirmPin: '135790' });
  assert.equal(done.status, 200);
  assert.equal(JSON.stringify(done.body).includes('135790'), false, 'the PIN is never echoed');
});

test('payments and transfers confirm with a reference, only to the customer’s own payees and accounts', () => {
  resetState();
  const entry = services.payees[0];
  const customer = customers.find((c) => c.customerId === entry.customerId);
  const from = customer.accounts[0].accountId;
  const pay = call('POST', '/payments', { fromAccount: from, payeeId: entry.payees[0].id, amount: 120 });
  assert.equal(pay.status, 200);
  assert.match(pay.body.note, /no balance changes/);
  const other = services.payees.find((p) => p.customerId !== entry.customerId).payees[0].id;
  assert.equal(call('POST', '/payments', { fromAccount: from, payeeId: other, amount: 120 }).status, 404, 'someone else’s payee');
  const stranger = customers.find((c) => c.customerId !== customer.customerId).accounts[0].accountId;
  assert.equal(call('POST', '/transfers', { fromAccount: from, toAccount: stranger, amount: 10 }).status, 409);
  const noLoan = services.payees.find((p) => !p.payees.some((x) => x.type === 'LOAN'));
  assert.match(call('GET', `/customers/${noLoan.customerId}/payees`).body.noLoan, /do not have any loan/);
});

test('cards, call-backs, cases and the card transactions', () => {
  resetState();
  const credit = services.cards.find((c) => c.kind === 'Credit' && c.status === 'ACTIVE');
  assert.equal(call('GET', `/cards/${credit.cardId}/transactions`).body.transactions.length, 5);
  assert.equal(call('POST', `/cards/${credit.cardId}/statements`, { month: '2026-10' }).status, 200);
  assert.equal(call('POST', `/cards/${credit.cardId}/block`).status, 200);
  assert.equal(call('POST', `/cards/${credit.cardId}/block`).status, 409);
  const id = customers[0].customerId;
  assert.equal(call('POST', '/callbacks', { customerId: id, reason: 'Loan question' }).status, 200);
  assert.equal(call('GET', `/customers/${id}/callbacks/open`).body.open, true);
  assert.equal(call('POST', '/callbacks', { customerId: id }).status, 409, 'one open call-back at a time');
  const account = customers[0].accounts[0].accountId;
  assert.match(call('POST', '/cases', { accountId: account, summary: 'ATM withdrawal I did not make' }).body.caseId, /^INV-/);
});

test('appointments: the training days, places per session and per customer, at least 2 days ahead (SG pp. 19, 45, 47)', () => {
  resetState();
  const id = customers.find((c) => c.country === 'SG').customerId;
  const payment = call('GET', '/appointments/slots', {}, { query: { type: 'velocity_training' } }).body.slots;
  assert.ok(payment.length && payment.every((s) => new Date(`${s.date}T00:00:00Z`).getUTCDay() === 3 && s.from === '09:30' && s.to === '12:30'));
  const trade = call('GET', '/appointments/slots', {}, { query: { type: 'trade_training' } }).body.slots;
  for (const s of trade) {
    const d = new Date(`${s.date}T00:00:00Z`);
    assert.equal(d.getUTCDay(), 5);
    assert.notEqual(new Date(d.getTime() + 7 * 86400000).getUTCMonth(), d.getUTCMonth(), 'the last Friday of the month');
  }
  const soonest = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  assert.ok(payment.every((s) => s.date > soonest));
  assert.equal(call('POST', '/appointments', { customerId: id, slotId: payment[0].slotId, count: 3 }).status, 409, 'two attendees at most');
  const booking = call('POST', '/appointments', { customerId: id, slotId: payment[0].slotId, count: 2 });
  assert.equal(booking.status, 200);
  assert.equal(call('POST', '/appointments', { customerId: id, slotId: payment[1].slotId, count: 1 }).status, 409, 'the two places are used');
  const east = call('GET', '/appointments/slots', {}, { query: { type: 'account_opening', region: 'east' } }).body.slots;
  assert.ok(east.length && east.every((s) => s.region === 'East'));
  const tampines = call('GET', '/appointments/slots', {}, { query: { type: 'account_opening', place: 'tampines' } }).body.slots;
  assert.ok(tampines.every((x) => x.place === 'Tampines branch'));
  const six = call('POST', '/appointments', { customerId: id, slotId: tampines[0].slotId, count: 6 });
  assert.equal(six.body.remainingEntitlement, 0);
  assert.equal(call('POST', '/appointments', { customerId: id, slotId: tampines[1].slotId }).status, 409, 'six accounts in all');
  const later = call('GET', '/appointments/slots', {}, { query: { type: 'velocity_training', from: payment.at(-1).date } }).body.slots[0];
  const other = customers.filter((c) => c.country === 'SG')[1].customerId;
  const far = call('POST', '/appointments', { customerId: other, slotId: later.slotId });
  assert.equal(call('POST', `/appointments/${far.body.bookingId}/cancel`).status, 200);
});

test('VIP line, investigations line, service codes and the service centre (SG pp. 29, 31, 32, 41)', () => {
  const [account, phoneCode] = services.vip;
  const vip = call('GET', `/vip/${account.mobile}`).body;
  assert.equal(vip.found, true);
  assert.equal(vip.vipType, 'account');
  assert.equal(typeof vip.serviceManager.available, 'boolean');
  const vipAccount = customers.find((c) => c.customerId === account.customerId).accounts[0].accountId;
  assert.equal(call('POST', `/vip/${account.mobile}/check-account`, { accountId: vipAccount }).body.match, true);
  assert.equal(call('POST', `/vip/${account.mobile}/check-account`, { accountId: '000000000000' }).body.match, false);
  assert.equal(call('GET', `/vip/${phoneCode.mobile}`).body.customerId, phoneCode.customerId);
  assert.match(call('GET', '/vip/+6500000000').body.message, /6538 1111/);
  const sm = call('GET', `/accounts/${services.lastServiceManagers[0].accountId}/service-manager`).body;
  assert.ok(sm.found && sm.serviceManager.name);
  assert.equal(call('GET', '/service-codes/328').body.options.length, 4);
  assert.match(call('GET', '/service-codes/999').body.reason, /invalid campaign code/);
  assert.equal(typeof call('GET', '/service-centre').body.open, 'boolean');
});

test('caller preferences: the language after 5 picks, balance as the favourite after 5 enquiries (SG pp. 1–2)', () => {
  resetState();
  const phone = '+6591112222';
  for (let i = 0; i < 4; i++) call('POST', `/callers/${phone}/choices`, { language: 'zh', transaction: 'balance' });
  assert.equal(call('GET', `/callers/${phone}`).body.preferredLanguage, null);
  call('POST', `/callers/${phone}/choices`, { language: 'zh', transaction: 'balance' });
  assert.deepEqual([call('GET', `/callers/${phone}`).body.preferredLanguage, call('GET', `/callers/${phone}`).body.favouriteTransaction], ['zh', 'balance']);
});

test('information needs no customer; faxes, call-backs by phone, surveys on the 1–3 scale', () => {
  resetState();
  const sg = call('GET', '/info/rates', {}, { query: { country: 'SG' } }).body;
  assert.deepEqual(
    sg.fx.rates.map((r) => r.currency),
    ['USD', 'CAD', 'AUD', 'NZD', 'HKD', 'GBP', 'EUR', 'JPY', 'IDR'],
  );
  assert.equal(sg.timeDeposit.minimumDeposit, 5000);
  const my = call('GET', '/info/rates', {}, { query: { country: 'MY' } }).body;
  assert.ok(my.primeRate && my.foreignCurrencyDepositRates.callRates.length && my.islamicBanking.length === 2);
  assert.equal(call('GET', '/info/rates', {}, { query: { country: 'XX' } }).status, 400);
  assert.equal(call('GET', '/info/branches', {}, { query: { country: 'MY', area: 'penang' } }).body.branches.length, 1);
  assert.ok(call('GET', '/info/branches', {}, { query: { country: 'SG', region: 'north' } }).body.branches.every((b) => b.region === 'North'));
  assert.match(call('GET', '/info/branches', {}, { query: { country: 'MY', area: 'nowhere' } }).body.note, /these are all of them/);
  assert.equal(call('GET', '/info/forms', {}, { query: { country: 'SG' } }).body.forms.length, 12);
  assert.equal(call('POST', '/info/forms/fax', { formId: '2651', faxNumber: '6123 4567' }).status, 200);
  assert.equal(call('POST', '/info/forms/fax', { formId: '2651', faxNumber: '612345' }).status, 400, 'a local fax has 8 digits');
  assert.equal(call('POST', '/info/forms/fax', { formId: '2651', faxNumber: '+60 3 2123 4567' }).status, 200, 'overseas');
  assert.equal(call('POST', '/info/promotions/SG-P1/fax', { faxNumber: '6123 4567' }).status, 200);
  assert.equal(call('POST', '/info/promotions/SG-P3/fax', { faxNumber: '6123 4567' }).status, 404, 'not one that can be faxed');
  assert.ok(call('GET', '/info/contacts', {}, { query: { country: 'SG' } }).body.contacts.some((c) => c.number === '6318 7777'));
  assert.equal(call('POST', '/callbacks', { phone: '+65 9123 4567', reason: 'A service manager' }).status, 200);
  assert.equal(call('GET', '/callbacks/open', {}, { query: { phone: '+65 9123 4567' } }).body.open, true);
  assert.equal(call('POST', '/callbacks', { phone: '+65 9123 4567' }).status, 409, 'one open call-back per number');
  assert.equal(call('POST', '/callbacks', { phone: '1234' }).status, 400, '5 to 15 digits');
  assert.equal(call('POST', '/callbacks', { customerId: '0000000' }).status, 400);
  assert.equal(call('GET', '/surveys/questions', {}, { query: { survey: 'service_manager' } }).body.questions.length, 3);
  assert.equal(call('POST', '/surveys', { ratings: [1, 2, 4] }).status, 400);
  assert.equal(call('POST', '/surveys', { ratings: [1, 2, 3] }).status, 200);
  assert.equal(call('POST', '/surveys', { survey: 'service_manager', ratings: [1, 1, 2] }).status, 400, 'needs the profile');
  assert.equal(call('POST', '/surveys', { survey: 'service_manager', profile: 'BC', ratings: [1, 1, 2] }).status, 200);
});
