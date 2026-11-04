// The mock's records for each test customer (data/customers.json), written to data/services.json: issued cheques, the
// last cheque book, cheque deposits, cards and their transactions, payees (loans, card and bill payments, other-bank
// payees), FPX direct debits (Malaysia), card applications, a sample investigation case, and what the bank's call flows
// read from its other systems: identity numbers and key codes for the logins, balance details (holds, cheques pending
// clearance, overdraft limits), incoming funds of the last 7 days, the VIP table and each account's last service
// manager. Deterministic: the same customers always give the same records. Edit data/services.json by hand if you
// like; running this again rewrites it.
import { readFileSync, writeFileSync } from 'node:fs';

const { customers } = JSON.parse(readFileSync(new URL('../data/customers.json', import.meta.url), 'utf8'));

// a small seeded random, from a text (an account number), so each account always gets the same records
function randomFrom(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}
const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const money = (rand, min, max) => Math.round((min + rand() * (max - min)) * 100) / 100;
const digits = (rand, n) => Array.from({ length: n }, () => Math.floor(rand() * 10)).join('');
const day = (d) => `2026-${d}`;

const PAYEES = {
  MY: {
    bills: ['Tenaga Nasional (electricity)', 'Air Selangor (water)', 'TM Unifi (internet)', 'Indah Water (sewerage)'],
    banks: ['Maybank', 'CIMB Bank', 'Public Bank', 'RHB Bank'],
  },
  SG: {
    bills: ['SP Group (utilities)', 'Singtel (mobile)', 'StarHub (broadband)', 'Town Council (service charges)'],
    banks: ['DBS Bank', 'UOB', 'Maybank Singapore', 'Standard Chartered'],
  },
};
const PAYEE_NAMES = ['Lim Hardware Trading', 'Ah Seng Logistics', 'Kedai Runcit Maju', 'Sunrise Printing', 'Green Valley Supplies', 'Harbour Freight Services'];
const SENDERS = ['Pacific Trading Pte Ltd', 'Orchid Foods Pte Ltd', 'Kim Seng Engineering', 'Northstar Logistics', 'Lotus Imports Ltd'];
const RETURN_REASONS = ['Insufficient funds', 'Signature differs', 'Payment stopped by the drawer', 'Post-dated'];

// service managers (the people calls go to); the busy one is never free, to try the "not available" path
const SERVICE_MANAGERS = [
  { id: 'SM01', name: 'Rachel Tan', group: 'SME Group A', busy: false },
  { id: 'SM02', name: 'David Lim', group: 'SME Group A', busy: false },
  { id: 'SM03', name: 'Aisha Rahman', group: 'SME Group B', busy: true },
  { id: 'SM04', name: 'Kevin Ong', group: 'SME Group B', busy: false },
];

