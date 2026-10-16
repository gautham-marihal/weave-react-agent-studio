import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_SIZE, collectFacets, filterBots, metaOfConfig, paginate, sortBots } from '../src/studio/agentList.js';
import { healthFrom, healthKey, healthTitle, needsAttention } from '../src/studio/health/health.js';

// 300 generated agents, the way a big organisation has them: a few teams, a few tags, most in development, some live
const TEAMS = ['support', 'sales', 'billing', 'onboarding'];
const bots = Array.from({ length: 300 }, (_, i) => ({
  id: `agent-${String(i).padStart(3, '0')}`,
  name: `${['Care', 'Booking', 'Billing', 'Welcome'][i % 4]} agent ${i}`,
  draft_revision: 1 + (i % 5),
  draft_saved_at: new Date(Date.UTC(2026, 9, 1) + i * 3600 * 1000).toISOString(),
  latest_version: i % 3 === 0 ? `1.${i % 7}.0` : null,
  deployed: i % 10 === 0 ? { production: '1.0.0', development: '1.0.0' } : i % 3 === 0 ? { development: '1.0.0' } : {},
}));
const meta = Object.fromEntries(
  bots.map((b, i) => [
    b.id,
    {
      tags: [TEAMS[i % 4], ...(i % 7 === 0 ? ['voice'] : [])],
      owner: `team-${i % 3}`,
      health:
        i % 9 === 0
          ? { state: 'bad', parts: [{ id: 'invalid', tone: 'bad', text: '2 errors', tab: 'config' }], checked: ['validity'] }
          : i % 5 === 0
            ? { state: 'warn', parts: [{ id: 'unsupported', tone: 'warn', text: '1 won’t run' }], checked: ['validity'] }
            : { state: 'ok', parts: [], checked: ['validity'] },
    },
  ]),
);

test('300 agents are searched by words in the name or id, in any order, and nothing is lost', () => {
  assert.equal(filterBots(bots, {}, meta).matched.length, 300);
  assert.equal(filterBots(bots, { query: 'agent 17' }, meta).matched.length, 13, '17 as a word anywhere: agents 17, 117, 217 and 170 to 179');
  assert.equal(filterBots(bots, { query: '17 agent' }, meta).matched.length, 13, 'any order');
  assert.equal(filterBots(bots, { query: 'BILLING' }, meta).matched.length, 75, 'ignoring case; a quarter are billing');
  assert.equal(filterBots(bots, { query: 'agent-042' }, meta).matched[0].id, 'agent-042', 'by id');
  assert.equal(filterBots(bots, { query: 'zzz' }, meta).matched.length, 0);
});

test('filters by tag, by owner, and by needs attention narrow the list, and agents not read yet are counted, not silently dropped', () => {
  assert.equal(filterBots(bots, { tag: 'voice' }, meta).matched.length, Math.ceil(300 / 7));
  assert.equal(filterBots(bots, { owner: 'team-1' }, meta).matched.length, 100);
  const both = filterBots(bots, { tag: 'support', owner: 'team-0' }, meta).matched;
  assert.ok(both.length > 0 && both.every((b) => meta[b.id].tags.includes('support') && meta[b.id].owner === 'team-0'));
  const attention = filterBots(bots, { attention: true }, meta).matched;
  assert.ok(attention.every((b) => needsAttention(meta[b.id].health)));
  assert.equal(attention.length, bots.filter((b, i) => i % 9 === 0 || i % 5 === 0).length);
  // only the first 100 have been read
  const partial = Object.fromEntries(Object.entries(meta).slice(0, 100));
  const result = filterBots(bots, { tag: 'voice' }, partial);
  assert.equal(result.unknown, 200, 'the 200 not read yet are counted');
  assert.ok(result.matched.every((b) => partial[b.id]));
  assert.equal(filterBots(bots, { query: 'agent 1' }, partial).unknown, 0, 'a search needs nothing beyond the list');
});

test('facets list each tag and owner with how many agents have it, the most common first', () => {
  const facets = collectFacets(bots, meta);
  assert.deepEqual(
    facets.tags
      .slice(0, 4)
      .map((t) => t.value)
      .sort(),
    ['billing', 'onboarding', 'sales', 'support'],
  );
  assert.equal(facets.tags.find((t) => t.value === 'support').count, 75);
  assert.equal(facets.tags.find((t) => t.value === 'voice').count, 43);
  assert.deepEqual(facets.owners.map((o) => o.value).sort(), ['team-0', 'team-1', 'team-2']);
  assert.deepEqual(collectFacets(bots, {}), { tags: [], owners: [] });
});

test('sorting by name, recently saved and furthest along is stable and complete', () => {
  const byName = sortBots(bots, 'name');
  assert.equal(byName.length, 300);
  assert.ok(byName.every((b, i, l) => i === 0 || (l[i - 1].name || l[i - 1].id).localeCompare(b.name || b.id, undefined, { sensitivity: 'base' }) <= 0));
  const recent = sortBots(bots, 'recent');
  assert.equal(recent[0].id, 'agent-299');
  const furthest = sortBots(bots, 'stage');
  assert.ok(Object.keys(furthest[0].deployed).includes('production'), 'production first');
  assert.ok(furthest.slice(-1)[0].latest_version === null, 'unpublished last');
  assert.deepEqual(
    bots.slice(0, 2).map((b) => b.id),
    ['agent-000', 'agent-001'],
    'the input is not reordered',
  );
  assert.equal(sortBots(bots, 'nonsense')[0].id, 'agent-299', 'an unknown sort falls back to recent');
});

