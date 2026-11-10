// The OCBC journey's bank records for the test customers (data/bank.json): what the bank database (Ashwin's DB2) holds
// for them, as the mock's stand-in serves it (POST /ocbc/dboperations): the phone banking TPIN, an e-mail address, and
// for each account its balance and recent transactions (daysAgo: the route turns it into a date, so they stay recent). Deterministic: the same customers always give the same records.
// The three customers whose DB2 TPIN is 1234 keep it here; the others get a 6-digit one. Running this again rewrites
// the file; edit it by hand if you like.
import { readFileSync, writeFileSync } from 'node:fs';

const { customers } = JSON.parse(readFileSync(new URL('../data/customers.json', import.meta.url), 'utf8'));

// a small seeded random, from a text, so each record always comes out the same (as in build-seed.mjs)
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

const TPIN_1234 = new Set(['5409881', '1449287', '2220125']); // as in DB2
// recent transactions, by country: [type, description, low, high]
const MOVES = {
  SG: [
    ['CREDIT', 'SALARY GIRO - NORTHSTAR LOGISTICS PTE LTD', 4200, 7800],
    ['CREDIT', 'PAYNOW TRANSFER FROM LIM KAH WEI', 50, 600],
    ['CREDIT', 'FAST TRANSFER FROM DBS - RENTAL INCOME', 1800, 3200],
    ['DEBIT', 'NETS PURCHASE - FAIRPRICE FINEST', 40, 260],
    ['DEBIT', 'GIRO - SP GROUP UTILITIES', 90, 240],
    ['DEBIT', 'GIRO - SINGTEL MOBILE', 45, 120],
    ['DEBIT', 'PAYNOW TO GRAB SINGAPORE', 12, 60],
    ['DEBIT', 'ATM WITHDRAWAL - OCBC CENTRE', 100, 500],
    ['DEBIT', 'GIRO - IRAS INCOME TAX INSTALMENT', 300, 1500],
    ['DEBIT', 'CARD PAYMENT - VISA PLATINUM', 400, 2500],
  ],
  MY: [
    ['CREDIT', 'SALARY - PETRONAS DAGANGAN BHD', 5200, 9800],
    ['CREDIT', 'DUITNOW TRANSFER FROM AHMAD RAZAK', 50, 800],
    ['DEBIT', 'JOMPAY - TENAGA NASIONAL BERHAD', 80, 320],
    ['DEBIT', 'FPX - SHOPEE MALAYSIA', 30, 400],
    ['DEBIT', 'DUITNOW QR - MYDIN MART', 25, 180],
    ['DEBIT', 'ATM WITHDRAWAL - OCBC JALAN TUN PERAK', 100, 600],
    ['DEBIT', 'JOMPAY - AIR SELANGOR', 30, 90],
    ['DEBIT', 'IBG TRANSFER - HOUSE RENT', 1200, 2400],
  ],
};
const BALANCE = { current: [3000, 45000], savings: [8000, 120000], fixed: [20000, 200000] };
const kindOf = (type) => (/fixed/i.test(type) ? 'fixed' : /current/i.test(type) ? 'current' : 'savings');

const records = customers.map((c) => {
  const rand = randomFrom(c.customerId);
  const words = c.name
    .toLowerCase()
    .replace(/[^a-z ]/g, '')
    .split(' ')
    .filter((w) => !['bin', 'binti', 'ao', 'al', 'do', 'so'].includes(w));
  return {
    customerId: c.customerId,
    passcode: TPIN_1234.has(c.customerId) ? '1234' : digits(rand, 6),
    email: `${words.slice(0, 2).join('.')}@example.com`,
    accounts: c.accounts.map((a) => {
      const r = randomFrom(a.accountId);
      const kind = kindOf(a.accountType);
      const [lo, hi] = BALANCE[kind];
      const balance = kind === 'fixed' ? Math.round((lo + r() * (hi - lo)) / 1000) * 1000 : money(r, lo, hi);
      const transactions =
        kind === 'fixed'
          ? [
              {
                type: 'CREDIT',
                amount: Math.round(balance * 0.0021 * 100) / 100,
                description: 'FIXED DEPOSIT INTEREST CREDIT',
                daysAgo: Math.floor(r() * 20 + 3),
              },
              { type: 'CREDIT', amount: balance, description: 'FIXED DEPOSIT PLACEMENT - 12 MONTHS', daysAgo: Math.floor(r() * 120 + 60) },
            ]
          : Array.from({ length: 6 + Math.floor(r() * 4) }, (_, i) => {
              const [type, description, low, high] = pick(r, MOVES[c.country] || MOVES.SG);
              return { type, amount: money(r, low, high), description, daysAgo: i * 4 + Math.floor(r() * 4) };
            });
      return { accountId: a.accountId, balance, transactions };
    }),
  };
});

writeFileSync(
  new URL('../data/bank.json', import.meta.url),
  `${JSON.stringify({ about: 'The OCBC journey’s bank records for the test customers (scripts/build-bank.mjs). Demo figures.', customers: records }, null, 2)}\n`,
);
console.log(`data/bank.json: ${records.length} customers, ${records.reduce((n, c) => n + c.accounts.length, 0)} accounts`);
