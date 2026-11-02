import { describe, expect, it } from 'vitest';
import type { AgentConfig, ValidationReport } from '../types/studio';
import {
  POLICY_NOTE,
  buildChecklist,
  isSecurity,
  knowledgeRows,
  normalizePreflightKnowledge,
  runHeadline,
  secretsStatus,
  splitUnsupported,
  testStatusOf,
  verdict,
  type CheckItem,
  type RunHeadline,
} from './releaseChecklist';

const ok: ValidationReport = { valid: true, errors: [], warnings: [], secrets_required: [], unsupported: [] };
const withTests: AgentConfig = { tests: [{ id: 'a', channel: 'web-chat', turns: [{ say: 'x' }], expect: [{ said_matches: '.' }] }] };
const ids = (items: CheckItem[]) => items.map((i) => i.id);
const by = (items: CheckItem[], id: string) => items.find((i) => i.id === id);
const run = (status: string, checksum: string, extra: Partial<RunHeadline> = {}): RunHeadline => ({
  id: status + checksum,
  status,
  checksum,
  ref: '',
  startedAt: '',
  total: 3,
  passed: 3,
  failed: 0,
  errors: 0,
  skipped: 0,
  ...extra,
});

describe('what the runtime can’t do yet', () => {
  const items = [
    { feature: 'MCP server tools', where: 'tools[3]' },
    { feature: 'sensitive variable pin', where: 'state.variables.pin', severity: 'security' as const },
    { feature: 'post_call.redaction', where: 'post_call.redaction', severity: 'security' as const },
  ];
  it('security items are split from ordinary advice, and nothing is lost', () => {
    const { security, advice } = splitUnsupported(items);
    expect(security.map((i) => i.where)).toEqual(['state.variables.pin', 'post_call.redaction']);
    expect(advice.map((i) => i.where)).toEqual(['tools[3]']);
    expect([isSecurity(items[1]), isSecurity(items[0])]).toEqual([true, false]);
  });
  it('missing or odd input is nothing to report', () => {
    for (const input of [undefined, null, 'x', {}, []]) expect(splitUnsupported(input)).toEqual({ security: [], advice: [] });
  });
});

describe('secrets', () => {
  it('a key the server says is not set is marked, one it can’t know about is just listed', () => {
    const keys = { OPENAI_API_KEY: true, ANTHROPIC_API_KEY: false };
    expect(secretsStatus(['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CRM_TOKEN'], keys)).toEqual([
      { name: 'OPENAI_API_KEY', missing: false, known: true },
      { name: 'ANTHROPIC_API_KEY', missing: true, known: true },
      { name: 'CRM_TOKEN', missing: false, known: false },
    ]);
    expect(secretsStatus(undefined, keys)).toEqual([]);
  });
});

