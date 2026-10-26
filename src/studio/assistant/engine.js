// Asking the AI to build or change a draft, and checking what comes back: the request goes out with the schema and the
// current draft, the answer is run through the same validator as a hand-made draft, and whatever it finds is handed
// back to the model to fix (a couple of times at most). Pure apart from the two functions it is given (`post`, to reach
// the model, and `validate`), so it is tested with stand-ins for both.

import { isObj } from '../form/engine.js';
import { TOOL, readAnswer, repairMessage, requestMessage, systemPrompt } from './prompt.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

// The model may drop what it was told to keep; the studio's own notes (where blocks are drawn) are never the AI's to
// lose. And a place saved for a block that no longer exists (an agent the AI removed or renamed, a tool it took away)
// is dropped, so the Workflow is drawn from what the agent is now.
export function keepStudioNotes(before, after) {
  const notes = isObj(after?.builder) ? after : isObj(before?.builder) ? { ...after, builder: clone(before.builder) } : after;
  return pruneStalePlaces(notes);
}

const toolIds = (c) => new Set((Array.isArray(c?.tools) ? c.tools : []).map((t) => t?.id));
export function pruneStalePlaces(config) {
  const places = config?.builder?.ui?.graph_positions;
  if (!isObj(places) || !Object.keys(places).length) return config;
  const agents = new Map((Array.isArray(config?.agents?.items) ? config.agents.items : []).filter(isObj).map((a) => [a.id, a]));
  const tools = toolIds(config);
  const keep = (id) => {
    // the Start block (workflowModel's START_ID; "start" before it, when no agent had that id)
    if (id === '::start' || (id === 'start' && !agents.has('start'))) return true;
    const [agent, kind, rest] = String(id).split('::');
    const a = agents.get(agent);
    if (!a) return false;
    if (kind === undefined) return true;
    if (kind === 'enter') return Number(rest) < (Array.isArray(a.on_enter) ? a.on_enter.length : 0);
    if (kind === 'tool') return (Array.isArray(a.tools) ? a.tools : []).includes(rest) && tools.has(rest);
    return false;
  };
  const kept = Object.fromEntries(Object.entries(places).filter(([id]) => keep(id)));
  if (Object.keys(kept).length === Object.keys(places).length) return config;
  const next = clone(config);
  if (Object.keys(kept).length) next.builder.ui.graph_positions = kept;
  else {
    delete next.builder.ui.graph_positions;
    if (!Object.keys(next.builder.ui).length) delete next.builder.ui;
    if (!Object.keys(next.builder).length) delete next.builder;
  }
  return next;
}

export async function askAssistant({ request, config, schema, model, post, validate, signal, onStep, earlier = [], maxRepairs = 2 }) {
  if (!String(request || '').trim()) throw new Error('Say what you need first.');
  const system = [{ type: 'text', text: systemPrompt(schema), cache_control: { type: 'ephemeral' } }];
  const messages = [{ role: 'user', content: requestMessage({ request, config, earlier }) }];
  const usage = { input: 0, output: 0, cached: 0 };
  let answer = null;
  let report = { errors: [], warnings: [] };
  let repairs = 0;
  for (let round = 0; round <= maxRepairs; round += 1) {
    onStep?.(round === 0 ? 'thinking' : 'fixing');
    const reply = await post(
      { model, max_tokens: 24000, system, messages, tools: [TOOL], tool_choice: { type: 'tool', name: TOOL.name }, temperature: 0.2 },
      signal,
    );
    answer = readAnswer(reply);
    usage.input += reply.usage?.input_tokens || 0;
    usage.output += reply.usage?.output_tokens || 0;
    usage.cached += reply.usage?.cache_read_input_tokens || 0;
    answer.config = keepStudioNotes(config, answer.config);
    onStep?.('checking');
    const checked = await validate(answer.config, signal);
    report = { errors: checked?.errors || [], warnings: checked?.warnings || [] };
    if (!report.errors.length || round === maxRepairs) break;
    repairs += 1;
    messages.push(
      { role: 'assistant', content: reply.content },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: answer.toolUseId, is_error: true, content: repairMessage(report.errors) }] },
    );
  }
  return { ...answer, issues: report, repairs, usage };
}

// Why a call to the model failed, in a sentence for a person.
export function explainFailure(status, body) {
  const said = typeof body?.error === 'string' ? body.error : body?.error?.message || '';
  if (status === 503) return 'No AI model is set up on this server. Add ANTHROPIC_API_KEY to .env.local and restart it.';
  if (status === 401 || status === 403) return 'The AI service did not accept the key set on this server. Check ANTHROPIC_API_KEY.';
  if (status === 429) return 'The AI service is busy or the limit was reached. Wait a moment and try again.';
  if (status === 413) return 'The agent is too large to send. Try asking for part of it at a time.';
  if (status === 529 || status >= 500) return `The AI service is having trouble${said ? ` (${said})` : ''}. Try again in a moment.`;
  return said || `The AI service refused the request (${status}).`;
}

// The call to the model through the server's /llm route (the key is added there, never here).
export async function postToModel(body, signal, fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl('/llm/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new Error('The studio could not reach the AI service. Is the server running?', { cause: error });
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  if (!res.ok) throw new Error(explainFailure(res.status, json));
  if (!json) throw new Error('The AI service answered with something that is not JSON.');
  return json;
}

export async function loadStatus(fetchImpl = fetch) {
  try {
    const res = await fetchImpl('/llm/status', { headers: { accept: 'application/json' } });
    if (!res.ok) return { configured: false };
    const json = await res.json();
    return json && typeof json === 'object' && 'configured' in json ? json : { configured: false };
  } catch {
    return { configured: false };
  }
}