test('pages: 25 at a time, the last page is short, and a page past the end is the last one', () => {
  assert.equal(PAGE_SIZE, 25);
  const first = paginate(bots, 1);
  assert.deepEqual([first.rows.length, first.page, first.pages, first.from, first.to, first.total], [25, 1, 12, 1, 25, 300]);
  const last = paginate(bots, 12);
  assert.deepEqual([last.rows.length, last.from, last.to], [25, 276, 300]);
  assert.equal(paginate(bots, 99).page, 12);
  assert.equal(paginate(bots, 0).page, 1);
  const short = paginate(bots.slice(0, 60), 3);
  assert.deepEqual([short.rows.length, short.from, short.to], [10, 51, 60]);
  assert.deepEqual(paginate([], 1), { rows: [], page: 1, pages: 1, from: 0, to: 0, total: 0 });
  const seen = new Set();
  for (let p = 1; p <= 12; p += 1) paginate(bots, p).rows.forEach((b) => seen.add(b.id));
  assert.equal(seen.size, 300, 'every agent is on exactly one page');
});

test('300 agents are filtered, sorted and paged in a blink', () => {
  const started = performance.now();
  for (let i = 0; i < 100; i += 1) paginate(sortBots(filterBots(bots, { query: 'care', tag: 'support', attention: i % 2 === 0 }, meta).matched, 'name'), 2);
  assert.ok(performance.now() - started < 500, `100 passes took ${Math.round(performance.now() - started)} ms`);
});

test('tags and owner are read from the draft’s meta, and only what is really there', () => {
  assert.deepEqual(metaOfConfig({ meta: { tags: ['voice', '', 7, 'support'], owner: 'team-x' } }), { tags: ['voice', 'support'], owner: 'team-x' });
  assert.deepEqual(metaOfConfig({ meta: {} }), { tags: [], owner: '' });
  assert.deepEqual(metaOfConfig(null), { tags: [], owner: '' });
});

// ---------------------------------------------------------------- health
test('health says only what it checked: a badge for each problem, nothing for what does not apply, and never just “healthy”', () => {
  const ok = healthFrom({ config: {}, report: { valid: true, errors: [], unsupported: [] } });
  assert.deepEqual([ok.state, ok.parts, ok.checked], ['ok', [], ['validity', 'what will run']]);
  assert.match(healthTitle(ok), /^No problems found in: validity, what will run$/);
  const invalid = healthFrom({ config: {}, report: { valid: false, errors: [{}, {}, {}] } });
  assert.deepEqual([invalid.state, invalid.parts[0].text, invalid.parts[0].tab], ['bad', '3 errors', 'config']);
  const wontRun = healthFrom({
    config: {},
    report: {
      valid: true,
      unsupported: [
        { feature: 'MCP', where: 'tools[1]' },
        { feature: 'code', where: 'tools[2]' },
      ],
    },
  });
  assert.deepEqual([wontRun.state, wontRun.parts[0].text], ['warn', '2 won’t run']);
  const security = healthFrom({ config: {}, report: { valid: true, unsupported: [{ feature: 'Redaction', where: 'post_call', severity: 'security' }] } });
  assert.deepEqual([security.state, security.parts[0].text], ['bad', '1 not enforced']);
  assert.equal(healthFrom({}).state, 'unknown', 'nothing checked says so');
  assert.equal(needsAttention(undefined), false);
  assert.equal(healthTitle(undefined), 'Not checked yet');
});

test('test results and knowledge indexes add a badge only for an agent that has scenarios or knowledge', () => {
  const config = { tests: [{ id: 'a' }, { id: 'b' }], knowledge: [{ id: 'faq' }] };
  const report = { valid: true, unsupported: [] };
  const failing = healthFrom({
    config,
    report,
    tests: {
      scenarios: [
        { id: 'a', last: { status: 'failed', checks: [] } },
        { id: 'b', last: { status: 'passed', checks: [] } },
      ],
    },
  });
  assert.deepEqual(
    failing.parts.map((p) => [p.id, p.text, p.tab]),
    [['tests_failing', '1 test failing', 'scenarios']],
  );
  const neverRun = healthFrom({ config, report, tests: { scenarios: [{ id: 'a' }, { id: 'b' }] } });
  assert.deepEqual(
    neverRun.parts.map((p) => p.id),
    ['tests_not_run'],
  );
  const passing = healthFrom({
    config,
    report,
    tests: {
      scenarios: [
        { id: 'a', last: { status: 'passed' } },
        { id: 'b', last: { status: 'passed' } },
      ],
    },
  });
  assert.deepEqual(passing.parts, []);
  assert.deepEqual(passing.checked, ['validity', 'what will run', 'tests']);
  const noTests = healthFrom({ config: { knowledge: [{ id: 'faq' }] }, report, tests: { scenarios: [] } });
  assert.ok(!noTests.checked.includes('tests'), 'no scenarios, no tests badge');
  const unbuilt = healthFrom({
    config,
    report,
    tests: null,
    knowledge: { bases: [{ id: 'faq', type: 'vector_store', problems: [{ problem: 'No index has been built.' }] }], files: [] },
  });
  assert.deepEqual(
    unbuilt.parts.map((p) => [p.id, p.text, p.tab]),
    [['knowledge', '1 index to build', 'knowledge']],
  );
  assert.equal(healthKey({ id: 'x', draft_revision: 4 }), 'x@4', 'an edit (a new revision) asks again');
});
