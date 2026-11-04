// The mock bank services: plain JSON over HTTP, one handler for every route, served by server.mjs (on this machine,
// and on Vercel, which runs server.mjs as it is). Records come from data/*.json (the bank database's test customers and what
// scripts/build-seed.mjs made for them). Actions (stop a cheque, pay a bill, book a slot…) answer as a bank would, with
// a reference, but change no balance anywhere: what they change is kept in memory only while this process runs.
// What the routes do follows the bank's IVR call flows (the SG BBCSC pack and the MY hotlines pack); the page each
// rule comes from is noted beside it ("p. N" for the SG pack, "MY p. N" for the Malaysian pages).
// With MOCK_API_KEY set, every route but /health needs the header x-api-key: <that key>.
// With the header x-refusals: in-body, a refusal (4xx with a reason) comes back as 200 with ok: false and the reason.
import customersFile from '../data/customers.json' with { type: 'json' };
import services from '../data/services.json' with { type: 'json' };
import info from '../data/info.json' with { type: 'json' };

const { customers } = customersFile;
const OTP = '123456'; // the one-time password every test customer "receives"

// what actions changed, by record key, for as long as this process runs
const changed = new Map();
const stateOf = (key, base) => ({ ...base, ...(changed.get(key) || {}) });
const change = (key, patch) => changed.set(key, { ...(changed.get(key) || {}), ...patch });
const created = {
  callbacks: [],
  appointments: [],
  cases: [],
  surveys: [],
  payments: [],
  statements: [],
  chequeBookOrders: [],
  pinChanges: [],
  otp: new Map(),
  choices: new Map(),
};

let counter = 1000;
const reference = (prefix) => `${prefix}-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${++counter}`;

// dates and times where the customer is: Singapore or Malaysia (both UTC+8), whatever the server's own zone
const COUNTRY_ZONE = { SG: 'Asia/Singapore', MY: 'Asia/Kuala_Lumpur' };
function localNow(country = 'SG') {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: COUNTRY_ZONE[country] || COUNTRY_ZONE.SG,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, minutes: Number(parts.hour) * 60 + Number(parts.minute), weekday: weekdayOf(date) };
}
const weekdayOf = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
const shift = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const today = (country) => localNow(country).date;
const daysBefore = (n, country) => shift(today(country), -n);
const workingDays = (n, country) => {
  let d = today(country);
  while (n > 0) {
    d = shift(d, 1);
    if (weekdayOf(d) % 6) n--;
  }
  return d;
};
const hhmm = (text) => Number(text.slice(0, 2)) * 60 + Number(text.slice(3, 5));

const customerOf = (id) => customers.find((c) => c.customerId === String(id));
const accountOf = (id) => {
  for (const c of customers) {
    const a = c.accounts.find((x) => x.accountId === String(id).replace(/\D/g, ''));
    if (a) return { ...a, customer: c };
  }
  return null;
};
const identityOf = (customerId) => services.identities.find((x) => x.customerId === customerId);
const cardOf = (id) => {
  const card = services.cards.find((c) => c.cardId === id);
  return card ? stateOf(`card:${id}`, card) : null;
};
const fee = (country, myr, sgd) => (country === 'MY' ? { fee: myr, currency: 'MYR' } : { fee: sgd, currency: 'SGD' });
const digitsOf = (text) => String(text ?? '').replace(/\D/g, '');

// the Commercial Service Centre: 8:30 am to 6:00 pm, Monday to Friday, closed on public holidays (p. 41)
function centre(country = 'SG') {
  const c = info.serviceCentre[country];
  if (!c) return null;
  const now = localNow(country);
  const open = c.days.includes(now.weekday) && !c.publicHolidays.includes(now.date) && now.minutes >= hhmm(c.opens) && now.minutes < hhmm(c.closes);
  return { name: c.name, open, hours: c.hours, ...(open ? {} : { closedMessage: `Our ${c.name} is operational from ${c.hours}.` }) };
}
const managerOf = (id) => {
  const m = services.serviceManagers.find((x) => x.id === id);
  if (!m) return null;
  const open = centre('SG').open;
  return { name: m.name, group: m.group, available: open && !m.busy, ...(open ? {} : { why: 'The service centre is closed.' }) };
};

// ---- appointments (pp. 19, 45, 47, 48): foreign worker account opening at a branch, and Velocity Payment or Trade
// module training at OCBC Centre; bookings at least 2 days ahead, never on weekends or public holidays
const KINDS = {
  account_opening: {
    title: 'Foreign worker account opening',
    capacity: 6, // accounts per session
    perCustomer: 6, // accounts one account holder may book in all (p. 47)
    sessions: (date) =>
      weekdayOf(date) % 6
        ? info.branches.SG.flatMap((b) => [
            { place: b.name, region: b.region, from: '09:30', to: '10:30' },
            { place: b.name, region: b.region, from: '14:30', to: '15:30' },
          ])
        : [],
  },
  velocity_training: {
    title: 'Velocity Payment module training',
    capacity: 12,
    perCustomer: 2, // attendees per account (p. 45)
    sessions: (date) => (weekdayOf(date) === 3 ? [{ place: 'OCBC Centre', region: 'Central', from: '09:30', to: '12:30' }] : []), // every Wednesday
  },
  trade_training: {
    title: 'Velocity Trade module training',
    capacity: 12,
    perCustomer: 2,
    // the last Friday of each month
    sessions: (date) =>
      weekdayOf(date) === 5 && shift(date, 7).slice(5, 7) !== date.slice(5, 7) ? [{ place: 'OCBC Centre', region: 'Central', from: '10:00', to: '12:00' }] : [],
  },
};
const booked = (slotId) => created.appointments.filter((a) => a.slotId === slotId && a.status === 'BOOKED').reduce((n, a) => n + a.count, 0);
function slots({ type, place, region, from } = {}, all = false) {
  const out = [];
  const first = from && from > shift(today('SG'), 2) ? from : shift(today('SG'), 2);
  for (const [kind, k] of Object.entries(KINDS)) {
    if (type && type !== kind) continue;
    for (let d = 0; d < 70; d++) {
      const date = shift(first, d);
      if (info.serviceCentre.SG.publicHolidays.includes(date)) continue;
      for (const s of k.sessions(date)) {
        if (place && !s.place.toLowerCase().includes(String(place).toLowerCase())) continue;
        if (region && s.region.toLowerCase() !== String(region).toLowerCase()) continue;
        const slotId = `${kind}-${date}-${s.from.replace(':', '')}-${s.place.split(' ')[0].toLowerCase()}`;
        const free = k.capacity - booked(slotId);
        if (free > 0) out.push({ slotId, type: kind, title: k.title, date, from: s.from, to: s.to, place: s.place, region: s.region, placesLeft: free });
      }
    }
  }
  out.sort((a, b) => (a.date + a.from).localeCompare(b.date + b.from));
  return all ? out : out.slice(0, 12);
}

