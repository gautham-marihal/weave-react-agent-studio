// Build › Steps: an agent's call, step by step, read from what the agent already has and written back to the same
// places (design: canvas "Build steps section", board 7). Nothing new is added to the configuration, so Workflow,
// Subagents and JSON always show the same call. Pure: no React, no DOM.
//
// Each subagent is a lane, the one that answers first at the top, then the ones it passes callers to. A lane's steps,
// in the order a call meets them:
//   greet   the channel's greeting (entry lane only; changed on Agent)                     every time
//   enter   what it does as it takes over: its `on_enter` actions, in order                  every time
//             a "show a form" step carries the form's own steps (`forms[i].on_submit`) as its `children`
//   rule    what it is told to do, in order: its instructions' rules written "Step N: …"    guided
//   decide  where it passes callers: its hand-overs, a way back, a person                    guided
//   end     how it ends the call: the end-the-call tool and its goodbye                      guided
// Rules not written "Step N: …" are not steps: they stay on Subagents.

import { getAtPath } from '../../schemaPath.js';
import { setPath } from '../schemaFacts.js';
import { readSimple } from '../../../simple/simpleModel.js';
import { agentLabel } from '../../rowNames.js';
import { channelPictures } from '../../../pictures/mediaModel.js';
import { addAgentTransfer, addBackToStart, addEnd, addSubagent, isBuiltin, removeHandoff } from '../../../workflow/workflowOps.js';

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

// a guided step is a rule written "Step 3: Offer up to three slots."
const STEP_RULE = /^\s*Step(?:\s+\d+)?\s*[:.]\s*/i;
export const isStepRule = (rule) => typeof rule === 'string' && STEP_RULE.test(rule);
export const ruleText = (rule) => String(rule).replace(STEP_RULE, '');

// steps that only keep a value or write the log: counted, not listed
const BOOKKEEPING = new Set(['set_state', 'log', 'discard_image']);

// the kind of each action, for its icon and words
export function kindOfAction(action) {
  switch (action?.type) {
    case 'say':
    case 'generate':
      return 'say';
    case 'send_form':
      return 'form';
    case 'request_image':
      return 'photo';
    case 'analyze_image':
    case 'compare_values':
      return 'check';
    case 'http':
      return 'lookup';
    case 'notify':
      return 'message';
    case 'transfer':
      return 'person';
    case 'handoff':
    case 'return_to_entry':
      return 'pass';
    case 'end_call':
      return 'end';
    default:
      return 'other';
  }
}

// a speech value (a string, a message by id, or one per language) as words
export function speechText(value) {
  if (typeof value === 'string') return value;
  if (isObj(value) && typeof value.message === 'string') return '';
  if (isObj(value)) return String(Object.values(value).find((v) => typeof v === 'string') || '');
  return '';
}

const agentsOf = (config) => list(config?.agents?.items).filter(isObj);
const entryOf = (config) => {
  const agents = agentsOf(config);
  return agents.find((a) => a.id === config?.agents?.entry) || agents[0] || null;
};
const toolOf = (config, id) => list(config?.tools).find((t) => isObj(t) && t.id === id) || null;

// the lanes in the order a call meets them: the first agent, then the ones it passes to (breadth first), then the rest
function laneOrder(config) {
  const agents = agentsOf(config);
  const first = entryOf(config);
  if (!first) return [];
  const seen = new Set([first.id]);
  const order = [first];
  for (let i = 0; i < order.length; i++) {
    for (const h of list(order[i].handoffs)) {
      const next = agents.find((a) => a.id === h?.to);
      if (next && !seen.has(next.id)) {
        seen.add(next.id);
        order.push(next);
      }
    }
  }
  return [...order, ...agents.filter((a) => !seen.has(a.id))];
}

