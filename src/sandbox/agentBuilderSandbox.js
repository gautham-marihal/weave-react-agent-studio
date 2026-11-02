// GENERATED from Weave React's in-browser imitation of the Agent Builder API (src/demo/demoApi.js at 7a0567a, bundled
// with esbuild). Sandbox mode answers every API call with it (src/sandbox/sandboxApi.ts), and the browser tests serve it
// over HTTP (e2e/support/standInServer.mjs). In memory or in this browser only; it never reaches a server. Do not edit by hand (changes: saves are "by Sandbox", and its notes say "Sandbox" where React's said "demo").
/* eslint-disable */
// @ts-nocheck
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
var upsertById = (list12, entries) => [
  ...(Array.isArray(list12) ? list12 : []).filter((item) => !entries.some((entry) => entry.id === item?.id)),
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
  const conversation2 = next.defaults?.conversation;
  if (!conversation2?.inactivity) {
    next.defaults = { ...next.defaults || {}, conversation: { ...conversation2 || {}, inactivity: clone(INACTIVITY) } };
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
    if (!(Array.isArray(next.messages) && next.messages.some((m) => m?.id === CALLBACK_MESSAGE.id))) messages.push(CALLBACK_MESSAGE);
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

// weave-react/src/demo/diff.js
var isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
var isIdList = (list12) => Array.isArray(list12) && list12.length > 0 && list12.every((item) => isObj(item) && typeof item.id === "string");
function diffConfigs(before, after, path = []) {
  const out = [];
  if (sameJson(before, after)) return out;
  if (isObj(before) && isObj(after)) {
    const keys = [.../* @__PURE__ */ new Set([...Object.keys(before), ...Object.keys(after)])];
    keys.forEach((key) => {
      if (!(key in after)) out.push({ op: "remove", path: [...path, key], before: before[key] });
      else if (!(key in before)) out.push({ op: "add", path: [...path, key], after: after[key] });
      else out.push(...diffConfigs(before[key], after[key], [...path, key]));
    });
    return out;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    if (isIdList(before) && isIdList(after)) {
      const ids = [.../* @__PURE__ */ new Set([...before.map((i) => i.id), ...after.map((i) => i.id)])];
      ids.forEach((id) => {
        const a = before.find((i) => i.id === id);
        const b = after.find((i) => i.id === id);
        const where = [...path, `id=${id}`];
        if (!b) out.push({ op: "remove", path: where, before: a });
        else if (!a) out.push({ op: "add", path: where, after: b });
        else out.push(...diffConfigs(a, b, where));
      });
      return out;
    }
    const length = Math.max(before.length, after.length);
    for (let i = 0; i < length; i += 1) {
      if (i >= after.length) out.push({ op: "remove", path: [...path, i], before: before[i] });
      else if (i >= before.length) out.push({ op: "add", path: [...path, i], after: after[i] });
      else out.push(...diffConfigs(before[i], after[i], [...path, i]));
    }
    return out;
  }
  out.push({ op: "change", path, before, after });
  return out;
}

// weave-react/src/demo/demoValidate.js
var isObj2 = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var list = (v) => Array.isArray(v) ? v : [];
var DEMO_VALIDATOR_NOTE = "Sandbox: checked by a few simple rules in your browser, not by the real validator. A real check happens when you use the real API.";
var KNOWN_PROVIDERS = ["anthropic", "assemblyai", "cartesia", "deepgram", "elevenlabs", "google", "groq", "openai", "openai_compatible", "silero"];
var REQUIRED_SECTIONS = ["schema_version", "meta", "runtime", "defaults", "persona", "channels", "agents"];
var UNSUPPORTED_TOOL_KINDS = { mcp: "MCP server tools", code: "Custom code tools" };
function secretsIn(value, out = /* @__PURE__ */ new Set()) {
  if (Array.isArray(value)) value.forEach((item) => secretsIn(item, out));
  else if (isObj2(value)) {
    if (typeof value.secret === "string" && Object.keys(value).length === 1) out.add(value.secret);
    else Object.values(value).forEach((item) => secretsIn(item, out));
  }
  return out;
}
function validateDemo(config, botId) {
  const errors = [];
  const warnings = [{ path: null, message: DEMO_VALIDATOR_NOTE }];
  const unsupported = [];
  const err = (path, message) => errors.push({ path, message });
  if (!isObj2(config)) {
    return { valid: false, errors: [{ path: null, message: "The configuration must be a JSON object." }], warnings, unsupported, secrets_required: [] };
  }
  REQUIRED_SECTIONS.forEach((key) => {
    if (!(key in config)) err([key], `${key} is required`);
  });
  if (isObj2(config.meta) && botId && config.meta.id !== botId) err(["meta", "id"], `meta.id must be '${botId}' (it is '${config.meta.id}')`);
  if (isObj2(config.meta) && !config.meta.name) err(["meta", "name"], "meta.name is required");
  if (isObj2(config.meta) && !/^\d+\.\d+\.\d+$/.test(String(config.meta.version ?? "")))
    err(["meta", "version"], `meta.version must be three numbers, like 1.0.0 (it is ${JSON.stringify(config.meta.version ?? null)})`);
  const ids = (items) => list(items).map((item) => isObj2(item) ? item.id : void 0);
  const duplicates = (items, path, what) => {
    const seen = /* @__PURE__ */ new Set();
    ids(items).forEach((id, index) => {
      if (typeof id !== "string") return;
      if (seen.has(id)) err([...path, index, "id"], `duplicate ${what} id '${id}'`);
      seen.add(id);
    });
  };
  duplicates(config.agents?.items, ["agents", "items"], "agent");
  duplicates(config.tools, ["tools"], "tool");
  duplicates(config.channels, ["channels"], "channel");
  duplicates(config.messages, ["messages"], "message");
  const agentIds = ids(config.agents?.items);
  if (isObj2(config.agents) && !agentIds.includes(config.agents.entry))
    err(["agents", "entry"], `'${config.agents.entry}' is not a declared agents id (declared: ${agentIds.filter(Boolean).join(", ") || "none"})`);
  const toolIds = ids(config.tools).filter(Boolean);
  list(config.agents?.items).forEach((agent, index) => {
    list(agent?.tools).forEach((tool, t) => {
      if (!toolIds.includes(tool))
        err(["agents", "items", index, "tools", t], `'${tool}' is not a declared tools id (declared: ${toolIds.join(", ") || "none"})`);
    });
  });
  const used = /* @__PURE__ */ new Set([
    ...list(config.agents?.items).flatMap((agent) => list(agent?.tools)),
    ...list(config.tasks).flatMap((task) => list(task?.steps).map((step) => step?.validate?.tool)),
    ...list(config.guardrails?.escalation).map((rule) => rule?.tool),
    config.guardrails?.topics?.on_off_topic?.then
  ]);
  list(config.tools).forEach((tool, index) => {
    if (isObj2(tool) && tool.id && !used.has(tool.id))
      warnings.push({ path: ["tools", index], message: `tool '${tool.id}' is not used by any agent, task or guardrail` });
  });
  list(config.channels).forEach((channel, index) => {
    const modalities = channel?.modalities;
    if (isObj2(modalities) && (list(modalities.input).length === 0 || list(modalities.output).length === 0)) {
      err(
        ["channels", index, "modalities", list(modalities.input).length === 0 ? "input" : "output"],
        "a channel needs at least one input and one output modality"
      );
    }
  });
  const models = config.defaults?.models;
  if (isObj2(config.defaults)) {
    if (!isObj2(models) || !isObj2(models.llm)) err(["defaults", "models", "llm"], "defaults.models.llm is required");
    else
      ["stt", "llm", "tts"].forEach((stage) => {
        const slot = models[stage];
        if (!isObj2(slot)) return;
        if (!slot.provider) err(["defaults", "models", stage, "provider"], `${stage} needs a provider`);
        else if (!KNOWN_PROVIDERS.includes(slot.provider))
          err(["defaults", "models", stage, "provider"], `provider '${slot.provider}' is not known to the runtime (known: ${KNOWN_PROVIDERS.join(", ")})`);
        if (!slot.model) err(["defaults", "models", stage, "model"], `${stage} needs a model`);
      });
  }
  const variables = isObj2(config.state?.variables) ? config.state.variables : {};
  const sensitive = Object.entries(variables).filter(([, variable]) => isObj2(variable) && variable.sensitive === true);
  if (sensitive.length && config.schema_version === "1.1")
    err(["schema_version"], "this config uses features that need schema_version 1.2 (sensitive state variables), but says 1.1");
  list(config.tools).forEach((tool, index) => {
    const kind = isObj2(tool) ? tool.type : void 0;
    if (UNSUPPORTED_TOOL_KINDS[kind]) unsupported.push({ feature: UNSUPPORTED_TOOL_KINDS[kind], where: `tools[${index}]` });
  });
  const valid = errors.length === 0;
  return { valid, errors, warnings, unsupported: valid ? unsupported : [], secrets_required: [...secretsIn(config)].sort() };
}

// weave-react/src/studio/form/engine.js
var isObj3 = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// weave-react/src/demo/demoKnowledge.js
var list2 = (v) => Array.isArray(v) ? v : [];
var DEMO_KNOWLEDGE_NOTE = "Sandbox: there is no embedding model here. The index is a plain word index kept in your browser, and scores come from the words a passage shares with the question, so real scores will differ.";
var BUILD_STEP_MS = 500;
var STEPS = ["Reading the files", "Cutting them into passages", "Indexing the passages", "Writing the index"];
var TEXT_EXT = [".txt", ".md", ".markdown", ".html", ".htm", ".csv", ".json"];
var STOP = /* @__PURE__ */ new Set([
  "the",
  "and",
  "for",
  "with",
  "what",
  "when",
  "how",
  "can",
  "you",
  "are",
  "your",
  "this",
  "that",
  "have",
  "from",
  "about",
  "there",
  "does",
  "much",
  "many"
]);
var words = (s) => String(s || "").toLowerCase().match(/[a-z0-9]{3,}/g)?.filter((w) => !STOP.has(w)) || [];
var state = (bot) => {
  bot.knowledge ||= { files: [], builds: {}, indexes: {} };
  return bot.knowledge;
};
var isTextFile = (name) => TEXT_EXT.some((ext) => String(name).toLowerCase().endsWith(ext));
function stripMarkup(name, content) {
  if (/\.html?$/i.test(name)) return content.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  return content;
}
function chunk(content, size = 1200, overlap = 150) {
  const clean2 = String(content).replace(/\s+/g, " ").trim();
  if (!clean2) return [];
  const out = [];
  for (let i = 0; i < clean2.length; i += Math.max(1, size - overlap)) {
    out.push(clean2.slice(i, i + size));
    if (i + size >= clean2.length) break;
  }
  return out;
}
var baseOf = (config, id) => list2(config?.knowledge).find((b) => b?.id === id);
function usedBy(config, baseId) {
  const agents = list2(config?.agents?.items).filter(
    (a) => list2(a?.knowledge).includes(baseId) || list2(a?.tools).some((t) => list2(config?.tools).some((tool) => tool?.id === t && tool.type === "knowledge" && tool.source === baseId))
  ).map((a) => a.id);
  const tools = list2(config?.tools).filter((t) => t?.type === "knowledge" && t.source === baseId).map((t) => t.id);
  return { agents, tools };
}
function settle(bot, nowMs) {
  const k = state(bot);
  let changed = false;
  Object.values(k.builds).forEach((job) => {
    if (job.status !== "running" || nowMs < Date.parse(job.started_at) + STEPS.length * job.stepMs) return;
    const base = job.baseDef;
    const documents = [];
    const passages = [];
    const log = STEPS.map((s) => `${s}\u2026`);
    list2(base?.sources).forEach((source) => {
      if (source?.type === "url") {
        log.push(`Skipped ${source.url}: Sandbox can\u2019t fetch web pages.`);
        return;
      }
      const file = k.files.find((f) => f.name === source?.file_id);
      if (!file) {
        log.push(`The file ${source?.file_id} is not uploaded.`);
        return;
      }
      const parts = isTextFile(file.name) ? chunk(stripMarkup(file.name, file.content || ""), base?.chunking?.size, base?.chunking?.overlap) : [];
      if (!parts.length) log.push(`${file.name}: no text could be read from it in Sandbox.`);
      parts.forEach((text3) => passages.push({ text: text3, source: file.name }));
      documents.push({ name: file.name, passages: parts.length });
    });
    if (!passages.length) {
      const pagesOnly = list2(base?.sources).length > 0 && list2(base?.sources).every((s) => s?.type === "url");
      Object.assign(job, {
        status: "failed",
        error: pagesOnly ? "Sandbox can\u2019t fetch web pages, so there was nothing to read. Add a text, markdown, HTML, CSV or JSON file to try it." : "None of the sources gave any text to index. Upload a text, markdown, HTML, CSV or JSON file and add it to this base.",
        log,
        finished_at: new Date(nowMs).toISOString()
      });
    } else {
      k.indexes[job.base] = {
        built_at: new Date(nowMs).toISOString(),
        embedding: { provider: "sandbox", model: "word-index" },
        passages,
        documents,
        stamps: Object.fromEntries(documents.map((d) => [d.name, k.files.find((f) => f.name === d.name)?.modified]))
      };
      Object.assign(job, { status: "done", result: { passages: passages.length }, log, finished_at: new Date(nowMs).toISOString() });
    }
    changed = true;
  });
  return changed;
}
function problemsOf(bot, config, base) {
  const k = state(bot);
  const problems = [];
  if (base.type !== "vector_store") return problems;
  const index = k.indexes[base.id];
  if (!index) problems.push({ problem: "No index has been built for this base.", fix: "Build the index." });
  list2(base.sources).forEach((source) => {
    if (source?.type !== "file") return;
    const file = k.files.find((f) => f.name === source.file_id);
    if (!file) problems.push({ problem: `The file ${source.file_id} is not uploaded.`, fix: "Upload it, or remove it from the sources." });
    else if (index && index.stamps?.[file.name] !== file.modified)
      problems.push({ problem: `The file ${file.name} changed after the index was built.`, fix: "Rebuild the index." });
  });
  return problems;
}
var buildView = (job, nowMs) => {
  if (!job) return null;
  const done = job.status !== "running";
  const stepsDone = done ? STEPS.length : Math.min(STEPS.length, Math.max(0, Math.floor((nowMs - Date.parse(job.started_at)) / job.stepMs)));
  return {
    id: job.id,
    status: job.status,
    log: done ? job.log : STEPS.slice(0, stepsDone + 1).map((s, i) => i < stepsDone ? `${s}\u2026 done` : `${s}\u2026`),
    ...job.result ? { result: job.result } : {},
    ...job.error ? { error: job.error } : {},
    started_at: job.started_at,
    ...job.finished_at ? { finished_at: job.finished_at } : {}
  };
};
function describeBase(bot, config, base, nowMs) {
  const k = state(bot);
  const index = k.indexes[base.id];
  return {
    id: base.id,
    type: base.type,
    mode: base.mode || "tool",
    used_by: usedBy(config, base.id),
    ...base.type === "vector_store" ? {
      sources: list2(base.sources).map(
        (s) => s?.type === "file" ? { type: "file", file_id: s.file_id, uploaded: k.files.some((f) => f.name === s.file_id) } : { ...s }
      ),
      index: index ? { built_at: index.built_at, passages: index.passages.length, embedding: index.embedding, documents: index.documents } : null,
      build: buildView(k.builds[base.id], nowMs)
    } : { connection: base.connection },
    problems: problemsOf(bot, config, base),
    embedding_key_available: true
  };
}
function overview(bot, config, ref, nowMs) {
  const k = state(bot);
  return {
    bot: bot.id,
    ref,
    bases: list2(config?.knowledge).filter(isObj3).map((b) => describeBase(bot, config, b, nowMs)),
    files: k.files.map((f) => ({
      name: f.name,
      size: f.size,
      modified: f.modified,
      used_by: list2(config?.knowledge).filter((b) => list2(b?.sources).some((s) => s?.type === "file" && s.file_id === f.name)).map((b) => b.id)
    })),
    embedding_key_available: true,
    demo: true,
    note: DEMO_KNOWLEDGE_NOTE
  };
}
function baseStatus(bot, config, baseId, nowMs) {
  const base = baseOf(config, baseId);
  if (!base) return null;
  const d = describeBase(bot, config, base, nowMs);
  return { index: d.index ?? null, build: d.build ?? null, problems: d.problems };
}
function upload(bot, name, content, size, nowIso) {
  const k = state(bot);
  const existing = k.files.find((f) => f.name === name);
  const row = { name, size, modified: nowIso, content: isTextFile(name) ? String(content || "") : "" };
  if (existing) Object.assign(existing, row);
  else k.files.push(row);
  return { name, size, modified: nowIso, used_by: [] };
}
function removeFile(bot, configs, name, force) {
  const k = state(bot);
  if (!k.files.some((f) => f.name === name)) return { status: 404, detail: `There is no file '${name}'.` };
  const readers = [
    ...new Set(
      (Array.isArray(configs) ? configs : [configs]).flatMap(
        (config) => list2(config?.knowledge).filter((b) => list2(b?.sources).some((s) => s?.type === "file" && s.file_id === name)).map((b) => b.id)
      )
    )
  ];
  if (readers.length && !force)
    return {
      status: 409,
      detail: `The file '${name}' is read by the knowledge base ${readers.map((r) => `'${r}'`).join(", ")}. Delete it anyway with force=true.`
    };
  k.files = k.files.filter((f) => f.name !== name);
  return { status: 204 };
}
function startBuild(bot, config, baseId, nowMs, stepMs = BUILD_STEP_MS) {
  const k = state(bot);
  const base = baseOf(config, baseId);
  if (!base) return { status: 404, detail: `There is no knowledge base '${baseId}'.` };
  if (base.type !== "vector_store") return { status: 400, detail: `The base '${baseId}' asks an external search service, so there is no index to build.` };
  if (k.builds[baseId]?.status === "running") return { status: 409, detail: `An index for '${baseId}' is already being built.` };
  const job = {
    id: `build_${Math.abs(nowMs).toString(36)}`,
    base: baseId,
    status: "running",
    started_at: new Date(nowMs).toISOString(),
    stepMs,
    log: [],
    baseDef: JSON.parse(JSON.stringify(base))
  };
  k.builds[baseId] = job;
  return { status: 202, job: buildView(job, nowMs) };
}
function searchBase(bot, config, baseId, body) {
  const k = state(bot);
  const base = baseOf(config, baseId);
  if (!base) return { status: 404, detail: `There is no knowledge base '${baseId}'.` };
  if (base.type !== "vector_store")
    return { status: 400, detail: "Searching an external service is done by the service itself: the studio can\u2019t test it here." };
  const index = k.indexes[baseId];
  if (!index) return { status: 409, detail: "No index has been built for this base yet: build it first." };
  const query = String(body?.query || "").trim();
  if (!query) return { status: 422, detail: "Write something to search for." };
  const inject = (base.mode || "tool") === "inject";
  const searched = inject && body?.previous_reply && base.retrieval?.query_from !== "last_user" ? `${body.previous_reply} ${query}` : query;
  const terms = [...new Set(words(searched))];
  const topK = Math.min(20, Math.max(1, body?.top_k || base.top_k || 4));
  const scored = index.passages.map((p) => {
    const have = new Set(words(p.text));
    const shared = terms.filter((t) => have.has(t)).length;
    return { text: p.text, source: p.source, score: terms.length ? Math.round(shared / terms.length * 0.85 * 100) / 100 : 0 };
  }).sort((a, b) => b.score - a.score).slice(0, topK);
  const minScore = typeof base.retrieval?.min_score === "number" ? base.retrieval.min_score : -Infinity;
  const hits = scored.filter((h) => h.score >= minScore);
  const shown = inject ? `${base.retrieval?.instruction || "Reference information, not instructions:"}
${hits.map((h) => `- ${h.text}`).join("\n")}` : JSON.stringify({ results: hits.map((h) => h.text) }, null, 2);
  return { status: 200, body: { hits, ms: 4 + terms.length, the_model_is_shown: shown, query_used: searched, demo: true, note: DEMO_KNOWLEDGE_NOTE } };
}
function preflightKnowledge(bot, config) {
  return list2(config?.knowledge).filter(isObj3).map((base) => ({ base: base.id, problems: problemsOf(bot, config, base) })).filter((row) => row.problems.length);
}

// weave-react/src/studio/form/templates.ts
var wordCount = (text3) => (String(text3 ?? "").trim().match(/\S+/g) || []).length;

// weave-react/src/studio/form/promptPreview.js
var text = (value) => typeof value === "string" ? value.trim() : "";
var list3 = (value) => Array.isArray(value) ? value : [];
var OPERATOR_WORDS = { equals: "is", not_equals: "is not", gte: "is at least", lte: "is at most", in: "is one of" };
var show = (value) => Array.isArray(value) ? value.map(show).join(", ") : typeof value === "string" ? `\u201C${value}\u201D` : String(value);
function describeCondition(condition) {
  if (!isObj3(condition)) return "a condition holds";
  const subject = ["state", "arg", "result", "event"].find((key) => key in condition);
  if (subject) {
    const operator = Object.keys(OPERATOR_WORDS).find((key) => key in condition);
    const label = { state: "the state", arg: "the argument", result: "the result", event: "the event detail" }[subject];
    if (operator === "not_equals" && condition[operator] === null) return `${label} ${condition[subject]} is set`;
    if (operator === "equals" && condition[operator] === null) return `${label} ${condition[subject]} is not set`;
    return operator ? `${label} ${condition[subject]} ${OPERATOR_WORDS[operator]} ${show(condition[operator])}` : `${label} ${condition[subject]} is set`;
  }
  if ("channel" in condition) return `the channel is ${show(condition.channel)}`;
  if ("schedule" in condition) return `${condition.schedule} is ${condition.open ? "open" : "closed"}`;
  if (Array.isArray(condition.all)) return condition.all.map(describeCondition).join(" and ");
  if (Array.isArray(condition.any)) return condition.any.map(describeCondition).join(" or ");
  if ("not" in condition) return `not (${describeCondition(condition.not)})`;
  return "a condition holds";
}
function renderTemplate(source, config) {
  const unresolved = [];
  const variables = isObj3(config?.state?.variables) ? config.state.variables : {};
  const constants = isObj3(config?.constants) ? config.constants : {};
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
function assemblePrompt(config, agentId, { channelId } = {}) {
  const agents = list3(config?.agents?.items);
  const agent = agents.find((item) => item?.id === agentId) || null;
  if (!agent) return null;
  const persona = isObj3(config.persona) ? config.persona : {};
  const instructions = isObj3(agent.instructions) ? agent.instructions : {};
  const unresolved = /* @__PURE__ */ new Set();
  const sections = [];
  const add = (id, title, note, body, extra = {}) => {
    const rendered = renderTemplate(body, config);
    rendered.unresolved.forEach((name) => unresolved.add(name));
    if (!rendered.text.trim()) return;
    sections.push({ id, title, note, text: rendered.text, words: wordCount(rendered.text), ...extra });
  };
  const who = [];
  if (text(persona.name)) who.push(`Your name is ${text(persona.name)}${text(persona.company) ? `, from ${text(persona.company)}` : ""}.`);
  if (text(persona.tone)) who.push(`Tone: ${text(persona.tone)}.`);
  const style = list3(persona.style_rules).map(text).filter(Boolean);
  if (style.length) who.push(`Style:
${style.map((rule) => `- ${rule}`).join("\n")}`);
  add("persona", "Who the agent is", "From the persona", who.join("\n\n"));
  const shared = list3(persona.shared_rules).map(text).filter(Boolean);
  add("shared", "Rules for every agent", "persona.shared_rules, added to every agent\u2019s prompt", shared.map((rule) => `- ${rule}`).join("\n"));
  add("role", "Its role", "instructions.role", instructions.role);
  add("opening", "When it takes over", "instructions.opening, applied once when this agent takes over", instructions.opening);
  const rules = list3(instructions.rules).map(text).filter(Boolean);
  add("rules", "Its rules", "instructions.rules", rules.map((rule) => `- ${rule}`).join("\n"));
  list3(instructions.conditional).forEach((block, index) => {
    add(
      `conditional-${index}`,
      `Only while ${describeCondition(block?.when)}`,
      "instructions.conditional, added only while its condition holds",
      block?.append,
      { conditional: true }
    );
  });
  const channel = list3(config.channels).find((item) => item?.id === channelId);
  if (channel) add("channel", `Added on ${channel.id}`, "The channel\u2019s instructions_append", channel.instructions_append);
  const tools = list3(config.tools);
  const lines = [];
  list3(agent.tools).forEach((id) => {
    const tool = tools.find((item) => item?.id === id);
    if (!tool) {
      lines.push(`- ${id} (not defined)`);
      return;
    }
    const args = Object.keys(isObj3(tool.parameters?.properties) ? tool.parameters.properties : {});
    lines.push(`- ${tool.name || tool.id}(${args.join(", ")})${text(tool.description) ? `: ${text(tool.description)}` : ""}`);
  });
  list3(agent.handoffs).forEach((handoff) => {
    if (isObj3(handoff)) lines.push(`- ${handoff.tool}(): ${text(handoff.description)}${handoff.to ? ` (hands the caller to ${handoff.to})` : ""}`);
  });
  if (lines.length) add("tools", "Tools it can use", "The tools it offers, and its handoffs", lines.join("\n"));
  const always = sections.filter((section) => !section.conditional);
  return {
    agent,
    sections,
    words: always.reduce((sum, section) => sum + section.words, 0),
    conditionalWords: sections.filter((section) => section.conditional).reduce((sum, section) => sum + section.words, 0),
    unresolved: [...unresolved]
  };
}

// weave-react/src/studio/form/jsonPaths.js
var rooted = (source) => source[0] === "$" ? source : source[0] === "[" ? `$${source}` : `$.${source}`;
function parsePath(text3) {
  const trimmed = String(text3 ?? "").trim();
  if (!trimmed) throw new Error("Enter a path, for example balance or $.balance");
  const source = rooted(trimmed);
  const segments = [];
  let i = 1;
  while (i < source.length) {
    const c = source[i];
    if (c === ".") {
      if (source[i + 1] === ".") throw new Error("\u201C..\u201D (search everywhere) isn\u2019t supported. Name each step: $.a.b");
      const match = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(source.slice(i + 1));
      if (!match) throw new Error(`Expected a field name after \u201C.\u201D at position ${i + 1}. A name with a dot or a space goes in brackets: $['a.b']`);
      segments.push({ key: match[0] });
      i += 1 + match[0].length;
    } else if (c === "[") {
      const close = source.indexOf("]", i);
      if (close === -1) throw new Error("A \u201C[\u201D is never closed.");
      const inner = source.slice(i + 1, close).trim();
      if (inner === "*") segments.push({ all: true });
      else if (/^\d+$/.test(inner)) segments.push({ index: Number(inner) });
      else if (/^(['"]).*\1$/.test(inner)) segments.push({ key: inner.slice(1, -1) });
      else if (inner.startsWith("?")) throw new Error("Filters like [?(@.x > 1)] aren\u2019t supported. Pick a field, an index [0] or [*].");
      else if (inner.includes(":")) throw new Error("Slices like [0:2] aren\u2019t supported. Use [0], [1] or [*].");
      else throw new Error(`Don\u2019t understand [${inner}]. Use [0], [*] or ['name'].`);
      i = close + 1;
    } else throw new Error(`Unexpected \u201C${c}\u201D at position ${i}. Steps are .name, [0], [*] or ['name'].`);
  }
  return segments;
}
function evalPath(value, text3) {
  let nodes = [value];
  for (const seg of parsePath(text3)) {
    const next = [];
    nodes.forEach((node) => {
      if (seg.all) {
        if (Array.isArray(node)) next.push(...node);
      } else if ("index" in seg) {
        if (Array.isArray(node) && seg.index < node.length) next.push(node[seg.index]);
      } else if (node !== null && typeof node === "object" && !Array.isArray(node) && seg.key in node) next.push(node[seg.key]);
    });
    nodes = next;
  }
  return nodes;
}

// weave-react/src/studio/form/toolInfo.js
var UNSUPPORTED_KINDS = {
  mcp: "MCP server tools",
  code: "Custom code tools"
};
var UNSUPPORTED_BUILTINS = {};
function kindOfTool(tool) {
  if (!isObj3(tool)) return "";
  if (tool.type) return tool.type;
  return tool.builtin ? "builtin" : "";
}
function notAvailable(tool) {
  const kind = kindOfTool(tool);
  if (UNSUPPORTED_KINDS[kind]) return UNSUPPORTED_KINDS[kind];
  if (kind === "builtin" && UNSUPPORTED_BUILTINS[tool.builtin]) return UNSUPPORTED_BUILTINS[tool.builtin];
  return null;
}

// weave-react/src/studio/form/messages.ts
var baseOf2 = (code) => String(code || "").split("-")[0].toLowerCase();
var primaryOf = (config) => {
  const language = config?.defaults?.language;
  if (typeof language?.primary === "string" && language.primary) return language.primary;
  const speaks = language?.speaks;
  const first = Array.isArray(speaks) ? speaks.find((code) => typeof code === "string" && !!code) : "";
  return first || "";
};

// weave-react/src/demo/simulatedAgent.js
var list4 = (v) => Array.isArray(v) ? v : [];
var STOP2 = /* @__PURE__ */ new Set([
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
var words2 = (text3) => String(text3 || "").toLowerCase().match(/[a-z]{4,}/g)?.filter((w) => !STOP2.has(w)) || [];
var shares = (said, candidates) => {
  const stems = new Set(words2(said).map((w) => w.slice(0, 4)));
  return candidates.some((w) => stems.has(w.slice(0, 4)));
};
function textOf(message, config) {
  const text3 = message?.text;
  if (typeof text3 === "string") return text3;
  if (!isObj3(text3)) return "";
  const primary = baseOf2(primaryOf(config));
  const key = Object.keys(text3).find((k) => baseOf2(k) === primary) || Object.keys(text3)[0];
  return key ? String(text3[key]) : "";
}
function speechText(speech, config) {
  if (typeof speech === "string") return speech;
  if (isObj3(speech) && speech.message)
    return textOf(
      list4(config?.messages).find((m) => m?.id === speech.message),
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
var widenQuestion = (text3) => [text3, ...ALSO.filter(([re]) => re.test(String(text3 || "").toLowerCase())).map(([, more]) => more)].join(" ");
function bestLine(passage, asked) {
  const own = new Set(words2(asked).map((w) => w.slice(0, 4)));
  const also = new Set(words2(widenQuestion(asked)).map((w) => w.slice(0, 4)));
  const lines = String(passage || "").split(/\n+|(?<=[.!?])\s+|\s+[-•*]\s+/).map((l) => l.replace(/^[\s*•-]+/, "").trim()).filter(Boolean);
  let best = "";
  let most = 0;
  lines.forEach((line) => {
    const n = words2(line).reduce((sum, w) => sum + (own.has(w.slice(0, 4)) ? 2 : also.has(w.slice(0, 4)) ? 1 : 0), 0);
    if (n > most) {
      most = n;
      best = line;
    }
  });
  return best;
}
var DEFAULT_STATE = (config) => Object.fromEntries(
  Object.entries(isObj3(config?.state?.variables) ? config.state.variables : {}).map(([name, v]) => [name, isObj3(v) ? v.default ?? null : null])
);
function createSimulatedAgent(config, { channelId, state: startingState } = {}) {
  const agents = list4(config?.agents?.items);
  const channels = list4(config?.channels);
  const channel = channels.find((c) => c?.id === channelId) || channels.find((c) => c?.enabled !== false) || channels[0] || null;
  let current = agents.find((a) => a?.id === config?.agents?.entry) || agents[0] || null;
  const state2 = { ...DEFAULT_STATE(config), ...isObj3(startingState) ? startingState : {} };
  const calls = [];
  let ended = false;
  let request = null;
  const persona = isObj3(config?.persona) ? config.persona : {};
  const name = () => persona.name || current?.name || "the agent";
  const fill = (text3) => renderTemplate(text3, { ...config, state: { variables: Object.fromEntries(Object.entries(state2).map(([k, v]) => [k, { type: "string", default: v }])) } }).text.replace(/‹[^›]*›/g, "").replace(/\s{2,}/g, " ").trim();
  const offered = () => list4(current?.tools).map((id) => list4(config?.tools).find((t) => t?.id === id)).filter(Boolean);
  const isVoice = () => !!channel && (["sip_voice", "web_voice"].includes(channel.type) || list4(channel.modalities?.output).includes("audio"));
  function applyEffects(tool) {
    const said = [];
    list4(tool.effects).forEach((rule) => {
      if (isObj3(rule.when)) {
        const w = rule.when;
        if ("state" in w && "equals" in w && state2[w.state] !== w.equals) return;
        if (!("state" in w) && !("channel" in w)) return;
      }
      list4(rule.do).forEach((action) => {
        if (action?.type === "set_state" && isObj3(action.values)) Object.assign(state2, action.values);
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
    const text3 = fill(speechText(say, config)) || `Hello, I\u2019m ${name()}.`;
    out.push({ role: "assistant", text: text3, simulated: true });
    return out;
  }
  const formOf = (tool) => list4(config?.forms).find((f) => isObj3(f) && f.id === tool?.params?.form);
  function passOn(person, said, urgent, call) {
    call(person, { reason: said });
    const transfer = list4(config?.telephony?.transfers).find((t) => isObj3(t) && t.id === person.params?.transfer);
    const fallback = list4(person.params?.fallback).find((a) => a?.type === "say");
    const sorry = urgent ? "I\u2019m sorry to hear that. " : "";
    return transfer?.target ? `${sorry}I\u2019ll put you through to someone on the team now.` : `${sorry}${fill(speechText(fallback?.text, config)) || "I\u2019ll put you through to a person."}`;
  }
  function reply(userText, { hits = [] } = {}) {
    const said = String(userText || "").trim();
    const lower = said.toLowerCase();
    const out = { messages: [], toolCalls: [], handoff: null, ended: false };
    const speak = (text3) => {
      if (text3) out.messages.push({ role: "assistant", text: text3, simulated: true });
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
        list4(config?.knowledge).length > 0 && "answer questions from our information"
      ].filter(Boolean);
      const about = String(config?.meta?.description || "").trim();
      speak(
        `${about ? `${about.replace(/\.$/, "")}. ` : ""}${can.length ? `I can ${can.length > 1 ? `${can.slice(0, -1).join(", ")} and ${can.at(-1)}` : can[0]}.` : "Ask me anything."}`
      );
      return out;
    }
    const handoff = list4(current?.handoffs).find((h) => isObj3(h) && shares(lower, words2(`${h.description} ${h.tool}`)));
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
    const tool = tools.find((t) => !t.builtin && shares(lower, words2(`${t.id} ${t.name || ""} ${t.description || ""}`)));
    if (tool) {
      call(
        tool,
        Object.fromEntries(Object.keys(isObj3(tool.parameters?.properties) ? tool.parameters.properties : {}).map((k) => [k, `\u2039${k} from the caller\u203A`]))
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
      const fields = list4(formOf(form)?.fields).map((f) => f?.name).filter(Boolean);
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
      `I\u2019m ${name()}. This is a simulated reply: the real agent answers from its instructions (\u201C${snippet}\u201D)${list4(config?.knowledge).length ? " and its documents" : ""}. Nothing here answers it yet: to be sure it can, add the answer under What it knows or What it does.`
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
      return { ...state2 };
    },
    get toolCalls() {
      return [...calls];
    },
    get ended() {
      return ended;
    }
  };
}

// weave-react/src/studio/scenarios/model.js
var modelNameOf = (tool) => isObj3(tool) ? String(tool.name || tool.id || "") : "";

// weave-react/src/demo/demoTests.js
var list5 = (v) => Array.isArray(v) ? v : [];
var clone2 = (v) => JSON.parse(JSON.stringify(v));
var DEMO_RUN_NOTE = "Sandbox: this result was made by a simple imitation of the runtime, not by the real one.";
var STEP_MS = 400;
function checksumOf(config) {
  const canon = (v) => Array.isArray(v) ? v.map(canon) : isObj3(v) ? Object.fromEntries(
    Object.keys(v).sort().map((k) => [k, canon(v[k])])
  ) : v;
  const text3 = JSON.stringify(canon(config));
  let a = 2166136261;
  let b = 16777619;
  for (let i = 0; i < text3.length; i += 1) {
    a ^= text3.charCodeAt(i);
    a = Math.imul(a, 16777619) >>> 0;
    b = Math.imul(b ^ text3.charCodeAt(i), 2246822507) + i >>> 0;
  }
  return `${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}
var wildcard = (pattern) => new RegExp(
  `^${String(pattern).split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`
);
var fillArgs = (value, args) => typeof value === "string" ? value.replace(/\{\{\s*args\.([A-Za-z_][\w-]*)\s*(?:\|[^}]*)?\}\}/g, (_, name) => args && args[name] !== void 0 ? String(args[name]) : "") : Array.isArray(value) ? value.map((v) => fillArgs(v, args)) : isObj3(value) ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillArgs(v, args)])) : value;
var sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b) || a !== null && b !== null && typeof a !== "object" && typeof b !== "object" && String(a) === String(b);
var subset = (needle, haystack) => isObj3(needle) && isObj3(haystack) && Object.entries(needle).every(([k, v]) => sameValue(haystack[k], v));
function matchMock(mocks, used, request) {
  for (let i = 0; i < mocks.length; i += 1) {
    const m = mocks[i];
    if (!isObj3(m)) continue;
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
  return list5(scenario.expect).map((expect) => {
    const check = (kind, passed, detail) => ({ kind, expect, passed, detail });
    if (!isObj3(expect)) return check("unknown", null, "This expectation is not an object.");
    if ("tool_called" in expect) {
      const ok3 = ctx.tools.some((t) => t.tool === expect.tool_called);
      return check(
        "tool_called",
        ok3,
        ok3 ? `\u201C${expect.tool_called}\u201D was called.` : `not called; the model called: ${[...new Set(ctx.tools.map((t) => t.tool))].join(", ") || "nothing"}`
      );
    }
    if ("tool_not_called" in expect) {
      const hit = ctx.tools.some((t) => t.tool === expect.tool_not_called);
      return check(
        "tool_not_called",
        !hit,
        hit ? `\u201C${expect.tool_not_called}\u201D was called, but should not have been.` : `\u201C${expect.tool_not_called}\u201D was not called.`
      );
    }
    if ("tool_called_with" in expect) {
      const { tool, args } = expect.tool_called_with || {};
      const calls = ctx.tools.filter((t) => t.tool === tool);
      const ok3 = calls.some((t) => subset(args || {}, t.args || {}));
      return check(
        "tool_called_with",
        ok3,
        ok3 ? `\u201C${tool}\u201D was called with those arguments.` : calls.length ? `\u201C${tool}\u201D was called, but with ${JSON.stringify(calls[0].args)}.` : `\u201C${tool}\u201D was not called.`
      );
    }
    if ("state_equals" in expect) {
      const { state: state2, value } = expect.state_equals || {};
      const actual = ctx.state[state2];
      const ok3 = sameValue(actual, value);
      return check(
        "state_equals",
        ok3,
        ok3 ? `${state2} is ${JSON.stringify(actual)}.` : `${state2} is ${JSON.stringify(actual ?? null)}, expected ${JSON.stringify(value)}.`
      );
    }
    if ("said_matches" in expect) {
      let re;
      try {
        re = new RegExp(expect.said_matches, "i");
      } catch {
        return check("said_matches", null, "The pattern is not a valid regular expression.");
      }
      const hit = ctx.said.find((t) => re.test(t));
      return check("said_matches", !!hit, hit ? `The agent said \u201C${hit.slice(0, 80)}\u201D.` : `No agent message matches /${expect.said_matches}/.`);
    }
    if ("agent_is" in expect)
      return check(
        "agent_is",
        ctx.agent === expect.agent_is,
        ctx.agent === expect.agent_is ? `${ctx.agent} was in charge at the end.` : `${ctx.agent || "no agent"} was in charge at the end, not ${expect.agent_is}.`
      );
    if ("http_called" in expect) {
      const e = expect.http_called || {};
      const hits = ctx.http.filter((h) => (!e.method || h.method === e.method) && wildcard(e.path || "").test(h.path));
      const ok3 = e.times ? hits.length === e.times : hits.length > 0;
      return check(
        "http_called",
        ok3,
        ok3 ? `${hits.length} matching request${hits.length === 1 ? "" : "s"}.` : e.times ? `${hits.length} matching requests, expected ${e.times}.` : "No such request was made."
      );
    }
    if ("http_not_called" in expect) {
      const e = expect.http_not_called || {};
      const hits = ctx.http.filter((h) => (!e.method || h.method === e.method) && wildcard(e.path || "").test(h.path));
      return check("http_not_called", hits.length === 0, hits.length ? `The bot made ${hits[0].method} ${hits[0].path}.` : "No such request was made.");
    }
    if ("judge" in expect)
      return check(
        "judge",
        null,
        scripted ? "Needs a live model, so it is skipped in a scenario with a model script." : judge ? "Sandbox has no model to grade this." : "Grading is off for this run: turn on \u201Cgrade reviewer checks\u201D."
      );
    for (const kind of ["task_outcome", "guardrail_triggered", "guardrail_not_triggered", "limit_reached"])
      if (kind in expect)
        return check(kind, null, "The Sandbox runs no tasks, safety rules or call limits, so this cannot be checked here. The real runner checks it.");
    return check("unknown", null, "The Sandbox runner does not know this kind of check.");
  });
}
function runScenarioDemo(config, scenario, { live = false, judge = false } = {}) {
  const scripted = list5(scenario?.model_script).length > 0;
  const mode = scripted ? "scripted" : "live";
  const base = {
    id: scenario?.id || "",
    mode,
    transcript: [],
    tools: [],
    http: [],
    unmocked: [],
    final_agent: "",
    final_state: {},
    events: [],
    notes: [DEMO_RUN_NOTE]
  };
  if (!scripted && !live)
    return {
      ...base,
      status: "skipped",
      checks: [],
      reason: "This scenario has no model script, so it is a live one: it runs only when live scenarios are included (it calls a paid model)."
    };
  const agents = list5(config?.agents?.items);
  const toolNamed = (name) => {
    const same = list5(config?.tools).filter((t) => modelNameOf(t) === name);
    return same.find((t) => !list5(t.channels).length || list5(t.channels).includes(scenario?.channel)) || same[0] || list5(config?.tools).find((t) => t?.id === name);
  };
  const sim = createSimulatedAgent(config, { channelId: scenario?.channel, state: isObj3(scenario?.state) ? scenario.state : void 0 });
  let agent = agents.find((a) => a?.id === config?.agents?.entry)?.id || agents[0]?.id || "";
  const state2 = { ...sim.state, ...isObj3(scenario?.state) ? scenario.state : {} };
  const simStart = JSON.stringify(sim.state);
  const transcript = [];
  const tools = [];
  const http = [];
  const unmocked = [];
  const said = [];
  const events = [];
  const used = {};
  let seq = 0;
  let clock = 0;
  const event = (name, fields) => {
    seq += 1;
    clock += 0.4;
    events.push({ t: "", seq, elapsed_s: Math.round(clock * 1e3) / 1e3, event: name, ...fields });
  };
  event("call_started", { bot: config?.meta?.id, channel: { id: scenario?.channel }, caller: scenario?.caller?.phone || null });
  event("agent_entered", { agent, first: true });
  sim.greeting().forEach((m) => {
    transcript.push({ role: "assistant", text: m.text });
    said.push(m.text);
    event("agent_said", { text: m.text, interrupted: false });
  });
  const script = [...list5(scenario?.model_script)];
  const runTool = (name, args) => {
    const tool = toolNamed(name);
    const handoff = list5(agents.find((a) => a?.id === agent)?.handoffs).find((h) => h?.tool === name);
    const record = { tool: name, args: args || {}, output: null, error: null };
    event("tool_called", { tool: name, args: args || {} });
    if (handoff) {
      agent = handoff.to;
      record.output = { handoff_to: handoff.to };
      event("agent_entered", { agent, first: false });
    } else if (tool?.type === "http" && isObj3(tool.request)) {
      const request = {
        method: tool.request.method || "GET",
        path: String(fillArgs(tool.request.path || "/", args)),
        query: fillArgs(tool.request.query || {}, args),
        body: fillArgs(tool.request.body, args),
        connection: tool.connection
      };
      const mock = matchMock(list5(scenario?.http_mocks), used, request);
      const status = mock ? mock.status ?? 200 : 404;
      http.push({ method: request.method, path: request.path, status, mocked: !!mock, connection: request.connection });
      event("http_request", { method: request.method, path: request.path, status, ms: 1, mocked: !!mock });
      if (!mock) unmocked.push({ method: request.method, path: request.path, connection: request.connection, query: request.query });
      const json = mock ? mock.json !== void 0 ? mock.json : mock.text : null;
      record.output = json ?? null;
      if (status >= 400) record.error = `HTTP ${status}`;
      else if (isObj3(tool.result?.to_state))
        Object.entries(tool.result.to_state).forEach(([variable, path]) => {
          const found = evalPath(json, path);
          if (found.length) {
            state2[variable] = found[0];
            event("state_changed", { name: variable, value: found[0] });
          }
        });
    } else if (tool?.builtin === "end_call") record.output = { ended: true };
    tools.push(record);
    return record;
  };
  for (const turn of list5(scenario?.turns)) {
    const pressed = isObj3(turn) && typeof turn.keys === "string" && turn.say === void 0;
    const textIn = String(turn?.say ?? "");
    if (pressed) event("keys_pressed", { count: turn.keys.length });
    else {
      transcript.push({ role: "user", text: textIn });
      event("user_said", { text: textIn });
    }
    if (scripted) {
      while (script.length) {
        const item = script.shift();
        if (typeof item === "string") {
          transcript.push({ role: "assistant", text: item });
          said.push(item);
          event("agent_said", { text: item, interrupted: false });
          break;
        }
        if (isObj3(item) && item.tool) runTool(item.tool, item.args);
      }
    } else if (!pressed) {
      const out = sim.reply(textIn);
      out.toolCalls.forEach((c) => runTool(c.id || c.tool, c.args));
      out.messages.forEach((m) => {
        transcript.push({ role: "assistant", text: m.text });
        said.push(m.text);
        event("agent_said", { text: m.text, interrupted: false });
      });
      if (out.handoff) agent = out.handoff;
    }
  }
  event("session_closed", { reason: "scenario_finished", error: null });
  const finalAgent = scripted ? agent : sim.currentAgent || agent;
  const started = JSON.parse(simStart);
  const simChanged = Object.fromEntries(Object.entries(sim.state).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(started[k])));
  const finalState = scripted ? state2 : { ...state2, ...simChanged };
  const checks = evaluateChecks(scenario, { tools, state: finalState, said, http, agent: finalAgent }, { judge, scripted });
  return {
    ...base,
    status: checks.some((c) => c.passed === false) ? "failed" : "passed",
    checks,
    transcript,
    tools,
    http,
    unmocked,
    final_agent: finalAgent,
    final_state: finalState,
    events,
    notes: scripted ? [DEMO_RUN_NOTE] : [DEMO_RUN_NOTE, "This live scenario was played by the simulated agent: no real model was called."]
  };
}
var aggregate = (results) => results.some((r) => r.status === "error") ? "error" : results.some((r) => r.status === "failed") ? "failed" : results.every((r) => r.status === "skipped") ? "skipped" : "passed";
function createRun({ id, config, ref, body, startedAt, stepMs = STEP_MS }) {
  const ids = list5(body?.scenarios);
  const all = list5(config?.tests).filter(isObj3);
  const chosen = ids.length ? all.filter((s) => ids.includes(s.id)) : all;
  const results = chosen.map((scenario) => {
    try {
      return runScenarioDemo(config, scenario, { live: body?.live === true, judge: body?.judge === true });
    } catch (error) {
      return {
        id: scenario.id,
        mode: "scripted",
        status: "error",
        detail: error.message,
        checks: [],
        transcript: [],
        tools: [],
        http: [],
        unmocked: [],
        final_agent: "",
        final_state: {},
        events: [],
        notes: [DEMO_RUN_NOTE]
      };
    }
  });
  return {
    id,
    ref,
    config_checksum: checksumOf(config),
    started_at: startedAt,
    live: body?.live === true,
    judge: body?.judge === true,
    runner: "demo",
    stepMs,
    results
  };
}
function viewRun(run, nowMs) {
  const elapsed = nowMs - Date.parse(run.started_at);
  const done = run.stepMs <= 0 ? run.results.length : Math.min(run.results.length, Math.max(0, Math.floor(elapsed / run.stepMs)));
  const visible = run.results.slice(0, done).map(clone2);
  const finished = done >= run.results.length;
  return {
    id: run.id,
    status: finished ? aggregate(run.results) : "running",
    ref: run.ref,
    config_checksum: run.config_checksum,
    started_at: run.started_at,
    finished_at: finished ? new Date(Date.parse(run.started_at) + run.results.length * Math.max(run.stepMs, 1)).toISOString() : null,
    live: run.live,
    judge: run.judge,
    runner: run.runner,
    total: run.results.length,
    scenarios: visible
  };
}
function headlineOf(run, nowMs) {
  const view = viewRun(run, nowMs);
  const count = (status) => view.scenarios.filter((s) => s.status === status).length;
  const { scenarios, ...rest } = view;
  return { ...rest, counts: { total: view.total, passed: count("passed"), failed: count("failed"), error: count("error"), skipped: count("skipped") } };
}
function scenarioListOf(config, runs, nowMs) {
  const views = runs.map((r) => viewRun(r, nowMs));
  return list5(config?.tests).filter(isObj3).map((scenario) => {
    let last = null;
    for (const view of views) {
      const hit = view.scenarios.find((s) => s.id === scenario.id);
      if (hit) {
        last = { ...hit, run_id: view.id, ran_at: view.started_at };
        break;
      }
    }
    const mode = list5(scenario.model_script).length > 0 ? "scripted" : "live";
    return last ? { ...scenario, mode, last } : { ...scenario, mode };
  });
}

// weave-react/src/demo/demoPreview.js
var list6 = (v) => Array.isArray(v) ? v : [];
var DEMO_PREVIEW_NOTE = "Sandbox: this preview was built by a simple imitation in your browser, not by the runtime, so wording and ordering can differ from what the model really receives.";
function pyRepr(value) {
  if (value === null || value === void 0) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.includes("'") && !value.includes('"') ? `"${value}"` : `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(", ")}]`;
  if (isObj3(value))
    return `{${Object.entries(value).map(([k, v]) => `${pyRepr(k)}: ${pyRepr(v)}`).join(", ")}}`;
  return String(value);
}
function previewPromptDemo(config, body = {}) {
  const agents = list6(config?.agents?.items);
  const agentId = body.agent || config?.agents?.entry || agents[0]?.id;
  const built = assemblePrompt(config, agentId, { channelId: body.channel });
  if (!built) return { status: 404, body: { detail: `There is no agent '${agentId}' in this configuration.` } };
  const channel = list6(config?.channels).find((c) => c?.id === (body.channel || list6(config?.channels).find((x) => x?.enabled !== false)?.id));
  const toolsById = Object.fromEntries(list6(config?.tools).map((t) => [t?.id, t]));
  const tools = [
    ...list6(built.agent.tools).map((id) => {
      const t = toolsById[id];
      const why = t ? notAvailable(t) : null;
      return {
        name: id,
        description: t?.description || "",
        parameters: t?.parameters || { type: "object", properties: {} },
        offered: !!t && !why,
        reason: !t ? "not defined" : why ? `${why} can\u2019t run yet` : ""
      };
    }),
    ...list6(built.agent.handoffs).filter(isObj3).map((h) => ({
      name: h.tool,
      description: h.description || `Hand the caller to ${h.to}`,
      parameters: { type: "object", properties: {} },
      offered: true,
      reason: ""
    }))
  ];
  const sections = built.sections.filter((s) => s.id !== "tools").map((s) => ({ kind: s.id, label: s.title, text: s.text, active: !s.conditional, ...s.conditional ? { when: s.note } : {} }));
  const instructions = sections.filter((s) => s.active).map((s) => s.text).join("\n\n");
  const state2 = Object.fromEntries(Object.entries(config?.state?.variables || {}).map(([k, v]) => [k, v?.sensitive ? "\u2022\u2022\u2022" : v?.default ?? null]));
  Object.assign(state2, isObj3(body.state) ? body.state : {});
  const words3 = (instructions.trim().match(/\S+/g) || []).length;
  return {
    status: 200,
    body: {
      agent: agentId,
      channel: channel?.id || null,
      instructions,
      sections,
      opening: built.agent.instructions?.opening || "",
      greeting: typeof channel?.greeting?.say === "string" ? channel.greeting.say : "",
      on_enter: list6(built.agent.on_enter),
      tools,
      knowledge: knowledgeUse(config, built.agent, toolsById),
      models: config?.defaults?.models || {},
      state: state2,
      stats: { words: words3, approx_tokens: Math.round(words3 * 1.33), tools_offered: tools.filter((t) => t.offered).length },
      demo: true,
      note: DEMO_PREVIEW_NOTE
    }
  };
}
var collectSecrets = (value, out = /* @__PURE__ */ new Set()) => {
  if (isObj3(value)) {
    if (typeof value.secret === "string") out.add(value.secret);
    Object.values(value).forEach((v) => collectSecrets(v, out));
  } else if (Array.isArray(value)) value.forEach((v) => collectSecrets(v, out));
  return out;
};
var effectWords = (rule) => list6(rule?.do).map((a) => {
  if (a?.type === "say") return "says a line";
  if (a?.type === "set_state") return `sets ${Object.keys(a.values || {}).join(", ") || "state"}`;
  if (a?.type === "handoff") return `hands over to ${a.to}`;
  if (a?.type === "end_call") return "ends the call";
  return a?.type ? String(a.type).replace(/_/g, " ") : "does something";
});
function previewResultDemo(config, body = {}) {
  const tool = list6(config?.tools).find((t) => t?.id === body.tool);
  if (!tool) return { status: 404, body: { detail: `There is no tool '${body.tool}' in this configuration.` } };
  const args = isObj3(body.args) ? body.args : {};
  const out = { demo: true, note: DEMO_PREVIEW_NOTE };
  if (tool.type === "http" && isObj3(tool.request)) {
    const connection = (config?.connections || {})[tool.connection] || {};
    const base = String(connection.base_url || "").replace(/\/$/, "");
    out.request = {
      method: tool.request.method || "GET",
      url: `${base}${fillArgs(tool.request.path || "/", args)}`,
      query: fillArgs(tool.request.query || {}, args),
      headers: {},
      body: tool.request.body === void 0 ? null : fillArgs(tool.request.body, args),
      auth: { type: connection.auth?.type || "none", secrets: [...collectSecrets(connection.auth)] }
    };
  }
  out.preconditions = { holds: true, message: "" };
  const props = isObj3(tool.parameters?.properties) ? tool.parameters.properties : {};
  out.args_problems = [
    ...list6(tool.parameters?.required).filter((name) => args[name] === void 0 || args[name] === "").map((name) => `the argument \u201C${name}\u201D is required`),
    ...Object.keys(args).filter((name) => !(name in props)).map((name) => `\u201C${name}\u201D isn\u2019t a parameter of this tool`)
  ];
  if ("response" in body) {
    const response = body.response;
    const toLlm = list6(tool.result?.to_llm);
    const seen = toLlm.length ? Object.fromEntries(
      toLlm.map((path) => {
        const found = evalPath(response, path);
        return found.length ? [String(path).replace(/^\$\./, ""), found.length === 1 ? found[0] : found] : null;
      }).filter(Boolean)
    ) : response;
    const stored = Object.fromEntries(
      Object.entries(isObj3(tool.result?.to_state) ? tool.result.to_state : {}).map(([variable, path]) => {
        const found = evalPath(response, path);
        return found.length ? [variable, found[0]] : null;
      }).filter(Boolean)
    );
    out.result = {
      model_sees: seen,
      model_sees_text: pyRepr(seen),
      stored_in_state: stored,
      kept_from_the_model: list6(tool.result?.out_of_band?.fields).map((f) => typeof f === "string" ? f : f?.name || JSON.stringify(f)),
      effects: list6(tool.effects).map(
        (rule) => `${effectWords(rule).join(", then ") || "does something"}${rule?.when ? " (only when its condition holds)" : ""}`
      )
    };
  }
  return { status: 200, body: out };
}
function knowledgeUse(config, agent, toolsById) {
  const bases = Object.fromEntries(list6(config?.knowledge).map((b) => [b?.id, b]));
  const before = list6(agent?.knowledge).filter((id) => bases[id]).map((id) => ({ base: id, top_k: bases[id].top_k, min_score: bases[id].retrieval?.min_score }));
  const byTools = list6(agent?.tools).map((id) => toolsById[id]).filter((t) => t?.type === "knowledge").map((t) => ({ tool: t.id, base: t.source }));
  return before.length || byTools.length ? { before_each_reply: before, tools: byTools } : null;
}

// weave-react/src/demo/demoTryPreviews.js
var list7 = (v) => Array.isArray(v) ? v : [];
var escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var tryRe = (source, flags) => {
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
};
var demo = (body) => ({ status: 200, body: { demo: true, note: DEMO_PREVIEW_NOTE, ...body } });
var refuse = (detail) => ({ status: 422, body: { detail } });
var DEMO_ENTITIES = [
  { kind: "card_number", how: "A run of 13 to 19 digits, which may have spaces or dashes between them.", re: /\b\d(?:[ -]?\d){12,18}\b/g },
  { kind: "bank_account", how: "A run of 8 to 12 digits.", re: /\b\d{8,12}\b/g },
  { kind: "national_id", how: "A letter and 7 digits, or 9 digits written in groups.", re: /\b[A-Z]\d{7}\b|\b\d{3}-\d{2}-\d{4}\b/g },
  { kind: "phone_number", how: "A number of 8 to 15 digits, which may start with + and have spaces or dashes.", re: /\+?\d[\d -]{7,14}\d/g },
  { kind: "email", how: "Something@something.something.", re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
  { kind: "date_of_birth", how: "A date such as 1990-04-12 or 12/04/1990.", re: /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g },
  { kind: "otp", how: "A code of 4 to 8 digits near the word code or OTP.", re: /(?<=\b(?:code|otp)\D{0,12})\d{4,8}\b/gi },
  { kind: "pin", how: "A code of 4 digits near the word PIN.", re: /(?<=\bpin\D{0,12})\d{4}\b/gi }
];
var demoEntities = () => DEMO_ENTITIES.map(({ kind, how }) => ({ kind, how }));
function findEntities(line, kinds) {
  const hits = [];
  list7(kinds).forEach((kind) => {
    const entity = DEMO_ENTITIES.find((e) => e.kind === kind);
    if (!entity) return;
    for (const m of line.matchAll(new RegExp(entity.re.source, entity.re.flags))) hits.push({ kind, start: m.index, end: m.index + m[0].length, text: m[0] });
  });
  return hits;
}
function previewRedactionDemo(config, body = {}) {
  const line = String(body.text ?? "");
  const r = isObj3(config?.post_call?.redaction) ? config.post_call.redaction : {};
  const replacement = typeof r.replacement === "string" ? r.replacement : "[REDACTED]";
  const hits = findEntities(line, r.entities);
  list7(r.patterns).forEach((source) => {
    const re = tryRe(source, "g");
    if (re) {
      for (const m of line.matchAll(re)) if (m[0]) hits.push({ kind: "pattern", start: m.index, end: m.index + m[0].length, text: m[0] });
    }
  });
  const variables = isObj3(config?.state?.variables) ? config.state.variables : {};
  const sensitive = Object.entries(variables).filter(([, spec]) => isObj3(spec) && spec.sensitive === true).map(([name]) => name);
  const state2 = isObj3(body.state) ? body.state : {};
  if (r.mask_sensitive_state !== false)
    sensitive.forEach((name) => {
      const value = state2[name];
      if (value === void 0 || value === null || value === "") return;
      const at2 = line.indexOf(String(value));
      if (at2 >= 0) hits.push({ kind: "sensitive_state", start: at2, end: at2 + String(value).length, text: String(value) });
    });
  const ordered = hits.sort((a, b) => a.start - b.start).filter((h, i, all) => i === 0 || h.start >= all[i - 1].end);
  let redacted = "";
  let at = 0;
  ordered.forEach((h) => {
    redacted += line.slice(at, h.start) + replacement;
    at = h.end;
  });
  redacted += line.slice(at);
  const on = r.enabled !== false && (list7(r.entities).length || list7(r.patterns).length || sensitive.length);
  return demo({
    redacted: on ? redacted : line,
    found: on ? ordered : [],
    entities: demoEntities().filter((e) => list7(r.entities).includes(e.kind)),
    patterns: list7(r.patterns),
    replacement,
    masks_sensitive_state: r.mask_sensitive_state !== false,
    sensitive_variables: sensitive,
    applies_to: ["saved transcripts and metrics", "the per-call log", "text sent in an API call or an email"],
    model_sees: on ? "The model still hears what the caller says during the call. Only what is saved or sent on is cleaned; the exact value of a sensitive variable is kept from it once stored." : "Redaction is not set up (or is off), so nothing would be hidden."
  });
}
var INJECTION = /ignore (all )?(your )?(previous|prior) instructions|disregard (the |your )?(system|previous)|reveal (your|the) (system )?prompt|you are now/i;
var DEFAULT_LINES = {
  deflect: "Sorry, I can\u2019t help with that.",
  block: "Sorry, I can\u2019t help with that.",
  end_call: "I\u2019m sorry, I have to end this call. Goodbye."
};
var STRENGTH = ["redact_in_logs", "rewrite", "deflect", "block", "end_call"];
function previewGuardrailsDemo(config, body = {}) {
  const line = String(body.text ?? "");
  const rules = list7(config?.guardrails?.input);
  const matched = [];
  const notChecked = [];
  rules.forEach((rule) => {
    let found = [];
    if (rule?.type === "prompt_injection") {
      const m = line.match(INJECTION);
      if (m) found = [{ text: m[0], start: m.index, end: m.index + m[0].length, what: "an attempt to change its instructions" }];
    } else if (rule?.type === "pii_detect") {
      found = findEntities(line, rule.entities).map((h) => ({ text: h.text, start: h.start, end: h.end, what: h.kind }));
    } else if (rule?.type === "regex_block") {
      list7(rule.patterns).forEach((source) => {
        const re = tryRe(source, "gi");
        if (re) {
          for (const m of line.matchAll(re)) if (m[0]) found.push({ text: m[0], start: m.index, end: m.index + m[0].length, what: "a blocked pattern" });
        }
      });
    } else notChecked.push(rule?.id || rule?.type);
    if (found.length)
      matched.push({
        rule: rule.id,
        type: rule.type,
        action: rule.on_trigger?.action || "deflect",
        kinds: rule.type === "pii_detect" ? list7(rule.entities) : [],
        found
      });
  });
  const action = STRENGTH.filter((a) => matched.some((m) => m.action === a)).pop() || null;
  const asked = !["deflect", "block", "end_call"].includes(action);
  const rewriteMatches = matched.filter((m) => m.action === "rewrite").flatMap((m) => m.found);
  let cleaned = line;
  [...rewriteMatches].sort((a, b) => b.start - a.start).forEach((h) => cleaned = `${cleaned.slice(0, h.start)}[removed]${cleaned.slice(h.end)}`);
  const firstWithLine = matched.find((m) => ["deflect", "block", "end_call"].includes(m.action));
  const logged = matched.filter((m) => m.action === "redact_in_logs").flatMap((m) => m.found);
  let saved = line;
  [...logged].sort((a, b) => b.start - a.start).forEach((h) => saved = `${saved.slice(0, h.start)}[REDACTED]${saved.slice(h.end)}`);
  return demo({
    matched,
    action,
    model_is_asked: asked,
    says_instead: firstWithLine ? rules.find((r) => r?.id === firstWithLine.rule)?.on_trigger?.say ?? DEFAULT_LINES[firstWithLine.action] ?? null : null,
    model_sees: asked ? action === "rewrite" ? cleaned : line : "(the line is withheld from the model)",
    saved_as: saved,
    rules: rules.map((r) => r?.id).filter(Boolean),
    not_checked_in_code: notChecked,
    how_actions_work: {
      deflect: "A fixed line is said and the model is not asked.",
      redact_in_logs: "The model still reads the line; the saved records hide the match.",
      rewrite: "The model reads a cleaned copy of the line.",
      block: "The line is dropped.",
      end_call: "The goodbye is said and the call ends."
    },
    default_lines: DEFAULT_LINES,
    limits: config?.guardrails?.limits || {}
  });
}
var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var ordinal = (n) => `${n}${[11, 12, 13].includes(n % 100) ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
function applyRule(rule, line) {
  const changes = [];
  const make = (re, to) => line.replace(re, (...m) => {
    const out = to(...m);
    if (out !== m[0]) changes.push({ from: m[0], to: out });
    return out;
  });
  let result = line;
  if (rule.type === "replace") {
    if (!rule.pattern || typeof rule.replacement !== "string") return { problem: "the rule needs a pattern and what to say instead", result, changes };
    const re = tryRe(rule.pattern, rule.ignore_case ? "gi" : "g");
    if (!re) return { problem: `the pattern \u201C${rule.pattern}\u201D is not a valid regular expression`, result, changes };
    result = make(re, () => rule.replacement);
  } else if (rule.type === "dictionary") {
    const keys = Object.keys(isObj3(rule.entries) ? rule.entries : {}).filter((key) => key !== "").sort((a, b) => b.length - a.length);
    if (!keys.length) return { result, changes };
    const flags = rule.ignore_case ? "gi" : "g";
    const body = keys.map(escapeRe).join("|");
    const re = new RegExp(rule.whole_word ? `\\b(?:${body})\\b` : body, flags);
    const lookup = (k) => rule.entries[keys.find((key) => rule.ignore_case ? key.toLowerCase() === k.toLowerCase() : key === k)];
    result = make(re, (m) => lookup(m) ?? m);
  } else if (rule.type === "spell") {
    if (!rule.pattern) return { problem: "the rule needs a pattern for what to spell out", result, changes };
    const re = tryRe(rule.pattern, "g");
    if (!re) return { problem: `the pattern \u201C${rule.pattern}\u201D is not a valid regular expression`, result, changes };
    result = make(re, (m) => m.split("").join(" "));
  } else if (rule.type === "digits") {
    const min = Math.max(1, Number(rule.min_length) || 6);
    const size = Math.max(1, Number(rule.group_size) || 4);
    result = make(
      new RegExp(`(\\+?)(\\d{${min},})`, "g"),
      (m, plus, digits) => `${plus ? rule.plus_prefix ?? "plus " : ""}${(digits.match(new RegExp(`.{1,${size}}`, "g")) || []).join(" ")}`
    );
  } else if (rule.type === "currency") {
    if (!rule.major_unit) return { problem: "the rule needs the word for the main unit, such as \u201Cdollars\u201D", result, changes };
    const symbols = list7(rule.symbols).length ? rule.symbols : ["$"];
    const re = new RegExp(`(${symbols.map(escapeRe).join("|")})\\s?(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d{2}))?`, "g");
    result = make(
      re,
      (m, sym, whole, cents) => `${whole.replace(/,/g, "")} ${rule.major_unit}${cents && rule.minor_unit ? ` and ${Number(cents)} ${rule.minor_unit}` : ""}`
    );
  } else if (rule.type === "time") {
    result = make(/\b(\d{1,2}):(\d{2})\s?(AM|PM)\b/gi, (m, h, min, ap) => `${h} ${min} ${ap.toUpperCase().split("").join(" ")}`);
  } else if (rule.type === "date") {
    result = make(/\b(\d{1,2})-([A-Za-z]{3})-(\d{4})\b/g, (m, d, mon, y) => {
      const month = MONTHS.find((name) => name.slice(0, 3).toLowerCase() === mon.toLowerCase());
      return month ? `${ordinal(Number(d))} ${month} ${y}` : m;
    });
  }
  return { result, changes };
}
function previewSpeechDemo(config, body = {}) {
  const line = String(body.text ?? "");
  const agents = list7(config?.agents?.items);
  const agent = agents.find((a) => a?.id === body.agent) || agents.find((a) => a?.id === config?.agents?.entry) || agents[0];
  const channel = list7(config?.channels).find((c) => c?.id === body.channel) || list7(config?.channels)[0];
  const speechOf = (node) => isObj3(node?.conversation?.speech) ? node.conversation.speech : null;
  const own = [speechOf(agent), speechOf(channel), speechOf(config?.defaults)].find((s) => s && Array.isArray(s.pronunciation));
  const rules = list7(own?.pronunciation);
  const applyTo = (speechOf(config?.defaults) || own)?.apply_to === "all" ? "all" : "model";
  const out = { text: line, apply_to: applyTo, spoken: line, changes: [], problems: [], applies: true, held_back_at_end: "" };
  const voice = channel ? list7(channel.modalities?.output).includes("audio") || /voice/.test(String(channel.type)) : true;
  if (!voice) return demo({ ...out, applies: false, why_not: "This channel has no voice, so nothing is spoken." });
  if (!rules.length) return demo({ ...out, applies: false, why_not: "No pronunciation rule applies to this agent." });
  if (body.source === "fixed" && applyTo === "model")
    return demo({
      ...out,
      applies: false,
      why_not: "Fixed lines you wrote yourself are not changed: \u201Cwhich lines use these rules\u201D is set to the AI\u2019s own words."
    });
  let spoken = line;
  rules.forEach((rule, index) => {
    const done = applyRule(rule, spoken);
    if (done.problem) out.problems.push({ rule: index + 1, message: done.problem });
    spoken = done.result;
    done.changes.forEach((c) => out.changes.push({ rule: index + 1, type: rule.type, label: rule.id || rule.type, from: c.from, to: c.to }));
  });
  out.spoken = spoken;
  const chunks = list7(body.chunks).map(String);
  if (chunks.length) {
    let carry = "";
    const arrived = [];
    chunks.forEach((piece, i) => {
      const text3 = carry + piece;
      const tail = i === chunks.length - 1 ? "" : (text3.match(/\d[\d:.,/-]*\s?[AaPp]?[Mm]?$/) || [""])[0];
      carry = tail;
      const speakable = tail ? text3.slice(0, -tail.length) : text3;
      if (speakable) arrived.push(rules.reduce((acc, rule) => applyRule(rule, acc).result, speakable));
    });
    out.streaming = { spoken_as_it_arrives: arrived };
  }
  return demo(out);
}
var compare = (actual, c) => {
  if ("equals" in c) return JSON.stringify(actual ?? null) === JSON.stringify(c.equals);
  if ("not_equals" in c) return JSON.stringify(actual ?? null) !== JSON.stringify(c.not_equals);
  if ("gte" in c) return Number(actual) >= c.gte;
  if ("lte" in c) return Number(actual) <= c.lte;
  if (Array.isArray(c.in)) return c.in.some((v) => JSON.stringify(v) === JSON.stringify(actual ?? null));
  return null;
};
var holds = (condition, state2, channelId = "") => {
  if (!isObj3(condition)) return null;
  if ("not" in condition) {
    const inner = holds(condition.not, state2, channelId);
    return inner === null ? null : !inner;
  }
  const group = Array.isArray(condition.all) ? "all" : Array.isArray(condition.any) ? "any" : "";
  if (group) {
    const parts = condition[group].map((c) => holds(c, state2, channelId));
    if (group === "all") return parts.includes(false) ? false : parts.includes(null) ? null : true;
    return parts.includes(true) ? true : parts.includes(null) ? null : false;
  }
  if (typeof condition.state === "string") return compare(state2[condition.state], condition);
  if ("channel" in condition) return channelId ? compare(channelId, { ...condition, equals: condition.channel }) : null;
  return null;
};
function previewTaskDemo(config, body = {}) {
  const task = list7(config?.tasks).find((t) => t?.id === body.task);
  if (!task) return { status: 404, body: { detail: `There is no task '${body.task}' in this configuration.` } };
  const variables = isObj3(config?.state?.variables) ? config.state.variables : {};
  const state2 = { ...Object.fromEntries(Object.entries(variables).map(([k, v]) => [k, v?.initial])), ...isObj3(body.state) ? body.state : {} };
  const phone = list7(config?.channels).find((c) => c?.id === body.channel)?.type === "sip_voice";
  const taskSkipped = holds(task.skip_if, state2, body.channel) === true;
  const steps = list7(task.steps).map((step) => {
    const skipped = holds(step.skip_if, state2, body.channel) === true;
    const held = holds(step.requires, state2, body.channel) === false;
    const out = {
      id: step.id,
      type: step.type || "collect",
      skipped_now: skipped,
      held_back_now: held,
      skip_if: step.skip_if ?? null,
      requires: step.requires ?? null,
      attempts: step.max_attempts ?? task.max_attempts ?? 3,
      problems: []
    };
    if ((step.type || "collect") === "collect") {
      const keypad = step.input === "dtmf";
      out.instructions = `Ask the caller: ${step.ask || "(no question written)"}`;
      out.answer_mode = keypad ? "keypad" : step.validate?.type === "tool" ? "tool_arguments" : "value";
      out.model_tools = keypad ? ["cannot_continue"] : ["cannot_continue", step.validate?.type === "tool" ? step.validate.tool : "submit_answer"];
      out.checked_by = step.validate?.type === "tool" ? { tool: step.validate.tool, args: step.validate.args || {} } : step.validate?.type === "regex" ? { pattern: step.validate.pattern } : null;
      out.pass_when = step.pass_when ?? null;
      out.store_in = step.store_in || "";
      if (keypad) {
        out.keypad = { num_digits: step.dtmf?.num_digits ?? null, timeout_s: step.dtmf?.timeout_s ?? 10, terminator: step.dtmf?.terminator ?? "#" };
        if (body.channel && !phone)
          out.problems.push("This step takes keypad digits, which only a phone call can give: on this channel it would end the task as failed.");
      }
    } else out.actions = list7(step.do).map((a) => a?.type ? `${String(a.type).replace(/_/g, " ")}.` : "Does something.");
    return out;
  });
  const ending = (outcome, block) => ({
    sets: isObj3(block?.set_state) ? block.set_state : {},
    then_runs: list7(block?.do).map((e) => String(e?.type || "does something").replace(/_/g, " ")),
    next_task: block?.next || "",
    resumes: block?.resume || "caller",
    silent: block?.silent === true,
    tells_the_calling_agent: block?.tell_model || (block?.silent === true ? "Carry on with what the caller asked." : `Tell the caller how it ended (${block?.outcome || outcome}).`)
  });
  return demo({
    task: task.id,
    steps,
    attempts: { limit: task.max_attempts ?? 3, counted: task.attempts_scope === "task" ? "task" : "step" },
    skipped_now: taskSkipped,
    keeps_history: task.return_history === "full",
    endings: { verified: ending("verified", task.on_success), failed: ending("failed", task.on_failure), declined: ending("declined", task.on_decline) },
    offered_by: list7(config?.tools).filter((t) => t?.type === "task" && t.task === task.id).map((t) => t.id),
    problems: []
  });
}
function tryPreviewDemo(path, config, body) {
  if (!isObj3(body) || path !== "/preview/task" && typeof body.text !== "string")
    return refuse(path === "/preview/task" ? "Name the task to preview." : "Send some text to try.");
  if (path === "/preview/speech") return previewSpeechDemo(config, body);
  if (path === "/preview/guardrails") return previewGuardrailsDemo(config, body);
  if (path === "/preview/redaction") return previewRedactionDemo(config, body);
  return previewTaskDemo(config, body);
}

// weave-react/src/demo/demoNumbers.js
var list8 = (v) => Array.isArray(v) ? v : [];
var ENVIRONMENTS = ["development", "staging", "production"];
var PATTERN = "^\\+?[0-9]{3,15}$";
var ok = (body, status = 200) => ({ status, body });
var fail = (status, detail) => ({ status, body: { detail } });
var HAND_MADE = [
  {
    number: "+6563001000",
    trunk: { id: "ST_demo1", name: "singtel poc" },
    rule: { id: "SDR_demo1", name: "singtel poc rule", agents: [["agent-singtel", ""]] }
  },
  {
    number: "+81355550100",
    trunk: { id: "ST_demo2", name: "japan pilot" },
    rule: { id: "SDR_demo2", name: "japan pilot rule", agents: [["agent-japan", ""]] }
  }
];
var numberSettings = () => ({
  number_pattern: PATTERN,
  environments: ENVIRONMENTS,
  defaults: { record_audio: true, krisp: false, allowed_addresses: [] },
  recording: { format: "MP3, audio only", path: "/out/{room_name}-{time}" },
  livekit_configured: true,
  demo: true
});
var clean = (value) => String(value ?? "").trim();
function checkNumber(state2, value) {
  const number = clean(value);
  if (!new RegExp(PATTERN).test(number))
    return { number, status: "invalid", reason: "Use digits only, with an optional + at the start (3 to 15 digits, no spaces).", owner: null, warnings: [] };
  const ours = list8(state2.numbers).find((n) => n.number === number);
  if (ours)
    return {
      number,
      status: "taken_by_builder",
      owner: { trunk: `agent-builder ${ours.bot}`, bot: ours.bot, environment: ours.environment, agents: ruleAgents(ours) },
      warnings: []
    };
  const hand = HAND_MADE.find((n) => n.number === number);
  if (hand) return { number, status: "taken_external", owner: { trunk: hand.trunk.name, agents: hand.rule.agents }, warnings: [] };
  return { number, status: "free", owner: null, warnings: number.startsWith("+") ? [] : ["A number without a + may be read as an extension."] };
}
var ruleAgents = (record) => [["agent-builder-runtime", JSON.stringify({ bot: record.bot, ref: record.environment })]];
function rowOf(state2, record) {
  const bot = state2.bots?.[record.bot];
  const version = bot?.deployed?.[record.environment] || null;
  const config = version ? bot.versions.find((v) => v.version === version)?.config : null;
  const phoneChannel = config ? list8(config.channels).some((c) => c?.type === "sip_voice" && c.enabled !== false) : false;
  const problems = [];
  if (!bot) problems.push("This agent no longer exists.");
  else if (!version) problems.push(`Nothing is deployed to ${record.environment}, so a call would not be answered.`);
  else if (!phoneChannel) problems.push(`The version in ${record.environment} has no phone channel.`);
  const lastCall = record.last_call || null;
  return {
    number: record.number,
    managed: true,
    trunk: { id: record.trunk_id, name: `agent-builder ${record.bot}` },
    bot: record.bot,
    environment: record.environment,
    rule: { id: record.rule_id, name: `agent-builder ${record.bot} (${record.environment})`, agents: ruleAgents(record) },
    options: { ...record.options },
    problems,
    deployment: { deployed: !!version, version },
    phone_channel: phoneChannel,
    last_call: lastCall,
    routing: lastCall ? "calls_arriving" : "no_calls_yet",
    routing_note: lastCall ? "" : `No call to ${record.number} has been logged yet. If calls are expected, whoever runs the phone system (FreeSWITCH) must route ${record.number} to the LiveKit SIP service.`,
    status: problems.length ? "problem" : lastCall ? "ready" : "waiting_for_calls"
  };
}
var handRow = (hand) => ({
  number: hand.number,
  managed: false,
  trunk: hand.trunk,
  bot: null,
  environment: null,
  rule: hand.rule,
  options: { record_audio: true, krisp: false, allowed_addresses: [], max_call_duration_s: null },
  problems: []
});
function validOptions(body) {
  const out = {};
  if (body.record_audio !== void 0) {
    if (typeof body.record_audio !== "boolean") return { error: "record_audio must be true or false." };
    out.record_audio = body.record_audio;
  }
  if (body.krisp !== void 0) {
    if (typeof body.krisp !== "boolean") return { error: "krisp must be true or false." };
    out.krisp = body.krisp;
  }
  if (body.allowed_addresses !== void 0) {
    const addresses = list8(body.allowed_addresses).map(String);
    if (!Array.isArray(body.allowed_addresses) || addresses.some((a) => !/^[0-9a-f.:]+(\/\d{1,3})?$/i.test(a)))
      return { error: "allowed_addresses must be IP addresses or networks, like 203.0.113.7 or 10.0.0.0/8." };
    out.allowed_addresses = addresses;
  }
  if (body.max_call_duration_s !== void 0 && body.max_call_duration_s !== null) {
    const n = body.max_call_duration_s;
    if (!Number.isInteger(n) || n < 30 || n > 86400) return { error: "max_call_duration_s must be a whole number of seconds from 30 to 86400." };
    out.max_call_duration_s = n;
  }
  return { out };
}
function routeNumbers(method, path, body, state2, ctx) {
  state2.numbers = list8(state2.numbers);
  const all = () => [...state2.numbers.map((r) => rowOf(state2, r)), ...HAND_MADE.map(handRow)];
  if (path === "/numbers/settings" && method === "GET") return ok(numberSettings());
  if (path === "/numbers" && method === "GET") return ok(all());
  if (path === "/numbers/check" && method === "GET") return ok(checkNumber(state2, ctx.params.get("number")));
  const m = path.match(/^\/bots\/([^/]+)\/numbers(?:\/([^/]+))?$/);
  if (!m) return null;
  const botId = decodeURIComponent(m[1]);
  const target = m[2] ? decodeURIComponent(m[2]) : "";
  if (!state2.bots?.[botId]) return fail(404, "No such agent.");
  if (!target && method === "GET") return ok(state2.numbers.filter((r) => r.bot === botId).map((r) => rowOf(state2, r)));
  if (!target && method === "POST") {
    const number = clean(body.number);
    if (!ENVIRONMENTS.includes(body.environment)) return fail(422, `environment must be one of ${ENVIRONMENTS.join(", ")}.`);
    const found = checkNumber(state2, number);
    if (found.status === "invalid") return fail(422, found.reason);
    if (found.status === "taken_by_builder") {
      const same = state2.numbers.find((r) => r.number === number);
      if (same.bot === botId && same.environment === body.environment) return ok({ ...rowOf(state2, same), changed: ["already set up"] });
      return fail(409, `${number} already belongs to ${same.bot} (${same.environment}).`);
    }
    if (found.status === "taken_external") return fail(409, `${number} is used by \u201C${found.owner.trunk}\u201D, which this builder does not manage.`);
    const options = validOptions(body);
    if (options.error) return fail(422, options.error);
    const record2 = {
      number,
      bot: botId,
      environment: body.environment,
      trunk_id: ctx.id("ST"),
      rule_id: ctx.id("SDR"),
      options: { record_audio: true, krisp: false, allowed_addresses: [], max_call_duration_s: null, ...options.out },
      last_call: null
    };
    state2.numbers.push(record2);
    ctx.commit();
    return ok({ ...rowOf(state2, record2), changed: ["trunk", "dispatch rule"] }, 201);
  }
  const record = state2.numbers.find((r) => r.number === target);
  if (target && !record) {
    if (HAND_MADE.some((n) => n.number === target))
      return fail(409, `${target} was set up by hand on the phone system. This builder does not manage it, so it cannot be changed here.`);
    return fail(404, `${target} is not a number of this builder.`);
  }
  if (record.bot !== botId) return fail(409, `${target} belongs to ${record.bot}, not ${botId}.`);
  if (method === "PATCH") {
    if (body.environment !== void 0 && !ENVIRONMENTS.includes(body.environment)) return fail(422, `environment must be one of ${ENVIRONMENTS.join(", ")}.`);
    const options = validOptions(body);
    if (options.error) return fail(422, options.error);
    if (body.environment) record.environment = body.environment;
    record.options = { ...record.options, ...options.out };
    ctx.commit();
    return ok(rowOf(state2, record));
  }
  if (method === "DELETE") {
    state2.numbers = state2.numbers.filter((r) => r !== record);
    ctx.commit();
    return ok({
      removed: [
        { kind: "dispatch rule", id: record.rule_id },
        { kind: "inbound trunk", id: record.trunk_id }
      ]
    });
  }
  return null;
}

// weave-react/src/demo/demoCalls.js
var list9 = (v) => Array.isArray(v) ? v : [];
var stamp = (iso2) => iso2.replace(/[-:]/g, "").replace(/\.\d+/, "").replace(/Z?$/, "Z");
var DEMO_DIALLED = "+6531580100";
function buildEvents({
  botId,
  ref = "draft",
  version = "draft",
  room,
  channel,
  caller = null,
  messages = [],
  agent = "assistant",
  startedAt,
  state: state2 = {},
  closedBy = "participant_disconnected",
  stepSeconds = 4,
  // optional, to look like a real line: callerGap and replyGap in seconds (a number or a function of the turn),
  // and the agent's model (written on its requests and usage)
  callerGap = null,
  replyGap = null,
  model = null
}) {
  const events = [];
  let seq = 0;
  let elapsed = 0;
  const at = () => new Date(Date.parse(startedAt) + elapsed * 1e3).toISOString();
  const add = (event, fields = {}, gap2 = 0.1) => {
    seq += 1;
    elapsed += gap2;
    events.push({ t: at(), seq, elapsed_s: Math.round(elapsed * 1e3) / 1e3, event, ...fields });
  };
  add(
    "call_started",
    {
      bot: botId,
      ref,
      version,
      room,
      channel,
      caller,
      dialled: channel?.type === "sip_voice" ? DEMO_DIALLED : null,
      participant: { identity: caller || "visitor", kind: "standard" },
      attributes: {},
      not_supported_yet: []
    },
    0.05
  );
  add("agent_entered", { agent, first: true });
  let callerTurns = 0;
  let agentTurns = 0;
  let handoffs = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const gap = (value, turn, fallback) => typeof value === "function" ? value(turn) : typeof value === "number" ? value : fallback;
  const voice = channel?.type === "sip_voice" || channel?.type === "web_voice";
  const r3 = (v) => Math.round(v * 1e3) / 1e3;
  let heard = 0;
  messages.forEach((m) => {
    if (m.role === "user") {
      callerTurns += 1;
      const spoken = events.filter((e) => e.event === "user_said" || e.event === "agent_said").length + 1;
      inputTokens += model ? 900 + 45 * spoken : 120;
      add("model_request", { agent, model: model?.model || "sandbox-model", messages: spoken, tools: [] }, gap(callerGap, callerTurns, stepSeconds));
      if (voice) heard = r3(0.55 + seq * 37 % 60 / 100);
      add("user_said", { text: m.text, ...voice ? { timing: { end_of_turn_delay: heard, transcription_delay: r3(heard * 0.85) } } : {} }, 0.02);
    } else {
      let toolMs = 0;
      list9(m.tools).forEach((t) => {
        const took = typeof t.ms === "number" ? t.ms : model ? 180 + (seq * 389 + String(t.tool).length * 97) % 1300 : 12;
        toolMs += took;
        add("tool_called", { tool: t.tool, args: t.args || {}, ...t.error ? { error: t.error } : { result: t.output ?? null }, duration_ms: took }, 0.3);
        if (t.handoff) {
          handoffs += 1;
          add("agent_entered", { agent: t.handoff, first: false }, 0.05);
        }
      });
      agentTurns += 1;
      outputTokens += model ? Math.max(12, Math.round(String(m.text || "").length / 4)) : 40;
      const wait = gap(replyGap, agentTurns, stepSeconds / 2);
      add(
        "agent_said",
        {
          text: m.text,
          interrupted: false,
          ...m.simulated ? { simulated: true } : {},
          ...voice && callerTurns > 0 ? (() => {
            const ttft = r3(wait * 0.55);
            const ttfb = r3(0.18 + seq * 53 % 40 / 100);
            return { timing: { llm_node_ttft: ttft, tts_node_ttfb: ttfb, e2e_latency: r3(heard + ttft + ttfb + toolMs / 1e3 + 0.06) } };
          })() : replyGap !== null && callerTurns > 0 ? { timing: { llm_node_ttft: Math.round(wait * 0.55 * 1e3) / 1e3 } } : {}
        },
        wait
      );
    }
  });
  add("session_closed", { reason: closedBy, error: null }, 1.5);
  const usage = model ? [{ type: "llm_usage", provider: model.provider || "sandbox", model: model.model || "sandbox-model", input_tokens: inputTokens, output_tokens: outputTokens }] : [];
  add("call_ended", { duration_s: Math.round(elapsed), caller_turns: callerTurns, agent_turns: agentTurns, handoffs, usage, state: state2 }, 0.1);
  return { events, callerTurns, agentTurns, handoffs, durationS: Math.round(elapsed), usage };
}
function makeCall({
  botId,
  ref = "draft",
  version = "draft",
  channel = { id: "web-chat", type: "web_chat" },
  caller = null,
  startedAt,
  messages,
  state: state2 = {},
  agent,
  status = "ended",
  idSuffix = "",
  stepSeconds,
  callerGap,
  replyGap,
  model
}) {
  const room = `session-${botId}-${idSuffix || Math.abs(Date.parse(startedAt)).toString(16).slice(-8)}`;
  const built = buildEvents({
    botId,
    ref,
    version,
    room,
    channel,
    caller,
    messages,
    agent,
    startedAt,
    state: state2,
    ...stepSeconds ? { stepSeconds } : {},
    ...callerGap !== void 0 ? { callerGap } : {},
    ...replyGap !== void 0 ? { replyGap } : {},
    ...model ? { model } : {}
  });
  const id = `${room}_${stamp(startedAt)}`;
  const events = status === "in_progress" ? built.events.slice(0, Math.max(3, Math.floor(built.events.length / 2))) : status === "unfinished" ? built.events.slice(0, -2) : built.events;
  const last = events[events.length - 1];
  const summary = {
    id,
    room,
    bot: botId,
    ref,
    version,
    channel,
    caller,
    dialled: channel?.type === "sip_voice" ? DEMO_DIALLED : null,
    started_at: startedAt,
    status,
    last_event_at: last.t,
    size: JSON.stringify(events).length,
    duration_s: status === "ended" ? built.durationS : Math.round(last.elapsed_s),
    caller_turns: events.filter((e) => e.event === "user_said").length,
    agent_turns: events.filter((e) => e.event === "agent_said").length,
    handoffs: built.handoffs
  };
  return {
    summary,
    events,
    final_state: status === "ended" ? state2 : void 0,
    usage: status === "ended" ? built.usage.length ? built.usage : [{ type: "llm_usage", provider: "sandbox", model: "sandbox-model", input_tokens: 120 * summary.caller_turns, output_tokens: 40 * summary.agent_turns }] : void 0
  };
}
var SEED_VERSION = "0.1.1";
var llmOf = (config) => {
  const llm = config?.defaults?.models?.llm;
  return llm && typeof llm.model === "string" && llm.model ? { provider: String(llm.provider || ""), model: llm.model } : { provider: "openai", model: "gpt-4.1-mini" };
};
function seedCalls(botId, config, nowIso, { history = true } = {}) {
  const channels = list9(config?.channels);
  const web = channels.find((c) => c?.type === "web_chat") || channels[0];
  const phone = channels.find((c) => c?.type === "sip_voice" || c?.type === "web_voice");
  const greeting = typeof web?.greeting?.say === "string" ? web.greeting.say : "Hello! How can I help you today?";
  const entry = config?.agents?.entry || "assistant";
  const ago = (hours) => new Date(Date.parse(nowIso) - hours * 3600 * 1e3).toISOString();
  const chan = (c) => ({ id: c?.id || "web-chat", type: c?.type || "web_chat" });
  const talk = (...pairs) => pairs.flatMap(([user, agent, extra]) => [
    { role: "user", text: user },
    { role: "assistant", text: agent, ...extra || {} }
  ]);
  const calls = [
    makeCall({
      model: llmOf(config),
      botId,
      ref: "production",
      version: SEED_VERSION,
      channel: chan(web),
      caller: null,
      startedAt: ago(2),
      agent: entry,
      idSuffix: "a1d2",
      messages: [
        { role: "assistant", text: greeting },
        ...talk(
          ["What can you help me with?", "I can answer questions about your account and orders, and pass you to a person if you would like."],
          ["Thanks, that is all", "Goodbye, and thank you for getting in touch.", { tools: [{ tool: "end_call", args: {}, output: { ended: true } }] }]
        )
      ]
    }),
    makeCall({
      model: llmOf(config),
      botId,
      ref: "development",
      version: SEED_VERSION,
      channel: chan(web),
      caller: null,
      startedAt: ago(7),
      agent: entry,
      idSuffix: "b7e4",
      messages: [
        { role: "assistant", text: greeting },
        ...talk([
          "Where is my order?",
          "I can\u2019t reach the order system right now.",
          { tools: [{ tool: "find_order", args: { order_id: "NB-1003" }, error: "HTTP 503" }] }
        ])
      ]
    }),
    makeCall({
      model: llmOf(config),
      botId,
      ref: "draft",
      version: "draft",
      channel: chan(web),
      caller: null,
      startedAt: ago(26),
      agent: entry,
      idSuffix: "c9f1",
      messages: [{ role: "assistant", text: greeting }, ...talk(["hello", "Hi again. What do you need?"])],
      status: "ended"
    })
  ];
  if (phone)
    calls.push(
      makeCall({
        model: llmOf(config),
        botId,
        ref: "production",
        version: SEED_VERSION,
        channel: chan(phone),
        caller: "+6591234567",
        startedAt: ago(30),
        agent: entry,
        idSuffix: "d3a8",
        messages: [
          { role: "assistant", text: greeting },
          ...talk([
            "I need to speak to a person",
            "I\u2019ll put you through now.",
            { tools: [{ tool: "transfer_or_callback", args: { reason: "asked for a person" }, output: { transferred: true } }] }
          ])
        ]
      })
    );
  return [
    ...calls,
    ...history ? [...seedHistory(botId, config, nowIso), ...seedQuestions(botId, config, nowIso), ...seedIncident(botId, config, nowIso)] : []
  ].sort((x, y) => Date.parse(y.summary.started_at) - Date.parse(x.summary.started_at));
}
function seedIncident(botId, config, nowIso) {
  const channels = list9(config?.channels);
  const web = channels.find((c) => c?.type === "web_chat") || channels[0];
  const greeting = typeof web?.greeting?.say === "string" ? web.greeting.say : "Hello! How can I help you today?";
  const entry = config?.agents?.entry || "assistant";
  const tools = list9(config?.tools).filter((t) => t && t.id);
  const tool = (tools.find((t) => /escalat|transfer|human/.test(t.id)) || tools.find((t) => t.id !== "end_call"))?.id || "escalate_to_human";
  const chan = { id: web?.id || "web-chat", type: web?.type || "web_chat" };
  const ago = (minutes) => new Date(Date.parse(nowIso) - minutes * 60 * 1e3).toISOString();
  if (/support/.test(botId))
    return [4, 9, 15, 22].map(
      (minutes, i) => makeCall({
        model: llmOf(config),
        botId,
        ref: "production",
        version: SEED_VERSION,
        channel: chan,
        startedAt: ago(minutes),
        agent: entry,
        idSuffix: `inc${i}`,
        messages: [
          { role: "assistant", text: greeting },
          {
            role: "user",
            text: [
              "My parcel arrived damaged, I need to talk to someone.",
              "Can I speak to a person about a refund?",
              "I want to make a complaint.",
              "Please put me through to your team."
            ][i]
          },
          {
            role: "assistant",
            text: "I\u2019m sorry, I couldn\u2019t put you through to the team just now. Please try again in a little while.",
            tools: [{ tool, args: { reason: "caller asked for a person" }, error: "HTTP 503" }]
          }
        ]
      })
    );
  if (/front/.test(botId))
    return [12, 31, 48].map(
      (minutes, i) => makeCall({
        model: llmOf(config),
        botId,
        ref: "production",
        version: SEED_VERSION,
        channel: chan,
        startedAt: ago(minutes),
        agent: entry,
        idSuffix: `slow${i}`,
        stepSeconds: 19,
        // about ten seconds before each answer
        messages: [
          { role: "assistant", text: greeting },
          { role: "user", text: ["What are your opening hours?", "Where are you located?", "Can I book for Friday?"][i] },
          { role: "assistant", text: "One moment while I check that for you." },
          { role: "user", text: "Thanks" },
          { role: "assistant", text: "You are welcome. Goodbye!" }
        ]
      })
    );
  return [];
}
function seedQuestions(botId, config, nowIso) {
  const channels = list9(config?.channels);
  const web = channels.find((c) => c?.type === "web_chat") || channels[0];
  const greeting = typeof web?.greeting?.say === "string" ? web.greeting.say : "Hello! How can I help you today?";
  const agents = list9(config?.agents?.items).map((a) => a?.id).filter(Boolean);
  const entry = config?.agents?.entry || agents[0] || "assistant";
  const other = agents.find((id) => id !== entry) || "specialist";
  const chan = { id: web?.id || "web-chat", type: web?.type || "web_chat" };
  const ago = (hours) => new Date(Date.parse(nowIso) - hours * 3600 * 1e3).toISOString();
  const passOn = { text: "I\u2019m not sure about that. Let me pass you to someone who can help.", tools: [{ tool: "to_specialist", args: {}, handoff: other }] };
  const passOnWords = { text: "Let me pass you to a colleague who can help with that." };
  const didNotKnow = (topic) => ({ text: `I\u2019m afraid I don\u2019t have any information about ${topic}.` });
  const foundNothing = { text: "I couldn\u2019t find anything about that.", tools: [{ tool: "search_help", args: {}, output: { results: [] } }] };
  const asked = [
    [5, "Do you deliver on Sundays?", passOn],
    [29, "Can you deliver on a Sunday?", passOnWords],
    [53, "Is Sunday delivery available?", passOn],
    [98, "do you deliver sundays", passOn],
    [170, "Do you deliver on Sundays?", passOnWords],
    [16, "Can I pay with PayPal?", didNotKnow("payment methods")],
    [77, "Do you take PayPal?", didNotKnow("payment methods")],
    [140, "Can I pay using PayPal please?", didNotKnow("payment methods")],
    [40, "Is there a student discount?", didNotKnow("discounts")],
    [121, "Do you have discounts for students?", didNotKnow("discounts")],
    [66, "Do you ship to Malaysia?", foundNothing],
    [190, "Can you ship my order to Malaysia?", foundNothing]
  ];
  const calls = asked.map(
    ([hours, question, reply], i) => makeCall({
      model: llmOf(config),
      botId,
      ref: "production",
      version: SEED_VERSION,
      channel: chan,
      startedAt: ago(hours + 0.3),
      agent: entry,
      idSuffix: `q${i}`,
      messages: [
        { role: "assistant", text: greeting },
        { role: "user", text: question },
        { role: "assistant", ...reply }
      ]
    })
  );
  calls.push(
    makeCall({
      model: llmOf(config),
      botId,
      ref: "production",
      version: SEED_VERSION,
      channel: chan,
      startedAt: ago(84.4),
      agent: entry,
      idSuffix: "q_again",
      messages: [
        { role: "assistant", text: greeting },
        { role: "user", text: "Can I change the delivery address after ordering?" },
        { role: "assistant", text: "Orders usually arrive in three to five days." },
        { role: "user", text: "Can I change the delivery address after I ordered?" },
        { role: "assistant", text: "Let me pass you to a colleague who can help with that." }
      ]
    })
  );
  return calls;
}
function seedHistory(botId, config, nowIso) {
  const channels = list9(config?.channels);
  const web = channels.find((c) => c?.type === "web_chat") || channels[0];
  const greeting = typeof web?.greeting?.say === "string" ? web.greeting.say : "Hello! How can I help you today?";
  const agents = list9(config?.agents?.items).map((a) => a?.id).filter(Boolean);
  const entry = config?.agents?.entry || agents[0] || "assistant";
  const other = agents.find((id) => id !== entry) || "specialist";
  const tool = list9(config?.tools).find((t) => t && t.id && !t.builtin)?.id || "lookup_order";
  const chan = { id: web?.id || "web-chat", type: web?.type || "web_chat" };
  const spoken = channels.find((c) => c?.type === "sip_voice" || c?.type === "web_voice");
  const voiceChan = spoken ? { id: spoken.id || spoken.type, type: spoken.type } : null;
  const ago = (hours) => new Date(Date.parse(nowIso) - hours * 3600 * 1e3).toISOString();
  const asks = [
    "Where is my order?",
    "I need to change my booking",
    "What are your opening hours?",
    "Can I get a refund?",
    "How do I reset my password?",
    "Is my payment received?"
  ];
  const rough = /support/.test(botId);
  const out = [];
  const add = (n, hours, version, ref, ask, { status = "ended", fail: fail3 = false, handoff = false, repeat = false, slow = false } = {}) => {
    const agentSays = fail3 ? "I can\u2019t reach the system right now." : handoff ? "I\u2019ll pass you to a specialist." : "I can help with that. One moment.";
    const tools = fail3 ? [{ tool, args: {}, error: "HTTP 500" }] : handoff ? [{ tool: "to_specialist", args: {}, handoff: other }] : [{ tool, args: {}, output: { ok: true } }];
    const talk = [
      { role: "user", text: ask },
      { role: "assistant", text: agentSays, tools }
    ];
    if (repeat) talk.push({ role: "user", text: ask }, { role: "assistant", text: "Sorry, let me try that again." });
    out.push(
      makeCall({
        model: llmOf(config),
        botId,
        ref,
        version,
        channel: voiceChan && n % 3 === 1 ? voiceChan : chan,
        ...voiceChan && n % 3 === 1 && voiceChan.type === "sip_voice" ? { caller: `+65912${String(34500 + n * 17).slice(-5)}` } : {},
        startedAt: ago(hours),
        agent: entry,
        idSuffix: `h${n}`,
        status,
        stepSeconds: slow ? 12 : void 0,
        // answers in about one to three and a half seconds, varying from call to call (a slow one waits its 6 s)
        ...slow ? {} : { replyGap: (turn) => 0.9 + (n * 7 + turn * 3) % 26 / 10 },
        messages: [{ role: "assistant", text: greeting }, ...talk]
      })
    );
  };
  for (let i = 0; i < 8; i += 1) add(i, 24 * 8 + i * 14 + i % 3 * 3, "0.1.0", "production", asks[i % asks.length], { handoff: i === 3 });
  for (let i = 0; i < 8; i += 1) {
    const hours = 6 + i * 19 + i % 2 * 4;
    if (rough)
      add(20 + i, hours, "0.1.1", "production", asks[(i + 2) % asks.length], {
        status: i % 3 === 0 ? "unfinished" : "ended",
        fail: i % 2 === 1,
        handoff: i === 4 || i === 6
      });
    else add(20 + i, hours, "0.1.1", "production", asks[(i + 2) % asks.length], { repeat: i === 2, slow: i === 5, status: i === 7 ? "unfinished" : "ended" });
  }
  return out;
}
function callFromConversation(botId, { startedAt, channel, messages, tools = [], state: state2 = {}, version = "draft", agent }) {
  const withTools = messages.map(
    (m, i) => m.role === "assistant" && tools.length ? { ...m, tools: i === messages.findIndex((x) => x.role === "assistant" && x !== messages[0]) ? tools : void 0 } : m
  );
  return makeCall({
    botId,
    ref: "draft",
    version,
    channel: channel || { id: "web-chat", type: "web_chat" },
    startedAt,
    messages: withTools.map((m) => ({ ...m, simulated: true })),
    state: state2,
    agent
  });
}
function listCallsOf(calls, params) {
  const limit = Math.min(200, Math.max(1, Number(params.get("limit")) || 25));
  const since = params.get("since") ? Date.parse(params.get("since")) : -Infinity;
  const until = params.get("until") ? Date.parse(params.get("until")) : Infinity;
  const caller = (params.get("caller") || "").toLowerCase();
  const channel = params.get("channel");
  const status = params.get("status");
  const rows = calls.map((c) => c.summary).filter((s) => Date.parse(s.started_at) >= since && Date.parse(s.started_at) <= until).filter(
    (s) => !caller || String(s.caller || "").toLowerCase().includes(caller)
  ).filter((s) => !channel || s.channel?.id === channel || s.channel?.type === channel).filter((s) => !status || s.status === status).sort((x, y) => Date.parse(y.started_at) - Date.parse(x.started_at));
  const offset = Number(params.get("cursor")) || 0;
  const page = rows.slice(offset, offset + limit);
  return { calls: page, next: offset + limit < rows.length ? String(offset + limit) : null };
}
function getCallOf(call, params) {
  const after = Number(params.get("after")) || 0;
  const limit = Math.min(2e3, Math.max(1, Number(params.get("limit")) || 500));
  const kinds = (params.get("kinds") || "").split(",").filter(Boolean);
  const all = call.events.filter((e) => e.seq > after && (!kinds.length || kinds.includes(e.event)));
  const events = all.slice(0, limit);
  const counts = {};
  call.events.forEach((e) => {
    counts[e.event] = (counts[e.event] || 0) + 1;
  });
  const ended = call.summary.status === "ended";
  return {
    call: call.summary,
    events,
    next_after: events.length ? events[events.length - 1].seq : after,
    more: all.length > events.length,
    complete: ended,
    counts,
    ...ended ? { final_state: call.final_state || {}, usage: call.usage || [] } : {}
  };
}
var transcriptOf = (call) => ({
  call: call.summary,
  turns: call.events.filter((e) => e.event === "user_said" || e.event === "agent_said").map((e) => ({ role: e.event === "user_said" ? "caller" : "agent", text: e.text, at: e.t, elapsed_s: e.elapsed_s }))
});
function followCallOf(call, { onOpen, onRecord, onEnd }, { delayMs = 350, schedule = setTimeout, cancel = clearTimeout } = {}) {
  let stopped = false;
  let timer = null;
  let i = 0;
  if (onOpen) onOpen(call.summary);
  const step = () => {
    if (stopped) return;
    if (i < call.events.length) {
      onRecord(call.events[i]);
      i += 1;
      timer = schedule(step, delayMs);
      return;
    }
    if (call.summary.status === "ended" && onEnd) onEnd();
  };
  timer = schedule(step, 0);
  return () => {
    stopped = true;
    cancel(timer);
  };
}

// weave-react/src/demo/demoLive.js
var list10 = (v) => Array.isArray(v) ? v : [];
var SLOT_MS = 3e4;
var KEEP_MS = 20 * 60 * 1e3;
var CUT_OFF_AFTER_S = 120;
function hash(text3) {
  let h = 2166136261;
  for (let i = 0; i < text3.length; i += 1) {
    h ^= text3.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
var SCENARIOS = [
  { id: "plain", ask: "What are your opening hours?" },
  { id: "plain", ask: "How do I reset my password?" },
  { id: "handoff", ask: "I need to change my booking" },
  { id: "toolfail", ask: "Where is my order?" },
  { id: "slow", ask: "Is my payment received?" },
  { id: "repeat", ask: "Can I get a refund?" },
  { id: "plain", ask: "Where is my order?" },
  { id: "cutoff", ask: "I need to speak to someone" },
  { id: "plain", ask: "Can I change my delivery address?" },
  { id: "person", ask: "My parcel arrived damaged" }
];
function conversation(scenario, { greeting, tool, other }) {
  const hello2 = { role: "assistant", text: greeting };
  const ask = { role: "user", text: scenario.ask };
  const said = (role, text3, extra) => ({ role, text: text3, ...extra || {} });
  switch (scenario.id) {
    case "handoff":
      return [
        hello2,
        ask,
        said("assistant", "I can help with that. Which booking is it about?"),
        said("user", "The one for next Tuesday, reference BK-2231."),
        said("assistant", "Changing the date needs our bookings team. I\u2019ll pass you to a specialist now.", {
          tools: [{ tool: "to_specialist", args: {}, handoff: other }]
        }),
        said("user", "Thank you"),
        said("assistant", "Hello, this is the specialist. I can see booking BK-2231. What date would suit you?"),
        said("user", "Thursday the same week, if possible."),
        said("assistant", "Thursday is free at the same time. Shall I move it?"),
        said("user", "Yes please."),
        said("assistant", "Done. You\u2019ll get a confirmation by email. Anything else?"),
        said("user", "No, that\u2019s all, thanks."),
        said("assistant", "Goodbye, and thank you for calling.", { tools: [{ tool: "end_call", args: {}, output: { ended: true } }] })
      ];
    case "toolfail":
      return [
        hello2,
        ask,
        said("assistant", "Let me look that up. What is your order number?"),
        said("user", "It\u2019s NB-1003."),
        said("assistant", "I can\u2019t reach the order system right now. Let me try again.", {
          tools: [{ tool, args: { order_id: "NB-1003" }, error: "HTTP 503" }]
        }),
        said("user", "Please try again"),
        said("assistant", "Sorry, it is still not answering.", { tools: [{ tool, args: { order_id: "NB-1003" }, error: "HTTP 503" }] }),
        said("user", "That\u2019s annoying. Can someone call me back?"),
        said("assistant", "Of course. I\u2019ve noted that you\u2019d like a call back today about order NB-1003."),
        said("user", "Okay, thanks."),
        said("assistant", "Thank you for your patience. Goodbye.", { tools: [{ tool: "end_call", args: {}, output: { ended: true } }] })
      ];
    case "repeat":
      return [
        hello2,
        ask,
        said("assistant", "One moment, I am looking into that."),
        said("user", "Can I get a refund?"),
        said("assistant", "Sorry, let me try that again. Which order is it for?"),
        said("user", "The blue jacket I bought last week."),
        said("assistant", "Thanks. Refunds go back to the card you paid with within five working days. Shall I start one?"),
        said("user", "Yes, please."),
        said("assistant", "Done. You\u2019ll get an email confirming it. Anything else?"),
        said("user", "No, thank you."),
        said("assistant", "Goodbye!", { tools: [{ tool: "end_call", args: {}, output: { ended: true } }] })
      ];
    case "person":
      return [
        hello2,
        ask,
        said("assistant", "I\u2019m sorry to hear that. Could you tell me what was damaged?"),
        said("user", "The box was crushed and the lamp inside is broken."),
        said("assistant", "Thank you. I can send a replacement, or a refund. Which would you prefer?"),
        said("user", "I want to speak to a person about this."),
        said("assistant", "Of course. I\u2019m passing you to a colleague now.", {
          tools: [{ tool: "escalate_to_human", args: { reason: "damaged item" }, output: { transferred: true } }]
        })
      ];
    case "cutoff":
      return [
        hello2,
        ask,
        said("assistant", "Of course. Can I ask what it is about, so I find the right person?"),
        said("user", "It\u2019s about my last bill."),
        said("assistant", "Let me find someone for you."),
        said("user", "Hello? Are you there?")
      ];
    default:
      return [
        hello2,
        ask,
        said("assistant", "I can help with that. One moment.", { tools: [{ tool, args: {}, output: { ok: true } }] }),
        said("user", "Great."),
        said("assistant", "Here is what I found. Is there anything else I can check?"),
        said("user", "Can you also check my last payment?"),
        said("assistant", "Yes, your last payment arrived on Monday."),
        said("user", "And when is the next one due?"),
        said("assistant", "The next one is due on the 1st of next month."),
        said("user", "Thanks, that is all."),
        said("assistant", "Goodbye, and thank you for getting in touch.", { tools: [{ tool: "end_call", args: {}, output: { ended: true } }] })
      ];
  }
}
var iso = (ms) => new Date(ms).toISOString();
function summaryOf(full, events, status, elapsedS) {
  const last = events[events.length - 1];
  return {
    ...full.summary,
    status,
    last_event_at: last.t,
    size: JSON.stringify(events).length,
    duration_s: status === "ended" ? full.summary.duration_s : Math.round(elapsedS),
    caller_turns: events.filter((e) => e.event === "user_said").length,
    agent_turns: events.filter((e) => e.event === "agent_said").length,
    handoffs: events.filter((e) => e.event === "agent_entered" && e.first === false).length
  };
}
function liveCallsFor(bot, nowMs, { keepMs = KEEP_MS } = {}) {
  const config = bot?.config || {};
  const channels = list10(config.channels).filter((c) => c && c.enabled !== false && c.id);
  if (!channels.length) return [];
  const greetOf = (c) => typeof c?.greeting?.say === "string" ? c.greeting.say : "Hello! How can I help you today?";
  const agents = list10(config.agents?.items).map((a) => a?.id).filter(Boolean);
  const entry = config.agents?.entry || agents[0] || "assistant";
  const other = agents.find((id) => id !== entry) || "specialist";
  const tool = list10(config.tools).find((t) => t && t.id && !t.builtin)?.id || "lookup_order";
  const out = [];
  const first = Math.floor((nowMs - keepMs - 5 * 60 * 1e3) / SLOT_MS);
  const last = Math.floor(nowMs / SLOT_MS);
  for (let n = first; n <= last; n += 1) {
    const h = hash(`${bot.id}:${n}`);
    if (h % 100 >= 55) continue;
    const startMs = n * SLOT_MS + h % 2e4;
    if (startMs > nowMs) continue;
    const scenario = SCENARIOS[(h >>> 8) % SCENARIOS.length];
    const channel = channels[(h >>> 4) % channels.length];
    const caller = channel.type === "sip_voice" ? `+65${String(81e6 + h % 9e6).padStart(8, "0")}` : null;
    const full = makeCall({
      botId: bot.id,
      ref: "production",
      version: "0.1.1",
      channel: { id: channel.id, type: channel.type },
      caller,
      startedAt: iso(startMs),
      agent: entry,
      idSuffix: `live${n}`,
      callerGap: (turn) => 14 + (h >>> turn % 16) % 15,
      replyGap: (turn) => scenario.id === "slow" ? 9 + (h >>> turn) % 5 : 1.1 + (h >>> turn + 3) % 17 / 10,
      model: llmOf(config),
      status: "ended",
      messages: conversation(scenario, { greeting: greetOf(channel), tool, other })
    });
    const elapsedS = (nowMs - startMs) / 1e3;
    const total = full.summary.duration_s;
    if (scenario.id === "cutoff") {
      const written = full.events.filter((e) => e.event !== "session_closed" && e.event !== "call_ended");
      const stops = written[written.length - 1].elapsed_s;
      const events = written.filter((e) => e.elapsed_s <= elapsedS);
      if (!events.length) continue;
      const status = elapsedS - stops > CUT_OFF_AFTER_S ? "unfinished" : "in_progress";
      if (status === "unfinished" && nowMs - (startMs + stops * 1e3) > keepMs) continue;
      out.push({ summary: summaryOf(full, events, status, Math.min(elapsedS, stops)), events });
      continue;
    }
    if (elapsedS < total) {
      const events = full.events.filter((e) => e.elapsed_s <= elapsedS);
      if (!events.length) continue;
      out.push({ summary: summaryOf(full, events, "in_progress", elapsedS), events });
    } else if (nowMs - (startMs + total * 1e3) <= keepMs) {
      out.push(full);
    }
  }
  return out.sort((a, b) => Date.parse(b.summary.started_at) - Date.parse(a.summary.started_at));
}
var liveCallOf = (bot, key, nowMs) => liveCallsFor(bot, nowMs).find((c) => c.summary.id === key || c.summary.room === key) || null;
function followLive(bot, key, { onOpen, onRecord, onEnd }, { after = 0, read = () => Date.now(), every = 1e3, schedule = setTimeout, cancel = clearTimeout } = {}) {
  let stopped = false;
  let timer = null;
  let seq = after;
  let opened = false;
  const look = () => {
    if (stopped) return;
    const call = liveCallOf(bot, key, read());
    if (!call) return;
    if (!opened) {
      opened = true;
      if (onOpen) onOpen(call.summary);
    }
    call.events.filter((e) => e.seq > seq).forEach((e) => {
      seq = e.seq;
      onRecord(e);
    });
    if (call.summary.status === "ended") {
      if (onEnd) onEnd();
      return;
    }
    timer = schedule(look, every);
  };
  timer = schedule(look, 0);
  return () => {
    stopped = true;
    cancel(timer);
  };
}

// weave-react/src/studio/form/channelTypes.js
var list11 = (v) => Array.isArray(v) ? v : [];
var isObj4 = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var text2 = (v) => typeof v === "string" ? v : v === void 0 || v === null ? "" : String(v);
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
  const rows = list11(isObj4(raw) ? raw.types : raw);
  return rows.filter((r) => isObj4(r) && text2(r.type)).map((r) => ({
    type: text2(r.type),
    label: text2(r.label) || text2(r.type),
    runsToday: r.runs_today !== false,
    // a list the server left out means "not restricted" (null), never "nothing allowed"
    input: Array.isArray(r.input) ? r.input.map(text2) : null,
    output: Array.isArray(r.output) ? r.output.map(text2) : null,
    voice: r.voice === true,
    canKeypad: r.can_have_keypad === true,
    canForms: r.can_show_forms === true,
    entryFields: r.entry_fields === null ? null : list11(r.entry_fields).map(text2),
    // null = any (a custom channel)
    defaultModalities: {
      input: list11(r.default_modalities?.input).map(text2),
      output: list11(r.default_modalities?.output).map(text2)
    },
    note: text2(r.note)
  }));
}
var FALLBACK = normalizeChannelTypes(FALLBACK_TYPES);

// weave-react/src/demo/minimalConfig.js
var minimalConfig = (id, name) => ({
  schema_version: "1.2",
  meta: { id, name, version: "0.1.0", status: "draft" },
  runtime: { engine: "livekit-agents", provider_mode: "plugins" },
  defaults: { models: { llm: { provider: "openai", model: "gpt-4.1-mini", api_key: { secret: "OPENAI_API_KEY" } } }, conversation: {} },
  persona: { name },
  channels: [
    {
      id: "web-chat",
      type: "web_chat",
      enabled: true,
      entry: { widget_id: `${id}-widget` },
      modalities: { input: ["text"], output: ["text"] },
      greeting: { say: "Hello! How can I help you today?" }
    }
  ],
  agents: {
    entry: "assistant",
    items: [{ id: "assistant", name, kind: "standalone", instructions: { role: "You are a helpful assistant. Answer briefly and politely." }, tools: [] }]
  }
});

// weave-react/src/demo/demoApi.js
var ENVIRONMENTS2 = ["development", "staging", "production"];
var RESERVED_IDS = ["transcripts", "metrics", "logs", "sessions", "tmp"];
var ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
var DEMO_USER = "Sandbox";
var clone3 = (value) => JSON.parse(JSON.stringify(value));
var ok2 = (body, status = 200) => ({ status, body });
var fail2 = (status, detail, extra = {}) => ({ status, body: { detail, ...extra } });
var bumpVersion = (version, kind = "patch") => {
  const [major, minor, patch] = String(version).split(".").map(Number);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
};
var memoryStorage = (initial = null) => {
  let state2 = initial;
  return {
    load: () => state2,
    save: (next) => {
      state2 = clone3(next);
    }
  };
};
var ENVIRONMENTS_RUN = ["production", "staging", "development"];
function placeCall(call, deployed = {}, published = null) {
  const s = call?.summary;
  if (!s || !ENVIRONMENTS_RUN.includes(s.ref)) return call;
  const live = ENVIRONMENTS_RUN.filter((env) => deployed?.[env]);
  if (!live.length) return { ...call, summary: { ...s, ref: "draft", version: "draft" } };
  const runs = [s.ref, ...live].find((env) => deployed?.[env] && deployed[env] === s.version);
  const ref = runs || (deployed?.[s.ref] ? s.ref : live[0]);
  const version = runs || !published || published.includes(s.version) ? s.version : deployed[ref];
  return ref === s.ref && version === s.version ? call : { ...call, summary: { ...s, ref, version } };
}
function createDemoApi({
  storage = memoryStorage(),
  loadSchema = async () => ({}),
  now = () => (/* @__PURE__ */ new Date()).toISOString(),
  seed = true,
  stepMs = STEP_MS,
  history = true,
  // On: a new agent has no calls, as on a real server, until it is put live.
  // Off: it gets sample calls at once (what the screen tests build on).
  quietNewAgents = false
} = {}) {
  let counter = 0;
  const uid = (prefix) => {
    counter += 1;
    return `${prefix}${Date.now().toString(36)}${counter}`;
  };
  const newBot = (id, name, config) => ({
    id,
    name,
    revision: 1,
    savedAt: now(),
    savedBy: DEMO_USER,
    config: config || minimalConfig(id, name),
    versions: [],
    deployments: [],
    deployed: {}
  });
  function seedState() {
    const state2 = { v: 1, bots: {} };
    const make = (id, name, starter) => {
      state2.bots[id] = newBot(id, name);
      state2.bots[id].config = applyStarter(state2.bots[id].config, starter);
      return state2.bots[id];
    };
    const support = make("acme-support", "Acme Support", "support");
    const front = make("front-desk", "Front Desk", "receptionist");
    make("bookings", "Bookings", "appointment");
    front.config.channels = [
      ...front.config.channels,
      {
        id: "phone",
        type: "sip_voice",
        enabled: true,
        // callers ring a number the platform sets up (Releases › Deploy), never one typed into the channel
        entry: {},
        modalities: { input: ["audio"], output: ["audio"] },
        greeting: { say: "Welcome to the front desk. How can I help you?" }
      }
    ];
    front.config.defaults = {
      ...front.config.defaults,
      models: {
        ...front.config.defaults.models,
        stt: { provider: "deepgram", model: "nova-3", language: "en", api_key: { secret: "DEEPGRAM_API_KEY" } },
        tts: { provider: "elevenlabs", model: "eleven_flash_v2_5", voice_id: "EXAVITQu4vr4xnSDxMaL", api_key: { secret: "ELEVEN_API_KEY" } }
      }
    };
    const publish = (bot, version) => {
      const config = { ...clone3(bot.config), meta: { ...bot.config.meta, version } };
      bot.versions.unshift({ version, published_at: now(), published_by: DEMO_USER, checksum: checksumOf(config), config });
      bot.config.meta.version = bumpVersion(version);
      bot.revision += 1;
    };
    const deploy = (bot, environment, version) => {
      const previous = bot.deployed[environment] || null;
      bot.deployments.push({
        id: uid("d"),
        status: "active",
        environment,
        version,
        previous_version: previous,
        deployed_at: now(),
        deployed_by: DEMO_USER,
        note: ""
      });
      bot.deployed[environment] = version;
    };
    publish(support, "0.1.0");
    deploy(support, "development", "0.1.0");
    deploy(support, "staging", "0.1.0");
    support.config.persona = { ...support.config.persona, tone: "warm, patient, plain language, and a little more concise" };
    publish(support, "0.1.1");
    deploy(support, "development", "0.1.1");
    publish(front, "0.1.0");
    deploy(front, "development", "0.1.0");
    return state2;
  }
  const read = () => {
    let state2 = storage.load();
    if (!state2 && seed) {
      state2 = seedState();
      storage.save(state2);
    }
    return state2 || { v: 1, bots: {} };
  };
  const summary = (bot) => ({
    id: bot.id,
    name: bot.name,
    draft_revision: bot.revision,
    draft_saved_at: bot.savedAt,
    latest_version: bot.versions[0]?.version || null,
    deployed: bot.deployed
  });
  const draftOf = (bot) => ({ bot_id: bot.id, revision: bot.revision, saved_at: bot.savedAt, saved_by: bot.savedBy, config: bot.config });
  async function handle(method, rawPath, body = {}) {
    if (body && typeof body === "object" && body.__file && typeof body.__file === "object" && typeof body.__file.text === "function") {
      const file = body.__file;
      body = { ...body, __file: await file.text(), __size: file.size };
    }
    const answer = await route(method, rawPath, body);
    return { status: answer.status, body: answer.body === void 0 ? void 0 : clone3(answer.body) };
  }
  async function route(method, rawPath, body = {}) {
    const [path, query = ""] = String(rawPath).split("?");
    const params = new URLSearchParams(query);
    const state2 = read();
    const commit = () => storage.save(state2);
    let m;
    if (path === "/health" && method === "GET") return ok2({ ok: true, demo: true });
    if (path === "/schema" && method === "GET") return ok2(await loadSchema());
    if (path === "/environments" && method === "GET") return ok2(ENVIRONMENTS2);
    if (path === "/providers" && method === "GET") {
      return ok2({
        providers: [
          { name: "anthropic", stages: ["llm"], installed: true, realtime_runnable: false, default_secret: "ANTHROPIC_API_KEY", key_available: false },
          { name: "assemblyai", stages: ["stt"], installed: false, realtime_runnable: false, default_secret: "ASSEMBLYAI_API_KEY", key_available: false },
          { name: "cartesia", stages: ["stt", "tts"], installed: true, realtime_runnable: false, default_secret: "CARTESIA_API_KEY", key_available: true },
          { name: "deepgram", stages: ["stt", "tts"], installed: true, realtime_runnable: false, default_secret: "DEEPGRAM_API_KEY", key_available: true },
          { name: "elevenlabs", stages: ["stt", "tts"], installed: true, realtime_runnable: false, default_secret: "ELEVEN_API_KEY", key_available: true },
          {
            name: "google",
            stages: ["stt", "llm", "tts", "realtime"],
            installed: false,
            realtime_runnable: false,
            default_secret: "GOOGLE_API_KEY",
            key_available: false
          },
          { name: "groq", stages: ["stt", "llm", "tts"], installed: false, realtime_runnable: false, default_secret: "GROQ_API_KEY", key_available: false },
          {
            name: "openai",
            stages: ["stt", "llm", "tts", "realtime"],
            installed: true,
            realtime_runnable: true,
            default_secret: "OPENAI_API_KEY",
            key_available: true
          },
          { name: "openai_compatible", stages: ["stt", "llm", "tts"], installed: true, realtime_runnable: false, default_secret: null, key_available: false },
          { name: "silero", stages: ["vad"], installed: true, realtime_runnable: false, default_secret: null, key_available: false }
        ],
        stages: { stt: "Speech-to-text", llm: "Language model", tts: "Text-to-speech", realtime: "Realtime", vad: "Voice activity" },
        turn_detectors: ["livekit-multilingual", "livekit-english"],
        note: "Sandbox: this is a made-up list of what a server could offer, not a real server."
      });
    }
    if (path === "/validate" && method === "POST") return ok2(validateDemo(body));
    if (path === "/channel-types" && method === "GET") return ok2({ types: FALLBACK_TYPES, note: "Sandbox: a copy of what a server answers." });
    if (path === "/redaction/entities" && method === "GET") return ok2({ entities: demoEntities() });
    if (["/preview/prompt", "/preview/result", "/preview/speech", "/preview/guardrails", "/preview/redaction", "/preview/task"].includes(path) && method === "POST") {
      const named = body.bot ? state2.bots[body.bot] : null;
      if (body.bot && !named) return fail2(404, "No such agent.");
      const ref = body.ref || "draft";
      const config = body.config || (named ? ref === "draft" ? named.config : (named.versions.find((v) => v.version === ref || v.version === named.deployed[ref]) || named.versions[0])?.config : null);
      if (!config) return fail2(422, "Send a config, or name a bot.", { errors: [] });
      const answer = path === "/preview/prompt" ? previewPromptDemo(config, body) : path === "/preview/result" ? previewResultDemo(config, body) : tryPreviewDemo(path, config, body);
      return answer.status === 200 ? ok2(answer.body) : fail2(answer.status, answer.body.detail);
    }
    if (/^\/numbers(\/|$)/.test(path) || /^\/bots\/[^/]+\/numbers(\/|$)/.test(path)) {
      const answer = routeNumbers(method, path, body || {}, state2, { params, commit, id: uid });
      if (answer) return answer;
    }
    if (path === "/bots" && method === "GET") return ok2(Object.values(state2.bots).map(summary));
    if (path === "/bots" && method === "POST") {
      const { id, name } = body || {};
      if (!ID_PATTERN.test(String(id || "")))
        return fail2(400, "An agent id starts with a lowercase letter and then has lowercase letters, digits, - or _ (up to 64 characters).");
      if (RESERVED_IDS.includes(id)) return fail2(400, `'${id}' is reserved and cannot be used as an agent id.`);
      if (state2.bots[id]) return fail2(409, `An agent with the id '${id}' already exists.`);
      state2.bots[id] = newBot(id, String(name || id));
      if (quietNewAgents) {
        state2.bots[id].calls = [];
        state2.bots[id].quiet = true;
      }
      commit();
      return ok2(draftOf(state2.bots[id]), 201);
    }
    if (m = path.match(/^\/bots\/([^/]+)(\/.*)?$/)) {
      const bot = state2.bots[decodeURIComponent(m[1])];
      const rest = m[2] || "";
      if (!bot) return fail2(404, "No such agent.");
      if (rest === "" && method === "GET") return ok2(summary(bot));
      if (rest === "/draft" && method === "GET") return ok2(draftOf(bot));
      if (rest === "/draft" && method === "PUT") {
        if (body.base_revision !== void 0 && body.base_revision !== null && body.base_revision !== bot.revision)
          return fail2(409, "The draft was saved by someone else after you opened it.");
        if (!body.config || typeof body.config !== "object" || Array.isArray(body.config))
          return fail2(422, "The configuration must be a JSON object.", { errors: [{ path: null, message: "The configuration must be a JSON object." }] });
        bot.config = clone3(body.config);
        bot.revision += 1;
        bot.savedAt = now();
        bot.savedBy = DEMO_USER;
        if (typeof bot.config.meta?.name === "string" && bot.config.meta.name) bot.name = bot.config.meta.name;
        commit();
        return ok2({ draft: draftOf(bot), validation: validateDemo(bot.config, bot.id) });
      }
      if (rest === "/publish" && method === "POST") {
        const report = validateDemo(bot.config, bot.id);
        if (!report.valid) return fail2(422, "This draft has errors, so it cannot be published.", { errors: report.errors });
        const latest = bot.versions[0]?.version;
        let version;
        if (body.bump) {
          if (!latest) return fail2(400, "Nothing is published yet, so there is no version to count from. Publish the draft\u2019s own version first.");
          if (!["major", "minor", "patch"].includes(body.bump)) return fail2(400, "bump must be major, minor or patch.");
          version = bumpVersion(latest, body.bump);
        } else version = bot.config.meta.version;
        if (bot.versions.some((v) => v.version === version)) return fail2(409, `Version ${version} is already published.`);
        const published = { ...clone3(bot.config), meta: { ...bot.config.meta, version } };
        const record = { version, published_at: now(), published_by: DEMO_USER, checksum: checksumOf(published), config: published };
        bot.versions.unshift(record);
        bot.config = { ...bot.config, meta: { ...bot.config.meta, version: bumpVersion(version) } };
        bot.revision += 1;
        bot.savedAt = now();
        commit();
        return ok2(
          {
            bot_id: bot.id,
            version,
            published_at: record.published_at,
            published_by: DEMO_USER,
            checksum: record.checksum,
            warnings: report.warnings,
            secrets_required: report.secrets_required
          },
          201
        );
      }
      if (rest === "/versions" && method === "GET") return ok2(bot.versions.map(({ config, ...v }) => v));
      if ((m = rest.match(/^\/versions\/([^/]+)$/)) && method === "GET") {
        const found = bot.versions.find((v) => v.version === decodeURIComponent(m[1]));
        return found ? ok2({ bot_id: bot.id, ...found }) : fail2(404, `Version ${m[1]} is not published.`);
      }
      if (rest === "/diff" && method === "GET") {
        const pick = (ref) => ref === "draft" ? bot.config : bot.versions.find((v) => v.version === ref)?.config;
        const a = params.get("a");
        const b = params.get("b");
        const left = pick(a);
        const right = pick(b);
        if (!left || !right) return fail2(404, "One of those versions is not published.");
        return ok2({ from: a, to: b, changes: diffConfigs(left, right) });
      }
      if (rest === "/deploy" && method === "POST") {
        const { version, environment, note } = body || {};
        if (!ENVIRONMENTS2.includes(environment)) return fail2(400, `environment must be one of ${ENVIRONMENTS2.join(", ")}.`);
        const target = bot.versions.find((v) => v.version === version);
        if (!target) return fail2(404, `Version ${version} is not published.`);
        const previous = bot.deployed[environment] || null;
        const deployment = {
          id: uid("d"),
          status: "active",
          environment,
          version,
          previous_version: previous,
          deployed_at: now(),
          deployed_by: DEMO_USER,
          note: note || ""
        };
        bot.deployments.push(deployment);
        bot.deployed[environment] = version;
        delete bot.quiet;
        settle(bot, Date.parse(now()));
        commit();
        const report = validateDemo(target.config, bot.id);
        return ok2({
          deployment,
          preflight: {
            secrets_required: [...secretsIn(target.config)].sort(),
            secrets_missing: [],
            unsupported: report.unsupported,
            knowledge: preflightKnowledge(bot, target.config)
          }
        });
      }
      if (rest === "/deployments" && method === "GET") {
        const current = Object.fromEntries(
          Object.entries(bot.deployed).map(([env, version]) => {
            const d = [...bot.deployments].reverse().find((x) => x.environment === env && x.version === version);
            return [env, { id: d.id, version, deployed_at: d.deployed_at, deployed_by: d.deployed_by }];
          })
        );
        return ok2({ current, history: bot.deployments });
      }
      if ((m = rest.match(/^\/deployments\/([^/]+)$/)) && method === "GET") {
        const found = bot.deployments.find((d) => d.id === m[1]);
        return found ? ok2(found) : fail2(404, "No such deployment.");
      }
      if (/^\/knowledge(\/|$)/.test(rest)) {
        const nowMs = Date.parse(now());
        if (settle(bot, nowMs)) commit();
        const ref = params.get("ref") || body?.ref || "draft";
        const knowledgeConfig = ref === "draft" ? bot.config : bot.versions.find((v) => v.version === ref || v.version === bot.deployed[ref])?.config || (ref === "latest" ? bot.versions[0]?.config : null);
        if (!knowledgeConfig) return fail2(404, `There is no '${ref}' to read the knowledge from.`);
        if (rest === "/knowledge" && method === "GET") return ok2(overview(bot, knowledgeConfig, ref, nowMs));
        if (rest === "/knowledge/files" && method === "GET") return ok2(overview(bot, knowledgeConfig, ref, nowMs).files);
        const fileMatch = rest.match(/^\/knowledge\/files\/(.+)$/);
        if (fileMatch && method === "PUT") {
          const name = decodeURIComponent(fileMatch[1]);
          if (!/\.(txt|md|markdown|html?|pdf|csv|json)$/i.test(name))
            return fail2(400, `'${name}' is not a kind of file knowledge can read: use text, markdown, HTML, PDF, CSV or JSON.`);
          const file = body && body.__file;
          const content = typeof file === "string" ? file : file && typeof file.text === "function" ? await file.text() : "";
          const size = typeof body?.__size === "number" ? body.__size : typeof file === "string" ? file.length : file?.size ?? content.length;
          if (size > 20 * 1024 * 1024) return fail2(413, "That file is larger than this server accepts (20 MB).");
          const row = upload(bot, name, content, size, now());
          commit();
          return ok2(row, 201);
        }
        if (fileMatch && method === "DELETE") {
          const deployedConfigs = Object.values(bot.deployed || {}).map((v) => bot.versions.find((x) => x.version === v)?.config);
          const answer = removeFile(bot, [bot.config, ...deployedConfigs], decodeURIComponent(fileMatch[1]), params.get("force") === "true");
          if (answer.status === 204) {
            commit();
            return { status: 204, body: void 0 };
          }
          return fail2(answer.status, answer.detail);
        }
        const baseMatch = rest.match(/^\/knowledge\/([^/]+)\/(build|status|search)$/);
        if (baseMatch) {
          const baseId = decodeURIComponent(baseMatch[1]);
          if (baseMatch[2] === "status" && method === "GET") {
            const answer = baseStatus(bot, knowledgeConfig, baseId, nowMs);
            return answer ? ok2(answer) : fail2(404, `There is no knowledge base '${baseId}'.`);
          }
          if (baseMatch[2] === "build" && method === "POST") {
            const answer = startBuild(bot, knowledgeConfig, baseId, nowMs, stepMs === 0 ? 0 : void 0);
            if (answer.status !== 202) return fail2(answer.status, answer.detail);
            commit();
            return ok2(answer.job, 202);
          }
          if (baseMatch[2] === "search" && method === "POST") {
            const answer = searchBase(bot, knowledgeConfig, baseId, body || {});
            return answer.status === 200 ? ok2(answer.body) : fail2(answer.status, answer.detail);
          }
        }
      }
      if (/^\/calls(\/|$)/.test(rest)) {
        if (!bot.calls) {
          bot.calls = seedCalls(bot.id, bot.config, now(), { history });
          commit();
        }
        if (rest === "/calls" && method === "GET") {
          const nowMs = Date.parse(now());
          const since = params.get("since") ? Date.parse(params.get("since")) : -Infinity;
          const wantsLive = params.get("status") === "in_progress" || nowMs - since <= 30 * 60 * 1e3;
          const calls = wantsLive && !bot.quiet ? [...liveCallsFor(bot, nowMs), ...bot.calls] : bot.calls;
          return ok2(
            listCallsOf(
              calls.map(
                (c) => placeCall(
                  c,
                  bot.deployed,
                  bot.versions.map((v) => v.version)
                )
              ),
              params
            )
          );
        }
        const callMatch = rest.match(/^\/calls\/([^/]+)(\/transcript)?$/);
        if (callMatch && method === "GET") {
          const key = decodeURIComponent(callMatch[1]);
          const found = !bot.quiet && liveCallOf(bot, key, Date.parse(now())) || bot.calls.find((c) => c.summary.id === key) || bot.calls.filter((c) => c.summary.room === key).sort((x, y) => Date.parse(y.summary.started_at) - Date.parse(x.summary.started_at))[0];
          if (!found) return fail2(404, "No such call.");
          const placed = placeCall(
            found,
            bot.deployed,
            bot.versions.map((v) => v.version)
          );
          return ok2(callMatch[2] ? transcriptOf(placed) : getCallOf(placed, params));
        }
      }
      const configAt = (ref) => ref === "draft" ? bot.config : ref === "latest" ? bot.versions[0]?.config : bot.versions.find((v) => v.version === ref)?.config || bot.versions.find((v) => v.version === bot.deployed[ref])?.config;
      if (rest === "/tests" && method === "GET") {
        const ref = params.get("ref") || "draft";
        const config = configAt(ref);
        if (!config) return fail2(404, `There is no '${ref}' to read the scenarios from.`);
        return ok2({ bot: bot.id, ref, scenarios: scenarioListOf(config, bot.testRuns || [], Date.parse(now())), network_allowed: false });
      }
      if (rest === "/tests/run" && method === "POST") {
        const nowMs = Date.parse(now());
        bot.testRuns ||= [];
        if (bot.testRuns.some((r) => viewRun(r, nowMs).status === "running")) return fail2(409, "A test run is already in progress for this agent.");
        const ref = body.config ? "unsaved" : body.ref || "draft";
        const config = body.config || configAt(ref);
        if (!config) return fail2(404, `There is no '${ref}' to test.`);
        if (!Array.isArray(config.tests) || !config.tests.length) return fail2(400, "This configuration has no test scenarios to run.");
        const unknown = (body.scenarios || []).filter((id) => !config.tests.some((s) => s?.id === id));
        if (unknown.length) return fail2(400, `There is no scenario ${unknown.map((id) => `'${id}'`).join(", ")}.`);
        const run = createRun({ id: uid("run_"), config: clone3(config), ref, body, startedAt: now(), stepMs });
        bot.testRuns.unshift(run);
        bot.testRuns = bot.testRuns.slice(0, 20);
        commit();
        return ok2(viewRun(run, nowMs), 202);
      }
      if (rest === "/tests/runs" && method === "GET") {
        const limit = Number(params.get("limit")) || 20;
        return ok2((bot.testRuns || []).slice(0, limit).map((r) => headlineOf(r, Date.parse(now()))));
      }
      if ((m = rest.match(/^\/tests\/runs\/([^/]+)$/)) && method === "GET") {
        const found = (bot.testRuns || []).find((r) => r.id === decodeURIComponent(m[1]));
        return found ? ok2(viewRun(found, Date.parse(now()))) : fail2(404, "No such test run.");
      }
      if (rest === "/sessions" && method === "POST")
        return fail2(503, "Sandbox has no LiveKit server, so there is no real conversation to join. Use the simulated preview.");
    }
    return fail2(404, `Sandbox has no ${method} ${path}.`);
  }
  function follow(botId, callId, handlers) {
    const bot = read().bots[botId];
    const call = bot?.calls?.find((c) => c.summary.id === callId || c.summary.room === callId);
    if (!call) {
      if (bot && !bot.quiet && liveCallOf(bot, callId, Date.parse(now())))
        return followLive(bot, callId, handlers, { read: () => Date.parse(now()), after: Number(handlers.after) || 0 });
      return () => {
      };
    }
    return followCallOf(call, handlers);
  }
  function recordConversation(botId, conversation2) {
    const state2 = read();
    const bot = state2.bots[botId];
    if (!bot) return null;
    if (!bot.calls) bot.calls = seedCalls(bot.id, bot.config, now(), { history });
    const call = callFromConversation(botId, { ...conversation2, startedAt: conversation2.startedAt || now(), version: conversation2.version || "draft" });
    bot.calls.unshift(call);
    bot.calls = bot.calls.slice(0, 60);
    storage.save(state2);
    return call.summary.id;
  }
  return { handle, follow, recordConversation, reset: () => storage.save(seed ? seedState() : { v: 1, bots: {} }) };
}
export {
  createDemoApi,
  memoryStorage
};
