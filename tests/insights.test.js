import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDemoApi, memoryStorage } from '../src/demo/demoApi.js';
import { readCall } from '../src/studio/replay/callFacts.js';
import {
  addAnswer,
  addTest,
  answerInDraft,
  answerPattern,
  askedSince,
  closeness,
  SAME_QUESTION,
  collectQuestions,
  decisionFor,
  groupQuestions,
  removeAnswer,
  ruleFor,
  testFor,
  unansweredTurns,
} from '../src/studio/insights/questionsModel.js';
import { alertAsText, effectiveRules, evaluateAlerts, lookback, reconcile, RULES, withStatus } from '../src/studio/insights/alertsModel.js';

const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
const NOW = '2026-10-20T12:00:00.000Z';
const nowMs = Date.parse(NOW);

// The demo's calls and their facts, as the studio reads them.
async function demoData() {
  const api = createDemoApi({ storage: memoryStorage(), loadSchema: async () => schema, now: () => NOW });
  const { body: bots } = await api.handle('GET', '/bots');
  const calls = [];
  const facts = {};
  const configs = {};
  for (const bot of bots) {
    configs[bot.id] = (await api.handle('GET', `/bots/${bot.id}/draft`)).body.config;
    const listed = (await api.handle('GET', `/bots/${bot.id}/calls?limit=100&since=2026-10-01T00:00:00Z`)).body.calls;
    for (const c of listed) {
      const summary = { ...c, bot: bot.id };
      calls.push(summary);
      const page = (await api.handle('GET', `/bots/${bot.id}/calls/${c.id}?limit=500`)).body;
      facts[`${bot.id}/${c.id}`] = readCall(page.events);
    }
  }
  return { bots: bots.map((b) => ({ id: b.id, name: b.name })), calls: calls.filter((c) => c.status !== 'in_progress'), facts, configs };
}

const turn = (say, said, tools = []) => ({ say, said: [said], tools, waitMs: 1000 });

// ---------------------------------------------------------------- questions it couldn't answer

test('a question is unanswered when the agent says it does not know, passes the caller on, finds nothing, or the caller has to ask again', () => {
  const facts = {
    turns: [
      turn('Do you deliver on Sundays?', 'I’m not sure about that. Let me pass you to someone who can help.'),
      turn('Can I pay with PayPal?', 'I’m afraid I don’t have any information about payment methods.'),
      turn('Do you ship to Malaysia?', 'I couldn’t find anything about that.', [{ tool: 'search_help', result: { results: [] } }]),
      turn('Can I change the address after ordering?', 'Orders arrive in three to five days.'),
      turn('Can I change the address after I ordered?', 'Sure, I can change that for you.'),
      turn('What are your hours?', 'We are open from 9 to 5.'),
    ],
  };
  assert.deepEqual(
    unansweredTurns(facts).map((q) => [q.text, q.reason]),
    [
      ['Do you deliver on Sundays?', 'passed_on'],
      ['Can I pay with PayPal?', 'did_not_know'],
      ['Do you ship to Malaysia?', 'not_found'],
      ['Can I change the address after ordering?', 'asked_again'],
    ],
  );
});

test('asking for a person, small talk, and a tool that broke are not questions the agent could not answer', () => {
  const facts = {
    turns: [
      turn('I want to speak to a real person', 'I’ll put you through now.', [{ tool: 'transfer_or_callback', handoff: '' }]),
      turn('Thanks', 'You’re welcome.'),
      turn('Where is my order?', 'I can’t reach the order system right now.', [{ tool: 'find_order', error: 'HTTP 503' }]),
    ],
  };
  assert.deepEqual(unansweredTurns(facts), []);
});

test('the last question of a call that was cut off before an answer counts, but only when the call was cut off', () => {
  const facts = { turns: [turn('Is the store open on public holidays?', '')] };
  facts.turns[0].said = [];
  assert.deepEqual(
    unansweredTurns(facts, { cutOff: true }).map((q) => q.reason),
    ['no_answer'],
  );
  assert.deepEqual(unansweredTurns(facts, { cutOff: false }), []);
});

