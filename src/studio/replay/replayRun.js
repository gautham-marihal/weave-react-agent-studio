// Playing a call's caller side again. The caller's words are fed, turn by turn, to something that answers as the agent would, and what comes back is
// read into the same facts as the original call (see callFacts.js), so the two can be compared.
//
// Two ways to answer: the SIMULATED agent (in the browser, free, instant: a few plain rules for the tools, hand-offs, goodbye and a person; no
// language model, so its wording is not the real agent's), and the scenario runner (the real runtime when there is one: see scenarioForReplay).
// Pure: no network, no DOM.

import { createSimulatedAgent } from '../../demo/simulatedAgent.js';
import { readCall, readTranscript } from './callFacts.js';
import { freshScenarioId } from '../scenarios/model.js';

const list = (v) => (Array.isArray(v) ? v : []);

// The caller's turns through the simulated agent on `config`. Stops where the agent ends the conversation (the rest are said not to be reached).
export function playSimulated(config, original) {
  const agent = createSimulatedAgent(config, { channelId: original.channelId });
  const facts = {
    source: 'simulated',
    channelId: agent.channel?.id || original.channelId,
    startAgent: agent.currentAgent || '',
    finalAgent: '',
    finalState: {},
    ended: false,
    handoffs: 0,
    opening: agent.greeting().map((m) => m.text),
    turns: [],
    errors: [],
    notReached: 0,
  };
  let finished = false;
  list(original.turns).forEach((turn) => {
    if (finished) {
      facts.notReached += 1;
      return;
    }
    const out = agent.reply(turn.say);
    facts.turns.push({
      say: turn.say,
      at: undefined,
      waitMs: null,
      said: out.messages.map((m) => m.text),
      tools: out.toolCalls.map((c) => ({ tool: c.tool || c.id, args: c.args || {}, result: undefined, error: '', handoff: c.handoff || '' })),
    });
    if (out.ended || agent.ended) finished = true;
  });
  facts.finalAgent = agent.currentAgent || '';
  facts.finalState = agent.state;
  facts.ended = agent.ended;
  facts.handoffs = facts.turns.reduce((n, t) => n + t.tools.filter((x) => x.handoff).length, 0);
  return facts;
}

// What a run of the scenario runner answers for one scenario (a result of GET /tests/runs/{id}), read as facts. The records of the run are used when it
// has them (they carry the waiting times and the hand-offs); otherwise its transcript and tool list.
export function factsFromResult(result, { channelId = '' } = {}) {
  if (!result) return null;
  const events = list(result.events);
  const base = events.length
    ? readCall(events)
    : readTranscript({ transcript: result.transcript, tools: result.tools, finalAgent: result.final_agent, finalState: result.final_state, channelId });
  return {
    ...base,
    source: 'runner',
    channelId: base.channelId || channelId,
    finalAgent: result.final_agent || base.finalAgent,
    finalState: Object.keys(result.final_state || {}).length ? result.final_state : base.finalState,
    notReached: 0,
  };
}

// The caller's turns as a scenario the runner can play, with a name that cannot clash with the agent's own. It is run from the editor's contents
// (`config` in the body of the run), never saved, so replaying changes nothing in the draft.
export function scenarioForReplay(config, original, { id = '' } = {}) {
  const channels = list(config?.channels).filter((c) => c && typeof c === 'object' && c.id);
  const channel = channels.find((c) => c.id === original.channelId) || channels.find((c) => c.enabled !== false) || channels[0];
  return {
    id: id || freshScenarioId(config?.tests, 'replay'),
    description: 'A replay of a call',
    channel: channel?.id || original.channelId || '',
    turns: list(original.turns)
      .map((t) => ({ say: t.say }))
      .filter((t) => t.say),
    expect: [{ said_matches: '.+' }],
  };
}

// The configuration a replay run starts from: the agent as it is, plus the replay scenario.
export function configWithScenario(config, scenario) {
  return { ...config, tests: [...list(config?.tests), scenario] };
}