describe('the release checklist', () => {
  it('a plain agent gets only the lines that apply', () => {
    const items = buildChecklist({ config: {}, report: ok, version: { version: '0.1.0', checksum: 'a' }, runs: [] });
    expect(ids(items)).toEqual(['valid', 'tests']);
    expect(by(items, 'valid')?.state).toBe('ok');
    expect([by(items, 'tests')?.state, by(items, 'tests')?.text]).toEqual(['warn', 'None written']);
    expect(JSON.stringify(by(items, 'tests'))).not.toMatch(/fail/i);
  });

  it('errors, protections that aren’t enforced, and parts the runtime can’t run each get their own line', () => {
    const items = buildChecklist({
      config: withTests,
      report: {
        ...ok,
        valid: false,
        errors: [{ path: null, message: 'a' }, { path: null, message: 'b' }, { path: null, message: 'c' }, { path: null, message: 'd' }],
        unsupported: [
          { feature: 'MCP server tools', where: 'tools[3]' },
          { feature: 'Redaction', where: 'post_call', severity: 'security' },
        ],
      },
      version: { version: '1', checksum: 'x' },
      runs: [],
    });
    expect(items.slice(0, 3).map((i) => [i.id, i.state])).toEqual([
      ['valid', 'bad'],
      ['security', 'bad'],
      ['unsupported', 'warn'],
    ]);
    expect(by(items, 'valid')?.detail).toHaveLength(3);
    expect(by(items, 'security')?.note).toMatch(/looks protected and is not/);
    expect(by(items, 'unsupported')?.detail?.[0]).toMatch(/MCP server tools \(tools\[3\]\)/);
  });

  it('tests count for a version only when a run tested that exact version', () => {
    const version = { version: '0.2.0', checksum: 'bbb' };
    const tests = (runs: RunHeadline[]) => by(buildChecklist({ config: withTests, report: ok, version, runs }), 'tests');
    expect([tests([run('passed', 'bbb')])?.state, tests([run('passed', 'bbb')])?.text]).toEqual(['ok', 'Passed on this exact version (3 scenarios)']);
    const failed = tests([run('failed', 'bbb', { failed: 2, passed: 1 })]);
    expect([failed?.state, failed?.text]).toEqual(['bad', 'Failed on this exact version']);
    expect(failed?.detail?.[0]).toMatch(/2 failed, 0 broke, of 3/);
    expect(failed?.action?.target).toEqual({ stage: 'test', focus: 'scenarios' });
    const other = tests([run('passed', 'aaa')]);
    expect([other?.state, other?.text]).toEqual(['warn', 'Not run on this exact version']);
    expect(other?.detail?.[0]).toMatch(/different configuration/);
    expect(tests([])?.detail?.[0]).toMatch(/No scenario has been run yet/);
    expect(tests([run('running', 'bbb')])?.state).toBe('warn');
  });

  it('a run that covered only some scenarios is not a pass on this exact version', () => {
    const config: AgentConfig = { tests: Array.from({ length: 4 }, (_, i) => ({ id: `s${i}` })) };
    const version = { version: '0.1.0', checksum: 'bbb' };
    const tests = (r: RunHeadline) => by(buildChecklist({ config, report: ok, version, runs: [r] }), 'tests');
    expect(tests(run('passed', 'bbb', { passed: 4, total: 4 }))?.state).toBe('ok');
    const partial = tests(run('passed', 'bbb', { passed: 1, total: 1 }));
    expect(partial?.state).toBe('warn');
    expect(partial?.text).toMatch(/Only part of the tests ran on this exact version \(1 of 4 ran\)/);
    expect(tests(run('passed', 'bbb', { passed: 4, skipped: 3, total: 7 }))?.text).toMatch(/4 of 7 scenarios; 3 not run/);
  });

  it('for a draft, the latest finished run is shown, whatever it tested', () => {
    const draft = (runs: RunHeadline[]) => by(buildChecklist({ config: withTests, report: ok, runs, target: 'draft' }), 'tests');
    expect(draft([run('passed', '', { passed: 2, total: 2 })])?.state).toBe('ok');
    expect(draft([run('failed', '')])?.state).toBe('bad');
    expect(draft([run('running', '')])?.state).toBe('warn');
    expect(draft([])?.text).toBe('Not run yet');
    expect(draft([run('skipped', '')])?.state).toBe('warn');
    expect(by(buildChecklist({ config: withTests, report: ok, target: 'draft' }), 'valid')?.text).toBe('The draft passes the server’s checks.');
  });

  it('knowledge shows only when the agent has some, and says what is not read yet', () => {
    const line = (bases: unknown[]) => by(buildChecklist({ config: {}, report: ok, knowledge: knowledgeRows({ bases }) }), 'knowledge');
    expect(by(buildChecklist({ config: {}, report: ok }), 'knowledge')).toBeUndefined();
    expect([line([{ id: 'a', type: 'vector_store', index: { passages: 5 } }])?.state, line([{ id: 'a', type: 'vector_store', index: { passages: 5 } }])?.text]).toEqual(['ok', '1 base ready']);
    const unread = line([{ id: 'a', type: 'vector_store', problems: [{ problem: 'No index has been built for this base.' }] }, { id: 'b', type: 'vector_store', index: { passages: 1 } }]);
    expect([unread?.state, unread?.text]).toEqual(['bad', '1 base not read yet']);
    expect(unread?.detail?.[0]).toMatch(/a: No index has been built/);
    expect(unread?.action?.target).toEqual({ stage: 'build', section: 'knowledge' });
    expect(line([{ id: 'a', type: 'vector_store', index: { passages: 1 }, problems: ['The file x.md changed after the index was built.'] }])?.state).toBe('warn');
    expect(line([{ id: 'a', type: 'vector_store', build: { status: 'running' } }])?.text).toBe('Documents are still being read');
    expect(line([{ id: 'live', type: 'rag_api' }])?.state).toBe('ok');
    expect(knowledgeRows([{ id: 'x', type: 'vector_store', index: {} }]).map((r) => r.state)).toEqual(['ready']);
  });

  it('provider keys: a usual key the server says is missing is amber, the rest is information', () => {
    const keys = { OPENAI_API_KEY: false, ELEVEN_API_KEY: true };
    const missing = by(buildChecklist({ config: {}, report: { ...ok, secrets_required: ['OPENAI_API_KEY', 'ELEVEN_API_KEY', 'MY_CRM_TOKEN'] }, keys }), 'secrets');
    expect([missing?.state, missing?.text, missing?.detail]).toEqual(['warn', '1 key not set on the server', ['OPENAI_API_KEY']]);
    const unknown = by(buildChecklist({ config: {}, report: { ...ok, secrets_required: ['ELEVEN_API_KEY', 'MY_CRM_TOKEN'] }, keys }), 'secrets');
    expect([unknown?.state, unknown?.text]).toEqual(['info', '2 secrets needed']);
    expect(unknown?.note).toMatch(/Names only/);
  });

  it('a voice channel with call records and no notice is warned about; chat and a told caller are not', () => {
    const phone: AgentConfig = { channels: [{ id: 'phone', type: 'sip_voice', enabled: true }] };
    expect(by(buildChecklist({ config: phone, report: ok }), 'notice')?.state).toBe('warn');
    expect(by(buildChecklist({ config: { ...phone, persona: { disclosures: { recording_notice: 'This call may be recorded.' } } }, report: ok }), 'notice')).toBeUndefined();
    expect(by(buildChecklist({ config: { channels: [{ id: 'c', type: 'web_chat', enabled: true }] }, report: ok }), 'notice')).toBeUndefined();
    expect(by(buildChecklist({ config: { ...phone, observability: { session_log: { enabled: false } } }, report: ok }), 'notice')).toBeUndefined();
  });

  it('the verdict never says fine while anything is amber or red, and the list says it is only advice', () => {
    expect(verdict([{ state: 'ok' }, { state: 'info' }])).toEqual({ state: 'ok', text: 'Everything checked looks fine' });
    expect(verdict([{ state: 'ok' }, { state: 'warn' }])).toEqual({ state: 'warn', text: 'Nothing blocks it, but 1 thing to look at' });
    expect(verdict([{ state: 'bad' }, { state: 'warn' }, { state: 'warn' }])).toEqual({ state: 'bad', text: '1 thing to fix before going live, and 2 to look at' });
    expect(POLICY_NOTE).toMatch(/advice/);
  });
});

