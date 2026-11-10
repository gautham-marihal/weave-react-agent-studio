import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, dayOf, datesQuery, datesWords, monthWeeks, queryFor } from '../src/studio/calls/callModel.js';
import { buildStep, canSearch, docBase, searchProblem, searchable } from '../src/studio/agent/detailed/parts/knowledgeView.js';
import { SCORE_BANDS, normalizeSearch } from '../src/studio/knowledge/model.js';
import { lookedUpWith, readersInWords } from '../src/studio/setup/setupKnowledge.js';

// FRONTEND_GUIDE section 10, the canvas build: the Calls list's chosen days (10.3), and the Knowledge index and
// search (10.2): which build step a log names, which bases a search can ask, and what a refused search says.

test('calls: chosen days are whole local days, in either order, and one day alone is that day', () => {
  const { since, until } = datesQuery('2026-10-28', '2026-10-30');
  assert.equal(new Date(since).getTime(), new Date(2026, 9, 28).getTime(), 'from the first day’s start');
  assert.equal(new Date(until).getTime(), new Date(2026, 9, 31).getTime(), 'to the start of the day after the last');
  assert.deepEqual(datesQuery('2026-10-30', '2026-10-28'), datesQuery('2026-10-28', '2026-10-30'), 'the order of the presses does not matter');
  const one = datesQuery('2026-10-28', '');
  assert.equal(new Date(one.until) - new Date(one.since), new Date(2026, 9, 29) - new Date(2026, 9, 28), 'one day');
  assert.deepEqual(datesQuery('', ''), {}, 'nothing chosen: no dates');
  assert.deepEqual(datesQuery('28/10/2026', ''), {}, 'not a day key: no dates');
});

test('calls: the line under the calendar names the days and counts them', () => {
  assert.match(datesWords('2026-10-28', '2026-10-30'), /28 Oct to .*30 Oct · 3 days$/);
  assert.match(datesWords('2026-10-28', ''), /28 Oct · 1 day$/);
  assert.equal(datesWords('', ''), '');
});

test('calls: a month is whole weeks from Monday, with no week that is all another month', () => {
  // November 2026 starts on a Sunday: the first row is 26 Oct to 1 Nov
  const weeks = monthWeeks(2026, 10);
  assert.equal(weeks[0][0].key, '2026-10-26');
  assert.equal(weeks[0][6].key, '2026-11-01');
  assert.ok(weeks.every((week) => week.length === 7 && week.some((x) => x.inMonth)));
  assert.equal(weeks.flat().filter((x) => x.inMonth).length, 30);
  assert.equal(dayKey(dayOf('2026-02-09')), '2026-02-09', 'a key reads back the same');
  // February 2027 starts on a Monday and has exactly four weeks
  assert.equal(monthWeeks(2027, 1).length, 4);
});

test('calls: the query sends since and until only for chosen days, and no empty until otherwise', () => {
  const chosen = queryFor({ range: 'dates', from: '2026-10-28', to: '2026-10-29' }, { limit: 10 });
  assert.deepEqual(
    Object.keys(chosen).filter((k) => chosen[k] !== undefined),
    ['limit', 'since', 'until'],
  );
  assert.equal(chosen.since, datesQuery('2026-10-28', '2026-10-29').since);
  const week = queryFor({ range: '7d' }, { nowMs: Date.UTC(2026, 9, 14, 12) });
  assert.equal('until' in week, false);
  assert.equal(week.since, '2026-10-07T12:00:00.000Z');
  const none = queryFor({ range: 'dates' });
  assert.equal(none.since, undefined, 'dates not chosen yet: everything');
  assert.equal('until' in none, false);
});

