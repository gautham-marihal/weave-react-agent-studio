// The test runner, IMITATED for demo mode. The real API runs scenarios in the real runtime (with a scripted or a live model); this plays
// them with the simulated agent and a few rules, and answers in the same shapes the real API does so the screens are the same ones. It is
// a FAKE and every result says so (`notes`): a pass here means the scenario is well formed and its checks can be met by the imitation,
// not that the real bot would pass. Checks that need a model (`judge`) are never graded.
// Pure: no network, no DOM, no clock of its own (`now` is passed in).

import { createSimulatedAgent } from './simulatedAgent.js';
import { isObj } from '../studio/form/engine.js';
import { evalPath } from '../studio/form/jsonPaths.js';

const list = (v) => (Array.isArray(v) ? v : []);
const clone = (v) => JSON.parse(JSON.stringify(v));

export const DEMO_RUN_NOTE = 'Demo mode: this result was made by a simple imitation of the runtime, not by the real one.';
export const STEP_MS = 400; // how long the imitation "takes" per scenario, so results appear one by one like the real runner's

// A stable fingerprint of a config (keys sorted), so a run can say which exact config it tested and a version can be compared with it.
export function checksumOf(config) {
  const canon = (v) => (Array.isArray(v) ? v.map(canon) : isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
  const text = JSON.stringify(canon(config));
  let a = 0x811c9dc5; let b = 0x01000193;
  for (let i = 0; i < text.length; i += 1) { a ^= text.charCodeAt(i); a = Math.imul(a, 0x01000193) >>> 0; b = (Math.imul(b ^ text.charCodeAt(i), 0x85ebca6b) + i) >>> 0; }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

const wildcard = (pattern) => new RegExp(`^${String(pattern).split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
export const fillArgs = (value, args) => (typeof value === 'string'
  ? value.replace(/\{\{\s*args\.([A-Za-z_][\w-]*)\s*(?:\|[^}]*)?\}\}/g, (_, name) => (args && args[name] !== undefined ? String(args[name]) : ''))
  : Array.isArray(value) ? value.map((v) => fillArgs(v, args)) : isObj(value) ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillArgs(v, args)])) : value);
const subset = (needle, haystack) => isObj(needle) && isObj(haystack) && Object.entries(needle).every(([k, v]) => JSON.stringify(haystack[k]) === JSON.stringify(v) || String(haystack[k]) === String(v));

// the first mock that matches a request, counting `times`
function matchMock(mocks, used, request) {
  for (let i = 0; i < mocks.length; i += 1) {
    const m = mocks[i];
    if (!isObj(m)) continue;
    if (m.connection && m.connection !== request.connection) continue;
    if (m.method && m.method !== request.method) continue;
    if (!wildcard(m.path).test(request.path)) continue;
    if (m.query && !subset(m.query, request.query)) continue;
    if (m.body_contains && !subset(m.body_contains, request.body)) continue;
    if (m.times && (used[i] || 0) >= m.times) continue;
    used[i] = (used[i] || 0) + 1;
    return m;
  }
  return null;
}

function evaluateChecks(scenario, ctx, { judge, scripted }) {
  return list(scenario.expect).map((expect) => {
    const check = (kind, passed, detail) => ({ kind, expect, passed, detail });
    if (!isObj(expect)) return check('unknown', null, 'This expectation is not an object.');
    if ('tool_called' in expect) { const ok = ctx.tools.some((t) => t.tool === expect.tool_called); return check('tool_called', ok, ok ? `“${expect.tool_called}” was called.` : `not called; the model called: ${[...new Set(ctx.tools.map((t) => t.tool))].join(', ') || 'nothing'}`); }
    if ('tool_not_called' in expect) { const hit = ctx.tools.some((t) => t.tool === expect.tool_not_called); return check('tool_not_called', !hit, hit ? `“${expect.tool_not_called}” was called, but should not have been.` : `“${expect.tool_not_called}” was not called.`); }
    if ('tool_called_with' in expect) {
      const { tool, args } = expect.tool_called_with || {};
      const calls = ctx.tools.filter((t) => t.tool === tool);
      const ok = calls.some((t) => subset(args || {}, t.args || {}));
      return check('tool_called_with', ok, ok ? `“${tool}” was called with those arguments.` : calls.length ? `“${tool}” was called, but with ${JSON.stringify(calls[0].args)}.` : `“${tool}” was not called.`);
    }
    if ('state_equals' in expect) {
      const { state, value } = expect.state_equals || {};
      const actual = ctx.state[state];
      const ok = JSON.stringify(actual) === JSON.stringify(value) || String(actual) === String(value);
      return check('state_equals', ok, ok ? `${state} is ${JSON.stringify(actual)}.` : `${state} is ${JSON.stringify(actual ?? null)}, expected ${JSON.stringify(value)}.`);
    }
    if ('said_matches' in expect) {
      let re; try { re = new RegExp(expect.said_matches, 'i'); } catch { return check('said_matches', null, 'The pattern is not a valid regular expression.'); }
      const hit = ctx.said.find((t) => re.test(t));
      return check('said_matches', !!hit, hit ? `The agent said “${hit.slice(0, 80)}”.` : `No agent message matches /${expect.said_matches}/.`);
    }
    if ('agent_is' in expect) return check('agent_is', ctx.agent === expect.agent_is, ctx.agent === expect.agent_is ? `${ctx.agent} was in charge at the end.` : `${ctx.agent || 'no agent'} was in charge at the end, not ${expect.agent_is}.`);
    if ('http_called' in expect) {
      const e = expect.http_called || {};
      const hits = ctx.http.filter((h) => (!e.method || h.method === e.method) && wildcard(e.path || '').test(h.path));
      const ok = e.times ? hits.length === e.times : hits.length > 0;
      return check('http_called', ok, ok ? `${hits.length} matching request${hits.length === 1 ? '' : 's'}.` : e.times ? `${hits.length} matching requests, expected ${e.times}.` : 'No such request was made.');
    }
    if ('http_not_called' in expect) {
      const e = expect.http_not_called || {};
      const hits = ctx.http.filter((h) => (!e.method || h.method === e.method) && wildcard(e.path || '').test(h.path));
      return check('http_not_called', hits.length === 0, hits.length ? `The bot made ${hits[0].method} ${hits[0].path}.` : 'No such request was made.');
    }
    if ('judge' in expect) return check('judge', null, scripted ? 'Needs a live model, so it is skipped in a scenario with a model script.' : judge ? 'Demo mode has no model to grade this.' : 'Grading is off for this run: turn on “grade reviewer checks”.');
    return check('unknown', null, 'The demo runner does not know this kind of check.');
  });
}

// One scenario -> the result the API would give.
export function runScenarioDemo(config, scenario, { live = false, judge = false } = {}) {
  const scripted = list(scenario?.model_script).length > 0;
  const mode = scripted ? 'scripted' : 'live';
  const base = { id: scenario?.id || '', mode, transcript: [], tools: [], http: [], unmocked: [], final_agent: '', final_state: {}, events: [], notes: [DEMO_RUN_NOTE] };
  if (!scripted && !live) return { ...base, status: 'skipped', checks: [], reason: 'This scenario has no model script, so it is a live one: it runs only when live scenarios are included (it calls a paid model).' };

  const agents = list(config?.agents?.items);
  const toolsById = Object.fromEntries(list(config?.tools).map((t) => [t?.id, t]));
  const sim = createSimulatedAgent(config, { channelId: scenario?.channel, state: isObj(scenario?.state) ? scenario.state : undefined });
  let agent = agents.find((a) => a?.id === config?.agents?.entry)?.id || agents[0]?.id || '';
  const state = { ...sim.state, ...(isObj(scenario?.state) ? scenario.state : {}) };
  const transcript = []; const tools = []; const http = []; const unmocked = []; const said = []; const events = [];
  const used = {};
  let seq = 0; let clock = 0;
  const event = (name, fields) => { seq += 1; clock += 0.4; events.push({ t: '', seq, elapsed_s: Math.round(clock * 1000) / 1000, event: name, ...fields }); };
  event('call_started', { bot: config?.meta?.id, channel: { id: scenario?.channel }, caller: scenario?.caller?.phone || null });
  event('agent_entered', { agent, first: true });
  sim.greeting().forEach((m) => { transcript.push({ role: 'assistant', text: m.text }); said.push(m.text); event('agent_said', { text: m.text, interrupted: false }); });

  const script = [...list(scenario?.model_script)];
  const runTool = (name, args) => {
    const tool = toolsById[name];
    const handoff = list(agents.find((a) => a?.id === agent)?.handoffs).find((h) => h?.tool === name);
    const record = { tool: name, args: args || {}, output: null, error: null };
    event('tool_called', { tool: name, args: args || {} });
    if (handoff) { agent = handoff.to; record.output = { handoff_to: handoff.to }; event('agent_entered', { agent, first: false }); }
    else if (tool?.type === 'http' && isObj(tool.request)) {
      const request = { method: tool.request.method || 'GET', path: String(fillArgs(tool.request.path || '/', args)), query: fillArgs(tool.request.query || {}, args), body: fillArgs(tool.request.body, args), connection: tool.connection };
      const mock = matchMock(list(scenario?.http_mocks), used, request);
      const status = mock ? (mock.status ?? 200) : 404;
      http.push({ method: request.method, path: request.path, status, mocked: !!mock, connection: request.connection });
      event('http_request', { method: request.method, path: request.path, status, ms: 1, mocked: !!mock });
      if (!mock) unmocked.push({ method: request.method, path: request.path, connection: request.connection, query: request.query });
      const json = mock ? (mock.json !== undefined ? mock.json : mock.text) : null;
      record.output = json ?? null;
      if (status >= 400) record.error = `HTTP ${status}`;
      else if (isObj(tool.result?.to_state)) Object.entries(tool.result.to_state).forEach(([variable, path]) => { const found = evalPath(json, path); if (found.length) { state[variable] = found[0]; event('state_changed', { name: variable, value: found[0] }); } });
    } else if (tool?.builtin === 'end_call') record.output = { ended: true };
    tools.push(record);
    return record;
  };

  for (const turn of list(scenario?.turns)) {
    const textIn = String(turn?.say ?? '');
    transcript.push({ role: 'user', text: textIn });
    event('user_said', { text: textIn });
    if (scripted) {
      // the model's replies, one item at a time, until it says something (that ends its turn)
      while (script.length) {
        const item = script.shift();
        if (typeof item === 'string') { transcript.push({ role: 'assistant', text: item }); said.push(item); event('agent_said', { text: item, interrupted: false }); break; }
        if (isObj(item) && item.tool) runTool(item.tool, item.args);
      }
    } else {
      const out = sim.reply(textIn);
      out.toolCalls.forEach((c) => runTool(c.id || c.tool, c.args));
      out.messages.forEach((m) => { transcript.push({ role: 'assistant', text: m.text }); said.push(m.text); event('agent_said', { text: m.text, interrupted: false }); });
      if (out.handoff) agent = out.handoff;
    }
  }
  event('session_closed', { reason: 'scenario_finished', error: null });
  const finalAgent = scripted ? agent : (sim.currentAgent || agent);
  const checks = evaluateChecks(scenario, { tools, state: scripted ? state : { ...state, ...sim.state }, said, http, agent: finalAgent }, { judge, scripted });
  return {
    ...base,
    status: checks.some((c) => c.passed === false) ? 'failed' : 'passed',
    checks, transcript, tools, http, unmocked, final_agent: finalAgent, final_state: scripted ? state : { ...state, ...sim.state }, events,
    notes: scripted ? [DEMO_RUN_NOTE] : [DEMO_RUN_NOTE, 'This live scenario was played by the simulated agent: no real model was called.'],
  };
}

const aggregate = (results) => (results.some((r) => r.status === 'error') ? 'error' : results.some((r) => r.status === 'failed') ? 'failed' : results.every((r) => r.status === 'skipped') ? 'skipped' : 'passed');

// A run: every result is computed now, and `visible` hides the ones that "haven't finished yet" so results appear one by one.
export function createRun({ id, config, ref, body, startedAt, stepMs = STEP_MS }) {
  const ids = list(body?.scenarios);
  const all = list(config?.tests).filter(isObj);
  const chosen = ids.length ? all.filter((s) => ids.includes(s.id)) : all;
  const results = chosen.map((scenario) => {
    try { return runScenarioDemo(config, scenario, { live: body?.live === true, judge: body?.judge === true }); } catch (error) { return { id: scenario.id, mode: 'scripted', status: 'error', detail: error.message, checks: [], transcript: [], tools: [], http: [], unmocked: [], final_agent: '', final_state: {}, events: [], notes: [DEMO_RUN_NOTE] }; }
  });
  return { id, ref, config_checksum: checksumOf(config), started_at: startedAt, live: body?.live === true, judge: body?.judge === true, runner: 'demo', stepMs, results };
}

// What the API would answer for a run at `nowMs`: the scenarios finished so far, and `running` until all are.
export function viewRun(run, nowMs) {
  const elapsed = nowMs - Date.parse(run.started_at);
  const done = run.stepMs <= 0 ? run.results.length : Math.min(run.results.length, Math.max(0, Math.floor(elapsed / run.stepMs)));
  const visible = run.results.slice(0, done).map(clone);
  const finished = done >= run.results.length;
  return {
    id: run.id, status: finished ? aggregate(run.results) : 'running', ref: run.ref, config_checksum: run.config_checksum, started_at: run.started_at,
    finished_at: finished ? new Date(Date.parse(run.started_at) + run.results.length * Math.max(run.stepMs, 1)).toISOString() : null,
    live: run.live, judge: run.judge, runner: run.runner, total: run.results.length, scenarios: visible,
  };
}

export function headlineOf(run, nowMs) {
  const view = viewRun(run, nowMs);
  const count = (status) => view.scenarios.filter((s) => s.status === status).length;
  const { scenarios, ...rest } = view;
  return { ...rest, counts: { total: view.total, passed: count('passed'), failed: count('failed'), error: count('error'), skipped: count('skipped') } };
}

// `GET /tests`: the scenarios of a config, each with the result of the newest run that has one.
export function scenarioListOf(config, runs, nowMs) {
  const views = runs.map((r) => viewRun(r, nowMs));
  return list(config?.tests).filter(isObj).map((scenario) => {
    let last = null;
    for (const view of views) {
      const hit = view.scenarios.find((s) => s.id === scenario.id);
      if (hit) { last = { ...hit, run_id: view.id, ran_at: view.started_at }; break; }
    }
    return last ? { ...scenario, last } : { ...scenario };
  });
}
