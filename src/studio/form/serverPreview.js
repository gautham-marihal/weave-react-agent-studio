// Reads the API's two preview answers (`POST /preview/prompt`, `POST /preview/result`) into what the screens show, and works out the advice
// that goes with them. The server runs the real runtime's own code to build them, so they are EXACT; the studio no longer keeps its own copy
// of the prompt's wording or of the path grammar (the old copies are only a fallback when the server can't be asked, and say "approximate").
// Reading is tolerant: a field that is missing or new is left out, never an error. Pure: no network, no DOM.

import { isObj } from './engine.js';

const list = (v) => (Array.isArray(v) ? v : []);
const text = (v) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v));
const words = (s) =>
  (
    String(s ?? '')
      .trim()
      .match(/\S+/g) || []
  ).length;

// ---- the prompt ----------------------------------------------------------------------------------------------------------------------
export function normalizePrompt(raw) {
  const r = isObj(raw) ? raw : {};
  const instructions = text(r.instructions);
  const sections = list(r.sections).map((s, i) => ({
    id: `${text(s?.kind) || 'section'}-${i}`,
    kind: text(s?.kind),
    label: text(s?.label) || text(s?.kind) || `Part ${i + 1}`,
    text: text(s?.text),
    active: s?.active !== false,
    when: text(s?.when),
  }));
  const tools = list(r.tools).map((t) => ({
    name: text(t?.name),
    description: text(t?.description),
    parameters: t?.parameters,
    offered: t?.offered !== false,
    reason: text(t?.reason),
  }));
  const stats = isObj(r.stats) ? r.stats : {};
  return {
    instructions,
    sections,
    opening: text(r.opening),
    greeting: text(r.greeting),
    onEnter: Array.isArray(r.on_enter) ? r.on_enter : r.on_enter ? [r.on_enter] : [],
    tools,
    knowledge: r.knowledge ?? null,
    models: r.models ?? null,
    state: isObj(r.state) ? r.state : {},
    stats: {
      words: typeof stats.words === 'number' ? stats.words : words(instructions),
      tokens:
        typeof stats.approx_tokens === 'number'
          ? stats.approx_tokens
          : typeof stats.tokens === 'number'
            ? stats.tokens
            : Math.round(words(instructions) * 1.33),
      toolsOffered: typeof stats.tools_offered === 'number' ? stats.tools_offered : tools.filter((t) => t.offered).length,
    },
  };
}

// How big is too big. The runtime sends the whole instructions with every model call, so a long prompt costs time and money on every turn,
// and a model given many tools picks the wrong one more often. These are advice, never errors.
export const LIMITS = { words: 1500, tools: 15 };

export function promptAdvice(prompt) {
  const advice = [];
  if (!prompt) return advice;
  if (prompt.stats.words > LIMITS.words)
    advice.push({
      id: 'long',
      text: `The instructions are ${prompt.stats.words.toLocaleString()} words (about ${prompt.stats.tokens.toLocaleString()} tokens), and they are sent with every reply. Over ${LIMITS.words.toLocaleString()} words, a model follows them less closely and each turn costs more: move rarely needed detail into a knowledge base or a condition.`,
    });
  if (prompt.stats.toolsOffered > LIMITS.tools)
    advice.push({
      id: 'tools',
      text: `This agent is offered ${prompt.stats.toolsOffered} tools. Past about ${LIMITS.tools}, a model picks the wrong one more often: give each agent only the tools it needs, and split the rest across agents.`,
    });
  const dropped = prompt.tools.filter((t) => !t.offered);
  if (dropped.length)
    advice.push({
      id: 'dropped',
      text: `${dropped.length} tool${dropped.length === 1 ? '' : 's'} will not be offered to the model: ${dropped.map((t) => `${t.name}${t.reason ? ` (${t.reason})` : ''}`).join('; ')}.`,
    });
  return advice;
}

// The "Preview as…" choices as the body of the request: only what was changed from the defaults is sent.
export function promptRequest({ config, agent, channel, state, now, callerPhone }) {
  const body = { config, agent };
  if (channel) body.channel = channel;
  const what = isObj(state) ? Object.fromEntries(Object.entries(state).filter(([, v]) => v !== undefined && v !== '')) : {};
  if (Object.keys(what).length) body.state = what;
  if (now) body.now = now;
  if (callerPhone) body.caller_phone = callerPhone;
  return body;
}