test('knowledge: the build step is the furthest step any log line names, in the server’s or the demo’s words', () => {
  assert.equal(buildStep(null), 0);
  assert.equal(buildStep({ log: [] }), 0);
  assert.equal(buildStep({ log: ['Reading the files…'] }), 0);
  assert.equal(buildStep({ log: ['Reading the files… done', 'Cutting them into passages…'] }), 1, '“done” on an earlier line is not the end');
  assert.equal(buildStep({ log: ['Reading the files… done', 'Cutting them into passages… done', 'Indexing the passages…'] }), 2);
  assert.equal(buildStep({ log: ['Embedded 231 passages with text-embedding-3-small'] }), 2);
  assert.equal(buildStep({ log: ['Indexing the passages… done', 'Writing the index…'] }), 3);
  assert.equal(buildStep({ log: ['Switched in the new index'] }), 3);
});

test('knowledge: the documents’ base is the setup’s own, else the first document base; a search asks either kind', () => {
  const service = { id: 'manual', type: 'rag_api', connection: 'svc' };
  const docs = { id: 'faq', type: 'vector_store', sources: [{ type: 'file', file_id: 'a.md' }] };
  const own = { id: 'knowledge', type: 'vector_store', sources: [] };
  assert.equal(docBase({ knowledge: [service, docs, own] }).id, 'knowledge');
  assert.equal(docBase({ knowledge: [service, docs] }).id, 'faq');
  assert.equal(docBase({ knowledge: [service] }), null);
  assert.equal(docBase({}), null);
  assert.deepEqual(
    searchable({ knowledge: [service, docs, { id: 'odd', type: 'other' }, null] }).map((b) => b.id),
    ['manual', 'faq'],
  );
  assert.equal(canSearch({ knowledge: [own] }), false, 'a base with nothing in it has nothing to search');
  assert.equal(canSearch({ knowledge: [own, docs] }), true);
  assert.equal(canSearch({ knowledge: [{ ...own, sources: [{ type: 'url', url: 'https://example.com' }] }] }), true);
  assert.equal(canSearch({ knowledge: [service] }), true, 'a search service can always be asked');
});

test('knowledge: a refused search says what to do; other answers keep the server’s words', () => {
  assert.match(searchProblem({ status: 409, kind: 'conflict', message: 'No index' }, 'faq'), /no index yet.*Build it first/);
  assert.match(searchProblem({ status: 404, kind: 'not_found' }, 'help_center'), /Save the draft first.*Help center/);
  assert.equal(searchProblem({ status: 400, kind: 'invalid', message: 'The studio can’t test it here.' }, 'x'), 'The studio can’t test it here.');
  assert.equal(searchProblem(null, 'x'), 'The search didn’t work.');
});

test('knowledge: a search answer keeps what was really searched for, and the scale’s bands cover 0 to 1 in order', () => {
  const answer = normalizeSearch({ hits: [], query: 'and how long?', query_used: 'Our routers… and how long?', note: 'Made-up scores' });
  assert.equal(answer.queryUsed, 'Our routers… and how long?');
  assert.equal(answer.note, 'Made-up scores');
  assert.equal(normalizeSearch({}).queryUsed, '');
  assert.equal(SCORE_BANDS[0][0], 0);
  assert.equal(SCORE_BANDS.at(-1)[1], 1);
  SCORE_BANDS.slice(1).forEach((band, i) => assert.equal(band[0], SCORE_BANDS[i][1], 'no gap between bands'));
});

test('knowledge: the tools that search a base are said in one sentence, and readersInWords still says both', () => {
  const config = {
    knowledge: [{ id: 'faq', type: 'vector_store' }],
    tools: [{ id: 'search_faq', type: 'knowledge', source: 'faq' }],
    agents: {
      entry: 'billing',
      items: [
        { id: 'billing', tools: ['search_faq'] },
        { id: 'sales', knowledge: ['faq'] },
      ],
    },
  };
  assert.match(lookedUpWith(config, 'faq'), /^Looked up with the “Search faq” tool \(Billing\)\.$/);
  assert.equal(lookedUpWith(config, 'other'), '');
  assert.match(readersInWords(config, 'faq'), /^Read by Sales in every conversation\. Looked up with the “Search faq” tool \(Billing\)\.$/);
  assert.match(lookedUpWith({ ...config, agents: { items: [] } }, 'faq'), /no agent has it yet/);
});
