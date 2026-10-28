// "Questions it couldn't answer": what callers asked that the agent dodged, didn't know or passed on, from real calls,
// with wordings of one question grouped and counted so the most asked come first. Answering adds a line to the draft's
// instructions (and optionally a test); nothing is sent. Pure: no network, no DOM, no clock of its own.

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// ---- what counts as "not answered"

// The agent saying it does not know, cannot help, or has nothing on it.
const DID_NOT_KNOW = new RegExp(
  [
    "\\bi(?:'m| am) (?:not sure|unsure|afraid i (?:don't|do not|can't|cannot))",
    "\\bi (?:don't|do not|can't|cannot) (?:know|tell|say|answer|help with|find|see|confirm)",
    "\\bi (?:don't|do not) have (?:that|this|any|the|information|details|access)",
    '\\b(?:no|not any) (?:information|details|answer) (?:on|about|for)',
    '\\bnot (?:something|a question) i can (?:help|answer)',
    '\\boutside (?:of )?what i can',
    '\\bunable to (?:help|answer|find|confirm|say)',
    "\\bisn't something i (?:can|know)",
    '\\bnot able to (?:help|answer|find|confirm)',
  ].join('|'),
  'i',
);
// The agent passing the caller on.
const PASSED_ON =
  /\b(?:pass(?:ing)? you|transfer(?:ring)? you|put(?:ting)? you through|connect(?:ing)? you|hand(?:ing)? you (?:over|to)|someone (?:who|that) can help|a colleague)\b/i;
// A caller asking for a person outright is not a gap in what the agent knows. One alternative per way of asking.
export const WANTS_A_PERSON =
  // eslint-disable-next-line sonarjs/regex-complexity -- one list of ways to say it
  /\b(?:speak|talk|chat)\s+(?:to|with)\s+(?:a|an|the|someone|somebody|real|actual|human|person|agent|representative|operator|manager|staff)\b|\b(?:real|actual|live) (?:person|human|agent)\b|\b(?:human|operator|representative)\b|\btransfer me\b|\bput me through\b/i;
// Small talk and endings are not questions.
const SMALL_TALK =
  // eslint-disable-next-line sonarjs/regex-complexity -- one list of words
  /^(?:hi|hello|hey|thanks?|thank you|ok(?:ay)?|yes|no|yeah|nope|bye|goodbye|good ?bye|that'?s all|nothing else|cheers|great|perfect|sure)[\s.!?,]*$/i;
export const HANDOFF_TOOL = /transfer|handoff|hand_off|escalat|human|callback/i;
const LOOKUP_TOOL = /search|knowledge|faq|kb|retriev|lookup|find/i;

const joinSaid = (turn) => list(turn?.said).join(' ').trim();
const emptyResult = (result) =>
  result === null ||
  result === undefined ||
  result === '' ||
  (Array.isArray(result) && result.length === 0) ||
  (isObj(result) &&
    (result.found === false ||
      result.count === 0 ||
      (Array.isArray(result.results) && result.results.length === 0) ||
      (Array.isArray(result.matches) && result.matches.length === 0) ||
      (Array.isArray(result.chunks) && result.chunks.length === 0)));

export const REASONS = {
  did_not_know: { label: 'Said it didn’t know', short: 'didn’t know' },
  passed_on: { label: 'Passed to a person', short: 'passed on' },
  not_found: { label: 'Found nothing to answer with', short: 'found nothing' },
  asked_again: { label: 'Caller had to ask again', short: 'asked again' },
  no_answer: { label: 'Call ended before an answer', short: 'no answer' },
};

// The unanswered caller turns in one call's facts (replay/callFacts.js): [{ text, reason, turnIndex, agent }]
export function unansweredTurns(facts, { cutOff = false } = {}) {
  const turns = list(facts?.turns);
  const out = [];
  turns.forEach((turn, i) => {
    const text = String(turn?.say || '').trim();
    const plain = text.replace(/[’‘]/g, "'");
    if (!text || SMALL_TALK.test(plain) || WANTS_A_PERSON.test(plain)) return;
    if (!wordsOf(text).length || text.length < 6) return;
    const reply = joinSaid(turn).replace(/[’‘]/g, "'");
    const tools = list(turn.tools);
    // a tool that broke is a fault (Alerts), not a gap in what the agent knows
    if (tools.some((t) => t.error)) return;
    let reason = '';
    if (tools.some((t) => t.handoff || HANDOFF_TOOL.test(t.tool || '')) || PASSED_ON.test(reply)) reason = 'passed_on';
    else if (DID_NOT_KNOW.test(reply)) reason = 'did_not_know';
    else if (tools.some((t) => LOOKUP_TOOL.test(t.tool || '') && emptyResult(t.result)) && !/\d/.test(reply)) reason = 'not_found';
    else if (i + 1 < turns.length && sameQuestion(text, turns[i + 1]?.say)) reason = 'asked_again';
    else if (cutOff && i === turns.length - 1 && !reply) reason = 'no_answer';
    if (reason) out.push({ text, reason, turnIndex: i, reply });
  });
  return out;
}

// ---- grouping the wordings of one question

const STOP = new Set(
  (
    'a an the and or but if of to in on at for with from by about as is are was were be been being am do does did doing done can could would should will shall may might must ' +
    'i me my mine you your yours we our us it its this that these those there here what whats which who whom whose when where why how hi hello hey please thanks thank ' +
    'just also really very so too any some much many more most get got have has had having need want like know tell let okay ok yes no not dont cant im ive id ' +
    'one take taken accept accepted available possible offer use using allow there anything something way able'
  ).split(' '),
);
const SAME = {
  shipping: 'deliver',
  ship: 'deliver',
  delivery: 'deliver',
  delivered: 'deliver',
  delivering: 'deliver',
  open: 'open',
  opening: 'open',
  hours: 'hour',
};
const stem = (word) => {
  if (SAME[word]) return SAME[word];
  let w = word;
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  return SAME[w] || w;
};
// the words that carry the meaning of a question, in a stable form
const wordsOf = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w))
    .map(stem);

