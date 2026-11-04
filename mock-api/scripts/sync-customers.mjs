// The test customers and their accounts, read from the bank database's API (read-only methods), so the mock's records
// belong to the same people and account numbers the agents find there. Writes data/customers.json. No TPIN (passcode)
// is kept. Run it again whenever the bank database's test customers change, then `npm run seed`.
//   node scripts/sync-customers.mjs [API root, default http://16.79.174.151:3322] [Region header, default DB2]
import { writeFileSync } from 'node:fs';

// eslint-disable-next-line sonarjs/no-clear-text-protocols -- the bank database's API is served over plain http only
const ROOT = (process.argv[2] || process.env.BANK_API_URL || 'http://16.79.174.151:3322').replace(/\/+$/, '');
const REGION = process.argv[3] || process.env.BANK_REGION || 'DB2';
const OUT = new URL('../data/customers.json', import.meta.url);

async function read(entity, method, columnMap = {}) {
  const response = await fetch(`${ROOT}/TetherfiDbRestApi/dboperations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Region: REGION },
    body: JSON.stringify({ ucid: 'mock-api-sync', dnis: 'default', channel: 'IVR', entity, method, details: [{ columnMap }] }),
  });
  const answer = await response.json();
  if (answer.responseCode !== 200) throw new Error(`${entity}.${method}: ${answer.errorDesc || response.status}`);
  return (answer.responseList || []).filter((item) => item.tableDetails).map((item) => item.tableDetails.columnMap);
}

// the country an account belongs to, from its currency
const COUNTRY = { SGD: 'SG', MYR: 'MY' };

const customers = [];
for (const c of await read('customer', 'getAllCustomers')) {
  const accounts = [];
  for (const a of await read('account', 'getCustomerAccounts', { customerId: c.customerId })) {
    const [details] = await read('account', 'getAccountDetails', { accountId: a.accountId });
    accounts.push({ accountId: a.accountId, accountType: a.accountType, currency: details?.currency || '' });
  }
  const currency = accounts.find((a) => a.currency)?.currency || '';
  customers.push({ customerId: c.customerId, name: c.name, phone: c.phone || '', country: COUNTRY[currency] || '', accounts });
}
customers.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(OUT, `${JSON.stringify({ source: `${ROOT} (Region ${REGION})`, customers }, null, 2)}\n`);
console.log(`${customers.length} customers, ${customers.reduce((n, c) => n + c.accounts.length, 0)} accounts → data/customers.json`);