// ---- the routes: [method, path pattern, handler(params, body, query)] → [status, body]
const notFound = (what) => [404, { ok: false, reason: `No ${what} with that number.` }];
const bad = (reason) => [400, { ok: false, reason }];
const ROUTES = [
  ['GET', '/health', () => [200, { ok: true, service: 'weave-mock-api', customers: customers.length, time: new Date().toISOString() }]],
  // the bare address answers too (a connection test with no path calls it)
  ['GET', '/', () => [200, { ok: true, service: 'weave-mock-api', routes: '/routes', health: '/health' }]],
  ['GET', '/routes', () => [200, { routes: ROUTES.map(([m, p]) => `${m} ${p}`) }]],

  // customers and their accounts (the same people and numbers as the bank database)
  [
    'GET',
    '/customers/:customerId',
    ({ customerId }) => {
      const c = customerOf(customerId);
      return c ? [200, { customerId: c.customerId, name: c.name, country: c.country, accounts: c.accounts }] : notFound('customer');
    },
  ],

  // logins besides phone code + TPIN. Each finds the customer; the TPIN (when there is one) is checked against the
  // bank database by the agent, and the account + NRIC login goes on to a one-time password (/otp/send, /otp/verify).
  [
    'POST',
    '/login/account',
    (_, body) => {
      // Singapore business customers without a phone code: 12-digit account number + the last 4 characters of their
      // NRIC or passport (pp. 34, 46)
      if (digitsOf(body.accountId).length !== 12) return [400, { ok: false, match: false, reason: 'You have entered an invalid account number.' }];
      const account = accountOf(body.accountId);
      if (!account || account.customer.country !== 'SG') return [200, { ok: true, match: false, reason: 'You have entered an invalid account number.' }];
      const id = identityOf(account.customer.customerId);
      const last4 = String(body.nricLast4 || '')
        .toUpperCase()
        .replace(/[^0-9A-Z]/g, '')
        .slice(-4);
      if (last4.length !== 4 || !id.idNumber.endsWith(last4))
        return [200, { ok: true, match: false, reason: 'You have entered an invalid NRIC or passport number.' }];
      if (id.customerType === 'personal')
        return [200, { ok: true, match: false, personal: true, reason: 'This line is for business customers. The correct number to dial is 1800 363 3333.' }];
      if (id.dormantAccounts.includes(account.accountId))
        return [200, { ok: true, match: false, dormant: true, reason: 'Please visit your nearest OCBC branch.' }];
      return [
        200,
        {
          ok: true,
          match: true,
          customerId: account.customer.customerId,
          name: account.customer.name,
          accessLevel: 'AS',
          bizconn: id.bizconn,
          next: `Send a one-time password to the mobile ending ${String(account.customer.phone).slice(-4)} (POST /otp/send).`,
        },
      ];
    },
  ],
  [
    'POST',
    '/login/key-code',
    (_, body) => {
      // Malaysian business banking: the key code, then the TPIN (MY p. 52)
      const id = services.identities.find((x) => x.keyCode && x.keyCode === digitsOf(body.keyCode));
      if (!id) return [200, { ok: true, match: false, reason: 'That key code is not valid.' }];
      const c = customerOf(id.customerId);
      return [
        200,
        {
          ok: true,
          match: true,
          customerId: c.customerId,
          name: c.name,
          next: 'Now call bank_customer_details with this customerId; then ask for the TPIN and compare it with the passcode there.',
        },
      ];
    },
  ],
  [
    'POST',
    '/login/ic',
    (_, body) => {
      // Malaysian consumer and iQ members: phone code or 12-digit IC number, then the TPIN (MY p. 50)
      const ic = digitsOf(body.ic);
      if (ic.length !== 12) return [400, { ok: false, match: false, reason: 'An IC number has 12 digits.' }];
      const id = services.identities.find((x) => x.idType === 'IC' && x.idNumber === ic);
      if (!id) return [200, { ok: true, match: false, reason: 'No customer has that IC number.' }];
      const c = customerOf(id.customerId);
      return [
        200,
        {
          ok: true,
          match: true,
          customerId: c.customerId,
          name: c.name,
          next: 'Now call bank_customer_details with this customerId; then ask for the TPIN and compare it with the passcode there.',
        },
      ];
    },
  ],
  [
    'POST',
    '/customers/:customerId/phone-pin',
    ({ customerId }, body) => {
      // changing the phone PIN / TPIN (p. 9, MY pp. 50, 52): a new 6-digit PIN, entered twice. The agent checks the
      // current PIN (it differs from the new one) and allows one change per call. Nothing here keeps a PIN.
      const c = customerOf(customerId);
      if (!c) return notFound('customer');
      const pin = digitsOf(body.newPin);
      if (pin.length !== 6 || String(body.newPin).replace(/\s/g, '').length !== 6)
        return [400, { ok: false, reason: 'You have entered an invalid new Phone PIN: it has 6 digits.' }];
      if (pin !== digitsOf(body.confirmPin)) return [400, { ok: false, reason: 'The two new PINs are not the same.' }];
      const change = { reference: reference('PIN'), customerId: c.customerId, changedOn: today(c.country) };
      created.pinChanges.push(change);
      return [
        200,
        {
          ok: true,
          ...change,
          message: 'You have successfully changed your Phone PIN. Please use your new Phone PIN the next time you call.',
          note: 'A test change: the TPIN kept in the bank database stays as it is.',
        },
      ];
    },
  ],

  // balances: the details the bank's balance enquiry reads out (pp. 4–5)
  [
    'GET',
    '/accounts/:accountId/balance',
    ({ accountId }) => {
      const account = accountOf(accountId);
      if (!account) return notFound('account');
      const d = services.balanceDetails.find((x) => x.accountId === account.accountId) || {
        holdAmount: 0,
        pendingClearance: 0,
        overdraftLimit: 0,
        omnibus: false,
      };
      const round = (n) => Math.round(n * 100) / 100;
      return [
        200,
        {
          accountId: account.accountId,
          accountType: account.accountType,
          currency: account.currency,
          balance: account.balance,
          availableBalance: round(account.balance - d.holdAmount - d.pendingClearance),
          holdAmount: d.holdAmount,
          pendingClearance: d.pendingClearance,
          overdraftLimit: d.overdraftLimit,
          omnibus: d.omnibus,
          ...(d.omnibus
            ? {
                notice:
                  'Please take note that the availability of balances for utilization is subject to the facility limits for omnibus and/or shared facilities.',
              }
            : {}),
          source: 'The balance is the bank database’s, as last copied into data/customers.json (npm run mock:sync).',
        },
      ];
    },
  ],
  [
    'GET',
    '/accounts/:accountId/incoming-funds',
    ({ accountId }) => {
      // GIRO, local and overseas transfers credited in the last 7 calendar days, newest first (p. 6)
      const account = accountOf(accountId);
      if (!account) return notFound('account');
      const funds = services.incomingFunds
        .filter((f) => f.accountId === account.accountId)
        .sort((a, b) => a.daysAgo - b.daysAgo)
        .map(({ daysAgo, ...f }) => ({ ...f, date: daysBefore(daysAgo, account.customer.country), today: daysAgo === 0 }));
      return [
        200,
        {
          accountId: account.accountId,
          days: 7,
          count: funds.length,
          funds,
          ...(funds.length ? {} : { message: 'There were no incoming funds received in the last 7 days.' }),
        },
      ];
    },
  ],

  // cheques
  [
    'GET',
    '/accounts/:accountId/cheques',
    ({ accountId }) => {
      if (!accountOf(accountId)) return notFound('account');
      const list = services.cheques.filter((c) => c.accountId === accountId).map((c) => stateOf(`cheque:${accountId}:${c.chequeNo}`, c));
      return [200, { accountId, cheques: list }];
    },
  ],
  [
    'GET',
    '/accounts/:accountId/cheques/:chequeNo',
    ({ accountId, chequeNo }) => {
      // issued cheque status: presented, stopped, cleared, returned (with the reason), not presented (p. 12)
      const base = services.cheques.find((c) => c.accountId === accountId && c.chequeNo === chequeNo.padStart(6, '0'));
      return base
        ? [200, { found: true, ...stateOf(`cheque:${accountId}:${base.chequeNo}`, base) }]
        : [404, { found: false, reason: 'We are unable to confirm your cheque number.' }];
    },
  ],
  [
    'POST',
    '/accounts/:accountId/cheques/:chequeNo/stop',
    ({ accountId, chequeNo }, body) => {
      // stop payment of one cheque, or a range of up to 50 within one cheque book (lastChequeNo), current accounts only
      // (pp. 15–16): SGD 15 for one, SGD 30 for a range
      const account = accountOf(accountId);
      if (!account) return notFound('account');
      if (!/current/i.test(account.accountType)) return [409, { ok: false, reason: 'Only current accounts can stop a cheque payment.' }];
      const first = Number(digitsOf(chequeNo));
      const last = body.lastChequeNo ? Number(digitsOf(body.lastChequeNo)) : first;
      const book = services.chequeBooks.find((b) => b.accountId === account.accountId && first >= Number(b.from) && last <= Number(b.to));
      if (last < first || last - first + 1 > 50 || (last > first && !book))
        return [
          400,
          {
            ok: false,
            code: 343,
            reason: 'The cheque range you have entered is invalid. Please enter less than 50 cheques, with the cheque range within the same cheque book.',
          },
        ];
      const numbers = Array.from({ length: last - first + 1 }, (_, i) => String(first + i).padStart(6, '0'));
      const known = numbers.map((no) => {
        const base = services.cheques.find((c) => c.accountId === account.accountId && c.chequeNo === no);
        return base ? stateOf(`cheque:${account.accountId}:${no}`, base) : { chequeNo: no, status: book ? 'NOT_PRESENTED' : 'UNKNOWN' };
      });
      if (known.some((c) => c.status === 'UNKNOWN')) return [404, { ok: false, reason: 'No cheque with that number was issued from this account.' }];
      const done = known.find((c) => ['CLEARED', 'PRESENTED', 'RETURNED'].includes(c.status));
      if (done) return [409, { ok: false, code: 196, reason: `Cheque ${done.chequeNo} has already been presented or cleared, so it cannot be stopped.` }];
      const stopped = known.find((c) => c.status === 'STOPPED');
      if (stopped)
        return [409, { ok: false, code: 192, reason: `Cheque ${stopped.chequeNo} was already stopped${stopped.stoppedOn ? ` on ${stopped.stoppedOn}` : ''}.` }];
      const country = account.customer.country;
      for (const no of numbers)
        change(`cheque:${account.accountId}:${no}`, { status: 'STOPPED', stoppedOn: today(country), stopReason: body.reason || 'Requested by the customer' });
      const now = localNow(country);
      const late = country === 'SG' && now.weekday % 6 && now.minutes >= 19 * 60;
      return [
        200,
        {
          ok: true,
          reference: reference('STP'),
          cheques: numbers.length === 1 ? numbers[0] : `${numbers[0]} to ${numbers.at(-1)}`,
          count: numbers.length,
          stoppedOn: today(country),
          ...(country === 'SG' ? { fee: numbers.length === 1 ? 15 : 30, currency: 'SGD' } : fee(country, 10, 0)),
          note: 'The charge is debited from the account.',
          ...(late ? { notice: 'Instructions placed after 7 PM on weekdays will not be effective for cheques presented for clearing today.' } : {}),
        },
      ];
    },
  ],
  [
    'GET',
    '/accounts/:accountId/cheque-books/last',
    ({ accountId }) => {
      const order = [...created.chequeBookOrders].reverse().find((o) => o.accountId === accountId);
      const book = services.chequeBooks.find((b) => b.accountId === accountId);
      if (order) return [200, { found: true, ordered: order }];
      return book ? [200, { found: true, ...book }] : [404, { found: false, reason: 'No cheque book has been issued.' }];
    },
  ],
  [
    'GET',
    '/accounts/:accountId/cheque-books/options',
    ({ accountId }) => {
      const account = accountOf(accountId);
      if (!account) return notFound('account');
      return [200, { accountId: account.accountId, options: chequeBookOptions(account) }];
    },
  ],
  [
    'POST',
    '/accounts/:accountId/cheque-books',
    ({ accountId }, body) => {
      const account = accountOf(accountId);
      if (!account) return notFound('account');
      if (!/current/i.test(account.accountType)) return [409, { ok: false, reason: 'Cheque books are only for current accounts.' }];
      const options = chequeBookOptions(account);
      const choice = options.find((o) => o.delivery === (body.delivery || 'normal'));
      if (!choice) return [409, { ok: false, reason: `That delivery is past its cut-off today. Offered now: ${options.map((o) => o.delivery).join(', ')}.` }];
      const order = { accountId, reference: reference('CHQ'), orderedOn: today(account.customer.country), ...choice };
      created.chequeBookOrders.push(order);
      return [200, { ok: true, ...order, message: 'Your cheque book will be sent.' }];
    },
  ],
  [
    'GET',
    '/accounts/:accountId/cheque-deposits',
    ({ accountId }, __, q) => {
      // cheques deposited, or returned, in the last 7 days, today's first; and any cheque pending clearance (p. 11)
      const account = accountOf(accountId);
      if (!account) return notFound('account');
      const kind = q.kind === 'returned' ? 'returned' : 'deposited';
      const list = services.chequeDeposits
        .filter((d) => d.accountId === account.accountId && d.daysAgo <= 7 && (kind === 'returned') === (d.status === 'RETURNED'))
        .sort((a, b) => a.daysAgo - b.daysAgo)
        .map(({ daysAgo, ...d }) => ({ ...d, date: daysBefore(daysAgo, account.customer.country), today: daysAgo === 0 }));
      const pending = services.balanceDetails.find((x) => x.accountId === account.accountId)?.pendingClearance || 0;
      return [
        200,
        {
          accountId: account.accountId,
          kind,
          days: 7,
          count: list.length,
          cheques: list,
          ...(pending ? { pendingClearance: pending, currency: account.currency } : {}),
          ...(list.length ? {} : { message: `There were no cheques ${kind} in the last 7 days.` }),
        },
      ];
    },
  ],

  // statements: this month, last month or the month before; earlier ones go to a service manager (p. 8)
  [
    'POST',
    '/accounts/:accountId/statements',
    ({ accountId }, body) => {
      const account = accountOf(accountId);
      if (!account) return notFound('account');
      if (!/^\d{4}-\d{2}$/.test(String(body.month || ''))) return bad('Say which month, e.g. "2026-10".');
      const country = account.customer.country;
      const now = today(country).slice(0, 7);
      const back = (Number(now.slice(0, 4)) - Number(body.month.slice(0, 4))) * 12 + Number(now.slice(5)) - Number(body.month.slice(5));
      if (back < 0) return bad('That month has not started yet.');
      if (country === 'SG' && back > 2)
        return [409, { ok: false, olderThanTwoMonths: true, reason: 'Statements earlier than two months ago are requested through a service manager.' }];
      const request = {
        accountId,
        month: body.month,
        reference: reference('STM'),
        requestedOn: today(country),
        readyBy: workingDays(7, country),
        delivery: 'Post to the registered address',
        ...fee(country, 5, 5),
        message: 'Your statement will be sent to you within 7 working days.',
      };
      created.statements.push(request);
      return [200, { ok: true, ...request }];
    },
  ],

  // cards
  [
    'GET',
    '/customers/:customerId/cards',
    ({ customerId }) =>
      customerOf(customerId)
        ? [200, { customerId, cards: services.cards.filter((c) => c.customerId === customerId).map((c) => cardOf(c.cardId)) }]
        : notFound('customer'),
  ],
  [
    'GET',
    '/cards/:cardId/transactions',
    ({ cardId }) => {
      // card balance, statement and transactions (MY p. 50)
      const card = cardOf(cardId);
      if (!card || card.kind !== 'Credit') return notFound('credit card');
      const list = services.cardTransactions.filter((t) => t.cardId === cardId);
      return [
        200,
        { cardId, last4: card.last4, amountDue: card.amountDue, minimumDue: card.minimumDue, dueOn: card.dueOn, currency: card.currency, transactions: list },
      ];
    },
  ],
  [
    'POST',
    '/cards/:cardId/statements',
    ({ cardId }, body) => {
      const card = cardOf(cardId);
      if (!card || card.kind !== 'Credit') return notFound('credit card');
      if (!/^\d{4}-\d{2}$/.test(String(body.month || ''))) return bad('Say which month, e.g. "2026-10".');
      const country = customerOf(card.customerId)?.country;
      return [
        200,
        {
          ok: true,
          reference: reference('CST'),
          last4: card.last4,
          month: body.month,
          readyBy: workingDays(7, country),
          delivery: 'Post to the registered address',
        },
      ];
    },
  ],
  [
    'POST',
    '/cards/:cardId/block',
    ({ cardId }, body) => {
      const card = cardOf(cardId);
      if (!card) return notFound('card');
      if (card.status === 'BLOCKED') return [409, { ok: false, reason: 'That card is already blocked.' }];
      const country = customerOf(card.customerId)?.country;
      change(`card:${cardId}`, { status: 'BLOCKED', blockedOn: today(country), blockReason: body.reason || 'Lost or stolen' });
      return [
        200,
        {
          ok: true,
          reference: reference('BLK'),
          last4: card.last4,
          blockedOn: today(country),
          replacementBy: workingDays(7, country),
          replacementFee: country === 'MY' ? 12 : 0,
          currency: card.currency,
        },
      ];
    },
  ],
  [
    'POST',
    '/cards/:cardId/activate',
    ({ cardId }) => {
      const card = cardOf(cardId);
      if (!card) return notFound('card');
      if (card.status === 'BLOCKED') return [409, { ok: false, reason: 'A blocked card cannot be activated.' }];
      if (card.status === 'ACTIVE') return [409, { ok: false, reason: 'That card is already active.' }];
      change(`card:${cardId}`, { status: 'ACTIVE' });
      return [200, { ok: true, last4: card.last4, status: 'ACTIVE' }];
    },
  ],
  [
    'POST',
    '/cards/:cardId/fee-waiver',
    ({ cardId }) => {
      const card = cardOf(cardId);
      if (!card || card.kind !== 'Credit') return notFound('credit card');
      if (card.feeWaiver) return [409, { ok: false, reason: 'This year’s annual fee was already waived.' }];
      change(`card:${cardId}`, { feeWaiver: today() });
      return [200, { ok: true, reference: reference('FEE'), waived: card.annualFee, currency: card.currency, note: 'This year’s annual fee is waived.' }];
    },
  ],
  [
    'POST',
    '/cards/:cardId/credit-limit',
    ({ cardId }, body) => {
      const card = cardOf(cardId);
      if (!card || card.kind !== 'Credit') return notFound('credit card');
      const limit = Number(body.newLimit);
      if (!limit || limit < 1000) return bad('Give the new limit, at least 1000.');
      if (limit <= card.creditLimit) {
        change(`card:${cardId}`, { creditLimit: limit });
        return [200, { ok: true, reference: reference('LIM'), creditLimit: limit, currency: card.currency, effective: 'now' }];
      }
      return [
        200,
        { ok: true, reference: reference('LIM'), requested: limit, currency: card.currency, effective: 'under review', decisionBy: workingDays(3, 'MY') },
      ];
    },
  ],
  [
    'POST',
    '/cards/:cardId/balance-transfer',
    ({ cardId }, body) => {
      const card = cardOf(cardId);
      if (!card || card.kind !== 'Credit') return notFound('credit card');
      const amount = Number(body.amount);
      if (!amount || !body.fromBank) return bad('Give the other bank and the amount.');
      if (amount > card.creditLimit * 0.9)
        return [409, { ok: false, reason: `That is more than this card’s limit allows (up to ${Math.round(card.creditLimit * 0.9)}).` }];
      return [200, { ok: true, reference: reference('BT'), amount, fromBank: body.fromBank, currency: card.currency, processedBy: workingDays(5, 'MY') }];
    },
  ],
  [
    'GET',
    '/card-applications/:applicantId',
    ({ applicantId }) => {
      const a = services.cardApplications.find((x) => x.applicantId === applicantId.replace(/\D/g, ''));
      return a ? [200, { found: true, ...a }] : [404, { found: false, reason: 'No card application with that ID number.' }];
    },
  ],

  // payees and payments (confirmed with a reference; no balance changes)
  [
    'GET',
    '/customers/:customerId/payees',
    ({ customerId }) => {
      const entry = services.payees.find((p) => p.customerId === customerId);
      if (!entry) return notFound('customer');
      const loans = entry.payees.filter((p) => p.type === 'LOAN').length;
      return [200, { ...entry, ...(loans ? {} : { noLoan: 'Sorry, you do not have any loan account with OCBC Bank.' }) }];
    },
  ],
  [
    'POST',
    '/payments',
    (_, body) => {
      const account = accountOf(body.fromAccount);
      if (!account) return bad('Give the account to pay from (fromAccount).');
      const payee = services.payees.find((p) => p.customerId === account.customer.customerId)?.payees.find((p) => p.id === body.payeeId);
      if (!payee) return [404, { ok: false, reason: 'That payee is not registered for this customer.' }];
      const amount = Number(body.amount);
      if (!amount || amount <= 0) return bad('Give an amount above zero.');
      const country = account.customer.country;
      // a Malaysian OCBC loan payment placed after 8 pm takes effect tomorrow (MY p. 53)
      const late = country === 'MY' && payee.type === 'LOAN' && localNow('MY').minutes > 20 * 60;
      const payment = {
        reference: reference('PAY'),
        fromAccount: account.accountId,
        payee: payee.name,
        type: payee.type,
        amount,
        currency: account.currency,
        paidOn: today(country),
        ...(late ? { effectiveOn: shift(today(country), 1), notice: 'Instructions placed after 8 pm will be effective tomorrow.' } : {}),
        ...(payee.type === 'OTHER_BANK' ? { arrivesBy: workingDays(1, country) } : {}),
      };
      created.payments.push(payment);
      return [200, { ok: true, ...payment, note: 'A test payment: no balance changes.' }];
    },
  ],
  [
    'POST',
    '/transfers',
    (_, body) => {
      const from = accountOf(body.fromAccount);
      const to = accountOf(body.toAccount);
      if (!from || !to) return bad('Give both accounts (fromAccount and toAccount).');
      if (from.customer.customerId !== to.customer.customerId) return [409, { ok: false, reason: 'Both accounts must belong to the same customer.' }];
      if (from.currency !== to.currency) return [409, { ok: false, reason: 'Both accounts must be in the same currency.' }];
      const amount = Number(body.amount);
      if (!amount || amount <= 0) return bad('Give an amount above zero.');
      const transfer = {
        reference: reference('TRF'),
        fromAccount: from.accountId,
        toAccount: to.accountId,
        amount,
        currency: from.currency,
        doneOn: today(from.customer.country),
      };
      created.payments.push(transfer);
      return [200, { ok: true, ...transfer, note: 'A test transfer: no balance changes.' }];
    },
  ],

  // FPX direct debits (Malaysia)
  [
    'GET',
    '/accounts/:accountId/fpx-direct-debits',
    ({ accountId }) =>
      accountOf(accountId)
        ? [200, { accountId, directDebits: services.fpxDirectDebits.filter((d) => d.accountId === accountId).map((d) => stateOf(`fpx:${d.id}`, d)) }]
        : notFound('account'),
  ],
  [
    'POST',
    '/fpx-direct-debits/:id/terminate',
    ({ id }) => {
      const d = services.fpxDirectDebits.find((x) => x.id === id);
      if (!d) return notFound('direct debit');
      if (stateOf(`fpx:${id}`, d).status === 'TERMINATED') return [409, { ok: false, reason: 'That direct debit is already ended.' }];
      change(`fpx:${id}`, { status: 'TERMINATED', endedOn: today('MY') });
      return [200, { ok: true, reference: reference('FPX'), merchant: d.merchant, endedOn: today('MY'), note: 'No further payments will be taken.' }];
    },
  ],

  // appointments (Singapore): ?type, ?place (part of a branch name), ?region (North, South, East, West, Central),
  // ?from (the earliest date wanted); earliest first, with the places left in each
  ['GET', '/appointments/slots', (_, __, query) => [200, { slots: slots(query) }]],
  [
    'POST',
    '/appointments',
    (_, body) => {
      const customer = customerOf(body.customerId);
      if (!customer) return bad('Give the customer (customerId).');
      const slot = slots({}, true).find((s) => s.slotId === body.slotId);
      if (!slot) return [409, { ok: false, reason: 'That slot is no longer free.' }];
      const kind = KINDS[slot.type];
      const mine = created.appointments
        .filter((a) => a.customerId === customer.customerId && a.type === slot.type && a.status === 'BOOKED')
        .reduce((n, a) => n + a.count, 0);
      const allowed = Math.min(kind.perCustomer - mine, slot.placesLeft);
      const count = Number(body.count || 1);
      if (!Number.isInteger(count) || count < 1 || count > allowed)
        return [
          409,
          {
            ok: false,
            reason: `You have entered an invalid number of ${slot.type === 'account_opening' ? 'accounts' : 'attendees'}.`,
            maximum: Math.max(0, allowed),
            ...(mine ? { alreadyBooked: mine } : {}),
          },
        ];
      const booking = {
        bookingId: reference('APT'),
        customerId: customer.customerId,
        slotId: slot.slotId,
        type: slot.type,
        title: slot.title,
        date: slot.date,
        from: slot.from,
        to: slot.to,
        place: slot.place,
        count,
        status: 'BOOKED',
      };
      created.appointments.push(booking);
      return [200, { ok: true, ...booking, ...(slot.type === 'account_opening' ? { remainingEntitlement: kind.perCustomer - mine - count } : {}) }];
    },
  ],
  [
    'GET',
    '/customers/:customerId/appointments',
    ({ customerId }) => [200, { customerId, bookings: created.appointments.filter((a) => a.customerId === customerId && a.status === 'BOOKED') }],
  ],
  [
    'POST',
    '/appointments/:bookingId/cancel',
    ({ bookingId }) => {
      const booking = created.appointments.find((a) => a.bookingId === bookingId && a.status === 'BOOKED');
      if (!booking) return notFound('booking');
      // no cancellation 2 days before the appointment date (p. 47)
      if (booking.date <= shift(today('SG'), 2)) return [409, { ok: false, reason: 'No cancellation is allowed 2 days before your appointment date.' }];
      booking.status = 'CANCELLED';
      return [
        200,
        {
          ok: true,
          bookingId,
          cancelled: `${booking.title} on ${booking.date} from ${booking.from} to ${booking.to}`,
          message: 'Your appointment has been cancelled.',
        },
      ];
    },
  ],

  // service managers and the service centre: whether a person can take the call now (pp. 31, 32, 41)
  ['GET', '/service-centre', (_, __, q) => (info.serviceCentre[q.country || 'SG'] ? [200, centre(q.country || 'SG')] : bad('Say the country: SG.'))],
  [
    'GET',
    '/accounts/:accountId/service-manager',
    ({ accountId }) => {
      // the service manager the account holder last spoke with, and their group (Investigations line, p. 32)
      const account = accountOf(accountId);
      if (!account || account.customer.country !== 'SG') return [200, { found: false, reason: 'You have entered an invalid account number.' }];
      const last = services.lastServiceManagers.find((x) => x.accountId === account.accountId);
      return [200, { found: true, accountId: account.accountId, serviceManager: managerOf(last?.serviceManagerId), centre: centre('SG') }];
    },
  ],
  [
    'GET',
    '/vip/:mobile',
    ({ mobile }) => {
      // the VIP table, by the mobile number registered with the bank (p. 31)
      const v = services.vip.find((x) => digitsOf(x.mobile).endsWith(digitsOf(mobile).slice(-8)) && digitsOf(mobile).length >= 8);
      if (!v) return [200, { found: false, message: 'This line is for VIP customers. Please call OCBC Business Banking on 6538 1111.' }];
      return [
        200,
        {
          found: true,
          name: v.name,
          vipType: v.vipType,
          language: v.language,
          check: {
            account: 'Ask for their 12-digit account number (POST /vip/{mobile}/check-account).',
            phone_code: 'Check their phone code and TPIN.',
            default: 'No check needed.',
          }[v.vipType],
          serviceManager: managerOf(v.serviceManagerId),
          centre: centre('SG'),
          ...(v.vipType === 'phone_code' ? { customerId: v.customerId } : {}),
        },
      ];
    },
  ],
  [
    'POST',
    '/vip/:mobile/check-account',
    ({ mobile }, body) => {
      const v = services.vip.find((x) => digitsOf(x.mobile).endsWith(digitsOf(mobile).slice(-8)) && digitsOf(mobile).length >= 8);
      if (!v) return [404, { ok: false, reason: 'No VIP with that mobile number.' }];
      const account = accountOf(body.accountId);
      const match = !!account && account.customer.customerId === v.customerId;
      return [200, { ok: true, match, ...(match ? { customerId: v.customerId } : { reason: 'You have entered an invalid account number.' }) }];
    },
  ],
  [
    'GET',
    '/service-codes/:code',
    ({ code }) => {
      // three-digit service codes (p. 29); only 328 exists today
      const entry = info.serviceCodes[digitsOf(code)];
      return entry ? [200, { found: true, code: digitsOf(code), ...entry }] : [404, { found: false, reason: 'This is an invalid campaign code.' }];
    },
  ],

  // call-backs (p. 39): one open request per caller; the number to call is 5 to 15 digits
  [
    'GET',
    '/customers/:customerId/callbacks/open',
    ({ customerId }) => {
      const open = created.callbacks.find((c) => c.who === customerId && c.status === 'OPEN');
      return [200, open ? { open: true, ...open } : { open: false }];
    },
  ],
  [
    'GET',
    '/callbacks/open',
    (_, __, q) => {
      const open = created.callbacks.find((c) => c.status === 'OPEN' && c.phoneDigits && c.phoneDigits === digitsOf(q.phone));
      return [200, open ? { open: true, ...open, message: 'You have already made a request for us to return your call.' } : { open: false }];
    },
  ],
  [
    'POST',
    '/callbacks',
    (_, body) => {
      // a known customer, or just a phone number (a caller who hasn't been verified, e.g. at the front desk)
      const customer = body.customerId ? customerOf(body.customerId) : null;
      if (body.customerId && !customer) return bad('No customer with that number.');
      const phone = String(body.phone || customer?.phone || '').replace(/[^\d+]/g, '');
      const n = digitsOf(phone).length;
      if (!customer && !n) return bad('Give the customer (customerId) or a phone number to call.');
      if (n < 5 || n > 15) return [400, { ok: false, reason: 'You have entered an invalid call-back number: it has 5 to 15 digits.' }];
      const who = customer ? customer.customerId : `phone:${digitsOf(phone)}`;
      const open = created.callbacks.find((c) => (c.who === who || c.phoneDigits === digitsOf(phone)) && c.status === 'OPEN');
      if (open) return [409, { ok: false, reason: 'You have already made a request for us to return your call.', reference: open.reference }];
      const callback = {
        reference: reference('CB'),
        who,
        customerId: customer?.customerId || null,
        phoneDigits: digitsOf(phone),
        phoneEnding: phone.slice(-4),
        reason: body.reason || 'General enquiry',
        status: 'OPEN',
        within: 'as soon as possible',
        message: 'Our Service Manager will return your call as soon as possible.',
      };
      created.callbacks.push(callback);
      const { phoneDigits, ...shown } = callback;
      return [200, { ok: true, ...shown }];
    },
  ],

  // investigation cases
  [
    'GET',
    '/accounts/:accountId/cases',
    ({ accountId }) =>
      accountOf(accountId) ? [200, { accountId, cases: [...services.cases, ...created.cases].filter((c) => c.accountId === accountId) }] : notFound('account'),
  ],
  [
    'POST',
    '/cases',
    (_, body) => {
      const account = accountOf(body.accountId);
      if (!account) return bad('Give the account (accountId).');
      if (!body.summary) return bad('Say what is to be looked into (summary).');
      const c = {
        caseId: reference('INV'),
        accountId: account.accountId,
        summary: body.summary,
        transaction: body.transaction || null,
        openedOn: today(account.customer.country),
        status: 'OPEN',
        handler: 'Investigations team',
        firstUpdateBy: workingDays(3, account.customer.country),
      };
      created.cases.push(c);
      return [200, { ok: true, ...c }];
    },
  ],

  // one-time passwords (always 123456 for the test customers; nothing is really sent); 3 tries (pp. 34, 35)
  [
    'POST',
    '/otp/send',
    (_, body) => {
      const customer = customerOf(body.customerId);
      if (!customer) return bad('Give the customer (customerId).');
      created.otp.set(customer.customerId, { tries: 0, until: Date.now() + 5 * 60000 });
      return [200, { ok: true, sentTo: `mobile ending ${String(customer.phone || '').slice(-4)}`, validMinutes: 5 }];
    },
  ],
  [
    'POST',
    '/otp/verify',
    (_, body) => {
      const sent = created.otp.get(String(body.customerId));
      if (!sent || Date.now() > sent.until) return [409, { ok: false, match: false, reason: 'No one-time password is waiting: send a new one.' }];
      sent.tries++;
      if (digitsOf(body.otp) === OTP) {
        created.otp.delete(String(body.customerId));
        return [200, { ok: true, match: true }];
      }
      const triesLeft = Math.max(0, 3 - sent.tries);
      if (!triesLeft) created.otp.delete(String(body.customerId));
      return [200, { ok: true, match: false, triesLeft, reason: 'You have entered an invalid One-Time Password.', ...(triesLeft ? {} : { locked: true }) }];
    },
  ],

  // the caller's preferences, by caller ID (p. 1–2): after 5 picks of the same language it becomes their preferred
  // language; after 5 balance enquiries "Account Balance" becomes their favourite transaction
  [
    'GET',
    '/callers/:phone',
    ({ phone }) => {
      const c = created.choices.get(digitsOf(phone)) || { language: {}, balance: 0 };
      const preferred = Object.entries(c.language).find(([, n]) => n >= 5)?.[0] || null;
      const open = created.callbacks.find((x) => x.status === 'OPEN' && x.phoneDigits === digitsOf(phone));
      return [200, { phone: digitsOf(phone), preferredLanguage: preferred, favouriteTransaction: c.balance >= 5 ? 'balance' : null, openCallback: !!open }];
    },
  ],
  [
    'POST',
    '/callers/:phone/choices',
    ({ phone }, body) => {
      if (digitsOf(phone).length < 5) return bad('Give the caller ID.');
      const c = created.choices.get(digitsOf(phone)) || { language: {}, balance: 0 };
      if (body.language) c.language[body.language] = (c.language[body.language] || 0) + 1;
      if (body.transaction === 'balance') c.balance++;
      created.choices.set(digitsOf(phone), c);
      return [200, { ok: true }];
    },
  ],
  [
    'POST',
    '/callers/:phone/reset',
    ({ phone }) => {
      created.choices.delete(digitsOf(phone));
      return [200, { ok: true }];
    },
  ],

  // information, no customer needed: ?country=MY or SG
  [
    'GET',
    '/info/rates',
    (_, __, q) => (info.rates[q.country] ? [200, { country: q.country, note: info.note, ...info.rates[q.country] }] : bad('Say the country: MY or SG.')),
  ],
  [
    'GET',
    '/info/branches',
    (_, __, q) => {
      // by branch name, area or region (North, South, East, West, Central); read in English (p. 44)
      if (!info.branches[q.country]) return bad('Say the country: MY or SG.');
      const area = String(q.area || '').toLowerCase();
      const region = String(q.region || '').toLowerCase();
      const list = info.branches[q.country].filter(
        (b) => (!area || `${b.name} ${b.area} ${b.address}`.toLowerCase().includes(area)) && (!region || String(b.region || '').toLowerCase() === region),
      );
      const asked = q.area || q.region;
      return [
        200,
        {
          country: q.country,
          branches: list.length ? list : info.branches[q.country],
          ...(asked && !list.length ? { note: `No branch matches “${asked}”: these are all of them.` } : {}),
        },
      ];
    },
  ],
  [
    'GET',
    '/info/forms',
    (_, __, q) => (info.forms[q.country] ? [200, { country: q.country, forms: info.forms[q.country] }] : bad('Say the country: MY or SG.')),
  ],
  ['POST', '/info/forms/fax', (_, body) => fax(Object.values(info.forms).flat(), body.formId, body, 'form')],
  [
    'GET',
    '/info/bank-codes',
    (_, __, q) => (info.bankCodes[q.country] ? [200, { country: q.country, ...info.bankCodes[q.country] }] : bad('Say the country: MY or SG.')),
  ],
  [
    'GET',
    '/info/promotions',
    (_, __, q) => {
      // up to 7 promotions, by category; some can be faxed (p. 21)
      const list = info.promotions[q.country];
      if (!list) return bad('Say the country: MY or SG.');
      return [200, { country: q.country, promotions: list.slice(0, 7), ...(list.length ? {} : { message: 'There are no promotions at the moment.' }) }];
    },
  ],
  [
    'POST',
    '/info/promotions/:id/fax',
    ({ id }, body) =>
      fax(
        Object.values(info.promotions)
          .flat()
          .filter((p) => p.fax)
          .map((p) => ({ id: p.id, name: p.title })),
        id,
        body,
        'promotion that can be faxed',
      ),
  ],
  [
    'GET',
    '/info/contacts',
    (_, __, q) => (info.contacts[q.country] ? [200, { country: q.country, contacts: info.contacts[q.country] }] : bad('Say the country: MY or SG.')),
  ],

  // surveys (pp. 37, 38): three questions, each 1 Excellent, 2 Satisfactory or 3 Poor. The IVR survey, or the service
  // manager survey with its BI or BC profile.
  [
    'GET',
    '/surveys/questions',
    (_, __, q) => {
      const survey = q.survey === 'service_manager' ? 'service_manager' : 'ivr';
      return [200, { survey, scale: info.surveys.scale, questions: info.surveys[survey] }];
    },
  ],
  [
    'POST',
    '/surveys',
    (_, body) => {
      const ratings = (body.ratings || []).map(Number);
      if (ratings.length !== 3 || ratings.some((r) => ![1, 2, 3].includes(r)))
        return bad('Give the three ratings, each 1 (Excellent), 2 (Satisfactory) or 3 (Poor).');
      const survey = body.survey === 'service_manager' ? 'service_manager' : 'ivr';
      if (survey === 'service_manager' && !['BI', 'BC'].includes(body.profile)) return bad('Say the service manager’s profile: BI or BC.');
      const saved = { reference: reference('SRV'), survey, ...(survey === 'service_manager' ? { profile: body.profile } : {}), ratings, savedOn: today() };
      created.surveys.push(saved);
      return [200, { ok: true, ...saved, message: 'Your feedback is highly appreciated.' }];
    },
  ],
];