// the steps of one action list (on_enter, a form's on_submit), each with its path; a form step carries its form's steps
function actionSteps(config, actions, basePath, lane, seenForms) {
  const forms = list(config?.forms);
  let hidden = 0;
  let ended = false;
  const steps = [];
  actions.forEach((action, i) => {
    if (isObj(action) && BOOKKEEPING.has(action.type)) {
      hidden += 1;
      return;
    }
    const path = [...basePath, i];
    const step = {
      key: path.join('.'),
      lane,
      kind: kindOfAction(action),
      every: true,
      section: basePath.at(-1) === 'on_submit' ? 'form' : 'enter',
      index: i,
      path,
      action,
      afterEnd: ended,
    };
    if (action?.type === 'send_form') {
      const at = action.form ? forms.findIndex((f) => isObj(f) && f.id === action.form) : -1;
      step.formIndex = at;
      step.form = at >= 0 ? forms[at] : null;
      // a form shown in two places lists its steps once, under the first
      if (at >= 0 && !seenForms.has(action.form)) {
        seenForms.add(action.form);
        const inner = actionSteps(config, list(forms[at].on_submit), ['forms', at, 'on_submit'], lane, seenForms);
        step.children = inner.steps;
        step.hiddenChildren = inner.hidden;
      } else step.children = [];
    }
    if (action?.type === 'end_call' && !action.when) ended = true;
    steps.push(step);
  });
  return { steps, hidden };
}

// Every lane of the agent, with its steps. -> [{ key, name, first, from: [names], steps, hidden }]
export function lanesOf(config) {
  const agents = agentsOf(config);
  const order = laneOrder(config);
  const seenForms = new Set();
  const greeting = readSimple(config).greeting || '';
  return order.map((agent, n) => {
    const index = agents.indexOf(agent);
    const base = ['agents', 'items', index];
    const steps = [];
    if (n === 0 && greeting) steps.push({ key: `${agent.id}.greet`, lane: agent.id, kind: 'greet', every: true, section: 'greet', text: greeting });
    const entered = actionSteps(config, list(agent.on_enter), [...base, 'on_enter'], agent.id, seenForms);
    steps.push(...entered.steps);
    const rules = list(agent.instructions?.rules);
    rules.forEach((rule, i) => {
      if (isStepRule(rule))
        steps.push({
          key: `${agent.id}.rule.${i}`,
          lane: agent.id,
          kind: 'guided',
          every: false,
          section: 'rule',
          index: i,
          path: [...base, 'instructions', 'rules', i],
          text: ruleText(rule),
        });
    });
    const branches = branchesOf(config, agent);
    if (branches.length) steps.push({ key: `${agent.id}.decide`, lane: agent.id, kind: 'decide', every: false, section: 'decide', path: base, branches });
    const ender = list(agent.tools)
      .map((id) => toolOf(config, id))
      .find((t) => isBuiltin(t, 'end_call'));
    if (ender)
      steps.push({ key: `${agent.id}.end`, lane: agent.id, kind: 'end', every: false, section: 'end', toolId: ender.id, text: speechText(ender.params?.say) });
    const from = agents.filter((a) => list(a.handoffs).some((h) => h?.to === agent.id)).map((a) => agentLabel(config, a.id));
    return { key: agent.id, name: agentLabel(config, agent.id), first: n === 0, from, steps, hidden: entered.hidden, index };
  });
}

// where a lane passes callers: each hand-over (to a subagent, with when), a way back to the first agent, a person
function branchesOf(config, agent) {
  const out = list(agent.handoffs)
    .map((h, i) =>
      isObj(h)
        ? {
            kind: 'pass',
            to: h.to,
            toName: agentLabel(config, h.to),
            when: h.description || '',
            handoff: i,
            missing: !agentsOf(config).some((a) => a.id === h.to),
          }
        : null,
    )
    .filter(Boolean);
  for (const id of list(agent.tools)) {
    const tool = toolOf(config, id);
    // a way back: when the caller's request is done or they need something else (its description is the tool's, for
    // the model: not a condition to show)
    if (isBuiltin(tool, 'return_to_entry')) out.push({ kind: 'back', toName: agentLabel(config, entryOf(config)?.id), when: '', toolId: id });
    if (isBuiltin(tool, 'transfer_or_callback')) out.push({ kind: 'person', toName: tool.name || 'a person', when: tool.description || '', toolId: id });
  }
  return out;
}