test('different wordings of one question are grouped, counted, and the most used wording names the group', () => {
  const q = (text, hoursAgo, reason = 'passed_on') => ({
    text,
    reason,
    bot: 'a',
    callId: `c${hoursAgo}`,
    startedAt: new Date(nowMs - hoursAgo * 3600e3).toISOString(),
  });
  const groups = groupQuestions([
    q('Do you deliver on Sundays?', 1),
    q('Can you deliver on a Sunday?', 2),
    q('Is Sunday delivery available?', 3),
    q('Do you deliver on Sundays?', 4, 'did_not_know'),
    q('Can I pay with PayPal?', 5),
    q('Do you take PayPal?', 6),
    q('Do you ship to Malaysia?', 7),
  ]);
  assert.deepEqual(
    groups.map((g) => [g.text, g.count]),
    [
      ['Do you deliver on Sundays?', 4],
      ['Can I pay with PayPal?', 2],
      ['Do you ship to Malaysia?', 1],
    ],
  );
  assert.deepEqual(groups[0].reasons, { passed_on: 3, did_not_know: 1 });
  assert.equal(groups[0].calls[0].callId, 'c1', 'the newest call first');
  assert.equal(groups[0].lastAt, new Date(nowMs - 3600e3).toISOString());
  assert.ok(closeness('Do you deliver on Sundays?', 'Where is my order?') < 0.5, 'unrelated questions are far apart');
  assert.ok(closeness('Where is my order?', 'Can you ship my order to Malaysia?') < SAME_QUESTION, 'one shared word is not the same question as a long one');
  assert.ok(closeness('PayPal?', 'Can I pay with PayPal?') >= SAME_QUESTION, 'but it is the same as a short one');
  const twice = groupQuestions([q('Do you deliver on Sundays?', 1), { ...q('Sunday delivery?', 1, 'asked_again') }]);
  assert.equal(twice[0].count, 1, 'asked twice in one call is one call');
  assert.equal(twice[0].calls.length, 1);
});

test('a decision follows its question however it is worded later, and what was asked since an answer is counted', () => {
  const groups = groupQuestions([
    { text: 'Is Sunday delivery available?', reason: 'passed_on', bot: 'a', callId: 'late', startedAt: new Date(nowMs - 3600e3).toISOString() },
    { text: 'Do you deliver on Sundays?', reason: 'passed_on', bot: 'a', callId: 'early', startedAt: new Date(nowMs - 48 * 3600e3).toISOString() },
  ]);
  const decision = { words: ['deliver', 'sunday'], text: 'Do you deliver on Sundays?', kind: 'answered', at: new Date(nowMs - 24 * 3600e3).toISOString() };
  assert.equal(decisionFor(groups[0], [decision]), decision);
  assert.equal(decisionFor(groups[0], [{ ...decision, words: ['paypal', 'pay'] }]), null);
  assert.deepEqual(
    askedSince(groups[0], decision.at).map((c) => c.callId),
    ['late'],
  );
});

test('answering adds one rule to the agent that should know, and a test that asks the question and looks for the answer', () => {
  const config = {
    channels: [{ id: 'web-chat', type: 'web_chat', enabled: true }],
    agents: {
      entry: 'front',
      items: [
        { id: 'front', name: 'Front', instructions: { role: 'Help.', rules: ['Be brief.'] } },
        { id: 'billing', name: 'Billing', instructions: { role: 'Bills.' } },
      ],
    },
    tests: [{ id: 'answers_deliver_sunday', channel: 'web-chat', turns: [{ say: 'x' }], expect: [] }],
  };
  const answer = 'Yes, we deliver on Sundays between 10 am and 4 pm.';
  const next = addAnswer(config, { agentId: 'billing', question: 'Do you deliver on Sundays?', answer });
  assert.deepEqual(next.agents.items[0], config.agents.items[0], 'the other agent is untouched');
  assert.deepEqual(next.agents.items[1].instructions.rules, [ruleFor('Do you deliver on Sundays?', answer)]);
  assert.equal(addAnswer(next, { agentId: 'billing', question: 'Do you deliver on Sundays?', answer }), next, 'the same rule twice is one rule');
  const t = testFor(next, { question: 'Do you deliver on Sundays?', answer, agentId: 'front', wasPassedOn: true });
  assert.equal(t.id, 'answers_deliver_sunday_2', 'a free id');
  assert.equal(t.channel, 'web-chat');
  assert.deepEqual(t.turns, [{ say: 'Do you deliver on Sundays?' }]);
  assert.deepEqual(t.expect[1], { agent_is: 'front' }, 'no longer passed on');
  const pattern = new RegExp(t.expect[0].said_matches, 'i');
  assert.ok(pattern.test(answer), 'the test passes on the answer');
  assert.ok(!pattern.test('I am not sure, let me pass you on.'), 'and fails on a dodge');
  assert.equal(answerPattern(''), '.+');
  assert.equal(addTest(next, t).tests.length, 2);
  // taken back: the draft is as it was, to the letter (no empty list left where the answer started one)
  const fresh = testFor({ ...config, tests: undefined }, { question: 'Do you deliver on Sundays?', answer, agentId: 'billing' });
  const { tests: _none, ...noTests } = config;
  const answered = addTest(addAnswer(noTests, { agentId: 'billing', question: 'Do you deliver on Sundays?', answer }), fresh);
  const back = removeAnswer(answered, { agentId: 'billing', rule: ruleFor('Do you deliver on Sundays?', answer), testId: fresh.id });
  assert.equal(JSON.stringify(back), JSON.stringify(noTests));
  assert.ok(answerInDraft(answered, { agentId: 'billing', rule: ruleFor('Do you deliver on Sundays?', answer) }));
  assert.ok(!answerInDraft(back, { agentId: 'billing', rule: ruleFor('Do you deliver on Sundays?', answer) }));
});