// what a cheque book costs and when it arrives (p. 14): in Singapore, the same day if asked before 10 am (SGD 27 /
// USD 18), by the next day if before 3 pm (SGD 18 / USD 12), or within 5 working days at no charge; an option past its
// cut-off is not offered
function chequeBookOptions(account) {
  const country = account.customer.country;
  if (country !== 'SG') return [{ delivery: 'normal', readyBy: workingDays(7, country), fee: 0, currency: account.currency }];
  const now = localNow('SG');
  const usd = account.currency === 'USD';
  const options = [];
  if (now.weekday % 6 && now.minutes < 10 * 60)
    options.push({ delivery: 'same_day', readyBy: now.date, fee: usd ? 18 : 27, currency: usd ? 'USD' : 'SGD', cutOff: '10:00 am' });
  if (now.weekday % 6 && now.minutes < 15 * 60)
    options.push({ delivery: 'express', readyBy: workingDays(1, 'SG'), fee: usd ? 12 : 18, currency: usd ? 'USD' : 'SGD', cutOff: '3:00 pm' });
  options.push({ delivery: 'normal', readyBy: workingDays(5, 'SG'), fee: 0, currency: usd ? 'USD' : 'SGD' });
  return options;
}

// a form or promotion by fax (pp. 21, 27–28): a local Singapore fax number has 8 digits; an overseas one is the country
// code, area code and number. A Malaysian fax number has at least 9 digits.
function fax(items, id, body, what) {
  const item = items.find((f) => f.id === String(id));
  if (!item) return [404, { ok: false, reason: `No ${what} with that id.` }];
  const number = String(body.faxNumber || '').replace(/[^\d+]/g, '');
  const n = digitsOf(number).length;
  const overseas = !!body.overseas || number.startsWith('+') || number.startsWith('00');
  const valid = String(id).startsWith('MY') ? n >= 9 && n <= 15 : overseas ? n >= 9 && n <= 15 : n === 8;
  if (!valid) return [400, { ok: false, reason: 'You have entered an invalid fax number.' }];
  return [
    200,
    {
      ok: true,
      reference: reference('FAX'),
      sent: item.name,
      faxEnding: number.slice(-4),
      message: `The ${what.split(' ')[0]} you have requested will be faxed to you shortly.`,
    },
  ];
}

