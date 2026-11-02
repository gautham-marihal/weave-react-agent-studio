import { describe, expect, it } from 'vitest';
import type { TestRun } from '../api/types';
import { expectationLabel, latestDraftRun, readableId, runCounts, runNotes } from './testRuns';

describe('readableId', () => {
  it('turns an id into words', () => {
    expect(readableId('track_my_order')).toBe('Track my order');
    expect(readableId('smoking-hub_on_the-phone')).toBe('Smoking hub on the phone');
  });
  it('keeps an id with nothing to replace', () => {
    expect(readableId('x')).toBe('X');
    expect(readableId('__')).toBe('__');
  });
});

describe('expectationLabel', () => {
  it('names the known kinds', () => {
    expect(expectationLabel('tool_called')).toBe('uses a tool');
    expect(expectationLabel('judge')).toBe('a reviewer model grades the reply');
  });
  it('shows unknown kinds readably instead of dropping them', () => {
    expect(expectationLabel('hands_over')).toBe('hands over');
  });
});

describe('runCounts', () => {
  it('lists failures first and leaves out zeros', () => {
    expect(runCounts({ counts: { passed: 7, failed: 0, error: 0, skipped: 3 } })).toBe('7 passed · 3 skipped');
    expect(runCounts({ counts: { passed: 1, failed: 2, error: 1, skipped: 0 } })).toBe('2 failed · 1 could not run · 1 passed');
  });
  it('says when nothing ran', () => {
    expect(runCounts({ counts: { passed: 0, failed: 0, error: 0, skipped: 0 } })).toBe('no scenarios ran');
    expect(runCounts({})).toBe('no scenarios ran');
  });
});

describe('runNotes', () => {
  it('collects each distinct reason once', () => {
    const live = 'needs a live model: run with live switched on (it calls the model and costs money)';
    expect(
      runNotes({
        scenarios: [
          { id: 'a', status: 'skipped', notes: [live] },
          { id: 'b', status: 'skipped', notes: [live] },
          { id: 'c', status: 'error', notes: [], error: 'tool lookup timed out' },
        ],
      })
    ).toEqual([live, 'tool lookup timed out']);
  });
});

describe('latestDraftRun: the newest finished run of the saved draft', () => {
  const run = (over: Partial<TestRun>): TestRun => ({ run_id: 'r', status: 'passed', started_at: '2026-10-22T12:00:00+00:00', ref: 'draft', total: 2, counts: { passed: 2 }, ...over });

  it('none: null (never run)', () => {
    expect(latestDraftRun([])).toBeNull();
  });

  it('takes the newest finished draft run, whatever order the list is in', () => {
    const r = latestDraftRun([
      run({ run_id: 'old', started_at: '2026-10-20T10:00:00+00:00', status: 'failed', counts: { passed: 1 } }),
      run({ run_id: 'new', started_at: '2026-10-22T10:00:00+00:00' }),
    ]);
    expect(r).toEqual({ status: 'passed', passed: 2, total: 2, startedAt: '2026-10-22T10:00:00+00:00' });
  });

  it('skips a run still going, a run of unsaved editor contents and a run of a version', () => {
    const r = latestDraftRun([
      run({ status: 'running', started_at: '2026-10-23T10:00:00+00:00' }),
      run({ ref: 'unsaved', started_at: '2026-10-23T09:00:00+00:00' }),
      run({ ref: '0.1.0', started_at: '2026-10-23T08:00:00+00:00' }),
      run({ status: 'failed', counts: { passed: 1, failed: 1 }, started_at: '2026-10-21T10:00:00+00:00' }),
    ]);
    expect(r?.status).toBe('failed');
    expect(r?.passed).toBe(1);
  });

  it('keeps error and skipped as the server says them', () => {
    expect(latestDraftRun([run({ status: 'error', counts: {} })])?.status).toBe('error');
    expect(latestDraftRun([run({ status: 'skipped', counts: { skipped: 2 } })])).toMatchObject({ status: 'skipped', passed: 0, total: 2 });
  });
});