// A `datetime-local` value ("2026-10-14T03:00") with the browser's own offset, as the API wants a time zone: "2026-10-14T03:00:00+08:00".
export function withLocalOffset(local, offsetMinutes = -new Date().getTimezoneOffset()) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(String(local || ''))) return '';
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const stamp = local.length === 16 ? `${local}:00` : local;
  return `${stamp}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

// The state variables worth offering as "what if…": a handful of simple ones (true/false, text, numbers), never the sensitive ones.
export function whatIfVariables(config, max = 6) {
  const vars = isObj(config?.state?.variables) ? config.state.variables : {};
  return Object.entries(vars)
    .filter(([, v]) => isObj(v) && v.sensitive !== true)
    .slice(0, max)
    .map(([name, v]) => ({
      name,
      type: v.type || (typeof v.default === 'boolean' ? 'boolean' : typeof v.default === 'number' ? 'number' : 'string'),
      default: v.default,
    }));
}

// What a person typed for a what-if value, as the value it means.
export function whatIfValue(type, typed) {
  if (typed === '' || typed === undefined) return undefined;
  if (type === 'boolean') return typed === 'true' ? true : typed === 'false' ? false : undefined;
  if (type === 'number' || type === 'integer') {
    const n = Number(typed);
    return Number.isNaN(n) ? undefined : n;
  }
  return typed;
}

// ---- a tool's request and what the model sees of its answer ---------------------------------------------------------------------------
export function normalizeResultPreview(raw) {
  const r = isObj(raw) ? raw : {};
  const request = isObj(r.request) ? r.request : null;
  const result = isObj(r.result) ? r.result : null;
  // the answer parts may sit under `result` (as the guide shows) or at the top level
  const pick = (key) => (result && key in result ? result[key] : r[key]);
  const hasAnswer = result !== null || 'model_sees' in r || 'model_sees_text' in r;
  return {
    request: request && {
      method: text(request.method),
      url: text(request.url || request.path),
      query: isObj(request.query) ? request.query : {},
      headers: isObj(request.headers) ? request.headers : {},
      body: request.body ?? null,
      auth: isObj(request.auth) ? { type: text(request.auth.type), secrets: list(request.auth.secrets).map(text) } : null,
    },
    preconditions: isObj(r.preconditions) ? { holds: r.preconditions.holds !== false, message: text(r.preconditions.message) } : null,
    argsProblems: list(r.args_problems).map((p) => (typeof p === 'string' ? p : text(p?.message || p))),
    hasAnswer,
    modelSees: hasAnswer ? pick('model_sees') : undefined,
    modelSeesText: hasAnswer ? text(pick('model_sees_text')) : '',
    storedInState: isObj(pick('stored_in_state')) ? pick('stored_in_state') : {},
    keptFromModel: list(pick('kept_from_the_model')).map(text),
    effects: list(pick('effects')).map((e) => (typeof e === 'string' ? e : text(e?.text || e?.description || e))),
  };
}

// Starting arguments for the "Try it" panel: a value for each parameter the tool takes, from its schema's example, default or type.
export function sampleArgs(parameters) {
  const props = isObj(parameters?.properties) ? parameters.properties : {};
  return Object.fromEntries(
    Object.entries(props).map(([name, p]) => {
      const spec = isObj(p) ? p : {};
      const example = list(spec.examples)[0] ?? spec.example ?? spec.default;
      if (example !== undefined) return [name, example];
      if (list(spec.enum).length) return [name, spec.enum[0]];
      return [
        name,
        spec.type === 'integer' || spec.type === 'number'
          ? 1
          : spec.type === 'boolean'
            ? true
            : spec.type === 'array'
              ? []
              : spec.type === 'object'
                ? {}
                : `a ${name.replace(/_/g, ' ')}`,
      ];
    }),
  );
}

// The studio's own approximate prompt (promptPreview.js) in the same shape as the server's answer, for when the server can't be asked.
export function fromApproximate(built, config) {
  const sections = built.sections
    .filter((s) => s.id !== 'tools')
    .map((s, i) => ({ id: `${s.id}-${i}`, kind: s.id, label: s.title, text: s.text, active: !s.conditional, when: s.conditional ? s.note : '' }));
  const instructions = sections
    .filter((s) => s.active)
    .map((s) => s.text)
    .join('\n\n');
  const toolsById = Object.fromEntries(list(config?.tools).map((t) => [t?.id, t]));
  const tools = [
    ...list(built.agent?.tools).map((id) => ({
      name: id,
      description: toolsById[id]?.description || '',
      parameters: toolsById[id]?.parameters,
      offered: !!toolsById[id],
      reason: toolsById[id] ? '' : 'not defined',
    })),
    ...list(built.agent?.handoffs)
      .filter(isObj)
      .map((h) => ({ name: h.tool, description: h.description || '', parameters: undefined, offered: true, reason: '' })),
  ];
  const w = words(instructions);
  return {
    instructions,
    sections,
    opening: text(built.agent?.instructions?.opening),
    greeting: '',
    onEnter: [],
    tools,
    knowledge: null,
    models: null,
    state: {},
    stats: { words: w, tokens: Math.round(w * 1.33), toolsOffered: tools.filter((t) => t.offered).length },
  };
}