const compiled = ROUTES.map(([method, path, handler]) => {
  const names = [];
  const re = new RegExp(`^${path.replace(/:(\w+)/g, (_, n) => (names.push(n), '([^/]+)'))}/?$`);
  return { method, re, names, handler };
});

/**
 * One request → { status, body }. method, path (without the query), query (object), body (object or text), headers.
 */
export function handle({ method, path, query = {}, body = {}, headers = {} }) {
  const key = process.env.MOCK_API_KEY;
  if (key && path !== '/health' && headers['x-api-key'] !== key) return { status: 401, body: { ok: false, reason: 'A valid x-api-key header is needed.' } };
  let parsed = body;
  if (typeof body === 'string') {
    try {
      parsed = body ? JSON.parse(body) : {};
    } catch {
      return { status: 400, body: { ok: false, reason: 'The body is not valid JSON.' } };
    }
  }
  const clean = path.replace(/^\/v1(?=\/)/, '');
  for (const r of compiled) {
    const m = clean.match(r.re);
    if (!m || r.method !== method) continue;
    const params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
    const [status, out] = r.handler(params, parsed || {}, query);
    // a caller that asks for refusals in the body (header x-refusals: in-body, as the agents do: their tools can't read
    // the body of an error answer) gets the bank's "no" as a 200 with ok: false and the reason, so it can say why
    if (headers['x-refusals'] === 'in-body' && status >= 400 && status < 500 && out?.reason)
      return { status: 200, body: { ...out, ok: false, refused: true, status } };
    return { status, body: out };
  }
  const known = compiled.some((r) => r.re.test(clean));
  return known
    ? { status: 405, body: { ok: false, reason: `${method} is not allowed here.` } }
    : { status: 404, body: { ok: false, reason: `No such route: ${method} ${path}. See GET /routes.` } };
}

/** For tests: forget what actions changed. */
export function resetState() {
  changed.clear();
  for (const k of Object.keys(created)) created[k] = k === 'otp' || k === 'choices' ? new Map() : [];
}