// every step in reading order, a form's steps right after it, with its number on the page
export function numbered(lanes) {
  const out = [];
  let n = 0;
  const walk = (steps, depth) =>
    steps.forEach((step) => {
      n += 1;
      out.push({ step, number: n, depth });
      if (step.children) walk(step.children, depth + 1);
    });
  lanes.forEach((lane) => walk(lane.steps, 0));
  return out;
}

export const countSteps = (lanes) => numbered(lanes).length;

// ---- problems: what can't run as written, and what runs with a limit (the strip under a step)
// the words a new step starts with, so a person sees what to write; left as they are, they would be said or followed
export const SAY_START = 'Write the line here.';
export const GUIDED_START = {
  ask: 'Ask for what you need from them, in one short question.',
  guided: 'Describe what the agent should do.',
  yes: 'Read back exactly what will happen and wait for a clear yes, then do it.',
};
export const isStarterText = (text) => String(text || '').trim() === SAY_START || String(text || '').trim() === GUIDED_START.guided;

export function problemsOf(config, step) {
  const out = [];
  const a = step.action;
  if (step.afterEnd) out.push({ level: 'danger', text: 'It comes after a step that ends the call, so it never runs.', fix: 'up' });
  if (step.kind === 'say' && a?.type === 'say' && String(speechText(a.text)).trim() === SAY_START)
    out.push({ level: 'danger', text: `It still says “${SAY_START}”: callers would hear that. Write the line, or remove the step.`, fix: 'edit' });
  if (step.kind === 'say' && a?.type === 'say' && typeof a.text === 'string' && !a.text.trim())
    out.push({ level: 'danger', text: 'The line is empty: write what it should say, or remove the step.', fix: 'edit' });
  if (step.kind === 'guided' && (!String(step.text || '').trim() || step.text.trim() === GUIDED_START.guided))
    out.push({ level: 'danger', text: 'It doesn’t say what to do yet: write it in a sentence, or remove the step.', fix: 'edit' });
  if (step.kind === 'lookup' && (!a?.path || a.path === '/'))
    out.push({ level: 'warn', text: 'It doesn’t say what to look up yet: give its path.', fix: 'edit' });
  if (step.kind === 'form' && !step.form)
    out.push({ level: 'danger', text: a?.form ? `There is no form “${a.form}” any more, so this step is skipped.` : 'No form is chosen yet.', fix: 'edit' });
  if (step.kind === 'lookup' && a?.connection && !isObj(config?.connections?.[a.connection]))
    out.push({ level: 'danger', text: `Its connection “${a.connection}” isn’t there any more.`, fix: 'edit' });
  if (step.kind === 'message' && !list(config?.notifications).some((x) => isObj(x) && x.id === a?.notification))
    out.push({ level: 'danger', text: a?.notification ? `There is no message “${a.notification}” any more.` : 'No message is chosen yet.', fix: 'edit' });
  if (step.kind === 'person' && a?.transfer && !list(config?.telephony?.transfers).some((t) => isObj(t) && t.id === a.transfer))
    out.push({ level: 'danger', text: `The transfer “${a.transfer}” isn’t there any more.`, fix: 'edit' });
  if (step.kind === 'photo') {
    const ways = channelPictures(config).filter((c) => c.on);
    const camera = a?.kind === 'camera';
    const takes = ways.filter((c) => (camera ? c.camera : c.photo));
    if (!takes.length)
      out.push({
        level: 'warn',
        text: camera ? 'No way in has the camera on, so this step is skipped.' : 'No way in takes photos, so this step is skipped.',
        fix: 'media',
      });
    else if (takes.length < ways.length)
      out.push({
        level: 'warn',
        text: `Only ${takes.length === 1 ? 'one way in takes' : 'some ways in take'} ${camera ? 'the camera' : 'photos'}; on the others this step is skipped.`,
        fix: 'media',
      });
  }
  if (step.kind === 'decide')
    step.branches.forEach((b) => {
      if (b.kind === 'pass' && b.missing) out.push({ level: 'danger', text: `It passes callers to “${b.to}”, which isn’t a subagent any more.` });
      // the format needs a description on every hand-over: without one the agent can't be saved
      else if (b.kind === 'pass' && !String(b.when).trim())
        out.push({ level: 'danger', text: `Say when to pass callers to ${b.toName}: it can’t be saved without it.`, fix: 'edit' });
    });
  return out;
}

