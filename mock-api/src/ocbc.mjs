// The OCBC journey (onboarding to everyday banking): the bank's core systems as stand-ins, for the
// ocbc-personal-banking agent. Its banking specialists are copies of the MY consumer team's, whose sign-in and account
// tools read Ashwin's DB2; here they read POST /ocbc/dboperations instead, which takes the same request and answers in
// the same shape, so their rules stay word for word. Unlike the older routes in app.mjs, what changes here is kept (a
// blocked card stays blocked, a transfer moves the balance, a new TPIN is the TPIN), in the store (store.mjs), so every
// copy of the function on Vercel sees it.
//   Customers:  the 15 test customers (data/customers.json + data/bank.json: TPIN, balances, recent transactions), and
//               each customer opened by the onboarding agent (POST /unbound/accounts with bank: "OCBC"): a new phone
//               banking number, a temporary TPIN (sent by SMS, see /tqd/cases), the account awaiting its first
//               deposit, and a debit card on its way.
// Figures are demo figures; nothing here touches DB2.

import { randomInt } from 'node:crypto';
import customersFile from '../data/customers.json' with { type: 'json' };
import services from '../data/services.json' with { type: 'json' };
import bankFile from '../data/bank.json' with { type: 'json' };
import { store } from './store.mjs';

const ZONE = { SG: 'Asia/Singapore', MY: 'Asia/Kuala_Lumpur' };
const today = (country = 'SG') => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE[country] || ZONE.SG }).format(new Date());
const shift = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const workingDays = (n, country) => {
  let d = today(country);
  for (let left = n; left > 0;) {
    d = shift(d, 1);
    if (new Date(`${d}T00:00:00Z`).getUTCDay() % 6) left -= 1;
  }
  return d;
};
const longDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const money = (n, currency) => `${currency} ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const round = (n) => Math.round(n * 100) / 100;
const digitsOf = (v) => String(v ?? '').replace(/\D/g, '');
const text = (v) => (typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v).trim());
// short references (TRF-48213): easy to say aloud, too short to be taken for an account number in call logs
const ref = (prefix) => `${prefix}-${randomInt(10000, 100000)}`;
const bad = (reason) => [400, { ok: false, reason }];
const notFound = (what) => [404, { ok: false, reason: `No ${what} with that number.` }];
// an account the bank doesn't know (an agent sent only the last four digits it said aloud): say how to get it right
const FULL_NUMBER =
  'No account with that number. Use the full account number (accountId from bank_customer_accounts), or its last four digits together with the customer id (the caller’s phone banking number).';

// ---- the test customers: data/customers.json (names, accounts) + data/bank.json (TPIN, e-mail, balances, history)
const BANK = new Map(bankFile.customers.map((c) => [c.customerId, c]));
const seeded = (customerId) => {
  const c = customersFile.customers.find((x) => x.customerId === customerId);
  if (!c) return null;
  const b = BANK.get(customerId);
  return {
    customerId: c.customerId,
    passcode: b.passcode,
    name: c.name,
    phone: c.phone,
    email: b.email,
    country: c.country,
    accounts: c.accounts.map((a) => {
      const r = b.accounts.find((x) => x.accountId === a.accountId);
      return { ...a, balance: r.balance, history: r.transactions };
    }),
    cards: services.cards.filter((card) => card.customerId === customerId),
  };
};

// ---- what changed since: kept in the store, by kind
//   bank_customers      customers opened by onboarding (whole records)
//   bank_account_index  account number -> its customer (for new customers)
//   bank_ledger         account number -> { balance, moves: [newest first] } once money moved
//   bank_cards          card id -> { status, ... } once a card was blocked or activated
//   bank_passcodes      customer -> { passcode } once the TPIN was changed
async function customerOf(id) {
  const customerId = digitsOf(id);
  if (customerId.length !== 7) return null;
  const c = seeded(customerId) || (await store.get('bank_customers', customerId));
  if (!c) return null;
  const changed = await store.get('bank_passcodes', customerId);
  return changed ? { ...c, passcode: changed.passcode } : c;
}
// an account by its full number; or by its last four digits with the customer (an agent just handed the caller has the
// endings it heard and the caller's phone banking number, not the full numbers): only when exactly one account fits
async function accountOf(id, customerId) {
  let accountId = digitsOf(id);
  if (!accountId) return null;
  if (accountId.length <= 4 && digitsOf(customerId)) {
    const owner = await customerOf(customerId);
    const fits = owner?.accounts.filter((a) => a.accountId.endsWith(accountId)) || [];
    if (fits.length !== 1) return null;
    accountId = fits[0].accountId;
  }
  let customer = customersFile.customers.find((c) => c.accounts.some((a) => a.accountId === accountId));
  if (customer) customer = await customerOf(customer.customerId);
  else {
    const index = await store.get('bank_account_index', accountId);
    customer = index ? await customerOf(index.customerId) : null;
  }
  const account = customer?.accounts.find((a) => a.accountId === accountId);
  if (!account) return null;
  const ledger = await store.get('bank_ledger', accountId);
  return { ...account, balance: ledger ? ledger.balance : account.balance, moves: ledger?.moves || [], customer };
}
async function cardOf(id) {
  const cardId = text(id).toUpperCase();
  const customer = await customerOf(cardId.slice(1, 8));
  const card = customer?.cards.find((c) => c.cardId === cardId);
  if (!card) return null;
  const changed = await store.get('bank_cards', cardId);
  return { ...card, ...(changed || {}), customer };
}
// money moving: the new balance and the line on the statement, kept for the account
async function post(account, type, amount, description) {
  const balance = round(account.balance + (type === 'CREDIT' ? amount : -amount));
  const move = { type, amount, description, date: today(account.customer.country) };
  await store.put('bank_ledger', account.accountId, { balance, moves: [move, ...account.moves] });
  return balance;
}

// ---- the DB2 stand-in's rows, as DB2 writes them (customerId = phone banking number, passcode = TPIN, accountId)
const customerRow = (c) => ({ customerId: c.customerId, passcode: c.passcode, name: c.name, phone: c.phone, email: c.email, country: c.country });
const accountRow = (a) => ({
  accountId: a.accountId,
  customerId: a.customer.customerId,
  accountType: a.accountType,
  balance: a.balance,
  currency: a.currency,
  ...(a.status ? { status: a.status } : {}),
  ...(a.status && a.expectedDeposit && a.balance === 0
    ? {
        note: `Opened on ${longDate(a.openedOn)}. The first deposit of ${money(a.expectedDeposit, a.currency)} has not arrived yet: ${a.relationshipManager || 'the relationship manager'} arranges it with the customer.`,
      }
    : {}),
});
const historyRows = (a) => [
  ...a.moves.map((m) => ({ accountId: a.accountId, type: m.type, amount: m.amount, description: m.description, transactionDate: m.date })),
  ...(a.history || []).map((t) => ({
    accountId: a.accountId,
    type: t.type,
    amount: t.amount,
    description: t.description,
    transactionDate: shift(today(a.customer.country), -t.daysAgo),
  })),
];
const db2 = (rows) => [200, { tableDetails: null, responseCode: '0', status: 'SUCCESS', errorDesc: null, responseList: rows }];
const db2Failed = (why) => [200, { tableDetails: null, responseCode: '-1', status: 'FAILED', description: why, errorDesc: why, responseList: [] }];

/** Opening an account for a bank whose agents serve it at once (called by POST /unbound/accounts with bank). */
export async function openBankingCustomer({ bank, account, customer, deposit, currency }) {
  let customerId = '';
  for (let i = 0; i < 10 && (!customerId || (await customerOf(customerId))); i++) customerId = String(randomInt(2000000, 10000000));
  const name = `${text(customer.first_name)} ${text(customer.last_name)}`.trim() || 'Customer';
  const record = {
    customerId,
    passcode: String(randomInt(0, 1000000)).padStart(6, '0'),
    name,
    phone: text(customer.mobile),
    email: text(customer.email),
    country: 'SG',
    bank,
    accounts: [
      {
        accountId: account.account_number,
        accountType: account.plan_name,
        currency,
        balance: 0,
        status: 'Open, awaiting the first deposit',
        expectedDeposit: deposit || 0,
        relationshipManager: account.relationship_manager,
        openedOn: today('SG'),
        history: [],
      },
    ],
    cards: [
      {
        cardId: `C${customerId}D`,
        customerId,
        kind: 'Debit',
        name: 'Debit Mastercard',
        last4: String(randomInt(0, 10000)).padStart(4, '0'),
        status: 'NOT_ACTIVATED',
        currency,
        linkedAccountEnding: account.account_number.slice(-4),
        arrivesBy: workingDays(5, 'SG'),
        note: 'A new card, posted to the customer’s address. It can be activated on a call once the customer has it.',
      },
    ],
  };
  await store.put('bank_customers', customerId, record);
  await store.put('bank_account_index', account.account_number, { customerId });
  return record;
}
/** The banking customer of an account opened by onboarding (or null). */
export async function bankingCustomerOfAccount(accountNumber) {
  const index = await store.get('bank_account_index', digitsOf(accountNumber));
  return index ? customerOf(index.customerId) : null;
}
/** The welcome e-mail's lines about phone banking for a new customer (the TPIN itself goes by SMS). */
export function welcomeBankingLines(c) {
  const card = c.cards[0];
  return [
    'Phone banking:',
    `Your phone banking number is ${c.customerId}. We have sent a temporary phone banking PIN by SMS to your mobile ending ${digitsOf(c.phone).slice(-4)}; please change it on your first call.`,
    `You can call or chat with us any time to check your new account${card ? `, and to activate your debit card ending ${card.last4} once it arrives` : ''}.`,
  ];
}

export const OCBC_ROUTES = [
  // ---- the DB2 stand-in: same request ({ entity, method, details: [{ columnMap }] }), same answer shape
  [
    'POST',
    '/ocbc/dboperations',
    async (_, body) => {
      const map = body?.details?.[0]?.columnMap || {};
      const key = `${text(body.entity)}.${text(body.method)}`;
      if (key === 'customer.getCustomerDetails') {
        const c = await customerOf(map.customerId ?? map.phoneNumber);
        return c ? db2([customerRow(c)]) : db2Failed('Customer not found.');
      }
      if (key === 'account.getCustomerAccounts') {
        const c = await customerOf(map.customerId ?? map.phoneNumber);
        if (!c) return db2Failed('Customer not found.');
        const accounts = await Promise.all(c.accounts.map((a) => accountOf(a.accountId)));
        return db2(accounts.filter(Boolean).map(accountRow));
      }
      if (key === 'account.getAccountDetails') {
        const a = await accountOf(map.accountId ?? map.accountNumber);
        return a ? db2([accountRow(a)]) : db2Failed('Account not found.');
      }
      if (key === 'transaction.getTransactionHistory') {
        const a = await accountOf(map.accountId ?? map.accountNumber);
        if (!a) return db2Failed('Account not found.');
        const rows = historyRows(a);
        return rows.length ? db2(rows) : db2Failed('No transactions found.');
      }
      return [500, { responseCode: '500', status: 'FAILED', description: 'Invalid entity or method name.', errorDesc: 'Invalid entity or method name.' }];
    },
  ],

  // ---- balance details: holds, cheques waiting to clear, overdraft (as GET /accounts/:id/balance, for every account)
  [
    'GET',
    '/ocbc/accounts/:accountId/balance',
    async ({ accountId }) => {
      const a = await accountOf(accountId);
      if (!a) return notFound('account');
      const d = services.balanceDetails.find((x) => x.accountId === a.accountId) || { holdAmount: 0, pendingClearance: 0, overdraftLimit: 0 };
      return [
        200,
        {
          ...accountRow(a),
          availableBalance: round(a.balance - d.holdAmount - d.pendingClearance),
          holdAmount: d.holdAmount,
          pendingClearance: d.pendingClearance,
          overdraftLimit: d.overdraftLimit,
        },
      ];
    },
  ],

  // ---- statements: this month or the two before; none from before the account opened
  [
    'POST',
    '/ocbc/accounts/:accountId/statements',
    async ({ accountId }, body) => {
      const a = await accountOf(accountId, body.customerId);
      if (!a) return bad(FULL_NUMBER);
      const month = text(body.month);
      if (!/^\d{4}-\d{2}$/.test(month)) return bad('Say which month, e.g. "2026-10".');
      const country = a.customer.country;
      const now = today(country).slice(0, 7);
      const back = (Number(now.slice(0, 4)) - Number(month.slice(0, 4))) * 12 + Number(now.slice(5)) - Number(month.slice(5));
      if (back < 0) return bad('That month has not started yet.');
      if (a.openedOn && month < a.openedOn.slice(0, 7))
        return [409, { ok: false, reason: `The account opened on ${longDate(a.openedOn)}, so there is no statement for that month.` }];
      if (back > 2)
        return [409, { ok: false, olderThanTwoMonths: true, reason: 'Statements earlier than two months ago are requested through a service manager.' }];
      return [
        200,
        {
          ok: true,
          reference: ref('STM'),
          accountEnding: a.accountId.slice(-4),
          month,
          readyBy: workingDays(7, country),
          delivery: 'Post to the registered address',
          fee: 5,
          currency: a.currency,
          message: 'Your statement will be sent to you within 7 working days.',
        },
      ];
    },
  ],

  // ---- cards
  [
    'GET',
    '/ocbc/customers/:customerId/cards',
    async ({ customerId }) => {
      const c = await customerOf(customerId);
      if (!c) return notFound('customer');
      const cards = await Promise.all(c.cards.map((card) => cardOf(card.cardId)));
      return [200, { customerId: c.customerId, cards: cards.map(({ customer, ...card }) => card) }];
    },
  ],
  [
    'POST',
    '/ocbc/cards/:cardId/block',
    async ({ cardId }, body) => {
      const card = await cardOf(cardId);
      if (!card) return notFound('card');
      if (card.status === 'BLOCKED') return [409, { ok: false, reason: `The card ending ${card.last4} is already blocked.` }];
      const country = card.customer.country;
      const blocked = { status: 'BLOCKED', blockedOn: today(country), blockReason: text(body.reason) || 'Lost or stolen' };
      await store.put('bank_cards', card.cardId, blocked);
      return [
        200,
        {
          ok: true,
          reference: ref('BLK'),
          last4: card.last4,
          blockedOn: blocked.blockedOn,
          replacementBy: workingDays(7, country),
          replacementFee: country === 'MY' ? 12 : 0,
          currency: card.currency,
          message: 'The card is blocked at once: no new payments or withdrawals can be made with it. A replacement card is posted to the registered address.',
        },
      ];
    },
  ],
  [
    'POST',
    '/ocbc/cards/:cardId/activate',
    async ({ cardId }) => {
      const card = await cardOf(cardId);
      if (!card) return notFound('card');
      if (card.status === 'BLOCKED') return [409, { ok: false, reason: 'A blocked card cannot be activated.' }];
      if (card.status === 'ACTIVE') return [409, { ok: false, reason: `The card ending ${card.last4} is already active.` }];
      await store.put('bank_cards', card.cardId, { status: 'ACTIVE', activatedOn: today(card.customer.country) });
      return [200, { ok: true, last4: card.last4, status: 'ACTIVE', message: 'The card is active and ready to use. Set its PIN at any OCBC ATM.' }];
    },
  ],

  // ---- payees and moving money (balances change, and each move shows in the history)
  [
    'GET',
    '/ocbc/customers/:customerId/payees',
    async ({ customerId }) => {
      const c = await customerOf(customerId);
      if (!c) return notFound('customer');
      const payees = services.payees.find((p) => p.customerId === c.customerId)?.payees || [];
      return [
        200,
        {
          customerId: c.customerId,
          payees,
          ...(payees.some((p) => p.type === 'LOAN') ? {} : { noLoan: 'Sorry, you do not have any loan account with OCBC Bank.' }),
          ...(payees.length ? {} : { message: 'No payees are registered yet. Payees are added in online banking.' }),
        },
      ];
    },
  ],
  [
    'POST',
    '/ocbc/transfers',
    async (_, body) => {
      const [from, to] = await Promise.all([accountOf(body.fromAccount, body.customerId), accountOf(body.toAccount, body.customerId)]);
      if (!from || !to) return bad(FULL_NUMBER);
      if (from.accountId === to.accountId) return bad('The two accounts must be different.');
      if (from.customer.customerId !== to.customer.customerId) return [409, { ok: false, reason: 'Both accounts must belong to the same customer.' }];
      if (from.currency !== to.currency) return [409, { ok: false, reason: 'Both accounts must be in the same currency.' }];
      if (/fixed/i.test(from.accountType)) return [409, { ok: false, reason: 'Money in a fixed deposit can’t be transferred before it matures.' }];
      const amount = round(Number(body.amount));
      if (!amount || amount <= 0) return bad('Give an amount above zero.');
      if (amount > from.balance)
        return [
          409,
          {
            ok: false,
            reason: `There isn’t enough money in the account ending ${from.accountId.slice(-4)}: its balance is ${money(from.balance, from.currency)}.`,
          },
        ];
      const fromBalance = await post(from, 'DEBIT', amount, `FUNDS TRANSFER TO A/C ENDING ${to.accountId.slice(-4)}`);
      const toBalance = await post(to, 'CREDIT', amount, `FUNDS TRANSFER FROM A/C ENDING ${from.accountId.slice(-4)}`);
      return [
        200,
        {
          ok: true,
          reference: ref('TRF'),
          fromAccountEnding: from.accountId.slice(-4),
          toAccountEnding: to.accountId.slice(-4),
          amount,
          currency: from.currency,
          doneOn: today(from.customer.country),
          fromBalanceNow: fromBalance,
          toBalanceNow: toBalance,
          message: 'The money is in the other account now.',
        },
      ];
    },
  ],
  [
    'POST',
    '/ocbc/payments',
    async (_, body) => {
      const from = await accountOf(body.fromAccount, body.customerId);
      if (!from) return bad(FULL_NUMBER);
      const payee = services.payees.find((p) => p.customerId === from.customer.customerId)?.payees.find((p) => p.id === text(body.payeeId));
      if (!payee) return [404, { ok: false, reason: 'That payee is not registered for this customer.' }];
      const amount = round(Number(body.amount));
      if (!amount || amount <= 0) return bad('Give an amount above zero.');
      if (/fixed/i.test(from.accountType)) return [409, { ok: false, reason: 'Payments can’t be made from a fixed deposit.' }];
      if (amount > from.balance)
        return [
          409,
          {
            ok: false,
            reason: `There isn’t enough money in the account ending ${from.accountId.slice(-4)}: its balance is ${money(from.balance, from.currency)}.`,
          },
        ];
      const country = from.customer.country;
      const balanceNow = await post(from, 'DEBIT', amount, `PAYMENT - ${payee.name.toUpperCase()}`);
      return [
        200,
        {
          ok: true,
          reference: ref('PAY'),
          fromAccountEnding: from.accountId.slice(-4),
          payee: payee.name,
          type: payee.type,
          amount,
          currency: from.currency,
          paidOn: today(country),
          balanceNow,
          ...(payee.type === 'OTHER_BANK' ? { arrivesBy: workingDays(1, country) } : {}),
        },
      ];
    },
  ],

  // ---- call-backs from a service manager: for a known customer (test or new), or just a phone number; one open at a time
  [
    'POST',
    '/ocbc/callbacks',
    async (_, body) => {
      const customer = digitsOf(body.customerId) ? await customerOf(body.customerId) : null;
      if (digitsOf(body.customerId) && !customer) return bad('No customer with that number.');
      const phone = String(body.phone || customer?.phone || '').replace(/[^\d+]/g, '');
      const n = digitsOf(phone).length;
      if (!customer && !n) return bad('Give the customer (customerId) or a phone number to call.');
      if (n < 5 || n > 15) return [400, { ok: false, reason: 'You have entered an invalid call-back number: it has 5 to 15 digits.' }];
      const who = customer ? customer.customerId : `phone-${digitsOf(phone)}`;
      const open = await store.get('bank_callbacks', who);
      if (open?.status === 'OPEN')
        return [409, { ok: false, reason: 'You have already made a request for us to return your call.', reference: open.reference }];
      const callback = {
        reference: ref('CB'),
        customerId: customer?.customerId || null,
        phoneEnding: phone.slice(-4),
        reason: text(body.reason) || 'General enquiry',
        status: 'OPEN',
        within: 'as soon as possible',
        message: 'Our Service Manager will return your call as soon as possible.',
      };
      await store.put('bank_callbacks', who, callback);
      return [200, { ok: true, ...callback }];
    },
  ],

  // ---- before a demo or a test run: a customer back as they were (balances, history, cards, TPIN, call-back)
  [
    'POST',
    '/ocbc/demo/reset',
    async (_, body) => {
      const c = await customerOf(body.customerId);
      if (!c) return notFound('customer');
      await Promise.all([
        ...c.accounts.map((a) => store.put('bank_ledger', a.accountId, null)),
        ...c.cards.map((card) => store.put('bank_cards', card.cardId, null)),
        store.put('bank_passcodes', c.customerId, null),
        store.put('bank_callbacks', c.customerId, null),
      ]);
      return [200, { ok: true, customerId: c.customerId, reset: ['balances', 'history', 'cards', 'TPIN', 'call-back'] }];
    },
  ],

  // ---- the phone PIN (TPIN): a new 6-digit PIN, entered twice; from now on it is the TPIN the agents check
  [
    'POST',
    '/ocbc/customers/:customerId/phone-pin',
    async ({ customerId }, body) => {
      const c = await customerOf(customerId);
      if (!c) return notFound('customer');
      const pin = digitsOf(body.newPin);
      if (pin.length !== 6 || String(body.newPin).replace(/\s/g, '').length !== 6) return bad('You have entered an invalid new Phone PIN: it has 6 digits.');
      if (pin !== digitsOf(body.confirmPin)) return bad('The two new PINs are not the same.');
      if (pin === c.passcode) return bad('The new Phone PIN must differ from the current one.');
      await store.put('bank_passcodes', c.customerId, { passcode: pin });
      return [
        200,
        {
          ok: true,
          reference: ref('PIN'),
          changedOn: today(c.country),
          message: 'You have successfully changed your Phone PIN. Please use your new Phone PIN the next time you call.',
        },
      ];
    },
  ],
];
