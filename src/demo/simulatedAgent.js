// A SIMULATED agent: answers from a config with plain rules, so the studio can preview chats and run tests without a
// runtime. No language model and no requests; replies are marked `simulated`. It imitates the shape of a conversation
// (greeting, goodbye, hand-overs, matching tools) and says plainly what it can't do. Pure, no randomness.

import { isObj } from '../studio/form/engine.js';
import { renderTemplate } from '../studio/form/promptPreview.js';
import { baseOf, primaryOf } from '../studio/form/messages.ts';

const list = (v) => (Array.isArray(v) ? v : []);
const STOP = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'when',
  'what',
  'your',
  'their',
  'about',
  'tool',
  'use',
  'user',
  'caller',
  'customer',
  'asks',
  'ask',
  'get',
  'gets',
  'give',
  'into',
  'have',
  'they',
  'them',
  'will',
  'can',
  'are',
  'its',
  'not',
  'only',
]);
const words = (text) =>
  String(text || '')
    .toLowerCase()
    .match(/[a-z]{4,}/g)
    ?.filter((w) => !STOP.has(w)) || [];
// Does what the caller said share a word (by its first four letters: bill, bills, billing) with these words?
const shares = (said, candidates) => {
  const stems = new Set(words(said).map((w) => w.slice(0, 4)));
  return candidates.some((w) => stems.has(w.slice(0, 4)));
};

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
  if (isObj(speech) && speech.message)
    return textOf(
      list(config?.messages).find((m) => m?.id === speech.message),
      config,
    );
  return '';
}

// Something to hand to a person at once: an emergency, pain, a complaint (said on top of asking for a person by name)
const URGENT = /\b(emergency|urgent|urgently|severe|bleeding|accident|ambulance|pain|painful|hurts?|complain|complaint)\b/;
// A request to take down for the team: a booking, an order, a call-back
const REQUEST = [/\bbook(s|ed|ing)?\b/, /\bappointments?\b/, /\breserv(e|ation)\b/, /\border(s|ed|ing)?\b/, /\bcall[ -]?back\b/];
// When a request is for, from what was said: a day, a part of the day, a time ("Saturday morning", "tomorrow 3pm")
const DAY = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|weekend)\b/i;
const PART = /\b(morning|afternoon|evening)\b/i;
const TIME = /\b\d{1,2}(:\d{2})? ?(am|pm)\b/i;
const whenIn = (said) =>
  [DAY, PART, TIME]
    .map((re) => re.exec(said)?.[0])
    .filter(Boolean)
    .join(' ');
// How it asks for each detail of a request, in conversation
const ASK = {
  name: 'Could I have your name, please?',
  phone: 'What is the best phone number to reach you on?',
  email: 'And your email address?',
  need: 'What would you like to book or ask for?',
  when: 'Which day and time would suit you?',
  message: 'Is there anything you’d like to add?',
};
// Everyday question words a document says another way ("where are you?" is its address, "how much" its prices)
const ALSO = [
  [/\bwhere\b|\blocat/, 'address location'],
  [/\bhow much\b|\bcost|\bprice|\bfees?\b/, 'price prices cost'],
  [/\bwhen\b|\bopen|\bhours?\b|\bclos/, 'opening hours open'],
  [/\bpark/, 'parking'],
  [/\bpay\b|\bcards?\b|\bcash\b/, 'payment'],
];
// what was asked, with those words: what its documents are searched for
export const widenQuestion = (text) => [text, ...ALSO.filter(([re]) => re.test(String(text || '').toLowerCase())).map(([, more]) => more)].join(' ');
// The document line that answers best: most words shared with the question, its own words above everyday ones
// (a passage may run several lines together, as "Prices: - Check-up: S$45 - Cleaning: S$90")
function bestLine(passage, asked) {
  const own = new Set(words(asked).map((w) => w.slice(0, 4)));
  const also = new Set(words(widenQuestion(asked)).map((w) => w.slice(0, 4)));
  const lines = String(passage || '')
    .split(/\n+|(?<=[.!?])\s+|\s+[-•*]\s+/)
    .map((l) => l.replace(/^[\s*•-]+/, '').trim())
    .filter(Boolean);
  let best = '';
  let most = 0;
  lines.forEach((line) => {
    const n = words(line).reduce((sum, w) => sum + (own.has(w.slice(0, 4)) ? 2 : also.has(w.slice(0, 4)) ? 1 : 0), 0);
    if (n > most) {
      most = n;
      best = line;
    }
  });
  return best;
}