export function closeness(a, b) {
  const x = new Set(Array.isArray(a) ? a : wordsOf(a));
  const y = new Set(Array.isArray(b) ? b : wordsOf(b));
  if (!x.size || !y.size) return 0;
  let shared = 0;
  x.forEach((w) => {
    if (y.has(w)) shared += 1;
  });
  // the share of the smaller one the other has: "Sunday delivery?" matches "Do you deliver on Sundays at all?". One
  // word alone ("Where is my order?") matches only a short question, not "Can you ship my order to Malaysia?".
  const small = Math.min(x.size, y.size);
  return shared / (small === 1 && Math.max(x.size, y.size) > 2 ? 2 : small);
}
export const SAME_QUESTION = 0.67;
const sameQuestion = (a, b) => closeness(a, b) >= 0.85;

// questions: [{ text, reason, bot, callId, startedAt, agent }] → groups, most asked first: [{ key, words, text (the
// most used wording), wordings: [{ text, count }], count, reasons: { reason: n },
// calls: [{ callId, bot, startedAt, text, reason }], firstAt, lastAt, agents }]
export function groupQuestions(questions) {
  const groups = [];
  [...list(questions)]
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
    .forEach((q) => {
      const words = wordsOf(q.text);
      if (!words.length) return;
      let best = null;
      let bestScore = 0;
      groups.forEach((g) => {
        const score = closeness(words, g.words);
        if (score > bestScore) {
          best = g;
          bestScore = score;
        }
      });
      if (!best || bestScore < SAME_QUESTION) {
        best = { words: [...new Set(words)], wordingCounts: new Map(), reasons: {}, calls: [], agents: new Set() };
        groups.push(best);
      }
      const shown = q.text.replace(/\s+/g, ' ').trim();
      const seen = best.wordingCounts.get(shown);
      best.wordingCounts.set(shown, { count: (seen?.count || 0) + 1, last: Math.max(seen?.last || 0, Date.parse(q.startedAt) || 0) });
      best.reasons[q.reason] = (best.reasons[q.reason] || 0) + 1;
      best.calls.push({ callId: q.callId, bot: q.bot, startedAt: q.startedAt, text: shown, reason: q.reason });
      if (q.agent) best.agents.add(q.agent);
      // a group's words grow with what its wordings share, so a third wording can join through either of the first two
      words.forEach((w) => {
        if (!best.words.includes(w) && best.words.length < 12) best.words.push(w);
      });
    });
  return groups
    .map((g) => {
      // the wording asked most, then the one asked most recently: how callers put it now
      const wordings = [...g.wordingCounts.entries()]
        .map(([text, w]) => ({ text, count: w.count, last: w.last }))
        .sort((a, b) => b.count - a.count || b.last - a.last)
        .map(({ text, count }) => ({ text, count }));
      const times = g.calls.map((c) => Date.parse(c.startedAt)).filter((t) => !Number.isNaN(t));
      // a caller who asked it twice in one call is one call: counted once, listed once
      const calls = [...new Map(g.calls.map((c) => [`${c.bot}/${c.callId}`, c])).values()].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
      const core = wordsOf(wordings[0].text);
      return {
        key: [...new Set(core)].sort().join(' '),
        words: [...new Set(core)],
        text: wordings[0].text,
        wordings,
        count: calls.length,
        reasons: g.reasons,
        calls,
        firstAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
        lastAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
        agents: [...g.agents],
      };
    })
    .sort((a, b) => b.count - a.count || Date.parse(b.lastAt) - Date.parse(a.lastAt));
}

