// The two preview endpoints, IMITATED for demo mode. The real API builds the prompt and a tool's request with the runtime's own code, so
// its answers are exact. Here there is no runtime: this builds the same shapes from the studio's own approximate copies (the prompt
// assembly in studio/form/promptPreview.js, the path grammar in studio/form/jsonPaths.js) and says so in `note`. Pure.

import { assemblePrompt } from '../studio/form/promptPreview.js';
import { isObj } from '../studio/form/engine.js';
import { evalPath } from '../studio/form/jsonPaths.js';
import { notAvailable } from '../studio/form/toolInfo.js';
import { fillArgs } from './demoTests.js';

const list = (v) => (Array.isArray(v) ? v : []);
export const DEMO_PREVIEW_NOTE = 'Demo mode: this preview was built by a simple imitation in your browser, not by the runtime, so wording and ordering can differ from what the model really receives.';

// What Python would print for a value: the model is shown a dict's repr, not JSON.
export function pyRepr(value) {
  if (value === null || value === undefined) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.includes("'") && !value.includes('"') ? `"${value}"` : `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(', ')}]`;
  if (isObj(value)) return `{${Object.entries(value).map(([k, v]) => `${pyRepr(k)}: ${pyRepr(v)}`).join(', ')}}`;
  return String(value);
}

export function previewPromptDemo(config, body = {}) {
  const agents = list(config?.agents?.items);
  const agentId = body.agent || config?.agents?.entry || agents[0]?.id;
  const built = assemblePrompt(config, agentId, { channelId: body.channel });
  if (!built) return { status: 404, body: { detail: `There is no agent '${agentId}' in this configuration.` } };
  const channel = list(config?.channels).find((c) => c?.id === (body.channel || list(config?.channels).find((x) => x?.enabled !== false)?.id));
  const toolsById = Object.fromEntries(list(config?.tools).map((t) => [t?.id, t]));
  const tools = [
    ...list(built.agent.tools).map((id) => {
      const t = toolsById[id];
      const why = t ? notAvailable(t) : null;
      return { name: id, description: t?.description || '', parameters: t?.parameters || { type: 'object', properties: {} }, offered: !!t && !why, reason: !t ? 'not defined' : why ? `${why} can’t run yet` : '' };
    }),
    ...list(built.agent.handoffs).filter(isObj).map((h) => ({ name: h.tool, description: h.description || `Hand the caller to ${h.to}`, parameters: { type: 'object', properties: {} }, offered: true, reason: '' })),
  ];
  const sections = built.sections.filter((s) => s.id !== 'tools').map((s) => ({ kind: s.id, label: s.title, text: s.text, active: !s.conditional, ...(s.conditional ? { when: s.note } : {}) }));
  const instructions = sections.filter((s) => s.active).map((s) => s.text).join('\n\n');
  const state = Object.fromEntries(Object.entries(config?.state?.variables || {}).map(([k, v]) => [k, v?.sensitive ? '•••' : v?.default ?? null]));
  Object.assign(state, isObj(body.state) ? body.state : {});
  const words = (instructions.trim().match(/\S+/g) || []).length;
  return {
    status: 200,
    body: {
      agent: agentId, channel: channel?.id || null, instructions, sections, opening: built.agent.instructions?.opening || '', greeting: typeof channel?.greeting?.say === 'string' ? channel.greeting.say : '',
      on_enter: list(built.agent.on_enter), tools, knowledge: knowledgeUse(config, built.agent, toolsById), models: config?.defaults?.models || {}, state,
      stats: { words, approx_tokens: Math.round(words * 1.33), tools_offered: tools.filter((t) => t.offered).length }, demo: true, note: DEMO_PREVIEW_NOTE,
    },
  };
}

const collectSecrets = (value, out = new Set()) => {
  if (isObj(value)) { if (typeof value.secret === 'string') out.add(value.secret); Object.values(value).forEach((v) => collectSecrets(v, out)); } else if (Array.isArray(value)) value.forEach((v) => collectSecrets(v, out));
  return out;
};

const effectWords = (rule) => list(rule?.do).map((a) => {
  if (a?.type === 'say') return 'says a line';
  if (a?.type === 'set_state') return `sets ${Object.keys(a.values || {}).join(', ') || 'state'}`;
  if (a?.type === 'handoff') return `hands over to ${a.to}`;
  if (a?.type === 'end_call') return 'ends the call';
  return a?.type ? String(a.type).replace(/_/g, ' ') : 'does something';
});

export function previewResultDemo(config, body = {}) {
  const tool = list(config?.tools).find((t) => t?.id === body.tool);
  if (!tool) return { status: 404, body: { detail: `There is no tool '${body.tool}' in this configuration.` } };
  const args = isObj(body.args) ? body.args : {};
  const out = { demo: true, note: DEMO_PREVIEW_NOTE };
  if (tool.type === 'http' && isObj(tool.request)) {
    const connection = (config?.connections || {})[tool.connection] || {};
    const base = String(connection.base_url || '').replace(/\/$/, '');
    out.request = { method: tool.request.method || 'GET', url: `${base}${fillArgs(tool.request.path || '/', args)}`, query: fillArgs(tool.request.query || {}, args), headers: {}, body: tool.request.body === undefined ? null : fillArgs(tool.request.body, args), auth: { type: connection.auth?.type || 'none', secrets: [...collectSecrets(connection.auth)] } };
  }
  out.preconditions = { holds: true, message: '' };
  const props = isObj(tool.parameters?.properties) ? tool.parameters.properties : {};
  out.args_problems = [
    ...list(tool.parameters?.required).filter((name) => args[name] === undefined || args[name] === '').map((name) => `the argument “${name}” is required`),
    ...Object.keys(args).filter((name) => !(name in props)).map((name) => `“${name}” isn’t a parameter of this tool`),
  ];
  if ('response' in body) {
    const response = body.response;
    const toLlm = list(tool.result?.to_llm);
    const seen = toLlm.length
      ? Object.fromEntries(toLlm.map((path) => { const found = evalPath(response, path); return found.length ? [String(path).replace(/^\$\./, ''), found.length === 1 ? found[0] : found] : null; }).filter(Boolean))
      : response;
    const stored = Object.fromEntries(Object.entries(isObj(tool.result?.to_state) ? tool.result.to_state : {}).map(([variable, path]) => { const found = evalPath(response, path); return found.length ? [variable, found[0]] : null; }).filter(Boolean));
    out.result = {
      model_sees: seen, model_sees_text: pyRepr(seen), stored_in_state: stored,
      kept_from_the_model: list(tool.result?.out_of_band?.fields).map((f) => (typeof f === 'string' ? f : f?.name || JSON.stringify(f))),
      effects: list(tool.effects).map((rule) => `${effectWords(rule).join(', then ') || 'does something'}${rule?.when ? ' (only when its condition holds)' : ''}`),
    };
  }
  return { status: 200, body: out };
}

// What the agent searches: the bases it reads before every reply, and the knowledge tools it can call (the server's own answer has the same two parts).
function knowledgeUse(config, agent, toolsById) {
  const bases = Object.fromEntries(list(config?.knowledge).map((b) => [b?.id, b]));
  const before = list(agent?.knowledge).filter((id) => bases[id]).map((id) => ({ base: id, top_k: bases[id].top_k, min_score: bases[id].retrieval?.min_score }));
  const byTools = list(agent?.tools).map((id) => toolsById[id]).filter((t) => t?.type === 'knowledge').map((t) => ({ tool: t.id, base: t.source }));
  return before.length || byTools.length ? { before_each_reply: before, tools: byTools } : null;
}
