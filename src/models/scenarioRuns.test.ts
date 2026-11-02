import { describe, expect, it } from 'vitest';
import {
  nextSteps,
  normalizeCheck,
  normalizeHeadline,
  normalizeResult,
  normalizeRun,
  normalizeScenarioList,
  refWords,
  resultSummary,
  runTokens,
  summariseScenarios,
  testStatusOf,
  tokenWords,
  tokensOf,
  type Run,
} from './scenarioRuns';

describe('reading what the server answers', () => {
  it('reads a run, a result and a check tolerantly: a missing field is left out, never an error', () => {
    expect(normalizeCheck({ kind: 'tool_called', expect: { tool_called: 'x' }, passed: false, detail: 'not called' })).toEqual({
      kind: 'tool_called',
      expect: { tool_called: 'x' },
      passed: false,
      detail: 'not called',
    });
    expect(normalizeCheck({ passed: undefined }).passed).toBeNull();
    const empty = normalizeResult({});
    expect(empty.status).toBe('skipped');
    expect([empty.checks, empty.unmocked, empty.events]).toEqual([[], [], []]);
    const run = normalizeRun({ id: 'r1', status: 'running', config_checksum: 'abc', scenarios: [{ id: 'a', status: 'passed', checks: [{ passed: true }] }] });
    expect([run.status, run.checksum, run.passed]).toEqual(['running', 'abc', 1]);
    expect(normalizeRun(null).status).toBe('running');
    expect(normalizeRun({ scenarios: [{ id: 'a', checks: [{ passed: false }] }] }).status).toBe('failed');
    expect(normalizeResult({ unmocked: ['GET /orders/1', { method: 'post', path: '/x' }] }).unmocked).toEqual([
      { method: 'GET', path: '/orders/1' },
      { method: 'POST', path: '/x' },
    ]);
    const head = normalizeHeadline({ id: 'r', status: 'failed', counts: { total: 4, passed: 2, failed: 1, error: 0, skipped: 1 } });
    expect([head.total, head.passed, head.failed, head.skipped]).toEqual([4, 2, 1, 1]);
  });

  it('takes a run id written either way, and the paid options from either place', () => {
    expect(normalizeRun({ run_id: 'r9' }).id).toBe('r9');
    expect(normalizeRun({ id: 'r8', run_id: 'r9' }).id).toBe('r8');
    expect(normalizeRun({ options: { live: true } }).live).toBe(true);
    expect(normalizeRun({ judge: true }).judge).toBe(true);
  });

  it('reads GET /tests whichever way the last result is named, and works out scripted or live', () => {
    const list = normalizeScenarioList({
      ref: 'draft',
      network_allowed: false,
      scenarios: [
        { id: 'a', model_script: ['hi'], last: { status: 'passed', checks: [], run_id: 'r1', ran_at: '2026-10-14T10:00:00Z' } },
        { id: 'b', last_result: { status: 'failed', checks: [{ passed: false, kind: 'tool_called', detail: 'no' }] } },
        { id: 'c' },
      ],
    });
    expect(list.items.map((i) => i.result?.status ?? null)).toEqual(['passed', 'failed', null]);
    expect(list.items[0].result?.mode).toBe('scripted');
    expect(list.items[1].result?.mode).toBe('live');
    expect(list.items[0].runId).toBe('r1');
    expect(list.networkAllowed).toBe(false);
    expect(normalizeScenarioList(null).items).toEqual([]);
  });

  it('shows a scenario the server lists as scripted as scripted, though its row carries no script', () => {
    const row = (extra: Record<string, unknown>) => ({ id: 'one', channel: 'web-chat', turns: [{ say: 'Hi' }], expect: [{ said_matches: '.' }], ...extra });
    const last = { status: 'passed', checks: [{ kind: 'said_matches', passed: true, detail: 'ok' }] };
    const { items } = normalizeScenarioList({
      ref: 'draft',
      scenarios: [row({ mode: 'scripted', last }), row({ id: 'two', mode: 'live', last }), row({ id: 'three', last })],
    });
    expect(items.map((i) => [i.scenario.id, i.result?.mode])).toEqual([
      ['one', 'scripted'],
      ['two', 'live'],
      ['three', 'live'],
    ]);
  });

  it('lets the mode in a result win over the row, and the row over a guess from the script', () => {
    expect(normalizeResult({ id: 'a', status: 'passed', mode: 'live' }, { mode: 'scripted' }).mode).toBe('live');
    expect(normalizeResult({ id: 'a', status: 'passed' }, { mode: 'scripted' }).mode).toBe('scripted');
    expect(normalizeResult({ id: 'a', status: 'passed' }, { mode: 'live', model_script: ['hi'] }).mode).toBe('live');
    expect(normalizeResult({ id: 'a', status: 'passed' }, { model_script: ['hi'] }).mode).toBe('scripted');
    expect(normalizeResult({ id: 'a', status: 'passed' }, { model_script: [] }).mode).toBe('live');
    expect(normalizeResult({ id: 'a', status: 'passed' }, { mode: 'something else' }).mode).toBe('live');
  });
});