// a subagent the first agent passes callers to, with no way to pass them back (a caller who then asks for something
// else stays there)
export function strandedLanes(config) {
  const first = entryOf(config);
  return agentsOf(config).filter((a) => {
    if (!first || a.id === first.id) return false;
    const reached = agentsOf(config).some((x) => list(x.handoffs).some((h) => h?.to === a.id));
    const back = list(a.tools).some((id) => isBuiltin(toolOf(config, id), 'return_to_entry')) || list(a.handoffs).some((h) => h?.to === first.id);
    return reached && !back;
  });
}

// ---- changes (each returns the new configuration)
const agentIndex = (config, laneKey) => list(config?.agents?.items).findIndex((a) => isObj(a) && a.id === laneKey);

// put an action into an action list (a lane's on_enter, a form's steps) at a place
export function insertAction(config, listPath, at, action) {
  const now = list(getAtPath(config, listPath));
  const place = Math.max(0, Math.min(at ?? now.length, now.length));
  return setPath(config, listPath, [...now.slice(0, place), action, ...now.slice(place)]);
}
export const enterPath = (config, laneKey) => ['agents', 'items', agentIndex(config, laneKey), 'on_enter'];

// a photo asked for in a form's steps: the picture's id goes into a state variable of its own, declared with it (the
// server checks that `into` names one)
export function insertPhoto(config, listPath, at) {
  const vars = config?.state?.variables && typeof config.state.variables === 'object' ? config.state.variables : {};
  let name = 'photo';
  let n = 1;
  while (name in vars) {
    n += 1;
    name = `photo_${n}`;
  }
  const next = setPath(config, ['state', 'variables', name], {
    type: 'string',
    nullable: true,
    default: null,
    description: 'The picture the caller sent (its id).',
  });
  return insertAction(next, listPath, at, { type: 'request_image', kind: 'upload', into: name, prompt: 'A clear photo of the front of the card.' });
}

// take a step out (an action, or a guided step's rule); an emptied on_enter is taken out (the schema wants one or more)
export function removeStep(config, step) {
  if (step.section === 'decide' || step.section === 'greet') return config;
  if (step.section === 'end') return removeHandoff(config, step.lane, { tool: step.toolId });
  const holderPath = step.path.slice(0, -1);
  const holder = list(getAtPath(config, holderPath));
  const rest = holder.filter((_, i) => i !== step.path.at(-1));
  if (step.section === 'rule') return renumber(setPath(config, holderPath, rest));
  if (!rest.length && holderPath.at(-1) === 'on_enter') {
    const next = clone(config);
    delete getAtPath(next, holderPath.slice(0, -1)).on_enter;
    return next;
  }
  return setPath(config, holderPath, rest);
}

// move a step up or down among the steps of its own list (by one place, or to a place)
export function moveStep(config, step, to) {
  if (!['enter', 'form', 'rule'].includes(step.section)) return config;
  const holderPath = step.path.slice(0, -1);
  const holder = [...list(getAtPath(config, holderPath))];
  const from = step.path.at(-1);
  if (step.section === 'rule') {
    // among the guided steps only: the other rules stay where they are
    const at = holder.map((r, i) => (isStepRule(r) ? i : -1)).filter((i) => i >= 0);
    const pos = at.indexOf(from);
    const target = at[Math.max(0, Math.min(to, at.length - 1))];
    if (pos < 0 || target === undefined || target === from) return config;
    const [moved] = holder.splice(from, 1);
    holder.splice(target, 0, moved);
    return renumber(setPath(config, holderPath, holder));
  }
  const place = Math.max(0, Math.min(to, holder.length - 1));
  if (place === from) return config;
  const [moved] = holder.splice(from, 1);
  holder.splice(place, 0, moved);
  return setPath(config, holderPath, holder);
}

