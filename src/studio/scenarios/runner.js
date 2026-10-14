// Runs test scenarios. Today there is one runner, the SIMULATED one: it plays each scenario against the simulated agent
// (demo/simulatedAgent.js), which answers by simple rules. So a run checks that the scenarios are well formed and shows how they read,
// NOT whether the real agent would pass: a real run needs a runtime that can play a conversation and a model to grade `judge`
// criteria, and the API has no endpoint for that yet. Every result says which runner made it.
//
// When such an endpoint exists, add a runner here with the same signature (`run(config, scenario) -> result`) and `RUNNERS.live`
// becomes available; the screen already shows the choice. Pure: no network, no DOM.

import { createSimulatedAgent } from '../../demo/simulatedAgent.js';
import { isObj } from '../form/engine.js';
import { regexProblem } from './model.js';

const list = (v) => (Array.isArray(v) ? v : []);
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const RUNNERS = {
  simulated: { id: 'simulated', label: 'Simulated', available: true, what: 'Plays each scenario against a simulated agent in your browser. It checks the scenarios and how they read, not the real agent.' },
  live: { id: 'live', label: 'Real agent', available: false, what: 'Plays each scenario as a real conversation with the runtime.', reason: 'The API has no endpoint that runs test scenarios yet, so nothing can play a real conversation for them.' },
};

// result statuses of one expectation: 'passed' | 'failed' | 'unchecked' (can't be judged here) | 'error' (the expectation is broken)
function check(expectation, ctx) {
  if (!isObj(expectation)) return { status: 'error', detail: 'This expectation is not an object.' };
  if ('tool_called' in expectation) {
    const wanted = expectation.tool_called;
    const ok = ctx.calls.some((c) => c.id === wanted || c.tool === wanted);
    return { status: ok ? 'passed' : 'failed', detail: ok ? `“${wanted}” was called.` : `Expected “${wanted}” to be called. ${ctx.calls.length ? `Called: ${[...new Set(ctx.calls.map((c) => c.id))].join(', ')}.` : 'No tool was called.'}` };
  }
  if ('tool_not_called' in expectation) {
    const unwanted = expectation.tool_not_called;
    const called = ctx.calls.some((c) => c.id === unwanted || c.tool === unwanted);
    return { status: called ? 'failed' : 'passed', detail: called ? `“${unwanted}” was called, but should not have been.` : `“${unwanted}” was not called.` };
  }
  if ('state_equals' in expectation) {
    const { state, value } = isObj(expectation.state_equals) ? expectation.state_equals : {};
    if (!state) return { status: 'error', detail: 'No state variable is named.' };
    const actual = ctx.state[state];
    const ok = sameJson(actual, value) || String(actual) === String(value);
    return { status: ok ? 'passed' : 'failed', detail: ok ? `${state} is ${JSON.stringify(actual)}.` : `${state} is ${JSON.stringify(actual ?? null)}, expected ${JSON.stringify(value)}.` };
  }
  if ('said_matches' in expectation) {
    const why = regexProblem(expectation.said_matches);
    if (why) return { status: 'error', detail: `The pattern is not valid (${why}).` };
    const re = new RegExp(expectation.said_matches);
    const hit = ctx.said.find((text) => re.test(text));
    return { status: hit ? 'passed' : 'failed', detail: hit ? `The agent said “${hit.slice(0, 80)}”.` : `No agent message matches /${expectation.said_matches}/.` };
  }
  if ('judge' in expectation) return { status: 'unchecked', detail: 'Needs a language model to grade it. A simulation can’t.' };
  return { status: 'error', detail: 'Unknown kind of expectation.' };
}

// -> { id, runner, status, results: [{ expect, status, detail }], transcript: [{ role, text, tools? }], ms }
export function runScenario(config, scenario, runner = 'simulated') {
  if (runner !== 'simulated') throw new Error(RUNNERS[runner]?.reason || `There is no runner “${runner}”.`);
  const started = Date.now();
  const agent = createSimulatedAgent(config, { channelId: scenario?.channel });
  const transcript = [];
  const said = [];
  agent.greeting().forEach((m) => { transcript.push({ role: 'assistant', text: m.text }); said.push(m.text); });
  for (const turn of list(scenario?.turns)) {
    const text = String(turn?.say ?? '');
    transcript.push({ role: 'user', text });
    const out = agent.reply(text);
    out.messages.forEach((m, index) => { transcript.push({ role: 'assistant', text: m.text, tools: index === 0 ? out.toolCalls.map((c) => c.tool) : undefined }); said.push(m.text); });
    if (out.ended) break;
  }
  const ctx = { calls: agent.toolCalls, state: agent.state, said };
  const results = list(scenario?.expect).map((expect) => ({ expect, ...check(expect, ctx) }));
  const failed = results.some((r) => r.status === 'failed');
  const broken = results.some((r) => r.status === 'error');
  const status = failed ? 'failed' : broken ? 'error' : results.length && results.every((r) => r.status === 'unchecked') ? 'unchecked' : 'passed';
  return { id: scenario?.id || '', channel: scenario?.channel || '', runner, status, results, transcript, ms: Date.now() - started };
}

// Runs every scenario; one that throws is reported as an error, not lost.
export function runAll(config, scenarios, runner = 'simulated', now = () => new Date().toISOString()) {
  const results = list(scenarios).map((scenario) => {
    try { return runScenario(config, scenario, runner); } catch (error) { return { id: scenario?.id || '', channel: scenario?.channel || '', runner, status: 'error', results: [], transcript: [], detail: error.message, ms: 0 }; }
  });
  const count = (status) => results.filter((r) => r.status === status).length;
  return { id: `run_${Date.now().toString(36)}`, ranAt: now(), runner, total: results.length, passed: count('passed'), failed: count('failed'), unchecked: count('unchecked'), errors: count('error'), scenarios: results };
}
