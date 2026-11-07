// A SIMULATED agent: plays a config with plain rules, so the studio can preview chats and run tests without a
// runtime. No language model and no requests; replies are marked `simulated`. It runs what the config says, as the
// runtime would: the channel's greeting (or none: it waits), each agent's steps as it takes over, hand-overs with their
// own lines, tool effects and their conditions, forms (or their "otherwise" where the channel can't show one), phone
// transfers with their hours and fallbacks, tasks step by step, the safety checks the server runs and the call limits.
// What only a model or a real system decides (which tool to use, what an API answers) is guessed from words or left
// empty, and said plainly in a note (`role: 'system'`), never made up as the agent's own words. Pure, no randomness.
//
// reply()/start() -> { messages: [agent lines], notes: [system lines], toolCalls, handoff, ended, form, steps }
//   form: a form to show (the session's form card), steps: picture steps for the session to run (useSimulatedPictures)

import { isObj } from '../studio/form/engine.js';
import { renderTemplate } from '../studio/form/promptPreview.js';
import { baseOf, primaryOf } from '../studio/form/messages.ts';
import { openNow } from '../studio/schedules.js';
import { conditionHolds } from './simulatedPictures.js';
import { validateDemo } from './demoValidate.js';

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
// one of these words or phrases, said as a word (a rule's keywords, a blocked topic)
const saysAny = (lower, phrases) =>
  list(phrases).some((p) => {
    const phrase = String(p || '')
      .toLowerCase()
      .trim();
    return phrase && new RegExp(`(^|[^a-z])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(lower);
  });

// Who would take over from the agent that answers first, for what a caller says, by the same matching the simulated
// conversation uses: a hand-over whose words the line shares, else a transfer tool's. null when it would answer itself.
//   -> { kind: 'subagent', to, why } | { kind: 'transfer', tool, why } | null
export function whoTakesOver(config, said) {
  const agents = list(config?.agents?.items).filter(isObj);
  const first = agents.find((a) => a.id === config?.agents?.entry) || agents[0];
  if (!first || !String(said || '').trim()) return null;
  const lower = String(said).toLowerCase();
  const handoff = first.kind === 'standalone' ? null : list(first.handoffs).find((h) => isObj(h) && shares(lower, words(`${h.description} ${h.tool}`)));
  if (handoff) return { kind: 'subagent', to: handoff.to, why: handoff.description || '' };
  const tool = list(config?.tools).find(
    (t) => isObj(t) && list(first.tools).includes(t.id) && t.builtin === 'transfer_or_callback' && shares(lower, words(`${t.description} ${t.id}`)),
  );
  return tool ? { kind: 'transfer', tool: tool.id, why: tool.description || '' } : null;
}

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
// Asking for a person: the model would choose its hand-over tool from the tool's own description; these words stand in
const PERSON = /\b(person|human|agent|representative|someone|operator|manager|supervisor|transfer|speak to|talk to)\b/;
// A request to take down for the team: a booking, an order, a call-back
const REQUEST = [/\bbook(s|ed|ing)?\b/, /\bappointments?\b/, /\breserv(e|ation)\b/, /\border(s|ed|ing)?\b/, /\bcall[ -]?back\b/];
// What the prompt-injection check (code-enforced, run by the server) looks for, in a simulation's plain words
const INJECTION =
  /\b(ignore|disregard|forget) (all |any |the |your )?(previous|prior|above|earlier) (instructions|rules)|\bsystem prompt\b|\byou are now\b|\bjailbreak\b/i;
// When a request is for, from what was said: a day, a part of the day, a time ("Saturday morning", "tomorrow 3pm")
const DAY = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|weekend)\b/i;
const PART = /\b(morning|afternoon|evening)\b/i;
const TIME = /\b\d{1,2}(:\d{2})? ?(am|pm)\b/i;
const whenIn = (said) =>
  [DAY, PART, TIME]
    .map((re) => re.exec(said)?.[0])
    .filter(Boolean)
    .join(' ');
// How a model might ask for a detail in conversation, where the channel can't show the form (its fields' own labels
// are used for any other)
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

// A built-in tool (end the call, pass to a person, show a form…): `type: builtin`, or named by `builtin` alone
const isBuiltin = (tool) => isObj(tool) && (tool.type === 'builtin' || (!tool.type && typeof tool.builtin === 'string'));

// The channels a conversation can be on: those switched on (a switched-off one reaches nobody)
export const liveChannels = (config) => list(config?.channels).filter((c) => isObj(c) && c.enabled !== false);
// Can this channel show a form? The schema's default: web chat and web voice can, the rest can't; `capabilities.forms`
// says otherwise.
export const showsForms = (channel) =>
  isObj(channel?.capabilities) && typeof channel.capabilities.forms === 'boolean'
    ? channel.capabilities.forms
    : ['web_chat', 'web_voice'].includes(channel?.type);
// The knowledge bases an agent reads: its own list (searched on every turn) and those its knowledge tools search
export function basesOf(config, agentId) {
  const agent = list(config?.agents?.items).find((a) => isObj(a) && a.id === agentId);
  if (!agent) return [];
  const tools = list(config?.tools).filter((t) => isObj(t) && t.type === 'knowledge' && list(agent.tools).includes(t.id));
  return [...new Set([...list(agent.knowledge), ...tools.map((t) => t.source)].filter((id) => typeof id === 'string' && id))];
}

export function createSimulatedAgent(config, { channelId, state: startingState } = {}) {
  const agents = list(config?.agents?.items);
  const live = liveChannels(config);
  const channel = live.find((c) => c.id === channelId) || live[0] || null;
  const entryAgent = agents.find((a) => a?.id === config?.agents?.entry) || agents[0] || null;
  let current = entryAgent;
  const state = { ...DEFAULT_STATE(config), ...(isObj(startingState) ? startingState : {}) }; // a scenario may preset values
  const calls = [];
  let ended = false;
  let request = null; // details asked for in conversation (a form's "otherwise" on a channel without forms)
  let task = null; // a task being run: { task, index, attempts, total, waiting }
  let strikes = 0; // off-topic strikes
  let handoffs = 0;
  let forms = 0;
  const openForms = new Map(); // requestId -> form id
  // what the server accepts but doesn't run yet (the same list its check gives, demoValidate.js): rules it keeps
  // and ignores are ignored here too, with a note when they would have acted
  const notRun = new Set(list(validateDemo(config)?.unsupported).map((u) => u?.where));
  const topicsRun = !notRun.has('guardrails.topics');
  const escalationRun = !notRun.has('guardrails.escalation');
  const limits = isObj(config?.guardrails?.limits) ? config.guardrails.limits : {};

  const persona = isObj(config?.persona) ? config.persona : {};
  const name = () => persona.name || current?.name || 'the agent';
  const isPhone = () => channel?.type === 'sip_voice';
  const isVoice = () => !!channel && (['sip_voice', 'web_voice'].includes(channel.type) || list(channel.modalities?.output).includes('audio'));
  const holds = (when) => conditionHolds(when, state, channel?.id);

  // A line with its {{...}} filled in: what the agent remembers ({{state.x}}, {{const.x}}), and what this step was
  // given ({{args.x}}, {{form.x}}, {{value}}). A value only the real system knows (an API's answer) shows as [its name],
  // never as nothing.
  const fill = (text, scope = {}) => {
    const given = String(text ?? '').replace(/\{\{\s*(args|form|result|with|value)(?:\.(\w+))?\s*((?:\|[^}]*)?)\}\}/g, (whole, root, key, filters) => {
      const v = root === 'value' ? scope.value : isObj(scope[root]) ? scope[root][key] : undefined;
      if (v !== undefined && v !== null && v !== '') return typeof v === 'object' ? JSON.stringify(v) : String(v);
      const fallback = /default\((.*?)\)/.exec(filters || '');
      if (fallback) return fallback[1].replace(/^['"]|['"]$/g, '');
      return `[${key || root}]`;
    });
    return renderTemplate(given, {
      ...config,
      state: { variables: Object.fromEntries(Object.entries(state).map(([k, v]) => [k, { type: 'string', default: v }])) },
    })
      .text.replace(/‹[^›]*›/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  };
  const filled = (values, scope) =>
    Object.fromEntries(Object.entries(isObj(values) ? values : {}).map(([k, v]) => [k, typeof v === 'string' && v.includes('{{') ? fill(v, scope) : v]));
  // the tools this agent has on this channel (a tool limited to other channels isn't offered here)
  const offered = () =>
    list(current?.tools)
      .map((id) => list(config?.tools).find((t) => t?.id === id))
      .filter((t) => isObj(t) && (!Array.isArray(t.channels) || !channel || t.channels.includes(channel.id)));

  // ---- one turn's output
  // lines: its own lines and the notes, in the order they happened (what a conversation shows)
  const result = () => ({ messages: [], notes: [], lines: [], toolCalls: [], handoff: null, ended: false, form: null, steps: [] });
  const speak = (out, text, extra = {}) => {
    if (!text) return;
    const line = { role: 'assistant', text, simulated: true, ...extra };
    out.messages.push(line);
    out.lines.push(line);
  };
  const note = (out, text) => {
    const line = { role: 'system', text: `Simulated: ${text}` };
    out.notes.push(line);
    out.lines.push(line);
  };
  const record = (out, tool, args = {}, extra = {}) => {
    const call = { tool: tool.name || tool.id, id: tool.id, args, ...extra };
    calls.push(call);
    out.toolCalls.push(call);
  };
  // a limit ends the call: its own line, then the end
  const limitEnds = (out) => {
    speak(out, fill(speechText(limits.say, config)));
    ended = true;
    out.ended = true;
  };

  // ---- steps (the schema's actions), in order, each when its condition holds
  const PICTURE = new Set(['request_image', 'analyze_image', 'compare_values', 'discard_image']);
  function run(actions, out, scope = {}) {
    const steps = list(actions);
    for (let i = 0; i < steps.length; i += 1) {
      if (out.ended || out.steps.length) return;
      const action = steps[i];
      if (!isObj(action)) continue;
      // a picture step and the rest after it run in the session (the picture card, measured in the browser)
      if (PICTURE.has(action.type)) {
        out.steps = steps.slice(i);
        return;
      }
      const ok = holds(action.when);
      if (ok === false) continue;
      if (ok === null) {
        note(out, `a “${action.type}” step was left out: its condition (an API’s answer, an event) can’t be known here.`);
        continue;
      }
      switch (action.type) {
        case 'say':
          speak(out, fill(speechText(action.text, config), scope));
          break;
        case 'generate':
          note(out, `the real agent writes a line here (“${clip(fill(action.instructions, scope), 80)}”).`);
          break;
        case 'set_state':
          Object.assign(state, filled(action.values, scope));
          break;
        case 'end_call':
          speak(out, fill(speechText(action.say, config), scope));
          ended = true;
          out.ended = true;
          return;
        case 'handoff':
          enter(action.to, out, { by: 'a step' });
          break;
        case 'return_to_entry':
          enter(entryAgent?.id, out, { by: 'a step' });
          break;
        case 'send_form':
          showForm(action.form, out, scope);
          break;
        case 'transfer':
          transfer(action.transfer, out, scope);
          break;
        case 'http':
          note(
            out,
            `the request to ${action.path || 'your system'} isn’t made, so what it brings back${isObj(action.to_state) ? ` (${Object.keys(action.to_state).join(', ')})` : ''} stays empty.`,
          );
          break;
        case 'notify':
          note(out, `the message “${action.notification}” isn’t sent.`);
          break;
        case 'collect_dtmf':
          note(out, isPhone() ? 'keypad tones can’t be pressed here.' : 'keypad tones need a phone call, so this channel skips them.');
          break;
        case 'log':
        case 'wrapup':
        case 'play_sound':
          break;
        default:
          note(out, `the step “${action.type}” isn’t run in a simulation.`);
      }
    }
  }
  const clip = (text, n) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);

  // ---- an agent takes over: its own line, what it remembers, then its steps
  function enter(toId, out, { announce, values, by } = {}) {
    const next = agents.find((a) => isObj(a) && a.id === toId);
    if (!next) {
      note(out, `there is no agent “${toId}” to pass to.`);
      return false;
    }
    if (Array.isArray(next.channels) && channel && !next.channels.includes(channel.id)) {
      note(out, `${next.name || next.id} doesn’t work on this channel, so the conversation stays with ${name()}.`);
      return false;
    }
    if (isObj(limits) && typeof limits.max_handoffs_per_call === 'number' && handoffs >= limits.max_handoffs_per_call) {
      note(out, 'the most hand-overs a call may have is reached, so the call ends.');
      limitEnds(out);
      return false;
    }
    handoffs += 1;
    if (announce !== undefined) speak(out, fill(speechText(announce, config)));
    if (isObj(values)) Object.assign(state, filled(values));
    current = next;
    out.handoff = next.id;
    if (announce === undefined && by) note(out, `${by} passes the conversation to ${next.name || next.id}.`);
    run(next.on_enter, out);
    return true;
  }

  // ---- a form: shown where the channel can show it, else its "otherwise" runs
  const formAt = (id) => list(config?.forms).find((f) => isObj(f) && f.id === id) || null;
  function showForm(id, out, scope = {}) {
    const form = formAt(id);
    if (!form) {
      note(out, `there is no form “${id}”.`);
      return;
    }
    if (!showsForms(channel)) {
      note(out, `this channel can’t show forms, so the form’s “otherwise” runs.`);
      const spoke = out.messages.length;
      run(form.otherwise, out, scope);
      // a model then asks for its details in conversation: imitated, a field at a time (its first question is the
      // "otherwise" line, when that asked)
      const fields = list(form.fields).filter((f) => isObj(f) && f.name);
      if (!out.ended && !out.steps.length && fields.length) startAsking(form, fields, out, scope, out.messages.length > spoke);
      return;
    }
    forms += 1;
    const requestId = `sim-form-${forms}`;
    openForms.set(requestId, form.id);
    out.form = {
      requestId,
      title: form.title || 'The agent needs some details',
      description: form.description || '',
      fields: list(form.fields),
      submitLabel: form.submit_label || 'Send',
      errors: {},
      busy: false,
    };
  }
  const askFor = (field) => ASK[field.name] || `${field.label || field.name}?`;
  // scope.said: what the caller said that started it (a day and time in it are kept); scope.call: the tool call
  // that gets the details as its arguments
  function startAsking(form, fields, out, scope, quiet) {
    const said = String(scope?.said || '');
    const values = {};
    if (said && fields.some((f) => f.name === 'need')) values.need = said;
    const when = whenIn(said);
    if (when && fields.some((f) => f.name === 'when')) values.when = when;
    const next = fields.find((f) => !values[f.name]);
    request = { form, fields, values, asking: next?.name || null, call: scope?.call || null };
    if (next && !quiet) speak(out, askFor(next));
  }
  // a form sent from the screen: checked as the server checks it, kept as it says, then its steps
  function submitForm(requestId, values) {
    const out = result();
    const form = formAt(openForms.get(requestId));
    if (!form) return { ...out, errors: { _form: 'This form isn’t open any more.' } };
    const errors = {};
    list(form.fields).forEach((field) => {
      const v = values?.[field.name];
      const blank = v === undefined || v === null || v === '' || v === false;
      if (field.required && blank) errors[field.name] = 'This is needed.';
      else if (!blank && typeof field.pattern === 'string') {
        try {
          if (!new RegExp(field.pattern).test(String(v))) errors[field.name] = 'This isn’t in the expected form.';
        } catch {
          /* a pattern the browser can't read: the server says */
        }
      } else if (!blank && field.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v))) errors[field.name] = 'This isn’t an email address.';
    });
    if (Object.keys(errors).length) return { ...out, errors };
    openForms.delete(requestId);
    Object.entries(isObj(form.store_in_state) ? form.store_in_state : {}).forEach(([field, variable]) => {
      if (values?.[field] !== undefined) state[variable] = values[field];
    });
    if (list(form.on_submit).length) run(form.on_submit, out, { form: values });
    else note(out, 'the real agent now has these details and answers from them.');
    return out;
  }
  // closing the form is an answer too: its "otherwise" runs
  function dismissForm(requestId) {
    const out = result();
    const form = formAt(openForms.get(requestId));
    openForms.delete(requestId);
    if (form) run(form.otherwise, out);
    return out;
  }

  // ---- a phone transfer: its hours, the steps before it, then success or failure. -> 'done' | 'closed' | 'failed'
  function transfer(id, out, scope = {}) {
    const t = list(config?.telephony?.transfers).find((x) => isObj(x) && x.id === id);
    if (!t) {
      note(out, `there is no phone transfer “${id}”.`);
      return 'failed';
    }
    if (channel?.capabilities?.human_transfer === false) {
      note(out, 'this channel doesn’t pass callers to a person (its “pass to a person” is switched off).');
      return 'failed';
    }
    if (t.schedule) {
      const schedule = isObj(config?.schedules) ? config.schedules[t.schedule] : null;
      if (schedule && openNow(schedule) === false) {
        note(out, `“${t.schedule}” is closed now.`);
        if (list(t.closed).length) {
          run(t.closed, out, scope);
          return 'closed';
        }
        return 'failed';
      }
    }
    run(t.before, out, scope);
    if (t.method === 'http_request') {
      note(out, 'the bridge isn’t asked in a simulation; this is what follows when it takes the caller.');
      run(t.on_success, out, scope);
      return 'done';
    }
    if (!t.target) {
      note(out, 'the transfer has no number yet.');
      run(t.on_failure, out, scope);
      return 'failed';
    }
    if (!isPhone()) {
      note(out, 'only a phone call can be put through to a number, so on this channel the transfer fails, as it would for real.');
      run(t.on_failure, out, scope);
      return 'failed';
    }
    note(out, `the call would be put through to ${typeof t.target === 'string' ? t.target : 'the number it looks up'} now.`);
    run(t.on_success, out, scope);
    ended = true;
    out.ended = true;
    return 'done';
  }

  // ---- a task: its steps in order, a question at a time, each answer checked as it says
  const taskAt = (id) => list(config?.tasks).find((t) => isObj(t) && t.id === id) || null;
  function startTask(id, out) {
    const t = taskAt(id);
    if (!t) {
      note(out, `there is no task “${id}”.`);
      return;
    }
    if (t.skip_if !== undefined && holds(t.skip_if) === true) {
      finishTask(t, 'success', out);
      return;
    }
    task = { task: t, index: 0, attempts: 0, total: 0, waiting: null };
    advance(out);
  }
  const stepKind = (step) => step.type || (step.ask ? 'collect' : list(step.do).length ? 'call' : 'say');
  function advance(out) {
    while (task && !out.ended) {
      const step = list(task.task.steps)[task.index];
      if (!isObj(step)) {
        finishTask(task.task, 'success', out);
        return;
      }
      if (step.skip_if !== undefined && holds(step.skip_if) === true) {
        task.index += 1;
        continue;
      }
      if (step.requires !== undefined && holds(step.requires) === false) {
        note(out, `the step “${step.id}” isn’t available yet (what it requires doesn’t hold).`);
        finishTask(task.task, 'failure', out);
        return;
      }
      const kind = stepKind(step);
      if (kind === 'collect') {
        if (step.input === 'dtmf' && !isPhone()) note(out, 'this step takes keypad tones, which need a phone call; here it is typed.');
        speak(out, fill(speechText(step.ask, config)) || `(It asks for ${step.store_in || step.id}.)`);
        task.waiting = step;
        return;
      }
      run(step.do, out);
      if (kind === 'call' && step.pass_when !== undefined) {
        const passed = holds(step.pass_when);
        if (passed === false && !failAttempt(step, out)) return;
        if (passed === null) note(out, `whether “${step.id}” passed depends on a real answer; it is taken as passed.`);
      }
      task.index += 1;
    }
  }
  // a failed answer: tried again while attempts are left (false: the task is over)
  function failAttempt(step, out) {
    task.attempts += 1;
    task.total += 1;
    const most = typeof step.max_attempts === 'number' ? step.max_attempts : task.task.max_attempts;
    const used = task.task.attempts_scope === 'task' ? task.total : task.attempts;
    if (typeof most === 'number' && used >= most) {
      run(step.on_exhausted, out);
      finishTask(task.task, 'failure', out);
      return false;
    }
    return true;
  }
  function answer(text, out) {
    const step = task.waiting;
    let ok = true;
    if (step.validate?.type === 'regex') {
      try {
        ok = new RegExp(step.validate.pattern).test(text);
      } catch {
        ok = true;
      }
    } else if (step.validate?.type === 'tool') note(out, `the answer would be checked by “${step.validate.tool}”; it is taken as right.`);
    if (!ok) {
      if (!failAttempt(step, out)) return;
      note(out, 'that answer doesn’t pass its check.');
      speak(out, fill(speechText(step.ask, config)));
      return;
    }
    if (step.store_in) state[step.store_in] = text;
    task.waiting = null;
    task.attempts = 0;
    task.index += 1;
    advance(out);
  }
  function finishTask(t, how, out) {
    task = null;
    const outcome = how === 'success' ? t.on_success : t.on_failure;
    if (!isObj(outcome)) return;
    if (isObj(outcome.set_state)) Object.assign(state, filled(outcome.set_state));
    run(outcome.do, out);
    if (outcome.tell_model && !outcome.silent) note(out, `the agent is told: “${fill(outcome.tell_model)}”`);
    if (outcome.next) startTask(outcome.next, out);
    else if (outcome.resume === 'entry' && current?.id !== entryAgent?.id) enter(entryAgent?.id, out, { by: 'The task' });
  }

  // ---- a tool is used: what it does by its kind, then its effects in order
  function runTool(tool, out, args = {}, said = '') {
    if (typeof limits.max_tool_calls_per_call === 'number' && calls.length >= limits.max_tool_calls_per_call) {
      note(out, 'the most tool uses a call may have is reached, so the call ends.');
      limitEnds(out);
      return;
    }
    record(out, tool, args);
    const scope = { args, said, call: calls[calls.length - 1] };
    const before = out.messages.length;
    if (isBuiltin(tool)) {
      if (tool.builtin === 'end_call') {
        speak(out, fill(speechText(tool.params?.say, config), scope));
        ended = true;
        out.ended = true;
        return;
      }
      if (tool.builtin === 'transfer_or_callback') {
        const how = transfer(tool.params?.transfer, out, scope);
        if (how === 'failed') run(tool.params?.fallback, out, scope);
      } else if (tool.builtin === 'send_form') showForm(tool.params?.form, out, scope);
      else if (tool.builtin === 'return_to_entry') enter(entryAgent?.id, out, { by: tool.name || tool.id });
      else if (tool.builtin === 'send_dtmf' || tool.builtin === 'collect_dtmf')
        note(out, isPhone() ? 'keypad tones aren’t sent here.' : 'keypad tones need a phone call.');
    } else if (tool.type === 'task') startTask(tool.task, out);
    else if (tool.type === 'mcp' || tool.type === 'code') note(out, `the server doesn’t run ${tool.type === 'mcp' ? 'MCP server' : 'custom code'} tools yet.`);
    else if (tool.type === 'knowledge') note(out, `“${tool.name || tool.id}” would search its documents now.`);
    // its effects, in order, each when its condition holds
    list(tool.effects).forEach((rule) => {
      if (out.ended || out.steps.length || !isObj(rule)) return;
      const ok = holds(rule.when);
      if (ok === false) return;
      if (ok === null) {
        note(out, 'an effect was left out: its condition is on the tool’s real answer, which a simulation doesn’t have.');
        return;
      }
      run(rule.do, out, scope);
    });
    const saidNothing = out.messages.length === before && !out.form && !out.steps.length && !out.ended && !task && !request;
    if (saidNothing && tool.reply !== 'none' && tool.type === 'http')
      note(out, `“${tool.name || tool.id}” would be called now. No request is made in a simulation, so there is no real answer.`);
  }

  // ---- the start of a conversation: the recording notice, the channel's greeting (none: it waits), the first
  // agent's steps, and the steps of what starts with the call
  function start() {
    const out = result();
    if (isVoice() && persona.disclosures?.recording_notice) speak(out, fill(speechText(persona.disclosures.recording_notice, config)), { kind: 'notice' });
    if (!channel) {
      note(out, 'no channel is switched on, so nobody can reach this agent.');
      return out;
    }
    const hello = fill(speechText(channel.greeting?.say, config));
    if (hello) speak(out, hello);
    else note(out, 'this channel has no greeting, so the agent waits for you to start.');
    run(entryAgent?.on_enter, out);
    list(config?.events)
      .filter((e) => isObj(e) && e.on === 'call_started' && holds(e.when) !== false)
      .forEach((e) => run(e.do, out));
    return out;
  }

  // hits: what a search of its documents found ([{ text, source, score }], best first), when it has documents
  function reply(userText, { hits = [] } = {}) {
    const said = String(userText || '').trim();
    const lower = said.toLowerCase();
    const out = result();
    if (ended) {
      note(out, 'the conversation has ended.');
      out.ended = true;
      return out;
    }
    const tools = offered();

    // the safety checks the server runs on what the caller said
    const injection = list(config?.guardrails?.input).find((g) => isObj(g) && g.type === 'prompt_injection');
    if (injection && INJECTION.test(said)) {
      const trigger = isObj(injection.on_trigger) ? injection.on_trigger : {};
      if (trigger.action === 'end_call') {
        speak(out, fill(speechText(trigger.say, config)));
        ended = true;
        out.ended = true;
      } else if (trigger.say) speak(out, fill(speechText(trigger.say, config)));
      else note(out, 'the prompt-injection check caught that, and the agent doesn’t follow it.');
      return out;
    }

    // a task asked a question: this is the answer
    if (task?.waiting) {
      answer(said, out);
      return out;
    }

    // details asked for in conversation: this answer is the one asked for
    if (request?.asking) {
      request.values[request.asking] = said;
      const next = request.fields.find((f) => !request.values[f.name]);
      if (next) {
        request.asking = next.name;
        speak(out, askFor(next));
        return out;
      }
      if (request.call) request.call.args = { ...request.values };
      Object.entries(isObj(request.form.store_in_state) ? request.form.store_in_state : {}).forEach(([field, variable]) => {
        if (request.values[field] !== undefined) state[variable] = request.values[field];
      });
      const values = request.values;
      const form = request.form;
      request = null;
      if (list(form.on_submit).length) run(form.on_submit, out, { form: values });
      else note(out, 'the real agent now has these details and answers from them.');
      return out;
    }

    // goodbye: its end-call tool, with the tool's own goodbye (none: it just ends)
    if (/\b(bye|goodbye|that'?s all|that is all|no,? thanks|nothing else)\b/.test(lower)) {
      const end = tools.find((t) => t.builtin === 'end_call');
      if (end) {
        runTool(end, out);
        return out;
      }
      note(out, 'this agent has no end-call tool, so a real one could not end the conversation.');
      return out;
    }

    // its hand-over and ending rules: run as the server runs them (kept but not run yet: said, and nothing happens)
    const rule = list(config?.guardrails?.escalation).find(
      (r) => isObj(r) && isObj(r.when) && Array.isArray(r.when.keywords) && saysAny(lower, r.when.keywords),
    );
    if (rule && !escalationRun) note(out, `the rule “${rule.id}” matches, but the server keeps it without running it yet, so it does nothing.`);
    if (rule && escalationRun) {
      if (rule.action === 'end_call') {
        speak(out, fill(speechText(rule.say, config)));
        ended = true;
        out.ended = true;
        return out;
      }
      if (rule.say) speak(out, fill(speechText(rule.say, config)));
      if (rule.action === 'handoff') enter(rule.to, out, { by: `The rule “${rule.id}”` });
      const ruled = rule.action === 'tool' ? list(config?.tools).find((t) => isObj(t) && t.id === rule.tool) : null;
      if (ruled) runTool(ruled, out, { reason: said }, said);
      return out;
    }

    // topics it avoids: the off-topic line, and after its strikes, its tool
    const topics = isObj(config?.guardrails?.topics) ? config.guardrails.topics : {};
    if (saysAny(lower, topics.blocked)) {
      if (!topicsRun) note(out, 'that is a topic it avoids, but the server keeps topic limits without running them yet, so the agent answers as usual.');
      else {
        strikes += 1;
        const off = isObj(topics.on_off_topic) ? topics.on_off_topic : {};
        speak(out, fill(speechText(off.say, config)));
        const then = list(config?.tools).find((t) => isObj(t) && t.id === off.then);
        if (typeof off.max_strikes === 'number' && strikes >= off.max_strikes && then) runTool(then, out, { reason: said }, said);
        return out;
      }
    }

    // a person, asked for, or needed at once (an emergency, pain, a complaint): its hand-over tool, chosen by the model
    // from the tool's description (these words stand in for that choice)
    const urgent = URGENT.test(lower);
    if (urgent || PERSON.test(lower)) {
      request = null;
      const person = tools.find((t) => t.builtin === 'transfer_or_callback');
      if (person) {
        runTool(person, out, { reason: said }, said);
        return out;
      }
      note(out, 'this agent has no way to pass someone to a person (switch on “Pass people to a person on your team”).');
      return out;
    }

    // what it can do, asked straight out: this agent's own tools and documents
    if (/\b(what can you (do|help)|how can you help|what do you do|what can i ask)\b/.test(lower)) {
      const can = [
        tools.some((t) => t.builtin === 'send_form') && 'take a request for our team (a booking, an order or a call-back)',
        tools.some((t) => t.builtin === 'transfer_or_callback') && 'pass you to someone on the team',
        basesOf(config, current?.id).length > 0 && 'answer questions from our information',
      ].filter(Boolean);
      const about = String(config?.meta?.description || '').trim();
      speak(
        out,
        `${about ? `${about.replace(/\.$/, '')}. ` : ''}${can.length ? `I can ${can.length > 1 ? `${can.slice(0, -1).join(', ')} and ${can.at(-1)}` : can[0]}.` : 'Ask me anything.'}`,
      );
      return out;
    }

    // another agent: its hand-over (an agent that answers on its own makes none)
    const handoff = current?.kind === 'standalone' ? null : list(current?.handoffs).find((h) => isObj(h) && shares(lower, words(`${h.description} ${h.tool}`)));
    if (handoff) {
      const before = current;
      calls.push({ tool: handoff.tool, id: handoff.tool, args: {}, handoff: handoff.to });
      out.toolCalls.push(calls[calls.length - 1]);
      if (!enter(handoff.to, out, { announce: handoff.announce, values: handoff.set_state, by: before?.name || before?.id })) out.toolCalls.pop();
      return out;
    }

    // a tool whose name or description matches what was said
    const tool = tools.find((t) => !isBuiltin(t) && t.type !== 'knowledge' && shares(lower, words(`${t.id} ${t.name || ''} ${t.description || ''}`)));
    if (tool) {
      runTool(
        tool,
        out,
        Object.fromEntries(Object.keys(isObj(tool.parameters?.properties) ? tool.parameters.properties : {}).map((k) => [k, `‹${k} from the caller›`])),
        said,
      );
      return out;
    }

    // a request to take down (booking, order, call-back), when it takes requests: its form
    const form = tools.find((t) => t.builtin === 'send_form');
    if (form && REQUEST.some((re) => re.test(lower))) {
      runTool(form, out, {}, said);
      return out;
    }

    // its documents: the line that answers best
    const hit = hits.find((h) => h && h.score > 0 && h.text);
    const line = hit ? bestLine(hit.text, said) : '';
    if (line) {
      speak(out, `${line}${/[.!?]$/.test(line) ? '' : '.'} (Simulated: found in ${hit.source || 'your documents'}; the real agent puts it in its own words.)`);
      return out;
    }

    const role = String(current?.instructions?.role || '')
      .replace(/\s+/g, ' ')
      .trim();
    const snippet = role ? role.split(/\s+/).slice(0, 14).join(' ') + (role.split(/\s+/).length > 14 ? '…' : '') : 'no instructions yet';
    speak(
      out,
      `I’m ${name()}. This is a simulated reply: the real agent answers from its instructions (“${snippet}”)${basesOf(config, current?.id).length ? ' and its documents' : ''}. Nothing here answers it yet: to be sure it can, add the answer under What it knows or What it does.`,
    );
    return out;
  }

  // steps run from outside (the session's picture steps reach a step that isn't a picture's)
  function act(actions, scope = {}) {
    const out = result();
    run(actions, out, scope);
    return out;
  }

  return {
    start,
    // the agent's first lines (kept for the test runner and replays, which show lines only)
    greeting: () => {
      const out = start();
      return out.messages;
    },
    reply,
    act,
    submitForm,
    dismissForm,
    get name() {
      return name();
    },
    get channel() {
      return channel;
    },
    get currentAgent() {
      return current?.id || null;
    },
    // whether the model of the agent answering now is marked as seeing pictures (its own, the channel's, else the
    // agent's default): the server sends pictures only to one that is
    get sees() {
      const own = current?.overrides?.models?.llm;
      const viaChannel = channel?.overrides?.models?.llm;
      const llm = isObj(own) ? own : isObj(viaChannel) ? viaChannel : config?.defaults?.models?.llm;
      return isObj(llm) && llm.vision === true;
    },
    // the knowledge bases the agent answering now reads
    get bases() {
      return basesOf(config, current?.id);
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
    // what the picture steps change (simulatedPictures.js): values set, read or compared, and an end to the call
    setState(values) {
      if (isObj(values)) Object.assign(state, values);
    },
    end() {
      ended = true;
    },
    // a line of the configuration's, with its {{...}} filled in from what the agent remembers
    say(speech) {
      return fill(speechText(speech, config));
    },
  };
}
