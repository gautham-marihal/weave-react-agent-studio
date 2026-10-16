// A call's records read as a conversation: what the caller said turn by turn, what the agent answered to each, which tools ran, who took over, how it ended.
// The same reading is used for a real call, a Test conversation and a scenario run (they all write the same records), so a replay of one can be laid
// beside another. Pure: no network, no DOM.

import { fixMojibake } from '../trace/records.js';

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clean = (text) => fixMojibake(typeof text === 'string' ? text : text == null ? '' : JSON.stringify(text));

// facts: {
//   channelId, startAgent, finalAgent, finalState, ended, handoffs,
//   opening: [text]                      what the agent said before the caller spoke (the greeting, a recording notice)
//   turns: [{ say, at, said: [text], tools: [{ tool, args, result, error, handoff }], waitMs }]
//   errors: [text]                       records of kind "error", and tools that failed
// }
export function readCall(records) {
  const events = list(records).filter(isObj).slice().sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const facts = { channelId: '', startAgent: '', finalAgent: '', finalState: {}, ended: false, handoffs: 0, opening: [], turns: [], errors: [] };
  let turn = null; let lastTool = null; let calledAt = null;
  events.forEach((e) => {
    switch (e.event) {
      case 'call_started':
        facts.channelId = e.channel?.id || '';
        break;
      case 'agent_entered':
        if (!facts.startAgent) facts.startAgent = e.agent || '';
        facts.finalAgent = e.agent || facts.finalAgent;
        if (e.first === false && lastTool && !lastTool.handoff) { lastTool.handoff = e.agent; facts.handoffs += 1; }
        break;
      case 'user_said':
        turn = { say: clean(e.text), at: e.elapsed_s, said: [], tools: [], waitMs: null };
        calledAt = e.elapsed_s;
        facts.turns.push(turn);
        lastTool = null;
        break;
      case 'agent_said': {
        const text = clean(e.text);
        if (!text) break;
        if (turn) {
          turn.said.push(text);
          if (turn.waitMs === null && typeof calledAt === 'number' && typeof e.elapsed_s === 'number') turn.waitMs = Math.max(0, Math.round((e.elapsed_s - calledAt) * 1000));
        } else facts.opening.push(text);
        break;
      }
      case 'tool_called': {
        const tool = { tool: e.tool || e.name || '', args: isObj(e.args) ? e.args : {}, result: e.result ?? e.output, error: e.error ? clean(e.error) : '', handoff: e.handoff || '' };
        if (turn) turn.tools.push(tool);
        lastTool = tool;
        if (tool.error) facts.errors.push(`The tool “${tool.tool}” failed: ${tool.error}`);
        if (tool.handoff) facts.handoffs += 1;
        break;
      }
      case 'error':
        facts.errors.push(clean(e.message || e.detail || e.error || 'An error was recorded.'));
        break;
      case 'state_changed':
        if (isObj(e.state)) facts.finalState = { ...facts.finalState, ...e.state };
        else if (e.name !== undefined || e.variable !== undefined) facts.finalState = { ...facts.finalState, [e.name ?? e.variable]: e.value ?? e.to };
        break;
      case 'call_ended':
        facts.ended = true;
        if (isObj(e.state)) facts.finalState = { ...e.state };
        break;
      default:
    }
  });
  return facts;
}

// A conversation the runner or the simulation already gives as { role, text } lines and tool records (no raw records): the same facts.
export function readTranscript({ transcript = [], tools = [], finalAgent = '', finalState = {}, ended = false, channelId = '' } = {}) {
  const facts = { channelId, startAgent: '', finalAgent, finalState: isObj(finalState) ? finalState : {}, ended, handoffs: 0, opening: [], turns: [], errors: [] };
  let turn = null; let toolIndex = 0;
  list(transcript).forEach((m) => {
    const role = String(m?.role || '').toLowerCase();
    const text = clean(m?.text);
    if (role === 'user' || role === 'caller') { turn = { say: text, at: undefined, said: [], tools: [], waitMs: null }; facts.turns.push(turn); }
    else if (text && (role === 'assistant' || role === 'agent' || role === 'bot')) {
      if (turn) turn.said.push(text); else facts.opening.push(text);
      list(m.tools).forEach((t) => { if (turn) turn.tools.push({ tool: t.tool || t.name || '', args: t.args || {}, result: t.output ?? t.result, error: t.error || '', handoff: t.handoff || '' }); });
    }
  });
  // tool records that the lines did not carry: spread over the turns in order, so at least the set of tools is right
  if (list(tools).length && !facts.turns.some((t) => t.tools.length)) {
    list(tools).forEach((t) => { const target = facts.turns[Math.min(toolIndex, facts.turns.length - 1)]; toolIndex += 1; if (target) target.tools.push({ tool: t.tool || t.name || '', args: t.args || {}, result: t.output ?? t.result, error: t.error || '', handoff: t.handoff || '' }); });
  }
  facts.handoffs = facts.turns.reduce((n, t) => n + t.tools.filter((x) => x.handoff).length, 0);
  facts.turns.forEach((t) => t.tools.forEach((x) => { if (x.error) facts.errors.push(`The tool “${x.tool}” failed: ${x.error}`); }));
  return facts;
}
