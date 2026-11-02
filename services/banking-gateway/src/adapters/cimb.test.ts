import { describe, expect, it } from 'vitest';
import { HostError } from '../ports/ports.ts';
import { cimbConfigFromEnv, createCimbPorts } from './cimb.ts';

// A stand-in for CIMB's TetherfiDbRestApi, answering in its own shapes (recorded from the server on 2026-11-02):
// HTTP 200 always, the outcome per row in responseList, "not found" as a FAILED row with a description.
type Row = Record<string, string>;
const ok = (rows: Row[]) => ({ responseCode: 200, errorDesc: null, responseList: rows.map((columnMap) => ({ tableDetails: { columnMap }, responseCode: '200', status: 'SUCCESS', description: null })) });
const failed = (description: string) => ({ responseCode: 200, errorDesc: null, responseList: [{ tableDetails: null, responseCode: '-1', status: 'FAILED', description }] });

const CUSTOMERS: Record<string, Row> = { '9909155': { customerId: '9909155', name: 'Goh Kian Hock', passcode: '246810' } };
const ACCOUNTS: Record<string, Row> = {
  '195166925799': { accountId: '195166925799', balance: '47311.86', accountType: 'Savings Account', customerId: '9909155', currency: 'SGD' },
  '480311686099': { accountId: '480311686099', balance: '-120.50', accountType: 'Current Account', customerId: '9909155', currency: 'MYR' },
};
const TXNS: Row[] = [
  { date: '2026-10-20T09:00:00.000', accountId: '195166925799', amount: '100.00', type: 'CREDIT', description: 'Old credit', txnId: '1' },
  { date: '2026-11-01T22:13:21.807', accountId: '195166925799', amount: '11.86', type: 'CREDIT', description: 'Interest credit', txnId: '3' },
  { date: '2026-11-01T22:13:20.100', accountId: '195166925799', amount: '200.00', type: 'DEBIT', description: 'DuitNow transfer', txnId: '2' },
];