describe('tests on one exact version (the Versions chip)', () => {
  it('reads a run headline from the server’s fields', () => {
    const h = runHeadline({ run_id: 'r1', status: 'passed', config_checksum: 'c', total: 2, counts: { passed: 2 }, started_at: 't' });
    expect([h.id, h.checksum, h.passed, h.total]).toEqual(['r1', 'c', 2, 2]);
    expect(runHeadline({ id: 'r2', status: 'failed' } as never).id).toBe('r2');
  });
  it('passed, failed, partial or not run', () => {
    const v = { checksum: 'c' };
    expect(testStatusOf(v, [run('passed', 'c')]).state).toBe('passed');
    expect(testStatusOf(v, [run('error', 'c')]).text).toBe('Broke');
    expect(testStatusOf(v, [run('passed', 'c', { total: 1, passed: 1 })], { scenarioCount: 3 }).state).toBe('partial');
    expect(testStatusOf(v, [run('passed', 'other')]).state).toBe('none');
    expect(testStatusOf({}, [run('passed', 'c')]).state).toBe('none');
    expect(testStatusOf(v, [run('running', 'c'), run('failed', 'c')]).state).toBe('failed');
  });
});

describe('preflight.knowledge from a deploy', () => {
  it('is read whatever shape the list has', () => {
    expect(normalizePreflightKnowledge([{ base: 'faq', problems: [{ problem: 'No index has been built.', fix: 'Build it.' }] }])).toEqual([{ base: 'faq', problem: 'No index has been built.', fix: 'Build it.' }]);
    expect(normalizePreflightKnowledge({ faq: [{ problem: 'p' }, 'q'] })).toEqual([
      { base: 'faq', problem: 'p', fix: '' },
      { base: 'faq', problem: 'q', fix: '' },
    ]);
    expect(normalizePreflightKnowledge([{ problem: 'flat', fix: 'f' }])).toEqual([{ base: '', problem: 'flat', fix: 'f' }]);
    expect(normalizePreflightKnowledge(undefined)).toEqual([]);
  });
});

describe('the banking line', () => {
  const banking = (url = ''): AgentConfig => ({ constants: { banking_gateway_url: url }, connections: { banking_gateway: { type: 'http' } }, tools: [{ id: 'get_balance', type: 'http', connection: 'banking_gateway' }] });
  const line = (config: AgentConfig, source: Parameters<typeof buildChecklist>[0]['banking']) => buildChecklist({ config, report: null, banking: source }).find((i) => i.id === 'banking');

  it('is not there for an agent without banking', () => {
    expect(line({}, { kind: 'browser', hosts: 'mock', studio: 'sandbox' })).toBeUndefined();
  });
  it('in Live on the mock bank: a warning (not a block) that it was tested on test data, naming the address a deploy uses', () => {
    const item = line(banking('https://g.example'), { kind: 'browser', hosts: 'mock', studio: 'live' });
    expect(item?.state).toBe('warn');
    expect(item?.text).toBe('Tested on the mock bank (test data)');
    expect(item?.detail?.join(' ')).toMatch(/^Mock bank · .*test data.*BANKING_GATEWAY_TOKEN/);
    expect(item?.note).toContain('https://g.example');
  });
  it('says when the address the runtime uses is not filled in yet, and that Refresh fills it in (nobody types it)', () => {
    expect(line(banking(''), { kind: 'browser', hosts: 'mock', studio: 'sandbox' })?.text).toBe('No gateway address yet');
    expect(line(banking(''), { kind: 'browser', hosts: 'mock', studio: 'live' })?.text).toBe('No gateway address yet');
  });
  it('otherwise names where answers come from and what the server needs', () => {
    for (const studio of ['live', 'sandbox'] as const) {
      const item = line(banking('https://g.example'), { kind: 'gateway', hosts: 'live', studio });
      expect(item?.state).toBe('info');
      expect(item?.detail?.[0]).toMatch(/BANKING_GATEWAY_TOKEN/);
    }
    expect(line(banking('https://g.example'), { kind: 'browser', hosts: 'mock', studio: 'sandbox' })?.state).toBe('info');
  });
});
