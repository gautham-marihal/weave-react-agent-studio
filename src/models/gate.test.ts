import { describe, expect, it } from 'vitest';
import { gateCheck } from './gate';
import { shipSteps } from './shipFlow';
import { readinessSteps } from './readiness';

const passed = { status: 'passed' as const, passed: 5, total: 5, startedAt: '2026-10-16T10:00:00Z' };

describe('gateCheck: tests must pass before publishing', () => {
  it('gate off: nothing is held, whatever the tests say', () => {
    expect(gateCheck({ enabled: false, scenarioCount: 0, latestRun: null })).toEqual({ ok: true, why: '', action: '' });
    expect(gateCheck({ enabled: false, latestRun: { status: 'failed' } }).ok).toBe(true);
  });

  it('no scenarios holds it and asks for tests', () => {
    const r = gateCheck({ enabled: true, scenarioCount: 0 });
    expect([r.ok, r.action]).toEqual([false, 'scenarios']);
    expect(r.why).toMatch(/no tests yet/);
  });

  it('never run holds it', () => {
    expect(gateCheck({ enabled: true, scenarioCount: 3 })).toEqual({ ok: false, why: 'The tests have not been run yet.', action: 'tests' });
  });

  it('a failed, broken or skipped latest run holds it, with passed of total', () => {
    expect(gateCheck({ enabled: true, scenarioCount: 3, latestRun: { status: 'failed', passed: 2, total: 3 } }).why).toMatch(/failed \(2 of 3 passed\)/);
    expect(gateCheck({ enabled: true, scenarioCount: 3, latestRun: { status: 'error' } }).why).toMatch(/broke/);
    expect(gateCheck({ enabled: true, scenarioCount: 3, latestRun: { status: 'skipped', passed: 0, total: 3 } }).why).toMatch(/skipped everything \(0 of 3 passed\)/);
  });

  it('a passing run lets it through', () => {
    expect(gateCheck({ enabled: true, scenarioCount: 5, latestRun: passed, savedAt: '2026-10-16T09:00:00Z' })).toEqual({ ok: true, why: 'The latest run passed (5 of 5).', action: '' });
  });

  it('unsaved edits hold it: changes the last run did not see', () => {
    expect(gateCheck({ enabled: true, scenarioCount: 5, latestRun: passed, savedAt: '2026-10-16T09:00:00Z', dirty: true }).why).toMatch(/changes the last run did not see/);
  });

  it('a save more than a second after the run started holds it; within the second does not', () => {
    expect(gateCheck({ enabled: true, scenarioCount: 5, latestRun: passed, savedAt: '2026-10-16T11:00:00Z' }).why).toMatch(/saved after the last run/);
    expect(gateCheck({ enabled: true, scenarioCount: 5, latestRun: passed, savedAt: '2026-10-16T10:00:00.400Z' }).ok).toBe(true);
    expect(gateCheck({ enabled: true, scenarioCount: 5, latestRun: passed, savedAt: '2026-10-16T10:00:01.200Z' }).ok).toBe(false);
  });

  it('no save time known: the run is trusted', () => {
    expect(gateCheck({ enabled: true, scenarioCount: 5, latestRun: passed, savedAt: '' }).ok).toBe(true);
  });
});

describe('the ship flow and readiness read the same gate', () => {
  const base = { dirty: false, report: { valid: true, errors: [], warnings: [], secrets_required: [], unsupported: [] }, scenarioCount: 0, latestRun: null, published: null };
  const tested = (r: ReturnType<typeof shipSteps>) => r.steps.find((s) => s.id === 'tested');

  it('gate off: no tests is only optional', () => {
    expect(tested(shipSteps({ ...base, gate: gateCheck({ enabled: false }) }))?.state).toBe('optional');
  });

  it('gate on with no tests: blocked, "Add tests"', () => {
    const t = tested(shipSteps({ ...base, gate: gateCheck({ enabled: true, scenarioCount: 0 }) }));
    expect(t?.state).toBe('blocked');
    expect(t?.action).toMatchObject({ kind: 'go', label: 'Add tests', target: { stage: 'build', focus: 'tests' } });
  });

  it('gate on with a failing run: blocked, "Run the tests"; a good run: done', () => {
    const failing = gateCheck({ enabled: true, scenarioCount: 4, latestRun: { status: 'failed', passed: 3, total: 4 } });
    expect(tested(shipSteps({ ...base, scenarioCount: 4, latestRun: { status: 'failed', passed: 3, total: 4 }, gate: failing }))?.action).toMatchObject({ label: 'Run the tests' });
    const good = { status: 'passed' as const, passed: 4, total: 4, startedAt: '2026-10-16T10:00:00Z' };
    expect(tested(shipSteps({ ...base, scenarioCount: 4, latestRun: good, gate: gateCheck({ enabled: true, scenarioCount: 4, latestRun: good, savedAt: '2026-10-16T09:00:00Z' }) }))?.state).toBe('done');
  });

  it('readiness says the same reason', () => {
    const gate = gateCheck({ enabled: true, scenarioCount: 2, latestRun: passed, savedAt: '2026-10-16T11:00:00Z' });
    const step = readinessSteps({ config: { meta: { name: 'A' } }, scenarioCount: 2, latestRun: passed, gate }).steps.find((s) => s.id === 'tests');
    expect([step?.state, step?.text]).toEqual(['blocked', 'The draft was saved after the last run. Run the tests again.']);
  });
});