// a guided step, added among a lane's guided steps (at: its place among them; past the end = last)
export function addGuided(config, laneKey, text, at = Infinity) {
  const i = agentIndex(config, laneKey);
  if (i < 0) return config;
  const path = ['agents', 'items', i, 'instructions', 'rules'];
  const held = getAtPath(config, path);
  // rules written by hand as one string stay a rule
  const rules = typeof held === 'string' && held.trim() ? [held] : [...list(held)];
  const steps = rules.map((r, n) => (isStepRule(r) ? n : -1)).filter((n) => n >= 0);
  // after the guided step before it, else right after the other rules' last guided step, else at the end
  const place = steps.length === 0 ? rules.length : at < steps.length ? steps[Math.max(0, at)] : steps.at(-1) + 1;
  rules.splice(place, 0, `Step: ${String(text).replace(STEP_RULE, '').trim()}`);
  let next = setPath(config, path, rules);
  // a subagent with no role yet gets the schema's required one, so the step is saved on a valid agent
  if (!getAtPath(next, ['agents', 'items', i, 'instructions', 'role']))
    next = setPath(next, ['agents', 'items', i, 'instructions', 'role'], 'Follow the steps below.');
  return renumber(next);
}
// as typed: trimming here ate the space after each word while it was being written
export const setGuided = (config, step, text) => renumber(setPath(config, step.path, `Step: ${String(text).replace(STEP_RULE, '')}`));

// the guided steps of every lane numbered 1, 2, 3… in their order (what the agent reads)
export function renumber(config) {
  const items = list(config?.agents?.items);
  let next = config;
  items.forEach((agent, i) => {
    const rules = list(agent?.instructions?.rules);
    let n = 0;
    const numberedRules = rules.map((r) => (isStepRule(r) ? `Step ${(n += 1)}: ${ruleText(r)}` : r));
    if (numberedRules.some((r, k) => r !== rules[k])) next = setPath(next, ['agents', 'items', i, 'instructions', 'rules'], numberedRules);
  });
  return next;
}

// a hand-over from a lane: to a subagent there is, or to a new one
// (once per pair: a second hand-over to the same subagent would only be a second name for the same move)
export function addPass(config, laneKey, toKey, when = '') {
  const from = agentsOf(config).find((a) => a.id === laneKey);
  if (list(from?.handoffs).some((h) => h?.to === toKey)) return config;
  return addAgentTransfer(config, laneKey, toKey, when);
}
export const addNewSubagent = (config, laneKey, name, when = '') => addSubagent(config, laneKey, { name, when });
export const addWayBack = (config, laneKey) => addBackToStart(config, laneKey).config;
export function setPassWhen(config, laneKey, handoff, text) {
  const i = agentIndex(config, laneKey);
  return i < 0 ? config : setPath(config, ['agents', 'items', i, 'handoffs', handoff, 'description'], String(text));
}
export const removePass = (config, laneKey, handoff) => removeHandoff(config, laneKey, { handoff });

// ending the call: the end-the-call tool on the lane (made once for the agent), and its goodbye (shared by every lane)
export const addEnding = (config, laneKey) => addEnd(config, laneKey).config;
export function setGoodbye(config, toolId, text) {
  const at = list(config?.tools).findIndex((t) => isObj(t) && t.id === toolId);
  if (at < 0) return config;
  // an empty goodbye means none (the call just ends), not an empty line to say
  if (!String(text).trim()) {
    const params = { ...config.tools[at].params };
    delete params.say;
    return setPath(config, ['tools', at, 'params'], params);
  }
  return setPath(config, ['tools', at, 'params', 'say'], String(text));
}
export const lanesUsingTool = (config, toolId) => agentsOf(config).filter((a) => list(a.tools).includes(toolId)).length;