test('demo: the made-up calls give each agent the same unanswered questions to work on, the most asked first', async () => {
  const { calls, facts } = await demoData();
  const mine = calls.filter((c) => c.bot === 'bookings');
  const groups = groupQuestions(collectQuestions(mine, facts));
  assert.deepEqual(
    groups.slice(0, 4).map((g) => [g.text, g.count]),
    [
      ['Do you deliver on Sundays?', 5],
      ['Can I pay with PayPal?', 3],
      ['Is there a student discount?', 2],
      ['Do you ship to Malaysia?', 2],
    ],
  );
  assert.ok(
    groups.some((g) => g.reasons.asked_again),
    'one the caller had to ask twice',
  );
});

// ---------------------------------------------------------------- alerts

const summary = (bot, id, minutesAgo, extra = {}) => ({
  bot,
  id,
  started_at: new Date(nowMs - minutesAgo * 60e3).toISOString(),
  status: 'ended',
  handoffs: 0,
  ...extra,
});

test('a tool failing on enough calls in the window is an alert, with the error and the calls it failed in', () => {
  const calls = [summary('a', '1', 5), summary('a', '2', 10), summary('a', '3', 20), summary('a', '4', 50)];
  const failed = { turns: [{ say: 'x', said: [], tools: [{ tool: 'find_order', error: 'HTTP 503' }] }], errors: [] };
  const facts = Object.fromEntries(calls.map((c) => [`a/${c.id}`, failed]));
  const alerts = evaluateAlerts({ calls, facts, bots: [{ id: 'a', name: 'Acme' }], nowMs });
  const tool = alerts.find((a) => a.rule === 'tool_failing');
  assert.equal(tool.title, '“find_order” is failing');
  assert.equal(tool.detail, 'It failed on 3 calls in the last 30 minutes (HTTP 503).');
  assert.deepEqual(tool.callIds, ['1', '2', '3'], 'the call 50 minutes ago is outside the window');
  assert.equal(tool.severity, 'critical');
  assert.deepEqual(tool.action, { kind: 'tool', tool: 'find_order' });
  // two failures are not enough
  assert.equal(evaluateAlerts({ calls: calls.slice(0, 2), facts, bots: [{ id: 'a' }], nowMs }).filter((a) => a.rule === 'tool_failing').length, 0);
  // and a person can raise the bar, or turn the rule off
  assert.equal(
    evaluateAlerts({ calls, facts, nowMs, rules: effectiveRules({ tool_failing: { params: { count: 4 } } }) }).filter((a) => a.rule === 'tool_failing').length,
    0,
  );
  assert.equal(
    evaluateAlerts({ calls, facts, nowMs, rules: effectiveRules({ tool_failing: { enabled: false } }) }).filter((a) => a.rule === 'tool_failing').length,
    0,
  );
});