const out = {
  cheques: [],
  chequeBooks: [],
  chequeDeposits: [],
  cards: [],
  cardTransactions: [],
  payees: [],
  fpxDirectDebits: [],
  cardApplications: [],
  cases: [],
  identities: [],
  balanceDetails: [],
  incomingFunds: [],
  serviceManagers: SERVICE_MANAGERS,
  lastServiceManagers: [],
  vip: [],
};
for (const customer of customers) {
  const rand = randomFrom(customer.customerId);
  const currency = customer.accounts[0]?.currency || (customer.country === 'MY' ? 'MYR' : 'SGD');
  const local = PAYEES[customer.country] || PAYEES.SG;

  for (const account of customer.accounts) {
    const r = randomFrom(account.accountId);
    // current accounts have cheques; statuses as the bank's cheque status enquiry gives them (SG pack p. 12)
    if (/current/i.test(account.accountType)) {
      const first = 100000 + Math.floor(r() * 800000);
      const statuses = ['CLEARED', 'CLEARED', 'NOT_PRESENTED', 'STOPPED', 'RETURNED', 'PRESENTED'];
      statuses.forEach((status, i) => {
        const chequeNo = String(first + i).padStart(6, '0');
        out.cheques.push({
          accountId: account.accountId,
          chequeNo,
          payee: pick(r, PAYEE_NAMES),
          amount: money(r, 120, 9500),
          currency: account.currency,
          issuedOn: day(`10-${String(5 + i * 4).padStart(2, '0')}`),
          status,
          ...(status === 'CLEARED' ? { clearedOn: day(`10-${String(8 + i * 4).padStart(2, '0')}`) } : {}),
          ...(status === 'STOPPED' ? { stoppedOn: day(`10-${String(9 + i * 4).padStart(2, '0')}`), stopReason: 'Lost in the post' } : {}),
          ...(status === 'RETURNED' ? { returnedOn: day('10-27'), returnReason: RETURN_REASONS[0] } : {}),
          ...(status === 'PRESENTED' ? { presentedOn: day('10-31') } : {}),
        });
      });
      out.chequeBooks.push({
        accountId: account.accountId,
        from: String(first).padStart(6, '0'),
        to: String(first + 49).padStart(6, '0'),
        sentOn: day('09-22'),
        delivery: pick(r, ['Courier to the registered address', 'Collected at the branch']),
      });
      // cheques deposited into the account: dated by days before today, so "the last 7 days" (p. 11) always has some
      for (let i = 0; i < 2; i++) {
        out.chequeDeposits.push({
          accountId: account.accountId,
          chequeNo: String(200000 + Math.floor(r() * 700000)),
          drawerBank: pick(r, local.banks),
          amount: money(r, 300, 15000),
          currency: account.currency,
          daysAgo: i ? 0 : 4,
          status: i ? 'CLEARING' : 'CLEARED',
        });
      }
      const back = randomFrom(`returned:${account.accountId}`);
      out.chequeDeposits.push({
        accountId: account.accountId,
        chequeNo: String(200000 + Math.floor(back() * 700000)),
        drawerBank: pick(back, local.banks),
        amount: money(back, 300, 6000),
        currency: account.currency,
        daysAgo: 2,
        status: 'RETURNED',
        returnReason: pick(back, RETURN_REASONS),
      });
    }
    // Malaysian accounts can have FPX direct debits
    if (customer.country === 'MY' && !/fixed/i.test(account.accountType)) {
      [
        ['Great Eastern Life (insurance premium)', 320],
        ['Public Mutual (unit trust)', 500],
      ].forEach(([merchant, amount], i) => {
        out.fpxDirectDebits.push({
          id: `FPX-${account.accountId.slice(-4)}-${i + 1}`,
          accountId: account.accountId,
          merchant,
          amount,
          currency: account.currency,
          frequency: 'Monthly',
          nextOn: day(`11-${String(5 + i * 10).padStart(2, '0')}`),
          status: 'ACTIVE',
        });
      });
    }
    // balance details the bank's balance enquiry reads out (SG pack pp. 4–5): a hold, cheques pending clearance and,
    // on current accounts, an overdraft limit
    if (!/fixed/i.test(account.accountType)) {
      const b = randomFrom(`balance:${account.accountId}`);
      const isCurrent = /current/i.test(account.accountType);
      out.balanceDetails.push({
        accountId: account.accountId,
        holdAmount: b() < 0.5 ? money(b, 50, 800) : 0,
        pendingClearance: isCurrent && b() < 0.6 ? money(b, 200, 3000) : 0,
        overdraftLimit: isCurrent && b() < 0.5 ? pick(b, [5000, 10000, 20000]) : 0,
        omnibus: false,
      });
    }
    // Singapore: incoming funds (GIRO, local and overseas transfers) of the last 7 calendar days (SG pack p. 6)
    if (customer.country === 'SG' && !/fixed/i.test(account.accountType)) {
      const f = randomFrom(`incoming:${account.accountId}`);
      const n = customer.customerId === '5409881' ? 3 : Math.floor(f() * 5); // the main demo customer always has some
      for (let i = 0; i < n; i++)
        out.incomingFunds.push({
          accountId: account.accountId,
          type: pick(f, ['GIRO', 'Local transfer', 'Overseas transfer']),
          from: pick(f, SENDERS),
          amount: money(f, 150, 12000),
          currency: account.currency,
          daysAgo: Math.floor(f() * 7),
          status: 'CREDITED',
        });
      out.lastServiceManagers.push({ accountId: account.accountId, serviceManagerId: pick(randomFrom(`sm:${account.accountId}`), SERVICE_MANAGERS).id });
    }
  }

  // a debit card for everyone; a credit card for about two in three
  const debitLast4 = String(1000 + Math.floor(rand() * 9000));
  out.cards.push({
    cardId: `C${customer.customerId}D`,
    customerId: customer.customerId,
    kind: 'Debit',
    name: 'Debit Mastercard',
    last4: debitLast4,
    status: 'ACTIVE',
    currency,
  });
  if (rand() < 0.67) {
    const limit = pick(rand, [5000, 8000, 12000, 20000]);
    out.cards.push({
      cardId: `C${customer.customerId}V`,
      customerId: customer.customerId,
      kind: 'Credit',
      name: pick(rand, ['Visa Platinum', 'Mastercard World', 'Visa Infinite']),
      last4: String(1000 + Math.floor(rand() * 9000)),
      status: rand() < 0.15 ? 'NOT_ACTIVATED' : 'ACTIVE',
      creditLimit: limit,
      amountDue: money(rand, 80, limit * 0.4),
      minimumDue: 50,
      dueOn: day('11-18'),
      annualFee: customer.country === 'MY' ? 250 : 196.2,
      currency,
    });
  }

  // payees: a loan for some, the credit card, two bills, one other-bank payee
  const payees = [];
  if (rand() < 0.5)
    payees.push({
      id: `L${customer.customerId}`,
      type: 'LOAN',
      name: pick(rand, ['Business term loan', 'Home loan', 'Car loan']),
      instalment: money(rand, 450, 3200),
      arrears: rand() < 0.2 ? money(rand, 100, 900) : 0,
      currency,
    });
  const credit = out.cards.find((c) => c.customerId === customer.customerId && c.kind === 'Credit');
  if (credit)
    payees.push({
      id: `P${credit.cardId}`,
      type: 'CREDIT_CARD',
      name: `${credit.name} ending ${credit.last4}`,
      amountDue: credit.amountDue,
      minimumDue: credit.minimumDue,
      currency,
    });
  local.bills
    .slice(0, 2)
    .forEach((bill, i) =>
      payees.push({ id: `B${customer.customerId}${i + 1}`, type: 'BILL', name: bill, accountRef: String(10000000 + Math.floor(rand() * 89999999)), currency }),
    );
  payees.push({
    id: `G${customer.customerId}`,
    type: 'OTHER_BANK',
    name: pick(rand, PAYEE_NAMES),
    bank: pick(rand, local.banks),
    accountEnding: String(1000 + Math.floor(rand() * 9000)),
    currency,
  });
  out.payees.push({ customerId: customer.customerId, payees });

  // credit card transactions, for "card balance, statement and transactions" (MY pack p. 50)
  if (credit) {
    const t = randomFrom(`card:${credit.cardId}`);
    const shops = customer.country === 'MY' ? ['Petronas', 'AEON Mall', 'Grab', 'Shopee', 'Mydin'] : ['Shell', 'FairPrice', 'Grab', 'Shopee', 'Courts'];
    for (let i = 0; i < 5; i++)
      out.cardTransactions.push({
        cardId: credit.cardId,
        merchant: pick(t, shops),
        amount: money(t, 12, 480),
        currency,
        postedOn: day(`10-${String(30 - i * 5).padStart(2, '0')}`),
      });
  }

  // identity numbers the logins check: NRIC in Singapore (account + NRIC + one-time password, SG pack p. 34), the
  // 12-digit IC in Malaysia (iQ members, MY pack p. 50) and the Malaysian business key code (MY pack p. 52)
  const id = randomFrom(`identity:${customer.customerId}`);
  out.identities.push({
    customerId: customer.customerId,
    ...(customer.country === 'SG'
      ? { idType: 'NRIC', idNumber: `S${digits(id, 7)}${'ABCDEFGHIZJ'[Math.floor(id() * 11)]}` }
      : {
          idType: 'IC',
          idNumber: `${pick(id, ['78', '82', '85', '90'])}0${1 + Math.floor(id() * 9)}1${Math.floor(id() * 9)}${digits(id, 6)}`,
          keyCode: digits(id, 8),
        }),
    customerType: 'business',
    bizconn: false,
    dormantAccounts: [],
  });
}