// ---- starting points (the empty page's common calls): guided steps and an ending on the first agent
export const STARTERS = [
  {
    id: 'route',
    name: 'Answer and pass on',
    line: 'Greet → find out what they need → pass to the right subagent or a person',
    steps: ['Find out what the caller needs in one short question.', 'Help with what you can; for anything else, pass them on or offer a call-back.'],
  },
  {
    id: 'details',
    name: 'Take details, then confirm',
    line: 'Greet → take the details → read them back → act after a yes → goodbye',
    steps: [
      'Find out what the caller needs.',
      'Take the details you need, one question at a time.',
      'Read the details back and wait for a clear yes before acting.',
      'Say the reference and what happens next.',
    ],
  },
  {
    id: 'verify',
    name: 'Check who they are, then help',
    line: 'Greet → ask for their number → check it → help → goodbye',
    steps: ['Ask for the number they use with us.', 'Check it before sharing any details.', 'Help with what they asked, then ask if there is anything else.'],
  },
];
export function applyStarter(config, starterId) {
  const starter = STARTERS.find((s) => s.id === starterId);
  const first = entryOf(config);
  if (!starter || !first) return config;
  let next = config;
  starter.steps.forEach((text) => (next = addGuided(next, first.id, text)));
  return addEnding(next, first.id);
}

// ---- the call in words, and words into steps (the "In your words" view)

// The steps as numbered lines, a lane's name before its lines (the first lane's lines need none)
export function wordsOf(config) {
  const out = [];
  let n = 0;
  lanesOf(config).forEach((lane) => {
    const line = (text) => out.push(`${(n += 1)}. ${text}`);
    if (!lane.first) out.push(`${lane.name}:`);
    lane.steps.forEach((step) => {
      line(stepLine(step));
      (step.children || []).forEach((c) => line(stepLine(c)));
    });
  });
  return out.join('\n');
}
// a hand-over's description read as a condition: "They want an appointment." -> "they want an appointment"
//   a tool's own "Use it when …" reads as the condition after it
export const condition = (when) =>
  String(when || '')
    .trim()
    .replace(/^use(?:\s+(?:it|this|this tool))?\s+(?:when|if)\s+/i, '')
    .replace(/[.!]+$/, '')
    .replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase());
function stepLine(step) {
  const a = step.action;
  switch (step.kind) {
    case 'greet':
      return `Greet them: “${step.text}”`;
    case 'say':
      return a?.type === 'generate' ? `Say something in its own words: ${a.instructions || ''}`.trim() : `Say “${speechText(a?.text)}”`;
    case 'form':
      return `Show the form ${step.form?.title || a?.form || ''}`.trim();
    case 'lookup':
      return `Look up ${a?.path || 'something'} on ${a?.connection || 'a system'}`;
    case 'message':
      return `Send the message ${a?.notification || ''}`.trim();
    case 'person':
      return `Put them through to a person (${a?.transfer || 'a transfer'})`;
    case 'guided':
      return step.text;
    case 'decide':
      return step.branches
        .map((b) =>
          b.kind === 'back'
            ? `When they need something else, pass them back to ${b.toName}.`
            : `If ${condition(b.when) || 'it fits'}, pass them to ${b.kind === 'person' ? 'a person' : b.toName}.`,
        )
        .join(' ');
    case 'end':
      return step.text ? `End the call: “${step.text}”` : 'End the call.';
    default:
      return String(a?.type || 'A step').replace(/_/g, ' ');
  }
}