function fakeCimb(options: { sqlError?: boolean } = {}) {
  const requests: Array<{ headers: Record<string, string>; body: { entity: string; method: string; details: Array<{ columnMap: Row }> } }> = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const headers = init.headers as Record<string, string>;
    requests.push({ headers, body });
    const answer = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
    if (headers.Region !== 'DB2' || options.sqlError) return answer(failed('Exception occurred: could not extract ResultSet; SQL [n/a]; nested exception is org.hibernate.exception.SQLGrammarException'));
    const map = body.details[0].columnMap as Row;
    switch (`${body.entity}.${body.method}`) {
      case 'customer.getCustomerDetails':
        return answer(CUSTOMERS[(map.customerId ?? '')] ? ok([CUSTOMERS[map.customerId ?? ''] as Row]) : failed('Customer not found.'));
      case 'account.getCustomerAccounts': {
        const rows = Object.values(ACCOUNTS).filter((a) => a.customerId === map.customerId).map(({ currency: _c, ...rest }) => rest);
        return answer(rows.length ? ok(rows) : failed('No accounts found for this customer.'));
      }
      case 'account.getAccountDetails':
        return answer(ACCOUNTS[(map.accountId ?? '')] ? ok([ACCOUNTS[map.accountId ?? ''] as Row]) : failed('No account found with the given accountId.'));
      case 'transaction.getTransactionHistory': {
        const rows = TXNS.filter((t) => t.accountId === map.accountId);
        return answer(rows.length ? ok(rows) : failed('No transactions found.'));
      }
      default:
        return new Response(JSON.stringify({ responseCode: 500, errorDesc: 'Invalid entity or method name', responseList: [] }), { status: 200 });
    }
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const signal = () => new AbortController().signal;
const portsWith = (fake: ReturnType<typeof fakeCimb>, region = 'DB2') => createCimbPorts({ baseUrl: 'http://cimb.test', region, fetch: fake.fetchImpl });

describe('CIMB adapter', () => {
  it('sends Region on every request, in CIMB’s envelope', async () => {
    const fake = fakeCimb();
    await portsWith(fake).core.loginWithPhoneCode('9909155', '246810', signal());
    expect(fake.requests.length).toBeGreaterThan(0);
    for (const r of fake.requests) {
      expect(r.headers.Region).toBe('DB2');
      expect(r.body).toMatchObject({ dnis: 'default', channel: 'IVR' });
    }
  });

  it('signs in with the customer id as Phone Code and the passcode as PIN, and never returns the passcode', async () => {
    const ports = portsWith(fakeCimb());
    expect((await ports.core.loginWithPhoneCode('9909155', '000000', signal())).result).toBe('invalid_pin');
    expect((await ports.core.loginWithPhoneCode('1111111', '246810', signal())).result).toBe('invalid_phonecode');
    const result = await ports.core.loginWithPhoneCode('9909155', '246810', signal());
    expect(result.result).toBe('ok');
    if (result.result !== 'ok') return;
    expect(result.customer).toMatchObject({ customerId: '9909155', displayName: 'Goh Kian Hock', segment: 'business', role: null });
    expect(result.customer.accounts).toEqual([
      { number: '195166925799', type: 'CA', product: 'Savings Account', currencies: ['SGD'], dormant: false, omnibus: false },
      { number: '480311686099', type: 'CA', product: 'Current Account', currencies: ['MYR'], dormant: false, omnibus: false },
    ]);
    expect(JSON.stringify(result)).not.toContain('246810');
  });

  it('reads balances in minor units, negative ones included', async () => {
    const ports = portsWith(fakeCimb());
    const b = await ports.core.getBalance('195166925799', 'SGD', signal());
    expect(b.current).toEqual({ minor: 4731186, currency: 'SGD' });
    expect(b.available).toEqual(b.current);
    expect(b.overdraftLimit).toBeNull();
    expect((await ports.core.getBalance('480311686099', null, signal())).current).toEqual({ minor: -12050, currency: 'MYR' });
    await expect(ports.core.getBalance('195166925799', 'USD', signal())).rejects.toMatchObject({ code: 'no_currency' });
    expect(await ports.core.listCurrencies('480311686099', signal())).toEqual(['MYR']);
  });

  it('lists transactions newest first with debits negative, and incoming funds as recent credits', async () => {
    const ports = portsWith(fakeCimb());
    const recent = await ports.core.recentTransactions('195166925799', 15, signal());
    expect(recent.map((t) => [t.postedOn, t.amount.minor, t.description])).toEqual([
      ['2026-11-01', 1186, 'Interest credit'],
      ['2026-11-01', -20000, 'DuitNow transfer'],
      ['2026-10-20', 10000, 'Old credit'],
    ]);
    expect(await ports.core.recentTransactions('195166925799', 1, signal())).toHaveLength(1);
    const incoming = await ports.core.incomingFunds('195166925799', '2026-10-26', signal());
    expect(incoming.map((t) => t.description)).toEqual(['Interest credit']);
    expect(await ports.core.recentTransactions('480311686099', 15, signal())).toEqual([]);
  });

  it('turns a database failure into a host error that names no SQL', async () => {
    const ports = portsWith(fakeCimb({ sqlError: true }));
    const error = await ports.core.loginWithPhoneCode('9909155', '246810', signal()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HostError);
    expect(error).toMatchObject({ system: 'soa', code: 'db_error' });
    expect(String((error as Error).message)).not.toMatch(/SQL|hibernate/i);
  });

  it('says not_offered for what CIMB has no method for, instead of inventing data', async () => {
    const ports = portsWith(fakeCimb());
    await expect(ports.core.stopCheques('195166925799', '1', '2', 'k', signal())).rejects.toMatchObject({ code: 'not_offered' });
    await expect(ports.core.requestStatement('195166925799', '2026-10', 'k', signal())).rejects.toMatchObject({ code: 'not_offered' });
    await expect(ports.crm.verifyAccountAndNric('195166925799', '1234567', signal())).rejects.toMatchObject({ code: 'not_offered' });
    await expect(ports.otp.send('9909155', signal())).rejects.toMatchObject({ code: 'not_offered' });
    await expect(ports.content.branches(signal())).rejects.toMatchObject({ code: 'not_offered' });
    expect(await ports.crm.identifyAccount('195166925799', signal())).toEqual({ found: true, customerId: '9909155', segment: null });
    expect(await ports.crm.identifyAccount('000000000000', signal())).toEqual({ found: false, customerId: null, segment: null });
  });

  it('maps an unreachable host and a hung one', async () => {
    const down = createCimbPorts({ baseUrl: 'http://cimb.test', region: 'DB2', fetch: (async () => Promise.reject(new TypeError('fetch failed'))) as typeof fetch });
    await expect(down.core.getBalance('195166925799', null, signal())).rejects.toMatchObject({ code: 'unreachable' });
    const hung = createCimbPorts({
      baseUrl: 'http://cimb.test',
      region: 'DB2',
      timeoutMs: 20,
      fetch: ((_u: string, init: RequestInit) => new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError'))))) as typeof fetch,
    });
    await expect(hung.core.getBalance('195166925799', null, signal())).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('cimbConfigFromEnv', () => {
  it('is off without CIMB_BASE_URL and defaults the region to DB2', () => {
    expect(cimbConfigFromEnv({})).toBeNull();
    expect(cimbConfigFromEnv({ CIMB_BASE_URL: 'http://16.79.174.151:3322/' })).toMatchObject({ baseUrl: 'http://16.79.174.151:3322', region: 'DB2' });
    expect(() => cimbConfigFromEnv({ CIMB_BASE_URL: 'http://x/TetherfiDbRestApi' })).toThrow();
    expect(() => cimbConfigFromEnv({ CIMB_BASE_URL: 'http://x', CIMB_REGION: 'DB2; drop' })).toThrow();
  });
});

// ---- transfers: a DEBIT then a CREDIT (transaction.insertTransaction), with live balances like CIMB's
function fakeLedger(faults: { credit?: 'refuse' | 'network'; reversal?: 'refuse' } = {}) {
  const balances: Record<string, { minor: number; customerId: string; currency: string }> = {
    '111111111111': { minor: 100_000, customerId: '9909155', currency: 'SGD' },
    '222222222222': { minor: 5_000, customerId: '9909155', currency: 'SGD' },
    '333333333333': { minor: 5_000, customerId: '1234567', currency: 'SGD' },
  };
  const posted: Array<{ accountId: string; type: string; amount: string; description: string }> = [];
  let txn = 4000;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const map = body.details[0].columnMap as Row;
    const answer = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
    const account = balances[map.accountId ?? ''];
    if (body.method === 'getAccountDetails') {
      return answer(account ? ok([{ accountId: (map.accountId ?? ''), balance: (account.minor / 100).toFixed(2), accountType: 'Savings Account', customerId: account.customerId, currency: account.currency }]) : failed('No account found with the given accountId.'));
    }
    if (body.method === 'insertTransaction') {
      const isReversal = (map.description ?? '').startsWith('Reversal');
      if (map.type === 'CREDIT' && !isReversal && faults.credit === 'network') throw new TypeError('fetch failed');
      if (map.type === 'CREDIT' && !isReversal && faults.credit === 'refuse') return answer(failed('Exception occurred: credit refused'));
      if (isReversal && faults.reversal === 'refuse') return answer(failed('Exception occurred: reversal refused'));
      if (!account) return answer(failed(`Account with ID ${map.accountId} does not exist.`));
      const minor = Math.round(Number(map.amount) * 100);
      if (map.type === 'DEBIT' && account.minor < minor) return answer(failed('Insufficient balance for debit transaction.'));
      account.minor += map.type === 'DEBIT' ? -minor : minor;
      posted.push({ accountId: (map.accountId ?? ''), type: (map.type ?? ''), amount: (map.amount ?? ''), description: (map.description ?? '') });
      txn += 1;
      return answer(ok([{ accountId: (map.accountId ?? ''), balanceAfterTxn: (account.minor / 100).toFixed(2), txnId: String(txn) }]));
    }
    return answer(failed('Exception occurred: unexpected'));
  }) as typeof fetch;
  return { balances, posted, ports: createCimbPorts({ baseUrl: 'http://cimb.test', region: 'DB2', fetch: fetchImpl }) };
}
const sgd = (minor: number) => ({ minor, currency: 'SGD' });

describe('CIMB transfers', () => {
  it('posts a debit then a credit with the amount as CIMB decimal text, and returns a reference', async () => {
    const l = fakeLedger();
    expect(await l.ports.core.transferOwn('111111111111', '222222222222', sgd(25_050), 'idem_abcdef0123456789', signal())).toEqual({ reference: 'TRF4001' });
    expect(l.posted.map((p) => [p.accountId, p.type, p.amount])).toEqual([
      ['111111111111', 'DEBIT', '250.50'],
      ['222222222222', 'CREDIT', '250.50'],
    ]);
    expect(l.posted[0]?.description).toMatch(/^Transfer to account ending 2222 ref /);
    expect(l.balances['111111111111']?.minor).toBe(74_950);
    expect(l.balances['222222222222']?.minor).toBe(30_050);
  });

  it('refuses before calling CIMB: zero, negative, the same account, another customer, another currency', async () => {
    const l = fakeLedger();
    for (const [from, to, minor] of [['111111111111', '222222222222', 0], ['111111111111', '222222222222', -500], ['111111111111', '111111111111', 100], ['111111111111', '333333333333', 100]] as const) {
      await expect(l.ports.core.transferOwn(from, to, sgd(minor), 'k', signal())).rejects.toMatchObject({ code: 'transfer_failed' });
    }
    await expect(l.ports.core.transferOwn('111111111111', '222222222222', { minor: 100, currency: 'MYR' }, 'k', signal())).rejects.toMatchObject({ code: 'transfer_failed' });
    expect(l.posted).toEqual([]);
  });

  it('an overdraft is refused by CIMB: insufficient_funds, nothing moved', async () => {
    const l = fakeLedger();
    await expect(l.ports.core.transferOwn('222222222222', '111111111111', sgd(10_000), 'k', signal())).rejects.toMatchObject({ code: 'insufficient_funds' });
    expect(l.posted).toEqual([]);
  });

  it('a refused credit is undone with a reversal credit: transfer_failed, balances as before', async () => {
    const l = fakeLedger({ credit: 'refuse' });
    await expect(l.ports.core.transferOwn('111111111111', '222222222222', sgd(1_000), 'k', signal())).rejects.toMatchObject({ code: 'transfer_failed' });
    expect(l.posted.map((p) => [p.accountId, p.type])).toEqual([['111111111111', 'DEBIT'], ['111111111111', 'CREDIT']]);
    expect(l.balances['111111111111']?.minor).toBe(100_000);
  });

  it('a refused credit whose reversal also fails is reported as incomplete', async () => {
    const l = fakeLedger({ credit: 'refuse', reversal: 'refuse' });
    await expect(l.ports.core.transferOwn('111111111111', '222222222222', sgd(1_000), 'k', signal())).rejects.toMatchObject({ code: 'transfer_incomplete' });
  });

  it('a credit lost on the network is never reversed (it may have been posted): incomplete', async () => {
    const l = fakeLedger({ credit: 'network' });
    await expect(l.ports.core.transferOwn('111111111111', '222222222222', sgd(1_000), 'k', signal())).rejects.toMatchObject({ code: 'transfer_incomplete' });
    expect(l.posted.map((p) => p.type)).toEqual(['DEBIT']);
  });
});

describe('formatMinor', () => {
  it('writes minor units as CIMB decimal text', async () => {
    const { formatMinor } = await import('./cimb.ts');
    expect([formatMinor(25_050, 'SGD'), formatMinor(5, 'MYR'), formatMinor(100, 'SGD'), formatMinor(1_500, 'IDR')]).toEqual(['250.50', '0.05', '1.00', '1500']);
  });
});