const DEFAULT_STATE = (config) =>
  Object.fromEntries(
    Object.entries(isObj(config?.state?.variables) ? config.state.variables : {}).map(([name, v]) => [name, isObj(v) ? (v.default ?? null) : null]),
  );

export function createSimulatedAgent(config, { channelId, state: startingState } = {}) {
  const agents = list(config?.agents?.items);
  const channels = list(config?.channels);
  const channel = channels.find((c) => c?.id === channelId) || channels.find((c) => c?.enabled !== false) || channels[0] || null;
  let current = agents.find((a) => a?.id === config?.agents?.entry) || agents[0] || null;
  const state = { ...DEFAULT_STATE(config), ...(isObj(startingState) ? startingState : {}) }; // a scenario may preset values
  const calls = [];
  let ended = false;
  let request = null; // a request being taken down: { tool, fields: [names], values: {}, asking }

  const persona = isObj(config?.persona) ? config.persona : {};
  const name = () => persona.name || current?.name || 'the agent';
  const fill = (text) =>
    renderTemplate(text, { ...config, state: { variables: Object.fromEntries(Object.entries(state).map(([k, v]) => [k, { type: 'string', default: v }])) } })
      .text.replace(/‹[^›]*›/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  const offered = () =>
    list(current?.tools)
      .map((id) => list(config?.tools).find((t) => t?.id === id))
      .filter(Boolean);
  const isVoice = () => !!channel && (['sip_voice', 'web_voice'].includes(channel.type) || list(channel.modalities?.output).includes('audio'));

  // Runs a tool's `set_state` and `say` effects whose condition is plainly true (none, or a readable state/arg test).
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
        else if (action?.type === 'end_call') {
          ended = true;
          if (action.say) said.push(fill(speechText(action.say, config)));
        } else if (action?.type === 'handoff' && action.to) {
          const next = agents.find((a) => a?.id === action.to);
          if (next) current = next;
        }
      });
    });
    return said.filter(Boolean);
  }

  function greeting() {
    const out = [];
    if (isVoice() && persona.disclosures?.recording_notice)
      out.push({ role: 'assistant', text: persona.disclosures.recording_notice, simulated: true, kind: 'notice' });
    const say = channel?.greeting?.say;
    const text = fill(speechText(say, config)) || `Hello, I’m ${name()}.`;
    out.push({ role: 'assistant', text, simulated: true });
    return out;
  }

  // a request's form: the fields it asks for, in order
  const formOf = (tool) => list(config?.forms).find((f) => isObj(f) && f.id === tool?.params?.form);
  // passing to a person: put through when a number is set, else the line callers hear when no one can take the call
  function passOn(person, said, urgent, call) {
    call(person, { reason: said });
    const transfer = list(config?.telephony?.transfers).find((t) => isObj(t) && t.id === person.params?.transfer);
    const fallback = list(person.params?.fallback).find((a) => a?.type === 'say');
    const sorry = urgent ? 'I’m sorry to hear that. ' : '';
    return transfer?.target
      ? `${sorry}I’ll put you through to someone on the team now.`
      : `${sorry}${fill(speechText(fallback?.text, config)) || 'I’ll put you through to a person.'}`;
  }

  // hits: what a search of its documents found ([{ text, source, score }], best first), when it has documents
  function reply(userText, { hits = [] } = {}) {
    const said = String(userText || '').trim();
    const lower = said.toLowerCase();
    const out = { messages: [], toolCalls: [], handoff: null, ended: false };
    const speak = (text) => {
      if (text) out.messages.push({ role: 'assistant', text, simulated: true });
    };
    const call = (tool, args = {}) => {
      const record = { tool: tool.name || tool.id, id: tool.id, args };
      calls.push(record);
      out.toolCalls.push(record);
    };
    if (ended) {
      speak('The conversation has ended in this simulation.');
      out.ended = true;
      return out;
    }
    const tools = offered();

    // goodbye
    if (/\b(bye|goodbye|that'?s all|that is all|no,? thanks|nothing else)\b/.test(lower)) {
      const end = tools.find((t) => t.builtin === 'end_call');
      if (end) {
        call(end);
        speak(fill(speechText(end.params?.say, config)) || 'Goodbye.');
        ended = true;
        out.ended = true;
        return out;
      }
      speak('Goodbye. (This agent has no end-call tool, so in a real call it could not hang up.)');
      return out;
    }

    // a person, asked for, or needed at once (an emergency, pain, a complaint)
    const urgent = URGENT.test(lower);
    if (urgent || /\b(person|human|agent|representative|someone|operator|manager|transfer|speak to|talk to)\b/.test(lower)) {
      request = null;
      const person = tools.find((t) => t.builtin === 'transfer_or_callback');
      if (person) {
        speak(passOn(person, said, urgent, call));
        return out;
      }
      if (urgent) {
        speak(
          'I’m sorry to hear that. (Simulated: this agent has no way to pass someone to a person, so a real one could only keep talking. Switch on “Pass people to a person on your team”.)',
        );
        return out;
      }
      speak('I can’t pass you to a person: this agent has no way to do that yet.');
      return out;
    }

    // a request being taken down: this answer is the detail it asked for
    if (request) {
      request.values[request.asking] = said;
      const next = request.fields.find((f) => !request.values[f]);
      if (next) {
        request.asking = next;
        speak(ASK[next] || `Could you tell me your ${next}?`);
        return out;
      }
      call(request.tool, { ...request.values });
      const who = request.values.name ? `, ${request.values.name.split(/\s+/)[0]}` : '';
      const when = request.values.when ? ` for ${request.values.when}` : '';
      request = null;
      speak(`Thank you${who}. I’ve noted your request${when}. Our team will confirm it with you shortly. Is there anything else I can help with?`);
      return out;
    }

    // what it can do, asked straight out
    if (/\b(what can you (do|help)|how can you help|what do you do|what can i ask)\b/.test(lower)) {
      const can = [
        tools.some((t) => t.builtin === 'send_form') && 'take a request for our team (a booking, an order or a call-back)',
        tools.some((t) => t.builtin === 'transfer_or_callback') && 'pass you to someone on the team',
        list(config?.knowledge).length > 0 && 'answer questions from our information',
      ].filter(Boolean);
      const about = String(config?.meta?.description || '').trim();
      speak(
        `${about ? `${about.replace(/\.$/, '')}. ` : ''}${can.length ? `I can ${can.length > 1 ? `${can.slice(0, -1).join(', ')} and ${can.at(-1)}` : can[0]}.` : 'Ask me anything.'}`,
      );
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
      call(
        tool,
        Object.fromEntries(Object.keys(isObj(tool.parameters?.properties) ? tool.parameters.properties : {}).map((k) => [k, `‹${k} from the caller›`])),
      );
      const extra = applyEffects(tool);
      speak(
        extra.length ? extra.join(' ') : `I’d look that up with ${tool.name || tool.id}. (No request is made in a simulation, so there is no real answer.)`,
      );
      if (ended) out.ended = true;
      return out;
    }

    // a request to take down (booking, order, call-back), when it takes requests: ask for each detail still needed
    const form = tools.find((t) => t.builtin === 'send_form');
    if (form && REQUEST.some((re) => re.test(lower))) {
      const fields = list(formOf(form)?.fields)
        .map((f) => f?.name)
        .filter(Boolean);
      const values = {};
      if (fields.includes('need')) values.need = said;
      const when = whenIn(said);
      if (when && fields.includes('when')) values.when = when;
      const next = fields.find((f) => !values[f]);
      if (next) {
        request = { tool: form, fields, values, asking: next };
        speak(`I can take that request for you. ${ASK[next] || `Could you tell me your ${next}?`}`);
        return out;
      }
    }

    // its documents: the line that answers best
    const hit = hits.find((h) => h && h.score > 0 && h.text);
    const line = hit ? bestLine(hit.text, said) : '';
    if (line) {
      speak(`${line}${/[.!?]$/.test(line) ? '' : '.'} (Simulated: found in ${hit.source || 'your documents'}; the real agent puts it in its own words.)`);
      return out;
    }

    const role = String(current?.instructions?.role || '')
      .replace(/\s+/g, ' ')
      .trim();
    const snippet = role ? role.split(/\s+/).slice(0, 14).join(' ') + (role.split(/\s+/).length > 14 ? '…' : '') : 'no instructions yet';
    speak(
      `I’m ${name()}. This is a simulated reply: the real agent answers from its instructions (“${snippet}”)${list(config?.knowledge).length ? ' and its documents' : ''}. Nothing here answers it yet: to be sure it can, add the answer under What it knows or What it does.`,
    );
    return out;
  }

  return {
    greeting,
    reply,
    get name() {
      return name();
    },
    get channel() {
      return channel;
    },
    get currentAgent() {
      return current?.id || null;
    },
    get state() {
      return { ...state };
    },
    get toolCalls() {
      return [...calls];
    },
    get ended() {
      return ended;
    },
  };
}