test('a spike of cut-off calls is an alert only over enough calls and well above the agent’s usual', () => {
  const recent = [
    summary('a', 'r1', 5, { status: 'unfinished' }),
    summary('a', 'r2', 10, { status: 'unfinished' }),
    summary('a', 'r3', 15),
    summary('a', 'r4', 20),
  ];
  const quietWeek = Array.from({ length: 20 }, (_, i) => summary('a', `w${i}`, 60 * 24 + i * 60));
  const cut = evaluateAlerts({ calls: [...recent, ...quietWeek], nowMs }).find((a) => a.rule === 'cut_off');
  assert.equal(cut.title, '50% of calls were cut off');
  assert.equal(cut.detail, '2 of 4 calls in the last hour; usually 0%.');
  // the same share is normal for an agent that is always cut off this often
  const roughWeek = quietWeek.map((c, i) => (i % 2 ? { ...c, status: 'unfinished' } : c));
  assert.equal(evaluateAlerts({ calls: [...recent, ...roughWeek], nowMs }).filter((a) => a.rule === 'cut_off').length, 0);
  // three calls are too few to say
  assert.equal(evaluateAlerts({ calls: [...recent.slice(0, 3), ...quietWeek], nowMs }).filter((a) => a.rule === 'cut_off').length, 0);
});

test('no calls for hours where there usually are some is an alert; an agent that rarely gets calls is left alone', () => {
  const busyWeek = Array.from({ length: 7 * 48 }, (_, i) => summary('a', `b${i}`, 60 * 4 + i * 30)); // two an hour until four hours ago
  const silent = evaluateAlerts({ calls: busyWeek, bots: [{ id: 'a', name: 'Acme' }], nowMs }).find((a) => a.rule === 'no_calls');
  assert.equal(silent.detail, 'No calls in the last 3 hours; it usually gets about 6 in that time.');
  const rare = busyWeek.filter((_, i) => i % 48 === 0);
  assert.equal(evaluateAlerts({ calls: rare, bots: [{ id: 'a' }], nowMs }).filter((a) => a.rule === 'no_calls').length, 0);
});

test('slow answers and recorded errors are alerts', () => {
  const calls = [summary('a', '1', 5), summary('a', '2', 15), summary('a', '3', 25)];
  const slow = { turns: [{ say: 'x', said: ['y'], tools: [], waitMs: 12000 }], errors: ['The model timed out'] };
  const facts = Object.fromEntries(calls.map((c) => [`a/${c.id}`, slow]));
  const alerts = evaluateAlerts({ calls, facts, nowMs });
  assert.match(alerts.find((a) => a.rule === 'slow').detail, /One answer in ten took 12\.0 s or more in the last hour \(over 3 answers\)/);
  assert.match(alerts.find((a) => a.rule === 'errors').detail, /3 calls recorded an error in the last 30 minutes, for example: The model timed out/);
  // a voice call's wait as Speed measures it (with making sure the caller finished) is the one that counts, not the bare gap between the words
  const voice = { turns: [{ say: 'x', said: ['y'], tools: [], waitMs: 7000 }], errors: [], waits: [{ ms: 9500, say: 'x' }] };
  const heard = evaluateAlerts({ calls, facts: Object.fromEntries(calls.map((c) => [`a/${c.id}`, voice])), nowMs }).find((a) => a.rule === 'slow');
  assert.match(heard.detail, /took 9\.5 s or more/);
});

test('an alert still open stays in the record however old it is and however many others came and went, so it never fires again as new', () => {
  const long = { key: 'tool_failing|a|x', rule: 'tool_failing', severity: 'critical', bot: 'a', botName: 'A', title: 'T', detail: 'D', count: 3 };
  let { state } = reconcile({ history: [], acks: {} }, [long], nowMs);
  let fired;
  state = { ...state, acks: { [long.key]: { at: NOW, by: 'Sam' } } };
  // 250 short alerts fire and clear while it stays open, over more than the 30 days the record keeps
  for (let i = 0; i < 250; i += 1) {
    const t = nowMs + (i + 1) * 4 * 3600e3;
    const flap = { ...long, key: `flap|${i}`, rule: 'slow' };
    ({ state } = reconcile(state, [long, flap], t));
    ({ state, fired } = reconcile(state, [long], t + 60e3));
    assert.equal(fired.length, 0, 'the long one never fires again');
  }
  assert.ok(
    state.history.some((h) => h.key === long.key && !h.clearedAt),
    'still open in the record',
  );
  assert.ok(state.acks[long.key], 'and still acknowledged');
  assert.ok(state.history.length <= 200);
});

