import { describe, expect, it } from 'vitest';
import { bankingStatus, LIVE_MOCK_BANK } from './bankingStatus';

describe('bankingStatus', () => {
  it('in Live without a gateway on real systems: the mock bank, said up front as test data, with the reason', () => {
    for (const kind of ['browser', 'gateway'] as const) {
      const s = bankingStatus({ kind, hosts: 'mock', studio: 'live' });
      expect(s.mock).toBe(true);
      expect(s.chip).toBe('Mock bank · test data');
      expect(s.tone).toBe('warning');
      expect(s.text).toMatch(/^Mock bank · /);
      expect(s.text).toContain(LIVE_MOCK_BANK);
      expect(`${s.chip} ${s.text}`).not.toMatch(/real systems ·|connected to the bank/i);
    }
  });
  it('in Sandbox: says which gateway answers, as test data', () => {
    expect(bankingStatus({ kind: 'browser', hosts: 'mock', studio: 'sandbox' }).text).toMatch(/in this browser/);
    expect(bankingStatus({ kind: 'gateway', hosts: 'mock', studio: 'sandbox' }).text).toMatch(/mock bank systems/);
    expect(bankingStatus({ kind: 'browser', hosts: 'mock', studio: 'sandbox' })).toMatchObject({ mock: true, chip: 'Sandbox · test data' });
  });
  it('a gateway on the bank’s real systems says so, in either mode', () => {
    for (const studio of ['live', 'sandbox'] as const) {
      expect(bankingStatus({ kind: 'gateway', hosts: 'live', studio })).toMatchObject({ mock: false, chip: 'Bank’s real systems', tone: 'success' });
    }
  });
});
