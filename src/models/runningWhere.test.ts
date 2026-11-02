import { describe, expect, it } from 'vitest';
import { environmentLabel, runningText, runningWhere } from './runningWhere';

const dep = (environment: string, version: string, status = 'active') => ({ environment, version, status });
const agents = [
  { id: 'acme', name: 'Acme Support', deployments: [dep('production', '1.2.0'), dep('development', '1.3.0'), dep('production', '1.1.0', 'superseded')] },
  { id: 'bill', name: 'Billing', deployments: [dep('development', '0.3.1'), dep('qa', '0.3.0')] },
  { id: 'new', name: '', deployments: [] },
];

describe('what is running where', () => {
  it('lists every environment the server has, then any other an agent runs in, the usual three in order', () => {
    const rows = runningWhere(['production', 'development', 'staging'], agents);
    expect(rows.map((r) => r.env)).toEqual(['development', 'staging', 'production', 'qa']);
    expect(rows[0].agents).toEqual([
      { id: 'acme', name: 'Acme Support', version: '1.3.0' },
      { id: 'bill', name: 'Billing', version: '0.3.1' },
    ]);
    expect(rows[1].agents).toEqual([]);
    expect(rows[2].agents).toEqual([{ id: 'acme', name: 'Acme Support', version: '1.2.0' }]);
  });

  it('takes the newest active deployment when the history marks more than one active', () => {
    const twice = [{ id: 'a', name: 'A', deployments: [{ ...dep('development', '0.1.0'), deployed_at: '2026-10-01T00:00:00Z' }, { ...dep('development', '0.1.1'), deployed_at: '2026-10-02T00:00:00Z' }] }];
    expect(runningWhere(['development'], twice)[0].agents[0].version).toBe('0.1.1');
    const sameTime = [{ id: 'a', name: 'A', deployments: [dep('development', '0.1.0'), dep('development', '0.1.1')] }];
    expect(runningWhere(['development'], sameTime)[0].agents[0].version).toBe('0.1.1');
    const newestFirst = [{ id: 'a', name: 'A', deployments: [{ ...dep('development', '0.2.0'), deployed_at: '2026-10-03T00:00:00Z' }, { ...dep('development', '0.1.0'), deployed_at: '2026-10-01T00:00:00Z' }] }];
    expect(runningWhere(['development'], newestFirst)[0].agents[0].version).toBe('0.2.0');
  });

  it('still shows what agents run when the server’s list could not be read', () => {
    expect(runningWhere(null, agents).map((r) => r.env)).toEqual(['development', 'production', 'qa']);
    expect(runningWhere(null, [])).toEqual([]);
  });

  it('says it in words', () => {
    const rows = runningWhere(['development', 'staging'], agents);
    expect(runningText(rows[0])).toBe('Acme Support 1.3.0, Billing 0.3.1');
    expect(runningText(rows[0], 1)).toBe('Acme Support 1.3.0 and 1 more');
    expect(runningText(rows[1])).toBe('Nothing deployed');
    expect(environmentLabel('pre_prod')).toBe('Pre prod');
  });
});