// Every unanswered question in a set of calls.
//   calls: summaries (bot, id, started_at, status)
//   facts: { 'bot/id': facts }
export function collectQuestions(calls, facts) {
  return list(calls).flatMap((c) => {
    const f = facts[`${c.bot}/${c.id}`];
    if (!f) return [];
    return unansweredTurns(f, { cutOff: c.status === 'unfinished' }).map((q) => ({
      ...q,
      bot: c.bot,
      callId: c.id,
      startedAt: c.started_at,
      agent: f.startAgent || '',
    }));
  });
}

// ---- what the person decided about a group (kept in this browser, see insightsStore.js)

// The decision that belongs to a group: the same question asked again later still finds it, however it is worded.
export function decisionFor(group, decisions) {
  let best = null;
  let bestScore = 0;
  list(decisions).forEach((d) => {
    const score = closeness(group.words, d.words);
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  });
  return bestScore >= SAME_QUESTION ? best : null;
}
// After an answer was added: how often the question still went unanswered (not live yet, or the answer didn't help).
export const askedSince = (group, at) => (at ? group.calls.filter((c) => Date.parse(c.startedAt) > Date.parse(at)) : []);

// ---- answering: what goes into the draft

export const ruleFor = (question, answer) => `If a caller asks “${question.replace(/[“”"]/g, '').trim()}” (or something like it), answer: ${answer.trim()}`;

// The draft with the answer added to an agent's rules. Returns the same object if the rule is already there.
export function addAnswer(config, { agentId, question, answer }) {
  const items = list(config?.agents?.items);
  const index = Math.max(
    0,
    items.findIndex((a) => isObj(a) && a.id === agentId),
  );
  const agent = items[index];
  if (!isObj(agent)) return config;
  const rule = ruleFor(question, answer);
  const rules = list(agent.instructions?.rules);
  if (rules.includes(rule)) return config;
  const instructions = { ...(isObj(agent.instructions) ? agent.instructions : { role: '' }), rules: [...rules, rule] };
  const nextItems = items.map((a, i) => (i === index ? { ...a, instructions } : a));
  return { ...config, agents: { ...config.agents, items: nextItems } };
}

// The two or three longest meaningful words of an answer, as a pattern a test can look for (all of them, any order).
export function answerPattern(answer) {
  const words = [
    ...new Set(
      String(answer || '')
        .toLowerCase()
        .replace(/[’']/g, '')
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 4 && !STOP.has(w)),
    ),
  ]
    .sort((a, b) => b.length - a.length)
    .slice(0, 2);
  if (!words.length) return '.+';
  return words.map((w) => `(?=[\\s\\S]*${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`).join('');
}

const slug = (text) =>
  wordsOf(text)
    .slice(0, 4)
    .join('_')
    .replace(/[^a-z0-9_]/g, '') || 'question';

// A test that asks the question and expects the answer (and, when the question used to be passed on, that it is not).
export function testFor(config, { question, answer, agentId, wasPassedOn }) {
  const channels = list(config?.channels).filter((c) => isObj(c) && c.id);
  const channel = (channels.find((c) => c.enabled !== false) || channels[0])?.id || '';
  const taken = new Set(list(config?.tests).map((t) => t?.id));
  const base = `answers_${slug(question)}`;
  let id = base;
  let n = 2;
  while (taken.has(id)) {
    id = `${base}_${n}`;
    n += 1;
  }
  const expect = [{ said_matches: answerPattern(answer) }];
  if (wasPassedOn && agentId) expect.push({ agent_is: agentId });
  return {
    id,
    description: `Callers asked “${question.trim()}” and were not answered. It should be answered now.`,
    channel,
    turns: [{ say: question.trim() }],
    expect,
  };
}

export function addTest(config, test) {
  return { ...config, tests: [...list(config?.tests), test] };
}

// Takes back an answer added from the questions page: its rule and the test made with it. The rest of the draft stays.
export function removeAnswer(config, { agentId, rule, testId }) {
  let next = config;
  const items = list(config?.agents?.items);
  if (rule && items.some((a) => isObj(a) && a.id === agentId && list(a.instructions?.rules).includes(rule))) {
    const without = (a) => {
      const { rules: all, ...instructions } = a.instructions;
      const rules = all.filter((r) => r !== rule);
      // a list the answer started goes with it
      return { ...a, instructions: rules.length ? { ...instructions, rules } : instructions };
    };
    next = { ...next, agents: { ...next.agents, items: items.map((a) => (isObj(a) && a.id === agentId ? without(a) : a)) } };
  }
  if (testId && list(next?.tests).some((t) => t?.id === testId)) {
    const { tests: all, ...rest } = next;
    const tests = all.filter((t) => t?.id !== testId);
    next = tests.length ? { ...rest, tests } : rest;
  }
  return next;
}

// Whether an answer added earlier is still in the draft (someone may have edited it out since).
export const answerInDraft = (config, { agentId, rule }) =>
  list(config?.agents?.items).some((a) => isObj(a) && (!agentId || a.id === agentId) && list(a.instructions?.rules).includes(rule));