describe('what a result says', () => {
  it('says in one line what happened, and what to do next', () => {
    const failed = normalizeResult({
      status: 'failed',
      checks: [
        { passed: false, kind: 'http_not_called', detail: 'made it' },
        { passed: null, kind: 'judge', detail: 'skipped' },
      ],
      unmocked: ['GET /orders/9'],
    });
    expect(resultSummary(failed)).toMatch(/1 check failed, and 1 request was not answered by any mock/);
    const steps = nextSteps(failed, { id: 'x', model_script: ['a'] });
    expect(steps.map((s) => s.kind)).toEqual(['mock', 'http', 'live']);
    expect(steps[0].text).toMatch(/GET \/orders\/9 and nothing answered it/);
    expect(resultSummary(normalizeResult({ status: 'skipped', reason: 'live' }))).toMatch(/live/);
    expect(resultSummary(normalizeResult({ status: 'error', detail: 'it broke' }))).toMatch(/it broke/);
    expect(resultSummary(normalizeResult({ status: 'passed', checks: [{ passed: true }, { passed: null }] }))).toMatch(/Passed\. 1 check was not checked here/);
    expect(resultSummary(normalizeResult({ status: 'passed', checks: [{ passed: true }] }))).toBe('Passed.');
    expect(nextSteps(normalizeResult({ status: 'skipped' }), { id: 'x' })[0].kind).toBe('live');
  });

  it('reads model use from usage or the call_ended record, sums it per run, and is null when nothing is reported', () => {
    expect(tokensOf({ usage: [], events: [] })).toBeNull();
    expect(tokensOf(undefined)).toBeNull();
    expect(
      tokensOf({
        usage: [
          { input_tokens: 100, output_tokens: 20 },
          { input_tokens: 50, output_tokens: 5 },
        ],
      }),
    ).toEqual({ input: 150, output: 25 });
    expect(
      tokensOf({ events: [{ event: 'user_said' }, { event: 'call_ended', usage: [{ type: 'llm_usage', input_tokens: 1200, output_tokens: 300 }] }] }),
    ).toEqual({
      input: 1200,
      output: 300,
    });
    expect(tokensOf({ usage: [{ model: 'x' }] })).toBeNull();
    expect(
      runTokens({ scenarios: [{ usage: [{ input_tokens: 10, output_tokens: 2 }] }, { usage: [] }, { usage: [{ input_tokens: 5, output_tokens: 1 }] }] }),
    ).toEqual({
      input: 15,
      output: 3,
    });
    expect(runTokens({ scenarios: [{ usage: [] }] })).toBeNull();
    expect(tokenWords({ input: 1234, output: 56 })).toBe('1,234 tokens in and 56 out');
  });

  it('names where a run was pointed', () => {
    expect(refWords('draft')).toBe('the saved draft');
    expect(refWords('unsaved')).toBe('your unsaved edits');
    expect(refWords('0.2.0')).toBe('version 0.2.0');
    expect(refWords('staging')).toBe('Staging');
  });
});

describe('“this exact version passed”', () => {
  const run = (extra: Partial<Run>): Run => ({
    id: 'r',
    status: 'passed',
    ref: '',
    checksum: 'abc',
    startedAt: '',
    finishedAt: '',
    live: false,
    judge: false,
    passed: 4,
    failed: 0,
    errors: 0,
    skipped: 0,
    total: 4,
    scenarios: [],
    ...extra,
  });

  it('counts a run for a version only when its checksum is the version’s', () => {
    const runs = [
      run({ id: 'r3', status: 'failed', checksum: 'bbb' }),
      run({ id: 'r2', checksum: 'aaa' }),
      run({ id: 'r1', status: 'running', checksum: 'ccc' }),
    ];
    expect(testStatusOf({ checksum: 'aaa' }, runs).state).toBe('passed');
    expect(testStatusOf({ checksum: 'bbb' }, runs).state).toBe('failed');
    expect(testStatusOf({ checksum: 'ccc' }, runs).state).toBe('none');
    expect(testStatusOf({ checksum: 'zzz' }, runs).state).toBe('none');
    expect(testStatusOf({}, runs).state).toBe('none');
    expect(testStatusOf({ checksum: 'aaa' }, []).text).toBe('Not run');
  });

  it('calls a run that left scripted ones out partial, and says which were not run', () => {
    expect(testStatusOf({ checksum: 'abc' }, [run({})], { scenarioCount: 4 }).text).toBe('Passed');
    const one = testStatusOf({ checksum: 'abc' }, [run({ passed: 1, total: 1 })], { scenarioCount: 4 });
    expect([one.state, one.text]).toEqual(['partial', '1 of 4 ran']);
    const live = testStatusOf({ checksum: 'abc' }, [run({ passed: 4, skipped: 3, total: 7 })], { scenarioCount: 7 });
    expect([live.state, live.text]).toEqual(['passed', 'Passed, 3 not run']);
    expect(testStatusOf({ checksum: 'abc' }, [run({ passed: 1, total: 1 })]).state).toBe('passed');
  });
});

describe('how the scenarios stand', () => {
  const rowOf = (id: string, mode: string, status: string | null) => ({ scenario: { id, mode }, result: status ? { status, mode } : null });
  it('counts each scenario by its own latest result: four scripted passing and three live never run are not “4 of 7”', () => {
    const seven = [
      rowOf('s1', 'scripted', 'passed'),
      rowOf('s2', 'scripted', 'passed'),
      rowOf('s3', 'scripted', 'passed'),
      rowOf('s4', 'scripted', 'passed'),
      rowOf('l1', 'live', null),
      rowOf('l2', 'live', null),
      rowOf('l3', 'live', 'skipped'),
    ];
    expect(summariseScenarios(seven)).toEqual({ total: 7, passed: 4, failed: 0, notRun: 3, liveNotRun: 3, scriptedNotRun: 0 });
    expect(summariseScenarios([rowOf('a', 'scripted', 'error'), rowOf('b', 'scripted', null)])).toMatchObject({ failed: 1, scriptedNotRun: 1 });
  });
});