// test cases for the login outcomes: a personal (not business) customer, a dormant account, BizConn (FD and loan
// enquiries) — SG pack pp. 3, 33–34
const identity = (cid) => out.identities.find((x) => x.customerId === cid);
const sgCustomers = customers.filter((c) => c.country === 'SG');
if (identity('5409881')) identity('5409881').bizconn = true;
const personal = sgCustomers.find((c) => c.customerId !== '5409881' && c.accounts.length === 1);
if (personal) identity(personal.customerId).customerType = 'personal';
const dormant = sgCustomers.find((c) => c !== personal && c.customerId !== '5409881' && c.accounts.length === 1);
if (dormant) identity(dormant.customerId).dormantAccounts = [dormant.accounts[0].accountId];

// the VIP table (SG pack p. 31), found by the mobile number registered with the bank: how each VIP is checked
// (account number, phone code, or no check), their language and their own service manager
const vipTypes = ['account', 'phone_code', 'default'];
sgCustomers
  .filter((c) => c !== personal && c !== dormant)
  .slice(0, 3)
  .forEach((c, i) =>
    out.vip.push({
      mobile: c.phone,
      customerId: c.customerId,
      name: c.name,
      vipType: vipTypes[i],
      language: i === 1 ? 'zh' : 'en',
      serviceManagerId: SERVICE_MANAGERS[i === 2 ? 2 : i].id,
    }),
  );

// card applications, by applicant ID (made up)
out.cardApplications.push(
  { applicantId: '900101145566', name: 'Applicant A', card: 'Visa Platinum', status: 'APPROVED', note: 'The card is sent by courier within 7 working days.' },
  {
    applicantId: '880512106789',
    name: 'Applicant B',
    card: 'Mastercard World',
    status: 'IN_REVIEW',
    note: 'More documents may be asked for; a decision usually takes 5 working days.',
  },
  { applicantId: '920830087123', name: 'Applicant C', card: 'Visa Infinite', status: 'DECLINED', note: 'The income requirement is not met.' },
);
// one open investigation case, for the investigations line
const firstSavings = customers.flatMap((c) => c.accounts).find((a) => /savings/i.test(a.accountType));
if (firstSavings)
  out.cases.push({
    caseId: 'INV-2026-0418',
    accountId: firstSavings.accountId,
    summary: 'Card payment the customer does not recognise',
    openedOn: day('10-29'),
    status: 'IN_PROGRESS',
    handler: 'Investigations team',
    updatedOn: day('10-31'),
  });

writeFileSync(new URL('../data/services.json', import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
console.log(
  Object.entries(out)
    .map(([k, v]) => `${k}: ${v.length}`)
    .join(', '),
  '→ data/services.json',
);
