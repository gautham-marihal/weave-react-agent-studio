import { describe, expect, it } from 'vitest';
import type { ValidationReport } from '../types/studio';
import { shipSteps, type ShipInput } from './shipFlow';

const report = (errors = 0): ValidationReport => ({
  valid: errors === 0,
  errors: Array.from({ length: errors }, () => ({ path: null, message: 'x' })),
  warnings: [],
  secrets_required: [],
  unsupported: [],
});
const ok: ShipInput = {
  dirty: false,
  report: report(),
  scenarioCount: 2,
  latestRun: { status: 'passed', passed: 2, total: 2 },
  published: { version: '0.1.1', changes: 0 },
  deployed: { staging: '0.1.1' },
};
const by = (r: ReturnType<typeof shipSteps>, id: string) => {
  const step = r.steps.find((s) => s.id === id);
  if (!step) throw new Error(`no step ${id}`);
  return step;
};

describe('shipSteps', () => {
  it('everything done: ready, nothing next', () => {
    const r = shipSteps(ok);
    expect(r.ready).toBe(true);
    expect(r.done).toBe(5);
    expect(r.next).toBeNull();
    expect(r.steps.map((s) => s.label)).toEqual(['Saved', 'Valid', 'Tested', 'Published', 'Deployed']);
  });

  it('unsaved edits come first, and its button saves', () => {
    const r = shipSteps({ ...ok, dirty: true });
    expect(by(r, 'save').state).toBe('todo');
    expect(r.next?.id).toBe('save');
    expect(r.ready).toBe(false);
    expect(r.next?.action).toEqual({ kind: 'save', label: 'Save' });
  });

  it('an unreadable JSON blocks, and blocked outranks to-do', () => {
    const r = shipSteps({ ...ok, parseError: 'bad', dirty: true, published: null });
    expect(r.next?.id).toBe('save');
    expect(by(r, 'save').state).toBe('blocked');
    expect(by(r, 'save').action).toEqual({ kind: 'go', label: 'Edit as JSON', target: { stage: 'build', focus: 'json' } });
  });

  it('the server’s checks not known yet: Valid is to do, not claimed', () => {
    const r = shipSteps({ ...ok, report: null });
    expect(by(r, 'valid')).toMatchObject({ state: 'todo', text: 'Not checked yet.' });
  });

  it('validation errors block with a count', () => {
    const r = shipSteps({ ...ok, report: report(2) });
    expect(by(r, 'valid').state).toBe('blocked');
    expect(by(r, 'valid').text).toMatch(/2 errors/);
  });

  it('no scenarios is optional, never a blocker, and not counted', () => {
    const r = shipSteps({ ...ok, scenarioCount: 0, latestRun: null });
    expect(by(r, 'tested').state).toBe('optional');
    expect(r.total).toBe(4);
    expect(r.ready).toBe(true);
  });

  it('never run is to do; a failing, broken or skipped latest run blocks', () => {
    expect(by(shipSteps({ ...ok, latestRun: null }), 'tested').state).toBe('todo');
    const r = shipSteps({ ...ok, latestRun: { status: 'failed', passed: 1, total: 2 } });
    expect(by(r, 'tested').state).toBe('blocked');
    expect(r.next?.id).toBe('tested');
    expect(by(shipSteps({ ...ok, latestRun: { status: 'error' } }), 'tested').text).toMatch(/broke/);
    expect(by(shipSteps({ ...ok, latestRun: { status: 'skipped' } }), 'tested').text).toMatch(/skipped everything/);
  });

  it('the gate holding blocks Tested with its reason, even with no scenarios', () => {
    const r = shipSteps({ ...ok, scenarioCount: 0, latestRun: null, gate: { ok: false, why: 'This agent has no tests yet.', action: 'scenarios' } });
    expect(by(r, 'tested')).toMatchObject({ state: 'blocked', text: 'This agent has no tests yet.' });
    expect(by(r, 'tested').action).toMatchObject({ kind: 'go', label: 'Add tests' });
    expect(by(shipSteps({ ...ok, gate: { ok: true, why: 'The latest run passed (2 of 2).', action: '' } }), 'tested').state).toBe('done');
  });

  it('changes since the published version ask for a publish', () => {
    const r = shipSteps({ ...ok, published: { version: '0.1.1', changes: 3 } });
    expect(by(r, 'published').state).toBe('todo');
    expect(r.next?.action?.kind).toBe('publish');
    expect(by(r, 'published').text).toMatch(/3 changes/);
  });

  it('changes that could not be counted are said, not guessed', () => {
    expect(by(shipSteps({ ...ok, published: { version: '0.1.1', changes: null } }), 'published').text).toMatch(/could not be counted/);
  });

  it('nothing published yet: publish, then deploy waits', () => {
    const r = shipSteps({ ...ok, published: null, deployed: {} });
    expect(by(r, 'published').state).toBe('todo');
    expect(by(r, 'deployed').text).toMatch(/Publish first/);
    expect(by(r, 'deployed').action).toBeUndefined();
  });

  it('an older version running is not the newest being deployed, and says which runs where', () => {
    const r = shipSteps({ ...ok, deployed: { development: '0.1.0' } });
    expect(by(r, 'deployed').state).toBe('todo');
    expect(by(r, 'deployed').text).toMatch(/older version \(development: v0\.1\.0\)/);
    expect(r.next?.action).toMatchObject({ kind: 'go', target: { stage: 'release', focus: 'deploy' } });
    const mixed = shipSteps({ ...ok, deployed: { staging: '0.1.1', production: '0.1.0' } });
    expect(by(mixed, 'deployed').text).toBe('v0.1.1 runs in staging. production runs v0.1.0.');
  });
});
