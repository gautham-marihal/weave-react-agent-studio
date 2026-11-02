// GENERATED from Weave React's in-browser simulations (src/demo/simulatedAgent.js, src/demo/draftAssistant.js,
// src/studio/replay/replayRun.js, src/studio/test/simulatedChannel.js, src/pages/browserVoice.js at 7a0567a, bundled with
// esbuild). Used only in Sandbox: the agent's made-up replies in a test conversation, the rule-based "Describe it", a
// replay played without the runtime, and the browser voice used to read a line aloud. Do not edit by hand.
/* eslint-disable */
// @ts-nocheck
// weave-react/src/studio/form/engine.js
var isObj = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// weave-react/src/studio/form/promptPreview.js
function renderTemplate(source, config) {
  const unresolved = [];
  const variables = isObj(config?.state?.variables) ? config.state.variables : {};
  const constants = isObj(config?.constants) ? config.constants : {};
  const out = String(source ?? "").replace(/\{\{([^{}]*)\}\}/g, (whole, expr) => {
    const [head, ...filters] = expr.split("|").map((part) => part.trim());
    const [root, name] = head.split(".");
    let value;
    if (root === "state" && name in variables) {
      const variable = variables[name];
      value = variable?.sensitive === true ? void 0 : variable?.default;
      if (variable?.sensitive === true) {
        unresolved.push(head);
        return "\u2039sensitive: not shown\u203A";
      }
    } else if (root === "const" && name in constants) value = constants[name];
    const empty = value === void 0 || value === null || value === "";
    const fallback = filters.map((f) => /^default\((.*)\)$/.exec(f)).find(Boolean);
    if (empty && fallback) return String(fallback[1]).replace(/^['"]|['"]$/g, "");
    if (empty) {
      unresolved.push(head);
      return `\u2039${head}\u203A`;
    }
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  });
  return { text: out, unresolved };
}

// weave-react/src/studio/form/messages.ts
var baseOf = (code) => String(code || "").split("-")[0].toLowerCase();
var primaryOf = (config) => {
  const language = config?.defaults?.language;
  if (typeof language?.primary === "string" && language.primary) return language.primary;
  const speaks = language?.speaks;
  const first = Array.isArray(speaks) ? speaks.find((code) => typeof code === "string" && !!code) : "";
  return first || "";
};

// weave-react/src/demo/simulatedAgent.js
var list = (v) => Array.isArray(v) ? v : [];
var STOP = /* @__PURE__ */ new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "when",
  "what",
  "your",
  "their",
  "about",
  "tool",
  "use",
  "user",
  "caller",
  "customer",
  "asks",
  "ask",
  "get",
  "gets",
  "give",
  "into",
  "have",
  "they",
  "them",
  "will",
  "can",
  "are",
  "its",
  "not",
  "only"
]);
var words = (text2) => String(text2 || "").toLowerCase().match(/[a-z]{4,}/g)?.filter((w) => !STOP.has(w)) || [];
var shares = (said, candidates) => {
  const stems = new Set(words(said).map((w) => w.slice(0, 4)));
  return candidates.some((w) => stems.has(w.slice(0, 4)));
};
function textOf(message, config) {
  const text2 = message?.text;
  if (typeof text2 === "string") return text2;
  if (!isObj(text2)) return "";
  const primary = baseOf(primaryOf(config));
  const key = Object.keys(text2).find((k) => baseOf(k) === primary) || Object.keys(text2)[0];
  return key ? String(text2[key]) : "";
}
function speechText(speech, config) {
  if (typeof speech === "string") return speech;
  if (isObj(speech) && speech.message)
    return textOf(
      list(config?.messages).find((m2) => m2?.id === speech.message),
      config
    );
  return "";
}
var URGENT = /\b(emergency|urgent|urgently|severe|bleeding|accident|ambulance|pain|painful|hurts?|complain|complaint)\b/;
var REQUEST = [/\bbook(s|ed|ing)?\b/, /\bappointments?\b/, /\breserv(e|ation)\b/, /\border(s|ed|ing)?\b/, /\bcall[ -]?back\b/];
var DAY = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|weekend)\b/i;
var PART = /\b(morning|afternoon|evening)\b/i;
var TIME = /\b\d{1,2}(:\d{2})? ?(am|pm)\b/i;
var whenIn = (said) => [DAY, PART, TIME].map((re) => re.exec(said)?.[0]).filter(Boolean).join(" ");
var ASK = {
  name: "Could I have your name, please?",
  phone: "What is the best phone number to reach you on?",
  email: "And your email address?",
  need: "What would you like to book or ask for?",
  when: "Which day and time would suit you?",
  message: "Is there anything you\u2019d like to add?"
};
var ALSO = [
  [/\bwhere\b|\blocat/, "address location"],
  [/\bhow much\b|\bcost|\bprice|\bfees?\b/, "price prices cost"],
  [/\bwhen\b|\bopen|\bhours?\b|\bclos/, "opening hours open"],
  [/\bpark/, "parking"],
  [/\bpay\b|\bcards?\b|\bcash\b/, "payment"]
];
var widenQuestion = (text2) => [text2, ...ALSO.filter(([re]) => re.test(String(text2 || "").toLowerCase())).map(([, more]) => more)].join(" ");
function bestLine(passage, asked) {
  const own = new Set(words(asked).map((w) => w.slice(0, 4)));
  const also = new Set(words(widenQuestion(asked)).map((w) => w.slice(0, 4)));
  const lines = String(passage || "").split(/\n+|(?<=[.!?])\s+|\s+[-•*]\s+/).map((l) => l.replace(/^[\s*•-]+/, "").trim()).filter(Boolean);
  let best = "";
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
var DEFAULT_STATE = (config) => Object.fromEntries(
  Object.entries(isObj(config?.state?.variables) ? config.state.variables : {}).map(([name, v]) => [name, isObj(v) ? v.default ?? null : null])
);
function createSimulatedAgent(config, { channelId, state: startingState } = {}) {
  const agents = list(config?.agents?.items);
  const channels = list(config?.channels);
  const channel = channels.find((c) => c?.id === channelId) || channels.find((c) => c?.enabled !== false) || channels[0] || null;
  let current = agents.find((a) => a?.id === config?.agents?.entry) || agents[0] || null;
  const state = { ...DEFAULT_STATE(config), ...isObj(startingState) ? startingState : {} };
  const calls = [];
  let ended = false;
  let request = null;
  const persona = isObj(config?.persona) ? config.persona : {};
  const name = () => persona.name || current?.name || "the agent";
  const fill = (text2) => renderTemplate(text2, { ...config, state: { variables: Object.fromEntries(Object.entries(state).map(([k, v]) => [k, { type: "string", default: v }])) } }).text.replace(/‹[^›]*›/g, "").replace(/\s{2,}/g, " ").trim();
  const offered = () => list(current?.tools).map((id) => list(config?.tools).find((t) => t?.id === id)).filter(Boolean);
  const isVoice = () => !!channel && (["sip_voice", "web_voice"].includes(channel.type) || list(channel.modalities?.output).includes("audio"));
  function applyEffects(tool) {
    const said = [];
    list(tool.effects).forEach((rule) => {
      if (isObj(rule.when)) {
        const w = rule.when;
        if ("state" in w && "equals" in w && state[w.state] !== w.equals) return;
        if (!("state" in w) && !("channel" in w)) return;
      }
      list(rule.do).forEach((action) => {
        if (action?.type === "set_state" && isObj(action.values)) Object.assign(state, action.values);
        else if (action?.type === "say") said.push(fill(speechText(action.text, config)));
        else if (action?.type === "end_call") {
          ended = true;
          if (action.say) said.push(fill(speechText(action.say, config)));
        } else if (action?.type === "handoff" && action.to) {
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
      out.push({ role: "assistant", text: persona.disclosures.recording_notice, simulated: true, kind: "notice" });
    const say = channel?.greeting?.say;
    const text2 = fill(speechText(say, config)) || `Hello, I\u2019m ${name()}.`;
    out.push({ role: "assistant", text: text2, simulated: true });
    return out;
  }
  const formOf = (tool) => list(config?.forms).find((f) => isObj(f) && f.id === tool?.params?.form);
  function passOn(person, said, urgent, call) {
    call(person, { reason: said });
    const transfer = list(config?.telephony?.transfers).find((t) => isObj(t) && t.id === person.params?.transfer);
    const fallback = list(person.params?.fallback).find((a) => a?.type === "say");
    const sorry = urgent ? "I\u2019m sorry to hear that. " : "";
    return transfer?.target ? `${sorry}I\u2019ll put you through to someone on the team now.` : `${sorry}${fill(speechText(fallback?.text, config)) || "I\u2019ll put you through to a person."}`;
  }
  function reply(userText, { hits = [] } = {}) {
    const said = String(userText || "").trim();
    const lower = said.toLowerCase();
    const out = { messages: [], toolCalls: [], handoff: null, ended: false };
    const speak = (text2) => {
      if (text2) out.messages.push({ role: "assistant", text: text2, simulated: true });
    };
    const call = (tool2, args = {}) => {
      const record = { tool: tool2.name || tool2.id, id: tool2.id, args };
      calls.push(record);
      out.toolCalls.push(record);
    };
    if (ended) {
      speak("The conversation has ended in this simulation.");
      out.ended = true;
      return out;
    }
    const tools = offered();
    if (/\b(bye|goodbye|that'?s all|that is all|no,? thanks|nothing else)\b/.test(lower)) {
      const end = tools.find((t) => t.builtin === "end_call");
      if (end) {
        call(end);
        speak(fill(speechText(end.params?.say, config)) || "Goodbye.");
        ended = true;
        out.ended = true;
        return out;
      }
      speak("Goodbye. (This agent has no end-call tool, so in a real call it could not hang up.)");
      return out;
    }
    const urgent = URGENT.test(lower);
    if (urgent || /\b(person|human|agent|representative|someone|operator|manager|transfer|speak to|talk to)\b/.test(lower)) {
      request = null;
      const person = tools.find((t) => t.builtin === "transfer_or_callback");
      if (person) {
        speak(passOn(person, said, urgent, call));
        return out;
      }
      if (urgent) {
        speak(
          "I\u2019m sorry to hear that. (Simulated: this agent has no way to pass someone to a person, so a real one could only keep talking. Switch on \u201CPass people to a person on your team\u201D.)"
        );
        return out;
      }
      speak("I can\u2019t pass you to a person: this agent has no way to do that yet.");
      return out;
    }
    if (request) {
      request.values[request.asking] = said;
      const next = request.fields.find((f) => !request.values[f]);
      if (next) {
        request.asking = next;
        speak(ASK[next] || `Could you tell me your ${next}?`);
        return out;
      }
      call(request.tool, { ...request.values });
      const who = request.values.name ? `, ${request.values.name.split(/\s+/)[0]}` : "";
      const when = request.values.when ? ` for ${request.values.when}` : "";
      request = null;
      speak(`Thank you${who}. I\u2019ve noted your request${when}. Our team will confirm it with you shortly. Is there anything else I can help with?`);
      return out;
    }
    if (/\b(what can you (do|help)|how can you help|what do you do|what can i ask)\b/.test(lower)) {
      const can = [
        tools.some((t) => t.builtin === "send_form") && "take a request for our team (a booking, an order or a call-back)",
        tools.some((t) => t.builtin === "transfer_or_callback") && "pass you to someone on the team",
        list(config?.knowledge).length > 0 && "answer questions from our information"
      ].filter(Boolean);
      const about = String(config?.meta?.description || "").trim();
      speak(
        `${about ? `${about.replace(/\.$/, "")}. ` : ""}${can.length ? `I can ${can.length > 1 ? `${can.slice(0, -1).join(", ")} and ${can.at(-1)}` : can[0]}.` : "Ask me anything."}`
      );
      return out;
    }
    const handoff = list(current?.handoffs).find((h) => isObj(h) && shares(lower, words(`${h.description} ${h.tool}`)));
    if (handoff) {
      const next = agents.find((a) => a?.id === handoff.to);
      if (next) {
        out.handoff = next.id;
        calls.push({ tool: handoff.tool, id: handoff.tool, args: {}, handoff: next.id });
        out.toolCalls.push(calls[calls.length - 1]);
        current = next;
        speak(`I\u2019ll pass you to ${next.name || next.id}.`);
        return out;
      }
    }
    const tool = tools.find((t) => !t.builtin && shares(lower, words(`${t.id} ${t.name || ""} ${t.description || ""}`)));
    if (tool) {
      call(
        tool,
        Object.fromEntries(Object.keys(isObj(tool.parameters?.properties) ? tool.parameters.properties : {}).map((k) => [k, `\u2039${k} from the caller\u203A`]))
      );
      const extra = applyEffects(tool);
      speak(
        extra.length ? extra.join(" ") : `I\u2019d look that up with ${tool.name || tool.id}. (No request is made in a simulation, so there is no real answer.)`
      );
      if (ended) out.ended = true;
      return out;
    }
    const form = tools.find((t) => t.builtin === "send_form");
    if (form && REQUEST.some((re) => re.test(lower))) {
      const fields = list(formOf(form)?.fields).map((f) => f?.name).filter(Boolean);
      const values = {};
      if (fields.includes("need")) values.need = said;
      const when = whenIn(said);
      if (when && fields.includes("when")) values.when = when;
      const next = fields.find((f) => !values[f]);
      if (next) {
        request = { tool: form, fields, values, asking: next };
        speak(`I can take that request for you. ${ASK[next] || `Could you tell me your ${next}?`}`);
        return out;
      }
    }
    const hit = hits.find((h) => h && h.score > 0 && h.text);
    const line = hit ? bestLine(hit.text, said) : "";
    if (line) {
      speak(`${line}${/[.!?]$/.test(line) ? "" : "."} (Simulated: found in ${hit.source || "your documents"}; the real agent puts it in its own words.)`);
      return out;
    }
    const role = String(current?.instructions?.role || "").replace(/\s+/g, " ").trim();
    const snippet = role ? role.split(/\s+/).slice(0, 14).join(" ") + (role.split(/\s+/).length > 14 ? "\u2026" : "") : "no instructions yet";
    speak(
      `I\u2019m ${name()}. This is a simulated reply: the real agent answers from its instructions (\u201C${snippet}\u201D)${list(config?.knowledge).length ? " and its documents" : ""}. Nothing here answers it yet: to be sure it can, add the answer under What it knows or What it does.`
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
    }
  };
}

// weave-react/src/studio/starters.ts
var hello = (company, voice) => voice ? `Hello, thank you for calling ${company}.` : `Hello, welcome to ${company}.`;
var isVoiceChannel = (channel) => ["sip_voice", "web_voice"].includes(channel?.type);
var STARTERS = [
  {
    id: "blank",
    label: "Blank",
    blurb: "A minimal helpful assistant to build from."
  },
  {
    id: "support",
    person: true,
    label: "Customer care",
    blurb: "Helps with questions and problems, and hands over when it can\u2019t solve them.",
    tone: "warm, patient, plain language",
    styleRules: ["One question at a time.", "Say sorry once when something went wrong, then move on to fixing it."],
    greeting: (name, company, voice) => company ? `${hello(company, voice)} How can I help you today?` : `Hi, I\u2019m ${name}. How can I help you today?`,
    role: "You are a customer care agent. Find out what the customer needs, ask one question at a time and give short, clear answers. If you cannot solve the problem, say so and offer to pass it to a person. Never guess account details. When the customer is finished, say goodbye and end the conversation.",
    opening: "Greet the customer and ask what they need help with.",
    goodbye: "Thanks for getting in touch. Take care!",
    tags: ["support"]
  },
  {
    id: "receptionist",
    person: true,
    label: "Front desk",
    blurb: "Greets people, finds out who or what they need and points them the right way.",
    tone: "polite, quick, professional",
    styleRules: ["Keep every reply to one or two short sentences."],
    greeting: (name, company, voice) => company ? `${hello(company, voice)} Who or what can I help you find?` : `Welcome, this is ${name} at the front desk. Who or what can I help you find?`,
    role: "You are the front desk. Greet everyone, find out who they want to reach or what they need, and point them the right way in one or two short sentences. If you do not know the answer, say you will find out rather than guessing. When they are finished, say goodbye and end the conversation.",
    opening: "Greet the visitor and ask who or what they are looking for.",
    goodbye: "Thank you, have a good day.",
    tags: ["front-desk"]
  },
  {
    id: "knowledge",
    person: true,
    label: "Knowledge guide",
    blurb: "Answers only from the information you give it, and says so when it doesn\u2019t know.",
    tone: "clear, factual, helpful",
    styleRules: ["Quote figures and dates exactly as written.", "Never make anything up."],
    greeting: (name, company, voice) => company ? `${hello(company, voice)} Ask me anything and I\u2019ll answer from what I know.` : `Hello, I\u2019m ${name}. Ask me anything and I\u2019ll answer from what I know.`,
    role: "You answer questions using only the information in these instructions. Add the facts you should answer from below this paragraph. If the answer is not there, say you do not know and suggest contacting a person. Keep answers short. Do not make anything up. When the user is finished, say goodbye and end the conversation.",
    opening: "Say you can answer questions and ask what they would like to know.",
    goodbye: "Glad I could help. Goodbye!",
    tags: ["knowledge"]
  },
  {
    id: "lead",
    label: "Lead concierge",
    blurb: "Welcomes interested visitors and collects their details for your team.",
    tone: "friendly, curious, never pushy",
    styleRules: ["Ask for one detail at a time.", "Never pressure anyone to share more than they want to."],
    greeting: (name, company, voice) => company ? `${hello(company, voice)} What brings you here today?` : `Hi, I\u2019m ${name}. What brings you here today?`,
    role: "You welcome people who are interested in what the company offers. Find out what they are looking for, then politely collect their name, email address and phone number, one at a time. Repeat the details back before you finish. When done, thank them, say the team will be in touch, and end the conversation.",
    opening: "Welcome the visitor and ask what they are looking for.",
    goodbye: "Thank you! Our team will be in touch soon.",
    tags: ["sales", "leads"]
  },
  {
    id: "appointment",
    person: true,
    label: "Booking concierge",
    blurb: "Takes booking requests: the service, a day and time, and contact details.",
    tone: "calm, organised, reassuring",
    styleRules: ["Ask one question at a time.", "Say dates and times the way a person would."],
    greeting: (name, company, voice) => company ? `${hello(company, voice)} Would you like to book an appointment?` : `Hello, this is ${name}. Would you like to book an appointment?`,
    role: "You take appointment requests. Ask which service they want, then the day and time that suit them, then their name and a contact number, one question at a time. Repeat the booking back and ask them to confirm. Say that a person will confirm the slot, and never promise a time you cannot check. When done, say goodbye and end the conversation.",
    opening: "Offer to book an appointment and ask which service they need.",
    goodbye: "Your request is noted. We\u2019ll confirm your booking shortly. Goodbye!",
    tags: ["booking"]
  },
  {
    id: "feedback",
    label: "Feedback collector",
    blurb: "Asks for a rating and a short comment, then thanks the person.",
    tone: "appreciative, brief, neutral",
    styleRules: ["Never argue or defend. Thank the person for every answer."],
    greeting: (name, company, voice) => company ? `${hello(company, voice)} Could you spare a minute to tell us how we did?` : `Hi, I\u2019m ${name}. Could you spare a minute to tell us how we did?`,
    role: "You collect feedback after a service. Ask for a rating from one to five, then ask what went well or badly in one short question. Thank the person for every answer, never argue or defend, and keep it under a minute. When done, thank them and end the conversation.",
    opening: "Ask if they have a minute to rate their experience from one to five.",
    goodbye: "Thank you for your feedback. It really helps!",
    tags: ["feedback"]
  }
];
var starterById = (id) => STARTERS.find((starter) => starter.id === id) || STARTERS[0];
var clone = (value) => JSON.parse(JSON.stringify(value));
var GOODBYE_ID = "goodbye";
var INACTIVITY_MESSAGES = [
  { id: "still_there", text: "Are you still there?" },
  { id: "still_there_final", text: "I\u2019m still here whenever you\u2019re ready. Is there anything else I can help with?" },
  {
    id: "inactivity_goodbye",
    text: "I haven\u2019t heard from you, so I\u2019ll end the conversation now. Please get in touch again any time.",
    allow_interruptions: false
  }
];
var CALLBACK_MESSAGE = {
  id: "callback_line",
  text: "I\u2019m sorry, I can\u2019t put you through to a person from here right now. Please get in touch with us again a little later."
};
var TRANSFER_ID = "human_support";
var ESCALATE_ID = "escalate_to_human";
var INACTIVITY = {
  enabled: true,
  timeout_s: 10,
  max_nudges: 2,
  nudges: [
    { type: "say", text: { message: "still_there" } },
    { type: "say", text: { message: "still_there_final" } }
  ],
  on_exhausted: { do: [{ type: "end_call", say: { message: "inactivity_goodbye" } }] }
};
var usesVoice = (config) => (Array.isArray(config?.channels) ? config.channels : []).some(
  (channel) => channel && channel.enabled !== false && (["sip_voice", "web_voice"].includes(channel.type) || ["input", "output"].some((side) => Array.isArray(channel.modalities?.[side]) && channel.modalities[side].includes("audio")))
);
var upsertById = (list7, entries) => [
  ...(Array.isArray(list7) ? list7 : []).filter((item) => !entries.some((entry) => entry.id === item?.id)),
  ...entries
];
function applyStarter(config, starterId) {
  const starter = starterById(starterId);
  if (!config || starter.id === "blank") return config;
  const next = clone(config);
  const name = next.persona?.name || next.meta?.name || "your assistant";
  const company = next.persona?.company || void 0;
  next.meta = { ...next.meta || {}, description: starter.blurb, tags: [.../* @__PURE__ */ new Set([...next.meta?.tags || [], ...starter.tags || []])] };
  next.persona = { ...next.persona || {}, tone: starter.tone, style_rules: [...starter.styleRules || []] };
  if (usesVoice(next) && !next.persona.disclosures?.recording_notice) {
    next.persona.disclosures = { ...next.persona.disclosures || {}, recording_notice: "This call may be recorded to improve our service." };
  }
  (next.channels || []).forEach((channel) => {
    if (channel && channel.greeting && typeof channel.greeting.say === "string" && starter.greeting)
      channel.greeting.say = starter.greeting(name, company, isVoiceChannel(channel));
  });
  const messages = [{ id: GOODBYE_ID, text: starter.goodbye }];
  const tools = Array.isArray(next.tools) ? next.tools.filter((t) => t?.id !== "end_call") : [];
  tools.push({
    id: "end_call",
    type: "builtin",
    builtin: "end_call",
    description: "Ends the conversation. Use it after saying goodbye, when the person has nothing more to ask.",
    params: { say: { message: GOODBYE_ID } }
  });
  const offered = ["end_call"];
  const conversation = next.defaults?.conversation;
  if (!conversation?.inactivity) {
    next.defaults = { ...next.defaults || {}, conversation: { ...conversation || {}, inactivity: clone(INACTIVITY) } };
    messages.push(...INACTIVITY_MESSAGES);
  }
  next.messages = upsertById(next.messages, messages);
  next.tools = tools;
  const items = next.agents?.items;
  if (Array.isArray(items) && items.length) {
    const entry = items.find((agent) => agent.id === next.agents.entry) || items[0];
    entry.instructions = { ...entry.instructions || {}, role: starter.role, opening: starter.opening };
    entry.tools = [.../* @__PURE__ */ new Set([...entry.tools || [], ...offered])];
  }
  return starter.person ? addPersonHandoff(next) : next;
}
function addPersonHandoff(config, { id = ESCALATE_ID } = {}) {
  if (!config) return config;
  const next = clone(config);
  const tools = Array.isArray(next.tools) ? next.tools : [];
  const messages = [];
  if (!tools.some((t) => t?.id === id)) {
    if (!(Array.isArray(next.messages) && next.messages.some((m2) => m2?.id === CALLBACK_MESSAGE.id))) messages.push(CALLBACK_MESSAGE);
    tools.push({
      id,
      type: "builtin",
      builtin: "transfer_or_callback",
      description: "Use when the caller asks for a person, or you cannot help them.",
      params: { transfer: TRANSFER_ID, fallback: [{ type: "say", text: { message: CALLBACK_MESSAGE.id } }] }
    });
  }
  next.tools = tools;
  const telephony = next.telephony || {};
  if (!(Array.isArray(telephony.transfers) && telephony.transfers.some((t) => t?.id === TRANSFER_ID))) {
    next.telephony = {
      ...telephony,
      transfers: [
        ...telephony.transfers || [],
        {
          id: TRANSFER_ID,
          description: "A person to take over. Add the number to transfer to; until then the callers hear the fallback line.",
          method: "sip_refer",
          target: ""
        }
      ]
    };
  }
  if (messages.length) next.messages = upsertById(next.messages, messages);
  const items = next.agents?.items;
  if (Array.isArray(items) && items.length) {
    const entry = items.find((agent) => agent.id === next.agents.entry) || items[0];
    entry.tools = [.../* @__PURE__ */ new Set([...entry.tools || [], id])];
  }
  return next;
}

// weave-react/src/studio/form/references.js
var ID_MAX = 64;
function freshId(taken, base2) {
  const clean = String(base2 || "item").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^[^a-z]+/, "").replace(/_+$/, "") || "item";
  const fit = (tail = "") => `${clean.slice(0, ID_MAX - tail.length).replace(/_+$/, "")}${tail}`;
  const set = new Set(taken);
  if (!set.has(fit())) return fit();
  let n = 2;
  while (set.has(fit(`_${n}`))) n += 1;
  return fit(`_${n}`);
}

// weave-react/src/studio/form/channelTypes.js
var list2 = (v) => Array.isArray(v) ? v : [];
var isObj2 = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var text = (v) => typeof v === "string" ? v : v === void 0 || v === null ? "" : String(v);
var WEB_IN = ["audio", "text", "image", "video"];
var FALLBACK_TYPES = [
  {
    type: "sip_voice",
    label: "Phone line (SIP)",
    runs_today: true,
    input: ["audio"],
    output: ["audio"],
    voice: true,
    can_have_keypad: true,
    can_show_forms: false,
    entry_fields: ["dnis", "sip_trunk", "dispatch_rule"],
    default_modalities: { input: ["audio"], output: ["audio"] },
    note: "A phone call carries audio only: no typed text, images or video, and nothing to show a form on. The caller has a keypad."
  },
  {
    type: "web_voice",
    label: "Web voice",
    runs_today: true,
    input: WEB_IN,
    output: ["audio", "text"],
    voice: true,
    can_have_keypad: false,
    can_show_forms: true,
    entry_fields: ["widget_id", "allowed_origins"],
    default_modalities: { input: ["audio"], output: ["audio"] },
    note: "A visitor talks in the browser; typing, an image or the camera can be added; the reply is spoken and also written. There is no keypad."
  },
  {
    type: "web_chat",
    label: "Web chat",
    runs_today: true,
    input: WEB_IN,
    output: ["audio", "text"],
    voice: true,
    can_have_keypad: false,
    can_show_forms: true,
    entry_fields: ["widget_id", "allowed_origins"],
    default_modalities: { input: ["text"], output: ["text"] },
    note: "A chat box in the browser. If the visitor can also talk to it, the channel is web voice, not web chat."
  },
  {
    type: "whatsapp",
    label: "WhatsApp",
    runs_today: false,
    input: ["text", "image"],
    output: ["text"],
    voice: false,
    can_have_keypad: false,
    can_show_forms: false,
    entry_fields: ["phone_number_id"],
    default_modalities: { input: ["text"], output: ["text"] },
    note: "Text and pictures. Nothing connects WhatsApp to the runtime yet."
  },
  {
    type: "sms",
    label: "SMS",
    runs_today: false,
    input: ["text"],
    output: ["text"],
    voice: false,
    can_have_keypad: false,
    can_show_forms: false,
    entry_fields: [],
    default_modalities: { input: ["text"], output: ["text"] },
    note: "Plain text. Nothing connects SMS to the runtime yet."
  },
  {
    type: "email",
    label: "Email",
    runs_today: false,
    input: ["text", "image"],
    output: ["text"],
    voice: false,
    can_have_keypad: false,
    can_show_forms: false,
    entry_fields: [],
    default_modalities: { input: ["text"], output: ["text"] },
    note: "Text and attached pictures. Nothing connects email to the runtime yet."
  },
  {
    type: "custom",
    label: "Custom",
    runs_today: true,
    input: WEB_IN,
    output: ["audio", "text"],
    voice: true,
    can_have_keypad: true,
    can_show_forms: true,
    entry_fields: null,
    default_modalities: { input: ["text"], output: ["text"] },
    note: "Anything you map yourself with `match` (a connector participant, say). Not restricted."
  }
];
function normalizeChannelTypes(raw) {
  const rows = list2(isObj2(raw) ? raw.types : raw);
  return rows.filter((r) => isObj2(r) && text(r.type)).map((r) => ({
    type: text(r.type),
    label: text(r.label) || text(r.type),
    runsToday: r.runs_today !== false,
    // a list the server left out means "not restricted" (null), never "nothing allowed"
    input: Array.isArray(r.input) ? r.input.map(text) : null,
    output: Array.isArray(r.output) ? r.output.map(text) : null,
    voice: r.voice === true,
    canKeypad: r.can_have_keypad === true,
    canForms: r.can_show_forms === true,
    entryFields: r.entry_fields === null ? null : list2(r.entry_fields).map(text),
    // null = any (a custom channel)
    defaultModalities: {
      input: list2(r.default_modalities?.input).map(text),
      output: list2(r.default_modalities?.output).map(text)
    },
    note: text(r.note)
  }));
}
var FALLBACK = normalizeChannelTypes(FALLBACK_TYPES);

// weave-react/src/studio/form/presets.js
var REACH_WORDS = {
  web_chat: { label: "Chat on your website", text: "A chat box on your website that visitors type into." },
  web_voice: { label: "Talk on your website", text: "Visitors talk to it from the browser, with their microphone." },
  sip_voice: { label: "Phone calls", text: "People ring a phone number. You add the number when it goes live." }
};
var TYPE_LABELS = {
  sip_voice: REACH_WORDS.sip_voice.label,
  web_voice: REACH_WORDS.web_voice.label,
  web_chat: REACH_WORDS.web_chat.label,
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "Email",
  custom: "Custom"
};
var GREETING_VOICE = "Hello, thanks for calling. How can I help you today?";
var GREETING_CHAT = "Hi! How can I help you today?";
var CHANNEL_PRESETS = [
  { id: "phone", type: "sip_voice", label: REACH_WORDS.sip_voice.label, note: "Callers dial a number", base: "phone" },
  { id: "web_voice", type: "web_voice", label: REACH_WORDS.web_voice.label, note: "Talk to the agent in the browser", base: "web_voice" },
  { id: "web_chat", type: "web_chat", label: REACH_WORDS.web_chat.label, note: "A chat widget on a website", base: "web_chat" },
  { id: "whatsapp", type: "whatsapp", label: "WhatsApp", note: "Messages on WhatsApp", base: "whatsapp" },
  { id: "sms", type: "sms", label: "SMS", note: "Text messages", base: "sms" },
  { id: "email", type: "email", label: "Email", note: "Email conversations", base: "email" }
];
function defaultsForType(type, botId) {
  const widget = `${botId || "agent"}-widget`;
  switch (type) {
    case "sip_voice":
      return {
        entry: {},
        modalities: { input: ["audio"], output: ["audio"] },
        greeting: { say: GREETING_VOICE },
        capabilities: { dtmf: true, human_transfer: true }
      };
    case "web_voice":
      return {
        entry: { widget_id: widget },
        modalities: { input: ["audio"], output: ["audio"] },
        greeting: { say: GREETING_VOICE },
        capabilities: { forms: true }
      };
    case "web_chat":
      return {
        entry: { widget_id: widget },
        modalities: { input: ["text"], output: ["text"] },
        greeting: { say: GREETING_CHAT },
        capabilities: { forms: true }
      };
    case "whatsapp":
      return { entry: {}, modalities: { input: ["text"], output: ["text"] }, greeting: { say: GREETING_CHAT }, capabilities: { forms: false } };
    case "sms":
    case "email":
      return { modalities: { input: ["text"], output: ["text"] } };
    default:
      return { modalities: { input: ["text"], output: ["text"] } };
  }
}
function buildChannel(presetId, { taken = [], botId = "" } = {}) {
  const preset = CHANNEL_PRESETS.find((item) => item.id === presetId) || CHANNEL_PRESETS[0];
  const start = defaultsForType(preset.type, botId);
  const lookalikes = taken.map((id) => String(id).replace(/-/g, "_"));
  const channel = { id: freshId([...taken, ...lookalikes], preset.base), type: preset.type, enabled: true, ...start };
  return channel;
}

// weave-react/src/voiceCatalog.js
var VOICE_CATALOG = [
  {
    id: "elevenlabs-sarah",
    name: "Sarah",
    provider: "ElevenLabs",
    language: "English (United States)",
    locale: "en-US",
    gender: "Female",
    style: "Reassuring",
    voiceId: "EXAVITQu4vr4xnSDxMaL",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/EXAVITQu4vr4xnSDxMaL/01a3e33c-6e99-4ee7-8543-ff2216a32186.mp3",
    tags: ["English", "American", "Reassuring"]
  },
  {
    id: "elevenlabs-jessica",
    name: "Jessica",
    provider: "ElevenLabs",
    language: "English (United States)",
    locale: "en-US",
    gender: "Female",
    style: "Playful",
    voiceId: "cgSgspJ2msm6clMCkdW9",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/cgSgspJ2msm6clMCkdW9/56a97bf8-b69b-448f-846c-c3a11683d45a.mp3",
    tags: ["English", "American", "Playful"]
  },
  {
    id: "elevenlabs-laura",
    name: "Laura",
    provider: "ElevenLabs",
    language: "English (United States)",
    locale: "en-US",
    gender: "Female",
    style: "Quirky",
    voiceId: "FGY2WhTYpPnrIDTdsKH5",
    previewUrl: "https://api.us.elevenlabs.io/v1/voices/FGY2WhTYpPnrIDTdsKH5/previews/audio?payload=eyJ2b2ljZV9zb3VyY2UiOiJwcmVtYWRlIiwiZmlsZW5hbWUiOiI2NzM0MTc1OS1hZDA4LTQxYTUtYmU2ZS1kZTEyZmU0NDg2MTgubXAzIiwidGltZXN0YW1wIjoxNzkyMTcwMDAwMDAwMDAwfQ%3D%3D",
    tags: ["English", "American", "Quirky"]
  },
  {
    id: "elevenlabs-alice",
    name: "Alice",
    provider: "ElevenLabs",
    language: "English (United Kingdom)",
    locale: "en-GB",
    gender: "Female",
    style: "Engaging",
    voiceId: "Xb7hH8MSUJpSbSDYk0k2",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/Xb7hH8MSUJpSbSDYk0k2/d10f7534-11f6-41fe-a012-2de1e482d336.mp3",
    tags: ["English", "British", "Engaging"]
  },
  {
    id: "elevenlabs-matilda",
    name: "Matilda",
    provider: "ElevenLabs",
    language: "English (United States)",
    locale: "en-US",
    gender: "Female",
    style: "Professional",
    voiceId: "XrExE9yKIg1WjnnlVkGX",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/XrExE9yKIg1WjnnlVkGX/b930e18d-6b4d-466e-bab2-0ae97c6d8535.mp3",
    tags: ["English", "American", "Professional"]
  },
  {
    id: "elevenlabs-lily",
    name: "Lily",
    provider: "ElevenLabs",
    language: "English (United Kingdom)",
    locale: "en-GB",
    gender: "Female",
    style: "Velvety",
    voiceId: "pFZP5JQG7iQjIQuC4Bku",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/pFZP5JQG7iQjIQuC4Bku/89b68b35-b3dd-4348-a84a-a3c13a3c2b30.mp3",
    tags: ["English", "British", "Velvety"]
  },
  {
    id: "elevenlabs-bella",
    name: "Bella",
    provider: "ElevenLabs",
    language: "English (United States)",
    locale: "en-US",
    gender: "Female",
    style: "Bright",
    voiceId: "hpp4J3VqNfWAUOO0d1Us",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/hpp4J3VqNfWAUOO0d1Us/dab0f5ba-3aa4-48a8-9fad-f138fea1126d.mp3",
    tags: ["English", "American", "Bright"]
  },
  {
    id: "elevenlabs-adam",
    name: "Adam",
    provider: "ElevenLabs",
    language: "English (United States)",
    locale: "en-US",
    gender: "Male",
    style: "Dominant",
    voiceId: "pNInz6obpgDQGcFmaJgB",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/pNInz6obpgDQGcFmaJgB/d6905d7a-dd26-4187-bfff-1bd3a5ea7cac.mp3",
    tags: ["English", "American", "Dominant"]
  },
  {
    id: "elevenlabs-eric",
    name: "Eric",
    provider: "ElevenLabs",
    language: "English (United States)",
    locale: "en-US",
    gender: "Male",
    style: "Smooth",
    voiceId: "cjVigY5qzO86Huf0OWal",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/cjVigY5qzO86Huf0OWal/d098fda0-6456-4030-b3d8-63aa048c9070.mp3",
    tags: ["English", "American", "Smooth"]
  },
  {
    id: "elevenlabs-roger",
    name: "Roger",
    provider: "ElevenLabs",
    language: "English (United States)",
    locale: "en-US",
    gender: "Male",
    style: "Laid-back",
    voiceId: "CwhRBWXzGAHq8TQ4Fs17",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/CwhRBWXzGAHq8TQ4Fs17/58ee3ff5-f6f2-4628-93b8-e38eb31806b0.mp3",
    tags: ["English", "American", "Laid-back"]
  },
  {
    id: "elevenlabs-george",
    name: "George",
    provider: "ElevenLabs",
    language: "English (United Kingdom)",
    locale: "en-GB",
    gender: "Male",
    style: "Warm",
    voiceId: "JBFqnCBsd6RMkjVDRZzb",
    previewUrl: "https://api.us.elevenlabs.io/v1/voices/JBFqnCBsd6RMkjVDRZzb/previews/audio?payload=eyJ2b2ljZV9zb3VyY2UiOiJwcmVtYWRlIiwiZmlsZW5hbWUiOiJlNjIwNmQxYS0wNzIxLTQ3ODctYWFmYi0wNmE2ZTcwNWNhYzUubXAzIiwidGltZXN0YW1wIjoxNzkyMTcwMDAwMDAwMDAwfQ%3D%3D",
    tags: ["English", "British", "Warm"]
  },
  {
    id: "elevenlabs-daniel",
    name: "Daniel",
    provider: "ElevenLabs",
    language: "English (United Kingdom)",
    locale: "en-GB",
    gender: "Male",
    style: "Steady",
    voiceId: "onwK4e9ZLuTAKqWW03F9",
    previewUrl: "https://api.us.elevenlabs.io/v1/voices/onwK4e9ZLuTAKqWW03F9/previews/audio?payload=eyJ2b2ljZV9zb3VyY2UiOiJwcmVtYWRlIiwiZmlsZW5hbWUiOiI3ZWVlMDIzNi0xYTcyLTRiODYtYjMwMy01ZGNhZGMwMDdiYTkubXAzIiwidGltZXN0YW1wIjoxNzkyMTcwMDAwMDAwMDAwfQ%3D%3D",
    tags: ["English", "British", "Steady"]
  },
  {
    id: "elevenlabs-brian",
    name: "Brian",
    provider: "ElevenLabs",
    language: "English (United States)",
    locale: "en-US",
    gender: "Male",
    style: "Resonant",
    voiceId: "nPczCjzI2devNBz1zQrb",
    previewUrl: "https://api.us.elevenlabs.io/v1/voices/nPczCjzI2devNBz1zQrb/previews/audio?payload=eyJ2b2ljZV9zb3VyY2UiOiJwcmVtYWRlIiwiZmlsZW5hbWUiOiIyZGQzZTcyYy00ZmQzLTQyZjEtOTNlYS1hYmM1ZDRlNWFhMWQubXAzIiwidGltZXN0YW1wIjoxNzkyMTcwMDAwMDAwMDAwfQ%3D%3D",
    tags: ["English", "American", "Resonant"]
  },
  {
    id: "elevenlabs-chris",
    name: "Chris",
    provider: "ElevenLabs",
    language: "English (United States)",
    locale: "en-US",
    gender: "Male",
    style: "Down-to-earth",
    voiceId: "iP95p4xoKVk53GoZ742B",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/iP95p4xoKVk53GoZ742B/3f4bde72-cc48-40dd-829f-57fbf906f4d7.mp3",
    tags: ["English", "American", "Down-to-earth"]
  },
  {
    id: "elevenlabs-will",
    name: "Will",
    provider: "ElevenLabs",
    language: "English (United States)",
    locale: "en-US",
    gender: "Male",
    style: "Relaxed",
    voiceId: "bIHbv24MWmeRgasZH58o",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/bIHbv24MWmeRgasZH58o/8caf8f3d-ad29-4980-af41-53f20c72d7a4.mp3",
    tags: ["English", "American", "Relaxed"]
  },
  {
    id: "elevenlabs-bill",
    name: "Bill",
    provider: "ElevenLabs",
    language: "English (United States)",
    locale: "en-US",
    gender: "Male",
    style: "Wise",
    voiceId: "pqHfZKP75CvOlQylNhV4",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/pqHfZKP75CvOlQylNhV4/d782b3ff-84ba-4029-848c-acf01285524d.mp3",
    tags: ["English", "American", "Wise"]
  },
  {
    id: "elevenlabs-charlie",
    name: "Charlie",
    provider: "ElevenLabs",
    language: "English (Australia)",
    locale: "en-AU",
    gender: "Male",
    style: "Energetic",
    voiceId: "IKne3meq5aSn9XLyUdCD",
    previewUrl: "https://api.us.elevenlabs.io/v1/voices/IKne3meq5aSn9XLyUdCD/previews/audio?payload=eyJ2b2ljZV9zb3VyY2UiOiJwcmVtYWRlIiwiZmlsZW5hbWUiOiIxMDJkZTZmMi0yMmVkLTQzZTAtYTFmMS0xMTFmYTc1YzU0ODEubXAzIiwidGltZXN0YW1wIjoxNzkyMTcwMDAwMDAwMDAwfQ%3D%3D",
    tags: ["English", "Australian", "Energetic"]
  },
  {
    id: "elevenlabs-liam",
    name: "Liam",
    provider: "ElevenLabs",
    language: "English (United States)",
    locale: "en-US",
    gender: "Male",
    style: "Energetic",
    voiceId: "TX3LPaxmHKxFdv7VOQHJ",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/TX3LPaxmHKxFdv7VOQHJ/63148076-6363-42db-aea8-31424308b92c.mp3",
    tags: ["English", "American", "Energetic"]
  },
  {
    id: "elevenlabs-callum",
    name: "Callum",
    provider: "ElevenLabs",
    language: "English (United States)",
    locale: "en-US",
    gender: "Male",
    style: "Husky",
    voiceId: "N2lVS1w4EtoT3dr4eOWO",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/N2lVS1w4EtoT3dr4eOWO/ac833bd8-ffda-4938-9ebc-b0f99ca25481.mp3",
    tags: ["English", "American", "Husky"]
  },
  {
    id: "elevenlabs-harry",
    name: "Harry",
    provider: "ElevenLabs",
    language: "English (United States)",
    locale: "en-US",
    gender: "Male",
    style: "Fierce",
    voiceId: "SOYHLrjzK2X1ezoPC6cr",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/SOYHLrjzK2X1ezoPC6cr/86d178f6-f4b6-4e0e-85be-3de19f490794.mp3",
    tags: ["English", "American", "Fierce"]
  },
  {
    id: "cartesia-skylar",
    name: "Skylar",
    provider: "Cartesia",
    language: "English (United States)",
    locale: "en-US",
    gender: "Female",
    style: "Friendly Guide",
    voiceId: "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4",
    previewUrl: "https://cdn.creativeclaw.co/voice-catalog/demos/v1/cartesia/97cddd2939e40ff178aa73d406966c0b.mp3",
    tags: ["English", "American", "Friendly Guide"]
  },
  {
    id: "cartesia-jacqueline",
    name: "Jacqueline",
    provider: "Cartesia",
    language: "English (United States)",
    locale: "en-US",
    gender: "Female",
    style: "Reassuring Agent",
    voiceId: "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc",
    previewUrl: "https://cdn.creativeclaw.co/voice-catalog/demos/v1/cartesia/77e37190f5a9f9e45f7653b7b04cf738.mp3",
    tags: ["English", "American", "Reassuring Agent"]
  },
  {
    id: "cartesia-katie",
    name: "Katie",
    provider: "Cartesia",
    language: "English (United States)",
    locale: "en-US",
    gender: "Female",
    style: "Friendly Fixer",
    voiceId: "f786b574-daa5-4673-aa0c-cbe3e8534c02",
    previewUrl: "https://cdn.creativeclaw.co/voice-catalog/demos/v1/cartesia/1b4d1c310b95954412a8adb8a2d4663c.mp3",
    tags: ["English", "American", "Friendly Fixer"]
  },
  {
    id: "cartesia-daniel",
    name: "Daniel",
    provider: "Cartesia",
    language: "English (United States)",
    locale: "en-US",
    gender: "Male",
    style: "Modern Assistant",
    voiceId: "47c38ca4-5f35-497b-b1a3-415245fb35e1",
    previewUrl: "https://cdn.creativeclaw.co/voice-catalog/demos/v1/cartesia/40ba519add5dd25228e7d69a5b0a0871.mp3",
    tags: ["English", "American", "Modern Assistant"]
  },
  {
    id: "cartesia-parker",
    name: "Parker",
    provider: "Cartesia",
    language: "English (United States)",
    locale: "en-US",
    gender: "Male",
    style: "Supportive Pal",
    voiceId: "30894953-bcce-41fe-892c-15ce19c843ff",
    previewUrl: "https://cdn.creativeclaw.co/voice-catalog/demos/v1/cartesia/b2b537f3d55a02b28b5b509293885977.mp3",
    tags: ["English", "American", "Supportive Pal"]
  },
  {
    id: "cartesia-jameson",
    name: "Jameson",
    provider: "Cartesia",
    language: "English (United States)",
    locale: "en-US",
    gender: "Male",
    style: "Easygoing Support",
    voiceId: "a5136bf9-224c-4d76-b823-52bd5efcffcc",
    previewUrl: "https://cdn.creativeclaw.co/voice-catalog/demos/v1/cartesia/5d217dbf2af27eb5ab77e4a06949da31.mp3",
    tags: ["English", "American", "Easygoing Support"]
  },
  {
    id: "cartesia-gemma",
    name: "Gemma",
    provider: "Cartesia",
    language: "English (United Kingdom)",
    locale: "en-GB",
    gender: "Female",
    style: "Decisive Agent",
    voiceId: "62ae83ad-4f6a-430b-af41-a9bede9286ca",
    previewUrl: "https://cdn.creativeclaw.co/voice-catalog/demos/v1/cartesia/0d6697486244ccdb5001152101ab9118.mp3",
    tags: ["English", "British", "Decisive Agent"]
  },
  {
    id: "cartesia-julia",
    name: "Julia",
    provider: "Cartesia",
    language: "English (United Kingdom)",
    locale: "en-GB",
    gender: "Female",
    style: "Gentle Guide",
    voiceId: "273f9ef7-9fc2-4def-88bb-ab108c6249ca",
    previewUrl: "https://cdn.creativeclaw.co/voice-catalog/demos/v1/cartesia/36dbe89bb9b635543e77cb5e9063e8b2.mp3",
    tags: ["English", "British", "Gentle Guide"]
  },
  {
    id: "cartesia-archie",
    name: "Archie",
    provider: "Cartesia",
    language: "English (United Kingdom)",
    locale: "en-GB",
    gender: "Male",
    style: "Approachable Mate",
    voiceId: "ef191366-f52f-447a-a398-ed8c0f2943a1",
    previewUrl: "https://cdn.creativeclaw.co/voice-catalog/demos/v1/cartesia/62cd0a7fdaa7201ebc19c532b11149e4.mp3",
    tags: ["English", "British", "Approachable Mate"]
  },
  {
    id: "cartesia-quentin",
    name: "Quentin",
    provider: "Cartesia",
    language: "English (United Kingdom)",
    locale: "en-GB",
    gender: "Male",
    style: "Refined Narrator",
    voiceId: "5568a7df-e5ab-4442-9fae-2e9ba1b15ad8",
    previewUrl: "https://cdn.creativeclaw.co/voice-catalog/demos/v1/cartesia/111c8bf2c7a69ceaa3cbe6d9194d38b5.mp3",
    tags: ["English", "British", "Refined Narrator"]
  },
  {
    id: "cartesia-ella",
    name: "Ella",
    provider: "Cartesia",
    language: "English (Australia)",
    locale: "en-AU",
    gender: "Female",
    style: "Caring Scout",
    voiceId: "2a12b36c-7f9b-4c3a-9f7a-72731b15323a",
    previewUrl: "https://cdn.creativeclaw.co/voice-catalog/demos/v1/cartesia/836950d4472bb9597a3199e6ade172b4.mp3",
    tags: ["English", "Australian", "Caring Scout"]
  },
  {
    id: "cartesia-arlo",
    name: "Arlo",
    provider: "Cartesia",
    language: "English (Australia)",
    locale: "en-AU",
    gender: "Male",
    style: "Service Specialist",
    voiceId: "12e85709-099c-480a-ba3e-875c41a9611a",
    previewUrl: "https://cdn.creativeclaw.co/voice-catalog/demos/v1/cartesia/7a8481817f0031797ff3b61bce6254a3.mp3",
    tags: ["English", "Australian", "Service Specialist"]
  },
  {
    id: "cartesia-ximena",
    name: "Ximena",
    provider: "Cartesia",
    language: "Spanish (Mexico)",
    locale: "es-MX",
    gender: "Female",
    style: "Calm Navigator",
    voiceId: "3597a26f-80ef-4bd5-8101-9699bc764917",
    previewUrl: "https://cdn.creativeclaw.co/voice-catalog/demos/v1/cartesia/c1dd558fc5773504915843be6ac1c166.mp3",
    tags: ["Spanish", "Mexican", "Calm Navigator"]
  },
  {
    id: "cartesia-ramon",
    name: "Ramon",
    provider: "Cartesia",
    language: "Spanish (Mexico)",
    locale: "es-MX",
    gender: "Male",
    style: "Calm Coordinator",
    voiceId: "9b67072c-d46c-465d-87dc-f7a1c6db2bf3",
    previewUrl: "https://cdn.creativeclaw.co/voice-catalog/demos/v1/cartesia/02aa1fbcbf3c999714a66ef625038163.mp3",
    tags: ["Spanish", "Mexican", "Calm Coordinator"]
  },
  {
    id: "cartesia-rafael",
    name: "Rafael",
    provider: "Cartesia",
    language: "Spanish (Spain)",
    locale: "es-ES",
    gender: "Male",
    style: "Poised Advisor",
    voiceId: "cbb6fdf0-30dd-49f6-af7d-bbb1185c1fa5",
    previewUrl: "https://cdn.creativeclaw.co/voice-catalog/demos/v1/cartesia/2d577a43daa03db92e13690b20a097be.mp3",
    tags: ["Spanish", "Castilian", "Poised Advisor"]
  },
  {
    id: "cartesia-iria",
    name: "Iria",
    provider: "Cartesia",
    language: "Spanish (Spain)",
    locale: "es-ES",
    gender: "Female",
    style: "Thoughtful Communicator",
    voiceId: "a7beff01-8f8b-4809-bfe6-e2166e57e0c2",
    previewUrl: "https://cdn.creativeclaw.co/voice-catalog/demos/v1/cartesia/f2238fb5a06c2ebb87364f2637c8da32.mp3",
    tags: ["Spanish", "Castilian", "Thoughtful Communicator"]
  }
];

// weave-react/src/studio/models/catalog.js
var m = (id, label, note, tags = []) => ({ id, label, note, tags });
var FALLBACK_PROVIDERS = [
  {
    name: "openai",
    stages: ["stt", "llm", "tts", "realtime"],
    installed: true,
    realtime_runnable: true,
    default_secret: "OPENAI_API_KEY",
    key_available: null
  },
  { name: "openai_compatible", stages: ["stt", "llm", "tts"], installed: true, default_secret: "OPENAI_API_KEY", key_available: null },
  { name: "anthropic", stages: ["llm"], installed: true, default_secret: "ANTHROPIC_API_KEY", key_available: null },
  { name: "deepgram", stages: ["stt", "tts"], installed: true, default_secret: "DEEPGRAM_API_KEY", key_available: null },
  { name: "cartesia", stages: ["stt", "tts"], installed: true, default_secret: "CARTESIA_API_KEY", key_available: null },
  { name: "elevenlabs", stages: ["stt", "tts"], installed: true, default_secret: "ELEVEN_API_KEY", key_available: null },
  { name: "silero", stages: ["vad"], installed: true, default_secret: null, key_available: null }
];
var MODEL_OPTIONS = {
  stt: {
    openai: [
      m("gpt-realtime-whisper", "GPT Realtime Whisper", "Streaming transcription for live calls", ["live calls"]),
      m("gpt-4o-transcribe", "GPT-4o Transcribe", "High-accuracy speech recognition", ["accurate"]),
      m("gpt-4o-mini-transcribe", "GPT-4o Mini Transcribe", "Lower-latency, cost-conscious transcription", ["fast"]),
      m("whisper-1", "Whisper 1", "General-purpose transcription"),
      m("gpt-4o-transcribe-diarize", "GPT-4o Transcribe Diarize", "Transcription with speaker labels"),
      m("gpt-4o-mini-transcribe-2025-03-20", "GPT-4o Mini Transcribe (Snapshot)", "Pinned model snapshot where supported")
    ],
    deepgram: [
      m("nova-3", "Nova-3", "Latest-generation speech recognition", ["accurate", "live calls"]),
      m("nova-2", "Nova-2", "Balanced accuracy and speed"),
      m("nova-2-general", "Nova-2 General", "General conversation transcription"),
      m("nova-2-phonecall", "Nova-2 Phonecall", "Optimized for telephone audio", ["phone"])
    ],
    cartesia: [m("ink-whisper", "Ink Whisper", "Cartesia\u2019s streaming speech recognition")],
    elevenlabs: [m("scribe_v1", "Scribe v1", "ElevenLabs speech recognition")],
    assemblyai: [m("universal-streaming", "Universal Streaming", "Real-time streaming transcription")],
    google: [m("chirp_2", "Chirp 2", "Multilingual speech recognition"), m("latest_long", "Latest Long", "Long-form conversation")],
    groq: [
      m("whisper-large-v3", "Whisper Large v3", "High-accuracy multilingual recognition"),
      m("whisper-large-v3-turbo", "Whisper Large v3 Turbo", "Faster large-model variant")
    ],
    openai_compatible: []
  },
  llm: {
    openai: [
      m("gpt-5.4", "GPT-5.4", "Advanced reasoning and complex tasks", ["most capable"]),
      m("gpt-5.4-mini", "GPT-5.4 Mini", "Balanced speed and capability"),
      m("gpt-5.4-nano", "GPT-5.4 Nano", "Lightweight, low-latency tasks", ["fast"]),
      m("gpt-4.1", "GPT-4.1", "Strong general-purpose model"),
      m("gpt-4.1-mini", "GPT-4.1 Mini", "Efficient general-purpose model")
    ],
    anthropic: [
      m("claude-sonnet-5-5", "Claude Sonnet 5.5", "Balanced quality and speed"),
      m("claude-haiku-5-5", "Claude Haiku 5.5", "Fastest, for low-latency replies", ["fast"]),
      m("claude-opus-5-5", "Claude Opus 5.5", "Most capable, for complex tasks", ["most capable"]),
      m("claude-fable-5-1", "Claude Fable 5.1", "Latest generation")
    ],
    google: [
      m("gemini-2.5-flash", "Gemini 2.5 Flash", "Fast, general purpose"),
      m("gemini-2.5-pro", "Gemini 2.5 Pro", "Advanced reasoning"),
      m("gemini-2.0-flash", "Gemini 2.0 Flash", "Previous generation, low latency")
    ],
    groq: [
      m("llama-3.3-70b-versatile", "Llama 3.3 70B", "Capable open model, fast on Groq"),
      m("llama-3.1-8b-instant", "Llama 3.1 8B", "Lightweight, lowest latency")
    ],
    openai_compatible: []
  },
  tts: {
    elevenlabs: [
      m("eleven_flash_v2_5", "Flash v2.5", "Lowest latency, best for live calls", ["fast", "live calls"]),
      m("eleven_turbo_v2_5", "Turbo v2.5", "Fast, with higher quality than Flash"),
      m("eleven_multilingual_v2", "Multilingual v2", "Highest quality across many languages", ["multilingual"]),
      m("eleven_v3", "v3", "Most expressive; slower, for quality over speed")
    ],
    cartesia: [
      m("sonic-3", "Sonic 3", "Latest generation, natural and expressive"),
      m("sonic-2", "Sonic 2", "Previous generation, widely compatible"),
      m("sonic-turbo", "Sonic Turbo", "Lowest latency", ["fast"])
    ],
    openai: [
      m("gpt-4o-mini-tts", "GPT-4o Mini TTS", "Steerable, natural voices"),
      m("tts-1", "TTS 1", "Fast, standard quality"),
      m("tts-1-hd", "TTS 1 HD", "Higher quality")
    ],
    deepgram: [m("aura-2-thalia-en", "Aura 2 Thalia", "English voice, Aura 2"), m("aura-asteria-en", "Aura Asteria", "English voice, Aura")],
    google: [],
    groq: [],
    openai_compatible: []
  }
};
var SECRET_BY_PROVIDER = Object.fromEntries(
  FALLBACK_PROVIDERS.filter((provider) => provider.default_secret).map((provider) => [provider.name, provider.default_secret])
);
function secretFor(provider, providers) {
  const known = (providers || []).find((item) => item.name === provider)?.default_secret;
  if (known) return known;
  if (SECRET_BY_PROVIDER[provider]) return SECRET_BY_PROVIDER[provider];
  const name = String(provider || "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[A-Z]/.test(name) ? `${name}_API_KEY` : "";
}
var modelsFor = (stage, provider) => MODEL_OPTIONS[stage]?.[provider] || [];
var defaultModelFor = (stage, provider) => modelsFor(stage, provider)[0]?.id || "";

// weave-react/src/studio/models/config.js
var clone2 = (value) => JSON.parse(JSON.stringify(value));
var isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
var str = (value) => typeof value === "string" ? value : "";
var voicesFor = (provider, gender) => VOICE_CATALOG.filter((voice) => voice.provider.toLowerCase() === String(provider).toLowerCase() && (!gender || voice.gender === gender));
var defaultVoiceFor = (provider) => voicesFor(provider, "Female")[0] || voicesFor(provider)[0];
function readModels(config) {
  const models = isObject(config?.defaults?.models) ? config.defaults.models : {};
  const slot = (stage) => ({
    provider: str(models[stage]?.provider),
    model: str(models[stage]?.model),
    secret: str(models[stage]?.api_key?.secret),
    baseUrl: str(models[stage]?.base_url)
  });
  return { stt: slot("stt"), llm: slot("llm"), tts: { ...slot("tts"), voiceId: str(models.tts?.voice_id) } };
}
function edit(config, stage, change) {
  const next = clone2(config);
  const defaults = isObject(next.defaults) ? next.defaults : next.defaults = {};
  const models = isObject(defaults.models) ? defaults.models : defaults.models = {};
  const slot = { ...isObject(models[stage]) ? models[stage] : {} };
  change(slot);
  models[stage] = slot;
  return JSON.stringify(next) === JSON.stringify(config) ? config : next;
}
function setProvider(config, stage, provider, providers) {
  if (readModels(config)[stage].provider === provider) return config;
  return edit(config, stage, (slot) => {
    slot.provider = provider;
    const model = defaultModelFor(stage, provider);
    if (model) slot.model = model;
    else delete slot.model;
    const secret = secretFor(provider, providers);
    if (secret) slot.api_key = { secret };
    else delete slot.api_key;
    delete slot.base_url;
    delete slot.options;
    if (stage === "tts") {
      const voice = defaultVoiceFor(provider);
      if (voice) slot.voice_id = voice.voiceId;
      else delete slot.voice_id;
    }
  });
}

// weave-react/src/studio/simple/simpleModel.js
var list3 = (v) => Array.isArray(v) ? v : [];
var entryAgentIndex = (config) => {
  const items = list3(config?.agents?.items);
  const index = items.findIndex((agent) => isObj(agent) && typeof agent.id === "string" && agent.id === config?.agents?.entry);
  return index >= 0 ? index : items.findIndex(isObj);
};
var LANGUAGES = [
  ["en-US", "English (United States)"],
  ["en-GB", "English (United Kingdom)"],
  ["en-AU", "English (Australia)"],
  ["en-IN", "English (India)"],
  ["en-NG", "English (Nigeria)"],
  ["es-ES", "Spanish (Spain)"],
  ["es-MX", "Spanish (Mexico)"],
  ["fr-FR", "French (France)"],
  ["fr-CA", "French (Canada)"],
  ["de-DE", "German"],
  ["it-IT", "Italian"],
  ["pt-BR", "Portuguese (Brazil)"],
  ["pt-PT", "Portuguese (Portugal)"],
  ["nl-NL", "Dutch"],
  ["sv-SE", "Swedish"],
  ["pl-PL", "Polish"],
  ["tr-TR", "Turkish"],
  ["ar-SA", "Arabic"],
  ["hi-IN", "Hindi"],
  ["ja-JP", "Japanese"],
  ["ko-KR", "Korean"],
  ["zh-CN", "Chinese (Mandarin)"],
  ["id-ID", "Indonesian"],
  ["sw-KE", "Swahili"]
];
var languageName = (code) => LANGUAGES.find(([c]) => c === code)?.[1] || LANGUAGES.find(([c]) => baseOf(c) === baseOf(code))?.[1]?.replace(/ \(.*\)$/, "") || code || "";
var BASE_LANGUAGES = [...new Map(LANGUAGES.map(([code, name]) => [baseOf(code), name.replace(/ \(.*\)$/, "")]))].map(([code, name]) => ({
  code,
  name
}));

// weave-react/src/studio/setup/setupModel.js
var isObj3 = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var list4 = (v) => Array.isArray(v) ? v : [];
var clone3 = (v) => JSON.parse(JSON.stringify(v));
var STEPS = [
  { id: "start", label: "Name and starting point" },
  { id: "purpose", label: "What it does", title: "What should it do?", lead: "Tell it what its job is, as you would brief a new colleague." },
  { id: "reach", label: "Where people reach it", title: "Where will people reach it?", lead: "Choose one or more. You can change this later." },
  {
    id: "voice",
    label: "Language and voice",
    title: "Which language, and which voice?",
    lead: "The language it speaks and understands, and, when people talk to it, how it sounds."
  },
  {
    id: "knowledge",
    label: "What it knows",
    optional: true,
    title: "What should it know?",
    lead: "Add your documents or web pages. It looks up the answer there whenever someone asks."
  },
  {
    id: "actions",
    label: "What it can do",
    optional: true,
    title: "What can it do for people?",
    lead: "Switch on what it may do during a conversation. Each one works straight away."
  },
  { id: "try", label: "Try it", title: "Try it out", lead: "Have a conversation with it, as a customer would. Change anything, then try again." },
  { id: "live", label: "Go live", title: "Put it live", lead: "One step: it is published and put live, ready for people to use." }
];
var STEP_IDS = STEPS.map((s) => s.id);
var entryOf = (config) => list4(config?.agents?.items)[entryAgentIndex(config)] || null;
function withEntry(config, change) {
  const index = entryAgentIndex(config);
  if (index < 0) return config;
  const next = clone3(config);
  change(next.agents.items[index], next);
  return next;
}
var REACH = [
  { type: "web_chat", preset: "web_chat", icon: "chat", ...REACH_WORDS.web_chat },
  { type: "web_voice", preset: "web_voice", icon: "mic", ...REACH_WORDS.web_voice },
  { type: "sip_voice", preset: "phone", icon: "phone", ...REACH_WORDS.sip_voice }
];
var DETAIL_FIELDS = [
  { name: "name", label: "Name", type: "text" },
  { name: "phone", label: "Phone number", type: "phone" },
  { name: "email", label: "Email", type: "email" },
  { name: "need", label: "What they need", type: "text", ask: "what you need" },
  { name: "when", label: "Preferred day and time", type: "text", ask: "the day and time that suit you" },
  { name: "message", label: "Message", type: "textarea" }
];
var REQUEST_FIELDS = ["name", "phone", "need", "when"];
var IDS = { end_call: "end_call", hand_over: "escalate_to_human", details: "collect_details", lookup: "look_up" };
var FORM_ID = "contact_details";
var GOODBYE = { id: "goodbye", text: "Thank you for getting in touch. Goodbye!" };
var isOwn = (id, base2) => typeof id === "string" && (id === base2 || new RegExp(`^${base2}_\\d+$`).test(id));
var toolIds = (config) => list4(config?.tools).map((t) => t?.id);
var IS_TOOL = {
  end_call: (t) => t.type === "builtin" && t.builtin === "end_call",
  hand_over: (t) => t.type === "builtin" && t.builtin === "transfer_or_callback",
  // only the switch's own form: a tool showing the person's own form is theirs, whatever it is called
  details: (t) => t.type === "builtin" && t.builtin === "send_form" && isOwn(t.params?.form, FORM_ID),
  lookup: (t) => t.type === "http" && isOwn(t.id, IDS.lookup)
};
function toolsFor(config, action) {
  const has2 = list4(entryOf(config)?.tools);
  const rank = (t) => has2.includes(t.id) ? 0 : isOwn(t.id, IDS[action]) ? 1 : 2;
  return list4(config?.tools).filter((t) => isObj3(t) && typeof t.id === "string" && IS_TOOL[action](t)).sort((a, b) => rank(a) - rank(b));
}
var POINTERS = {
  tools: ["tool", "then", "tool_called", "tool_not_called"],
  transfers: ["transfer"],
  forms: ["form"],
  connections: ["connection", "server", "via"],
  messages: ["message"]
};
function usedIn(config, kind, id) {
  const keys = POINTERS[kind];
  const found = /* @__PURE__ */ new Set();
  const visit = (node, key, section) => {
    if (Array.isArray(node)) {
      if (kind === "tools" && key === "tools" && node.includes(id)) found.add(section);
      node.forEach((item) => visit(item, key, section));
    } else if (isObj3(node))
      Object.entries(node).forEach(([k, v]) => {
        if (typeof v !== "string") visit(v, k, section || k);
        else if (keys.includes(k) && v === id) found.add(section || k);
      });
  };
  visit(config, "", "");
  return [...found];
}
function dropTools(config, action, extra = () => {
}) {
  const ids = toolsFor(config, action).map((t) => t.id);
  if (!ids.length) return config;
  return withEntry(config, (agent, next) => {
    agent.tools = list4(agent.tools).filter((id) => !ids.includes(id));
    ids.filter((id) => isOwn(id, IDS[action]) && !usedIn(next, "tools", id).length).forEach((id) => {
      const tool = list4(next.tools).find((t) => t?.id === id);
      next.tools = list4(next.tools).filter((t) => t !== tool);
      dropLines(next, tool);
      extra(next, tool);
    });
  });
}
var giveTool = (config, id) => withEntry(config, (agent) => {
  if (!list4(agent.tools).includes(id)) agent.tools = [...list4(agent.tools), id];
});
var STUDIO_LINES = [GOODBYE.text, CALLBACK_MESSAGE.text, ...STARTERS.map((s) => s.goodbye).filter(Boolean)];
var untouched = (line) => Object.keys(line).every((k) => k === "id" || k === "text") && STUDIO_LINES.includes(line.text);
function dropLines(next, tool) {
  const ids = [];
  const visit = (node) => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (isObj3(node)) Object.entries(node).forEach(([k, v]) => k === "message" && typeof v === "string" ? ids.push(v) : visit(v));
  };
  visit(tool);
  ids.forEach((id) => {
    const line = list4(next.messages).find((m2) => isObj3(m2) && m2.id === id);
    if (!line || !untouched(line) || usedIn(next, "messages", id).length) return;
    next.messages = list4(next.messages).filter((m2) => m2 !== line);
    if (!next.messages.length) delete next.messages;
  });
}
var askInWords = (fields) => `Could you tell me your ${listWords(fields.map((f) => DETAIL_FIELDS.find((d) => d.name === f.name)?.ask || String(f.label || f.name).toLowerCase()))}?`;
var detailField = (f) => ({ name: f.name, label: f.label, type: f.type, ...f.name === "name" ? { required: true } : {} });
function setDetails(config, on, { fields } = {}) {
  if (!on)
    return dropTools(config, "details", (next2, tool) => {
      const formId2 = tool?.params?.form;
      if (!isOwn(formId2, FORM_ID) || usedIn(next2, "forms", formId2).length) return;
      next2.forms = list4(next2.forms).filter((f) => f?.id !== formId2);
      if (!next2.forms.length) delete next2.forms;
    });
  const existing = toolsFor(config, "details")[0];
  const next = clone3(config);
  const formId = existing?.params?.form || FORM_ID;
  const form = list4(next.forms).find((f) => isObj3(f) && f.id === formId);
  if (!form) {
    const chosen = DETAIL_FIELDS.filter((f) => (fields && fields.length ? fields : ["name", "phone"]).includes(f.name));
    next.forms = [
      ...list4(next.forms),
      { id: formId, title: "Your details", fields: chosen.map(detailField), submit_label: "Send", otherwise: [{ type: "say", text: askInWords(chosen) }] }
    ];
  } else if (fields && fields.length) {
    const had = list4(form.fields).filter(isObj3);
    const known = DETAIL_FIELDS.map((f) => f.name);
    const kept = had.filter((f) => !known.includes(f.name) || fields.includes(f.name));
    const added = DETAIL_FIELDS.filter((f) => fields.includes(f.name) && !had.some((h) => h.name === f.name)).map(detailField);
    if (kept.length + added.length) {
      const said = list4(form.otherwise);
      if (said.length === 1 && isObj3(said[0]) && said[0].type === "say" && said[0].text === askInWords(had))
        form.otherwise = [{ ...said[0], text: askInWords([...kept, ...added]) }];
      form.fields = [...kept, ...added];
    }
  }
  let id = existing?.id;
  if (!id) {
    id = freshId(toolIds(next), IDS.details);
    next.tools = [
      ...list4(next.tools),
      {
        id,
        type: "builtin",
        builtin: "send_form",
        description: "Use when the person wants to book, order or be called back, or when you need their details for your team.",
        params: { form: formId }
      }
    ];
  }
  return giveTool(next, id);
}
var listWords = (words3) => words3.length > 1 ? `${words3.slice(0, -1).join(", ")} and ${words3.at(-1)}` : words3[0] || "details";

// weave-react/src/demo/draftAssistant.js
var ASSISTANT = {
  kind: "demo-rules",
  label: "Demo assistant",
  isAi: false,
  description: "Builds a first draft from your description with simple rules in your browser. It is not an AI model and does not understand what you wrote beyond keywords, so read and edit everything it makes."
};
var MIN_DESCRIPTION = 15;
var KINDS = [
  [
    "support",
    [
      "support",
      "help desk",
      "helpdesk",
      "customer",
      "complaint",
      "issue",
      "refund",
      "order",
      "billing",
      "bill ",
      "problem",
      "ticket",
      "troubleshoot",
      "account"
    ],
    "customer care"
  ],
  ["receptionist", ["front desk", "reception", "receptionist", "visitor", "directions", "route calls", "who to speak", "greet", "switchboard"], "front desk"],
  ["knowledge", ["faq", "frequently asked", "knowledge", "policies", "policy", "documentation", "answer questions", "information about"], "knowledge guide"],
  ["lead", ["lead", "sales", "prospect", "interested in", "quote", "demo request", "capture details", "contact details"], "lead concierge"],
  ["appointment", ["book", "appointment", "schedule", "reservation", "booking", "slot", "clinic", "salon", "table for"], "booking concierge"],
  ["feedback", ["feedback", "survey", "rating", "nps", "how we did", "review"], "feedback collector"]
];
var LANGS = {
  spanish: "es",
  french: "fr",
  german: "de",
  portuguese: "pt",
  italian: "it",
  dutch: "nl",
  hindi: "hi",
  arabic: "ar",
  japanese: "ja",
  korean: "ko",
  chinese: "zh",
  mandarin: "zh",
  swahili: "sw",
  indonesian: "id",
  turkish: "tr",
  polish: "pl",
  swedish: "sv"
};
var LOCALE_OF = {
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  pt: "pt-BR",
  it: "it-IT",
  nl: "nl-NL",
  hi: "hi-IN",
  ar: "ar-SA",
  ja: "ja-JP",
  ko: "ko-KR",
  zh: "zh-CN",
  sw: "sw-KE",
  id: "id-ID",
  tr: "tr-TR",
  pl: "pl-PL",
  sv: "sv-SE"
};
var TONES = [
  "friendly",
  "warm",
  "formal",
  "professional",
  "casual",
  "calm",
  "upbeat",
  "empathetic",
  "concise",
  "patient",
  "playful",
  "polite",
  "reassuring",
  "direct",
  "cheerful"
];
var sentences = (text2) => String(text2).replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
var has = (text2, words3) => words3.some((w) => text2.includes(w));
var shorten = (text2, n) => text2.length > n ? `${text2.slice(0, n - 1).trimEnd()}\u2026` : text2;
function generateDraft(description, base2, { name, company: fallbackCompany } = {}) {
  const raw = String(description || "").trim();
  if (raw.length < MIN_DESCRIPTION)
    return { ok: false, problem: "Describe what the agent should do in a sentence or two, for example who it talks to and what it helps with." };
  if (!base2 || typeof base2 !== "object") return { ok: false, problem: "There is no draft to build on." };
  const text2 = raw.toLowerCase();
  const assumptions = [];
  const questions = [];
  const scored = KINDS.map(([id, words3, label]) => ({ id, label, score: words3.reduce((n, w) => n + (text2.includes(w) ? 1 : 0), 0) })).sort(
    (a, b) => b.score - a.score
  );
  const kind = scored[0].score > 0 ? scored[0] : { id: "support", label: "customer care", score: 0 };
  assumptions.push(
    scored[0].score > 0 ? `Started from the \u201C${STARTERS.find((s) => s.id === kind.id).label}\u201D starter because the description mentions ${KINDS.find(([id]) => id === kind.id)[1].filter((w) => text2.includes(w)).slice(0, 3).map((w) => `\u201C${w.trim()}\u201D`).join(", ")}.` : "Nothing in the description says what kind of agent this is, so it started from the \u201CCustomer care\u201D starter."
  );
  let config = applyStarter(base2, kind.id);
  const named = /\b(?:called|named)\s+([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,2})/.exec(raw);
  const company = /\b(?:for|at|of)\s+((?:[A-Z][\w&.-]*)(?:\s+[A-Z][\w&.-]*){0,3})/.exec(raw);
  const agentName = named ? named[1] : name || config.meta?.name || "Assistant";
  if (named) assumptions.push(`The agent is called ${agentName}, as the description says.`);
  config.persona = { ...config.persona, name: agentName };
  const notACompany = /* @__PURE__ */ new Set([...Object.keys(LANGS), "english", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);
  if (company && company[1].length > 1 && !notACompany.has(company[1].toLowerCase().split(" ")[0])) {
    config.persona.company = company[1];
    assumptions.push(`The company is ${company[1]}.`);
  } else if (fallbackCompany) {
    config.persona.company = fallbackCompany;
    assumptions.push(`The company is ${fallbackCompany}, your workspace\u2019s name.`);
  }
  if (named) config.meta = { ...config.meta, name: agentName };
  const voiceWords = ["voice", "phone", "call", "calls", "calling", "dial", "ring"];
  const chatWords = ["chat", "website", "widget", "web chat", "text"];
  const voice = voiceWords.some((w) => new RegExp(String.raw`\b${w}\b`, "i").test(text2));
  const chat = has(text2, chatWords);
  const wanted = [];
  if (voice) wanted.push("phone");
  if (chat || !voice) wanted.push("web_chat");
  if (text2.includes("whatsapp")) wanted.push("whatsapp");
  if (/\bsms\b/.test(text2)) wanted.push("sms");
  if (/\be-?mail\b/.test(text2)) wanted.push("email");
  const taken = [];
  const channels = [];
  [...new Set(wanted)].forEach((preset) => {
    const existing = preset === "web_chat" ? (config.channels || []).find((c) => c.type === "web_chat") : null;
    const channel = existing || buildChannel(preset, { taken, botId: config.meta?.id || "" });
    taken.push(channel.id);
    channels.push(channel);
  });
  config.channels = channels;
  const starter = STARTERS.find((item) => item.id === kind.id);
  config.channels.forEach((c) => {
    if (c.greeting && typeof c.greeting.say === "string" && starter?.greeting)
      c.greeting.say = starter.greeting(agentName, config.persona.company, isVoiceChannel(c));
  });
  assumptions.push(`Reachable by ${channels.map((c) => c.id.replace(/_/g, " ")).join(" and ")}${voice ? "" : ", since no channel was mentioned"}.`);
  if (channels.some((c) => ["sip_voice", "web_voice"].includes(c.type))) {
    config = setProvider(setProvider(config, "stt", "openai"), "tts", "openai");
    assumptions.push("Speech uses OpenAI for listening and speaking, because voice needs both. Change it under AI model.");
    config.persona = {
      ...config.persona,
      disclosures: { ...config.persona.disclosures || {}, recording_notice: "This call may be recorded to improve our service." }
    };
    assumptions.push("A recording notice was added because the agent speaks. Remove it if calls are not recorded.");
  }
  const spoken = Object.entries(LANGS).filter(([word]) => text2.includes(word)).map(([, code]) => code);
  const english = text2.includes("english") || !spoken.length;
  if (spoken.length) {
    const speaks = [.../* @__PURE__ */ new Set([...english ? ["en"] : [], ...spoken])];
    const primary = english ? "en-US" : LOCALE_OF[spoken[0]];
    config.defaults = { ...config.defaults, language: { primary, speaks } };
    assumptions.push(
      `It speaks ${speaks.map((c) => languageName(c)).join(" and ")}; the primary language is ${languageName(primary)}. Its greeting and goodbye are written in English only: add the other languages in the \u201CLanguage and voice\u201D step.`
    );
    questions.push(
      `The fixed lines (greeting, goodbye) are in English. Write them in ${spoken.map((c) => languageName(c)).join(", ")} in the \u201CLanguage and voice\u201D step.`
    );
  }
  const tones = TONES.filter((t) => text2.includes(t));
  if (tones.length) {
    config.persona = { ...config.persona, tone: tones.join(", ") };
    assumptions.push(`Tone: ${tones.join(", ")}.`);
  } else assumptions.push(`Tone: \u201C${config.persona.tone}\u201D, from the starter, since the description doesn\u2019t say.`);
  const rules = sentences(raw).filter((s) => /\b(never|always|must|must not|do not|don'?t|should not|shouldn'?t|only)\b/i.test(s)).slice(0, 5);
  const entry = (config.agents?.items || []).find((a) => a.id === config.agents?.entry) || config.agents?.items?.[0];
  if (entry && rules.length) {
    entry.instructions = { ...entry.instructions, rules: [...entry.instructions?.rules || [], ...rules] };
    assumptions.push(
      `${rules.length} sentence${rules.length === 1 ? "" : "s"} that sound like rules ${rules.length === 1 ? "was" : "were"} added as rules: ${rules.map((r) => `\u201C${shorten(r, 50)}\u201D`).join("; ")}.`
    );
  }
  if (has(text2, ["human", "person", "escalat", "transfer", "agent to take over", "representative", "someone"])) {
    if (!(config.tools || []).some((t) => t.builtin === "transfer_or_callback")) {
      config = addPersonHandoff(config);
      assumptions.push(
        "It can pass callers to a person: a transfer was added with no number yet, so callers hear a fallback line until you set one under Telephony."
      );
    }
    questions.push("Which number should callers be transferred to? Set it on the transfer under Telephony.");
  }
  const asks = [
    ["book", /\bbook(s|ed|ing|ings)?\b/],
    ["appointment", /\bappointments?\b/],
    ["reservation", /\breserv(e|es|ed|ation|ations)\b/],
    ["order", /\border(s|ed|ing)?\b(?! to\b)/],
    ["call-back", /\bcall[ -]?backs?\b/]
  ].filter(([, re]) => re.test(text2)).map(([word]) => word);
  if (asks.length) {
    config = setDetails(config, true, { fields: REQUEST_FIELDS });
    assumptions.push(
      `It takes requests (it mentions ${asks.slice(0, 2).map((w) => `\u201C${w}\u201D`).join(" and ")}): it asks for the name, phone number, what they need and a day and time, and your team confirms each one.`
    );
  }
  const target = (config.agents?.items || []).find((a) => a.id === config.agents?.entry) || config.agents?.items?.[0];
  if (target)
    target.instructions = {
      ...target.instructions,
      role: `${target.instructions?.role || ""}

About this agent, in the words of whoever asked for it:
${raw}`.trim()
    };
  config.meta = { ...config.meta, description: shorten(sentences(raw)[0] || raw, 140) };
  if (has(text2, ["order", "status", "account", "lookup", "look up", "balance", "crm", "database", "calendar", "inventory", "api", "system"]))
    questions.push(
      "It mentions looking things up. Which system should it use? Add an HTTP connection and a tool for it under Connections; this draft has no tools for lookups."
    );
  if (has(text2, ["card number", "pin", "password", "otp", "one-time code", "ssn", "social security"]))
    questions.push("It mentions secrets (card numbers, PINs, codes). Mark such state variables \u201Csensitive\u201D; note that the runtime does not enforce that yet.");
  if (has(text2, ["hours", "open ", "closed", "weekend", "business hours"]))
    questions.push("It mentions opening hours. Add a schedule and use it to decide when to transfer.");
  if (!has(text2, ["bye", "goodbye", "end the call", "hang up"]))
    assumptions.push("It ends the conversation with a goodbye line when the caller is finished (from the starter).");
  questions.push("Read the role and the rules, and try the draft in the preview before you rely on it.");
  const summary = {
    kind: STARTERS.find((s) => s.id === kind.id)?.label || kind.label,
    name: config.persona.name,
    channels: channels.map((c) => c.id),
    languages: (config.defaults?.language?.speaks || ["en"]).map((c) => baseOf(c)),
    tone: config.persona.tone,
    rules: (entry?.instructions?.rules || []).length,
    tools: (config.tools || []).map((t) => t.id)
  };
  return { ok: true, config, summary, assumptions, questions, source: ASSISTANT.kind };
}

// weave-react/src/studio/replay/replayRun.js
var list5 = (v) => Array.isArray(v) ? v : [];
function playSimulated(config, original) {
  const agent = createSimulatedAgent(config, { channelId: original.channelId });
  const facts = {
    source: "simulated",
    channelId: agent.channel?.id || original.channelId,
    startAgent: agent.currentAgent || "",
    finalAgent: "",
    finalState: {},
    ended: false,
    handoffs: 0,
    opening: agent.greeting().map((m2) => m2.text),
    turns: [],
    errors: [],
    notReached: 0
  };
  let finished = false;
  list5(original.turns).forEach((turn) => {
    if (finished) {
      facts.notReached += 1;
      return;
    }
    const out = agent.reply(turn.say);
    facts.turns.push({
      say: turn.say,
      at: void 0,
      waitMs: null,
      said: out.messages.map((m2) => m2.text),
      tools: out.toolCalls.map((c) => ({ tool: c.tool || c.id, args: c.args || {}, result: void 0, error: "", handoff: c.handoff || "" }))
    });
    if (out.ended || agent.ended) finished = true;
  });
  facts.finalAgent = agent.currentAgent || "";
  facts.finalState = agent.state;
  facts.ended = agent.ended;
  facts.handoffs = facts.turns.reduce((n, t) => n + t.tools.filter((x) => x.handoff).length, 0);
  return facts;
}

// weave-react/src/studio/test/simulatedChannel.js
var VOICE = ["sip_voice", "web_voice"];
var list6 = (v) => Array.isArray(v) ? v : [];
var isObj4 = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var isVoiceChannel3 = (channel) => isObj4(channel) && (VOICE.includes(channel.type) || list6(channel.modalities?.output).includes("audio"));
function chooseSimulatedChannel(config, wanted = "") {
  const channels = list6(config?.channels).filter((c) => isObj4(c) && typeof c.id === "string" && c.id);
  const on = channels.filter((c) => c.enabled !== false);
  const asked = wanted ? channels.find((c) => c.id === wanted) : null;
  const picked = asked || on.find((c) => c.type === "web_chat") || on.find((c) => !isVoiceChannel3(c)) || on[0] || channels[0] || null;
  return picked ? { id: picked.id, type: picked.type, voice: isVoiceChannel3(picked) } : null;
}

// weave-react/src/pages/browserVoice.js
var FEMALE = [
  "zira",
  "hazel",
  "susan",
  "samantha",
  "victoria",
  "karen",
  "moira",
  "tessa",
  "fiona",
  "allison",
  "ava",
  "catherine",
  "linda",
  "heera",
  "jenny",
  "aria",
  "sonia",
  "libby",
  "maisie",
  "natasha",
  "clara",
  "emma",
  "michelle",
  "ana",
  "elena",
  "helena",
  "laura",
  "paulina",
  "monica",
  "sabina",
  "hortense",
  "julie",
  "amelie",
  "denise",
  "katja",
  "hedda",
  "anna",
  "zosia",
  "paola",
  "elsa",
  "female",
  "woman",
  "serena",
  "kate",
  "nicole",
  "joanna",
  "salli",
  "kimberly",
  "ivy",
  "amy",
  "emily",
  "raveena",
  "veena",
  "kalpana",
  "swara",
  "neerja",
  "yelda",
  "lekha",
  "siri"
];
var MALE = [
  "david",
  "mark",
  "george",
  "james",
  "richard",
  "ravi",
  "daniel",
  "alex",
  "fred",
  "tom",
  "oliver",
  "guy",
  "ryan",
  "eric",
  "christopher",
  "sean",
  "rishi",
  "male",
  "man",
  "jorge",
  "pablo",
  "diego",
  "stefan",
  "claude",
  "hans",
  "luca",
  "thomas",
  "jacques",
  "paul",
  "brian",
  "matthew",
  "joey",
  "justin",
  "kevin",
  "russell",
  "geraint",
  "arthur",
  "hemant",
  "prabhat",
  "madhur",
  "liam",
  "connor",
  "neil",
  "william"
];
var words2 = (name) => String(name || "").toLowerCase().split(/[^a-z]+/).filter(Boolean);
function genderOfBrowserVoice(voice) {
  const parts = words2(voice?.name);
  const f = parts.some((p) => FEMALE.includes(p));
  const m2 = parts.some((p) => MALE.includes(p));
  if (f && !m2) return "female";
  if (m2 && !f) return "male";
  return "";
}
var base = (lang) => String(lang || "").toLowerCase().replace("_", "-").split("-")[0];
var same = (a, b) => String(a || "").toLowerCase().replace("_", "-") === String(b || "").toLowerCase().replace("_", "-");
function pickBrowserVoice(voices, { locale, gender }) {
  const want = String(gender || "").toLowerCase();
  const list7 = Array.isArray(voices) ? voices : [];
  const sameLanguage = list7.filter((v) => base(v.lang) === base(locale));
  const rank = (v) => (same(v.lang, locale) ? 0 : 1) + (v.localService ? 0 : 0.5);
  const byRank = (a, b) => rank(a) - rank(b);
  const confirmed = sameLanguage.filter((v) => genderOfBrowserVoice(v) === want).sort(byRank);
  if (confirmed.length) return { voice: confirmed[0], certain: true, pitch: 1 };
  const pitch = want === "female" ? 1.25 : want === "male" ? 0.8 : 1;
  const unknown = sameLanguage.filter((v) => genderOfBrowserVoice(v) === "").sort(byRank);
  if (unknown.length) return { voice: unknown[0], certain: false, pitch };
  const other = sameLanguage.filter((v) => genderOfBrowserVoice(v) !== want);
  return { voice: other.length ? other[0] : null, certain: false, pitch };
}
export {
  ASSISTANT,
  MIN_DESCRIPTION,
  chooseSimulatedChannel,
  createSimulatedAgent,
  genderOfBrowserVoice,
  generateDraft,
  pickBrowserVoice,
  playSimulated,
  speechText,
  widenQuestion
};
