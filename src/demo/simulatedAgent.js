// A SIMULATED agent: it answers a conversation from a configuration using a few plain rules, so the studio can show a chat preview and
// run test scenarios without a runtime. It is not the real agent and does not pretend to be: it has no language model, makes no
// requests, and its replies are marked `simulated` wherever they are shown. What it does imitate, in a crude way, is the shape of a
// conversation: the greeting (and recording notice), saying goodbye through `end_call`, offering a person through
// `transfer_or_callback`, "calling" a tool whose name or description matches what the caller said (and applying its `set_state`
// effects), and handing off to another agent. Anything it can't do it says plainly.
// Pure: no network, no DOM, no randomness.

import { isObj } from '../studio/form/engine.js';
import { renderTemplate } from '../studio/form/promptPreview.js';
import { baseOf, primaryOf } from '../studio/form/messages.js';

const list = (v) => (Array.isArray(v) ? v : []);
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'when', 'what', 'your', 'their', 'about', 'tool', 'use', 'user', 'caller', 'customer', 'asks', 'ask', 'get', 'gets', 'give', 'into', 'have', 'they', 'them', 'will', 'can', 'are', 'its', 'not', 'only']);
const words = (text) => String(text || '').toLowerCase().match(/[a-z]{4,}/g)?.filter((w) => !STOP.has(w)) || [];
// Does what the caller said share a word (by its first four letters: bill, bills, billing) with these words?
const shares = (said, candidates) => { const stems = new Set(words(said).map((w) => w.slice(0, 4))); return candidates.some((w) => stems.has(w.slice(0, 4))); };

// A message's text: a plain string, or the entry for the primary language (else the first one).
function textOf(message, config) {
  const text = message?.text;
  if (typeof text === 'string') return text;
  if (!isObj(text)) return '';
  const primary = baseOf(primaryOf(config));
  const key = Object.keys(text).find((k) => baseOf(k) === primary) || Object.keys(text)[0];
  return key ? String(text[key]) : '';
}

// What a `say` value (a text, or a { message } reference) comes to.
export function speechText(speech, config) {
  if (typeof speech === 'string') return speech;
  if (isObj(speech) && speech.message) return textOf(list(config?.messages).find((m) => m?.id === speech.message), config);
  return '';
}

const DEFAULT_STATE = (config) => Object.fromEntries(Object.entries(isObj(config?.state?.variables) ? config.state.variables : {}).map(([name, v]) => [name, isObj(v) ? v.default ?? null : null]));