const QUOTE = /[“"](.+?)[”"]/;
const PERSON = /\b(a person|person|human|colleague|staff|team|nurse|doctor|manager|agent on duty|front desk)\b/i;
// One line → what it becomes: { kind, text, lane, every, note?, to?, when?, quote? }
//   names: the subagents' names (to pass to), forms and messages by name (to show, to send)
function lineToStep(line, { lane, laneNames, forms, messages, first }) {
  const text = line.trim();
  const lower = text.toLowerCase();
  const quote = text.match(QUOTE)?.[1];
  // passing on: "if they want an appointment, pass them to Bookings"
  const pass = text.match(/^(?:if|when)\s+(.+?),\s*(?:then\s+)?(?:pass|hand|send|transfer|put)\b.*?\b(?:to|through to)\s+(?:the\s+)?(.+?)\.?$/i);
  if (pass || /\b(pass|hand)\b.*\bto\b/i.test(text)) {
    const target = (pass?.[2] || text.replace(/^.*\bto\s+(?:the\s+)?/i, '')).replace(/[.]$/, '').trim();
    // the longest name that fits, so "Sales support" wins over "Sales"; a name must end at a word break
    const t = target.toLowerCase();
    const sub = [...laneNames]
      .sort((x, y) => y.length - x.length)
      .find((n) => t === n.toLowerCase() || (t.startsWith(n.toLowerCase()) && /^\W/.test(t.slice(n.length))));
    // "pass them back to Reception" from a subagent: its way back to the first agent
    if (sub && sub === laneNames[0] && !first && /\bback\b/i.test(text)) return { kind: 'back', lane, to: sub, text, every: false };
    if (sub) return { kind: 'pass', lane, to: sub, when: pass?.[1] || '', text, every: false };
    if (PERSON.test(target) || PERSON.test(text))
      return {
        kind: 'guided',
        lane,
        text,
        every: false,
        note: 'Passing to a person is set on Tools › Pass to a person; until then the agent offers a call-back.',
      };
  }
  if (/\b(put|transfer)\b.*\bthrough\b|\btransfer\b/i.test(text) && PERSON.test(text))
    return {
      kind: 'guided',
      lane,
      text,
      every: false,
      note: 'Passing to a person is set on Tools › Pass to a person; until then the agent offers a call-back.',
    };
  // ending and greeting only when the line is about them ("Ask if they want anything else before you end" stays guided)
  if (/^(?:end\b|hang up|say (?:good)?bye|goodbye|bye\b)/i.test(lower)) return { kind: 'end', lane, text, quote, every: false };
  if (first && /^(?:greet|say hello|hello|welcome)\b/i.test(lower))
    return { kind: 'greet', lane, text, quote, every: true, note: 'The greeting stays on Agent, where it is set for every way in.' };
  const form = forms.find((f) => lower.includes(f.name.toLowerCase()) || lower.includes(f.id.toLowerCase().replace(/_/g, ' ')));
  if (form && /\b(form|show|fill|take|ask)\b/i.test(lower)) return { kind: 'form', lane, text, form: form.id, formName: form.name, every: true };
  if (/\b(text|sms|e-?mail|send (them )?(a )?message)\b/i.test(lower)) {
    const message = messages.find((m) => lower.includes(m.name.toLowerCase()) || lower.includes(m.id.toLowerCase().replace(/_/g, ' ')));
    if (message) return { kind: 'message', lane, text, message: message.id, messageName: message.name, every: true };
    return { kind: 'guided', lane, text, every: false, note: 'It has no message to send yet: add one on Connections › Messages, or keep this step guided.' };
  }
  // a line said every time; "Say “…” if they are new" has a condition, so the agent decides (guided)
  const afterQuote = text.replace(/^.*?[“"].+?[”"]/, '');
  if (quote && /^\s*(say|tell|read)\b/i.test(text) && !/\b(if|when|unless|only|once|after|before)\b/i.test(afterQuote))
    return { kind: 'say', lane, text, quote, every: true };
  return { kind: 'guided', lane, text, every: false };
}