test('a check of one workspace leaves the alerts of another workspace’s agents as they were (not cleared, still acknowledged)', () => {
  const theirs = { key: 'tool_failing|a|find_order', rule: 'tool_failing', severity: 'critical', bot: 'a', botName: 'Acme', title: 'T', detail: 'D', count: 3 };
  let { state } = reconcile({ history: [], acks: {} }, [theirs], nowMs, new Set(['a']));
  state = { ...state, acks: { [theirs.key]: { at: NOW, by: 'Sam' } } };
  // the other workspace has one agent, "b", with nothing wrong
  ({ state } = reconcile(state, [], nowMs + 60e3, new Set(['b'])));
  assert.equal(state.history[0].clearedAt, null, 'still open');
  assert.ok(state.acks[theirs.key], 'still acknowledged');
  // an empty workspace checks no agent at all
  ({ state } = reconcile(state, [], nowMs + 120e3, new Set()));
  assert.equal(state.history[0].clearedAt, null);
  // back in its own workspace, with the problem gone, it clears as before
  ({ state } = reconcile(state, [], nowMs + 180e3, new Set(['a'])));
  assert.ok(state.history[0].clearedAt);
});

test('the record of alerts: a new alert fires once, an acknowledgement holds until it clears, and a snooze runs out', () => {
  const alert = { key: 'tool_failing|a|find_order', rule: 'tool_failing', severity: 'critical', bot: 'a', botName: 'Acme', title: 'T', detail: 'D', count: 3 };
  let { state, fired } = reconcile({ history: [], acks: {} }, [alert], nowMs);
  assert.equal(fired.length, 1);
  assert.equal(state.history[0].clearedAt, null);
  ({ state, fired } = reconcile(state, [{ ...alert, count: 5, detail: 'D5' }], nowMs + 60e3));
  assert.equal(fired.length, 0, 'still the same alert');
  assert.equal(state.history[0].detail, 'D5', 'its numbers are kept up to date');
  state = { ...state, acks: { [alert.key]: { at: NOW, by: 'Sam' } } };
  assert.equal(withStatus([alert], state.acks, nowMs)[0].status, 'seen');
  ({ state } = reconcile(state, [], nowMs + 120e3));
  assert.ok(state.history[0].clearedAt, 'it cleared');
  assert.deepEqual(state.acks, {}, 'and the acknowledgement went with it');
  ({ state, fired } = reconcile(state, [alert], nowMs + 180e3));
  assert.equal(fired.length, 1, 'coming back, it is new again');
  const snoozed = { ...state, acks: { [alert.key]: { until: new Date(nowMs + 3600e3).toISOString() } } };
  assert.equal(withStatus([alert], snoozed.acks, nowMs)[0].status, 'snoozed');
  assert.equal(withStatus([alert], snoozed.acks, nowMs + 2 * 3600e3)[0].status, 'new', 'the snooze ran out');
  assert.equal(reconcile(snoozed, [alert], nowMs + 2 * 3600e3).state.acks[alert.key], undefined, 'and is forgotten');
  assert.match(alertAsText({ ...alert, severity: 'critical' }, 'https://x'), /^\[Critical\] Acme: T\nD\nhttps:\/\/x$/);
});

test('the rules: every one has words and sensible numbers, a change outside its range is held to it, and the look-back covers the longest window', () => {
  RULES.forEach((r) => {
    assert.ok(r.label && r.sentence && r.why, r.id);
    Object.keys(r.params).forEach((k) => assert.ok(r.sentence.includes(`{${k}}`), `${r.id} names ${k}`));
  });
  const rules = effectiveRules({ tool_failing: { params: { count: 0, minutes: 99999 } } });
  assert.deepEqual(rules.find((r) => r.id === 'tool_failing').params, { count: 1, minutes: 1440 });
  assert.equal(lookback(rules).recordsMs, 1440 * 60e3);
});

test('demo: Acme Support’s hand-over to a person is failing right now (a tool its draft has), Front Desk is slow, and Bookings is fine', async () => {
  const { bots, calls, facts } = await demoData();
  const alerts = evaluateAlerts({ calls, facts, bots, nowMs });
  const of = (bot) => alerts.filter((a) => a.bot === bot).map((a) => a.rule);
  assert.ok(of('acme-support').includes('tool_failing'), JSON.stringify(of('acme-support')));
  assert.equal(alerts.find((a) => a.rule === 'tool_failing').action.tool, 'escalate_to_human');
  assert.ok(of('front-desk').includes('slow'), JSON.stringify(of('front-desk')));
  assert.deepEqual(of('bookings'), []);
});