export function createSimulatedAgent(config, { channelId } = {}) {
  const agents = list(config?.agents?.items);
  const channels = list(config?.channels);
  const channel = channels.find((c) => c?.id === channelId) || channels.find((c) => c?.enabled !== false) || channels[0] || null;
  let current = agents.find((a) => a?.id === config?.agents?.entry) || agents[0] || null;
  const state = DEFAULT_STATE(config);
  const calls = [];
  let ended = false;

  const persona = isObj(config?.persona) ? config.persona : {};
  const name = () => persona.name || current?.name || 'the agent';
  const fill = (text) => renderTemplate(text, { ...config, state: { variables: Object.fromEntries(Object.entries(state).map(([k, v]) => [k, { type: 'string', default: v }])) } }).text.replace(/‹[^›]*›/g, '').replace(/\s{2,}/g, ' ').trim();
  const offered = () => list(current?.tools).map((id) => list(config?.tools).find((t) => t?.id === id)).filter(Boolean);
  const isVoice = () => !!channel && (['sip_voice', 'web_voice'].includes(channel.type) || list(channel.modalities?.output).includes('audio'));

  // Runs the `set_state` and `say` steps of a tool's effects whose condition is plainly true (no condition, or a state/arg test we can read).
  function applyEffects(tool) {
    const said = [];
    list(tool.effects).forEach((rule) => {
      if (isObj(rule.when)) {
        const w = rule.when;
        if ('state' in w && 'equals' in w && state[w.state] !== w.equals) return;
        if (!('state' in w) && !('channel' in w)) return; // a condition on the tool's real answer: unknowable here
      }
      list(rule.do).forEach((action) => {
        if (action?.type === 'set_state' && isObj(action.values)) Object.assign(state, action.values);
        else if (action?.type === 'say') said.push(fill(speechText(action.text, config)));
        else if (action?.type === 'end_call') { ended = true; if (action.say) said.push(fill(speechText(action.say, config))); }
        else if (action?.type === 'handoff' && action.to) { const next = agents.find((a) => a?.id === action.to); if (next) current = next; }
      });
    });
    return said.filter(Boolean);
  }

  function greeting() {
    const out = [];
    if (isVoice() && persona.disclosures?.recording_notice) out.push({ role: 'assistant', text: persona.disclosures.recording_notice, simulated: true, kind: 'notice' });
    const say = channel?.greeting?.say;
    const text = fill(speechText(say, config)) || `Hello, I’m ${name()}.`;
    out.push({ role: 'assistant', text, simulated: true });
    return out;
  }

  function reply(userText) {
    const said = String(userText || '').trim();
    const lower = said.toLowerCase();
    const out = { messages: [], toolCalls: [], handoff: null, ended: false };
    const speak = (text) => { if (text) out.messages.push({ role: 'assistant', text, simulated: true }); };
    const call = (tool, args = {}) => { const record = { tool: tool.name || tool.id, id: tool.id, args }; calls.push(record); out.toolCalls.push(record); };
    if (ended) { speak('The conversation has ended in this simulation.'); out.ended = true; return out; }
    const tools = offered();

    // goodbye
    if (/\b(bye|goodbye|that'?s all|that is all|no,? thanks|nothing else)\b/.test(lower)) {
      const end = tools.find((t) => t.builtin === 'end_call');
      if (end) {
        call(end);
        speak(fill(speechText(end.params?.say, config)) || 'Goodbye.');
        ended = true; out.ended = true;
        return out;
      }
      speak('Goodbye. (This agent has no end-call tool, so in a real call it could not hang up.)');
      return out;
    }

    // a person
    if (/\b(person|human|agent|representative|someone|operator|manager|transfer|speak to|talk to)\b/.test(lower)) {
      const person = tools.find((t) => t.builtin === 'transfer_or_callback');
      if (person) {
        call(person, { reason: said });
        const fallback = list(person.params?.fallback).find((a) => a?.type === 'say');
        speak(fill(speechText(fallback?.text, config)) || 'I’ll put you through to a person.');
        return out;
      }
      speak('I can’t pass you to a person: this agent has no way to do that yet.');
      return out;
    }

    // another agent
    const handoff = list(current?.handoffs).find((h) => isObj(h) && shares(lower, words(`${h.description} ${h.tool}`)));
    if (handoff) {
      const next = agents.find((a) => a?.id === handoff.to);
      if (next) {
        out.handoff = next.id;
        calls.push({ tool: handoff.tool, id: handoff.tool, args: {}, handoff: next.id });
        out.toolCalls.push(calls[calls.length - 1]);
        current = next;
        speak(`I’ll pass you to ${next.name || next.id}.`);
        return out;
      }
    }

    // a tool whose name or description matches what was said
    const tool = tools.find((t) => !t.builtin && shares(lower, words(`${t.id} ${t.name || ''} ${t.description || ''}`)));
    if (tool) {
      call(tool, Object.fromEntries(Object.keys(isObj(tool.parameters?.properties) ? tool.parameters.properties : {}).map((k) => [k, `‹${k} from the caller›`])));
      const extra = applyEffects(tool);
      speak(extra.length ? extra.join(' ') : `I’d look that up with ${tool.name || tool.id}. (No request is made in a simulation, so there is no real answer.)`);
      if (ended) out.ended = true;
      return out;
    }

    const role = String(current?.instructions?.role || '').replace(/\s+/g, ' ').trim();
    const snippet = role ? role.split(/\s+/).slice(0, 14).join(' ') + (role.split(/\s+/).length > 14 ? '…' : '') : 'no instructions yet';
    speak(`I’m ${name()}. This is a simulated reply: a real agent would answer using its instructions (“${snippet}”).`);
    return out;
  }

  return {
    greeting,
    reply,
    get name() { return name(); },
    get channel() { return channel; },
    get currentAgent() { return current?.id || null; },
    get state() { return { ...state }; },
    get toolCalls() { return [...calls]; },
    get ended() { return ended; },
  };
}