// The lines → steps, in their lanes. A line "Bookings:" (a subagent's name) gives it the lines after.
//   -> { steps: [...], lanes: [names in the order used] }
//   lane: the lane the first lines belong to (default: the first agent's)
export function parseWords(config, words, { lane: startLane } = {}) {
  const lanes = lanesOf(config);
  const laneNames = lanes.map((l) => l.name);
  const forms = list(config?.forms)
    .filter(isObj)
    .map((f) => ({ id: f.id, name: f.title || f.id }));
  const messages = list(config?.notifications)
    .filter(isObj)
    .map((m) => ({ id: m.id, name: m.title || m.name || m.id }));
  // the lines of the steps each lane already takes every time (as wordsOf writes them): a line left as it was is that
  // step, kept as it is, so the call's own words turned into steps change nothing
  const kept = new Map(
    lanes.map((l) => [
      l.key,
      new Set(
        l.steps
          .flatMap((s) => [s, ...(s.children || [])])
          .filter((s) => s.every && s.section !== 'greet')
          .map((s) => stepLine(s).trim()),
      ),
    ]),
  );
  let lane = lanes.some((l) => l.key === startLane) ? startLane : lanes[0]?.key;
  const out = [];
  String(words || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim())
    .filter(Boolean)
    .forEach((line) => {
      // "Bookings:" (a subagent's name, however long) gives it the lines after
      const named = lanes.find((l) => line.toLowerCase().startsWith(`${l.name.toLowerCase()}:`));
      if (named) {
        lane = named.key;
        line = line.slice(named.name.length + 1).trim();
        if (!line) return;
      }
      if (kept.get(lane)?.has(line)) {
        out.push({ kind: 'keep', lane, text: line, every: true });
        return;
      }
      // "If A, pass to X. If B, put through to Y." is two steps
      line
        .split(/(?<=\.)\s+(?=(?:if|when|otherwise)\b)/i)
        .filter(Boolean)
        .forEach((part) => out.push(lineToStep(part, { lane, laneNames, forms, messages, first: lane === lanes[0]?.key })));
    });
  return out;
}

// The parsed steps into the agent: each lane the words cover gets these guided steps in place of its old ones, and the
// hand-overs, forms, messages and endings the words name that it doesn't have yet. Steps it takes every time that the
// words don't name are kept (nothing done by hand is lost).
export function applyWords(config, parsed) {
  let next = config;
  const lanes = lanesOf(config);
  const covered = new Set(parsed.map((p) => p.lane));
  // the old guided steps of the lanes the words cover go
  covered.forEach((key) => {
    const i = agentIndex(next, key);
    const path = ['agents', 'items', i, 'instructions', 'rules'];
    const rules = list(getAtPath(next, path));
    if (rules.some(isStepRule))
      next = setPath(
        next,
        path,
        rules.filter((r) => !isStepRule(r)),
      );
  });
  for (const p of parsed) {
    const lane = lanes.find((l) => l.key === p.lane);
    if (!lane) continue;
    if (p.kind === 'guided') next = addGuided(next, p.lane, p.text);
    else if (p.kind === 'back') next = addWayBack(next, p.lane);
    else if (p.kind === 'pass') {
      const to = lanes.find((l) => l.name === p.to);
      const agent = agentsOf(next).find((a) => a.id === p.lane);
      if (to && !list(agent?.handoffs).some((h) => h?.to === to.key))
        next = addPass(next, p.lane, to.key, p.when ? `${p.when.charAt(0).toUpperCase()}${p.when.slice(1)}.` : '');
    } else if (p.kind === 'end') {
      next = addEnding(next, p.lane);
      if (p.quote) {
        const tool = lanesOf(next)
          .find((l) => l.key === p.lane)
          ?.steps.find((s) => s.kind === 'end');
        if (tool) next = setGoodbye(next, tool.toolId, p.quote);
      }
    } else if (p.kind === 'form' || p.kind === 'message' || p.kind === 'say') {
      const action =
        p.kind === 'form'
          ? { type: 'send_form', form: p.form }
          : p.kind === 'message'
            ? { type: 'notify', notification: p.message }
            : { type: 'say', text: p.quote };
      const agent = agentsOf(next).find((a) => a.id === p.lane);
      const has = list(agent?.on_enter).some((x) => JSON.stringify(x) === JSON.stringify(action));
      if (!has) next = insertAction(next, enterPath(next, p.lane), undefined, action);
    }
  }
  return renumber(next);
}
