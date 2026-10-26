// Guardrails in plain words, for the top of the Guardrails page: the topics it keeps to, the limits on a call, and the moments it hands over or ends the
// call by itself. Each reads its part of `guardrails` and writes it back complete; a part left empty is taken out, so nothing is written that was not
// chosen. Pure: no React, no DOM.

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const clone = (v) => JSON.parse(JSON.stringify(v));
const strings = (v) => list(v).filter((s) => typeof s === 'string' && s.trim());

// What a line it says is, in words: the text itself, or '' for a reference to one of the fixed lines (the field then says which).
export const sayText = (say) => (typeof say === 'string' ? say : '');
export const sayRef = (say) => (isObj(say) && typeof say.message === 'string' ? say.message : '');

// Changes `guardrails` on a copy, and takes out what is left empty: an empty part, then an empty `guardrails`.
function edit(config, change) {
  const next = clone(config || {});
  next.guardrails = isObj(next.guardrails) ? next.guardrails : {};
  change(next.guardrails, next);
  ['topics', 'limits'].forEach((part) => {
    const value = next.guardrails[part];
    if (isObj(value) && Object.keys(value).length === 0) delete next.guardrails[part];
  });
  ['escalation', 'input', 'output'].forEach((part) => {
    if (Array.isArray(next.guardrails[part]) && next.guardrails[part].length === 0) delete next.guardrails[part];
  });
  if (Object.keys(next.guardrails).length === 0) delete next.guardrails;
  return next;
}

// ---- topics ---------------------------------------------------------------------------------------------------------------------------------------
//   { allowed: [..], blocked: [..], offTopic: null | { strikes, then, say, sayRef } }; a topic written twice is shown once
export function topicsOf(config) {
  const t = isObj(config?.guardrails?.topics) ? config.guardrails.topics : {};
  const off = isObj(t.on_off_topic) ? t.on_off_topic : null;
  return {
    allowed: tidyList(t.allowed),
    blocked: tidyList(t.blocked),
    offTopic: off
      ? { strikes: Number(off.max_strikes) || 1, then: typeof off.then === 'string' ? off.then : '', say: sayText(off.say), sayRef: sayRef(off.say) }
      : null,
  };
}

const tidyList = (items) => [...new Set(strings(items).map((s) => s.trim()))];

// which: 'allowed' | 'blocked'
export function setTopics(config, which, items) {
  return edit(config, (g) => {
    const topics = isObj(g.topics) ? { ...g.topics } : {};
    const clean = tidyList(items);
    if (clean.length) topics[which] = clean;
    else delete topics[which];
    g.topics = topics;
  });
}

// What it does when someone keeps going off topic: after `strikes` tries it runs the tool `then` (ending the conversation, passing to a person...),
// saying `say` first. null takes the rule away. A new rule with no tool to run is not written (the schema needs one); one already there without a
// tool (made by hand) is kept, with what else it has, until a tool is chosen. What it says is kept as typed (a space typed at its end included).
export function setOffTopic(config, value) {
  return edit(config, (g) => {
    const topics = isObj(g.topics) ? { ...g.topics } : {};
    if (!value || (!value.then && !isObj(topics.on_off_topic))) delete topics.on_off_topic;
    else {
      const rule = { max_strikes: Math.max(1, Math.round(Number(value.strikes) || 1)) };
      if (value.then) rule.then = value.then;
      const say = String(value.say || '');
      if (say.trim()) rule.say = say;
      else if (value.sayRef) rule.say = { message: value.sayRef };
      topics.on_off_topic = rule;
    }
    g.topics = topics;
  });
}

// The tools that can be run when the tries are used up, by name: ending the conversation and passing to a person first.
export function endingTools(config) {
  const tools = list(config?.tools).filter((t) => isObj(t) && typeof t.id === 'string' && t.id);
  const rank = (t) => (t.builtin === 'end_call' ? 0 : t.builtin === 'transfer_or_callback' ? 1 : 2);
  const label = (t) =>
    t.builtin === 'end_call' ? 'End the conversation' : t.builtin === 'transfer_or_callback' ? 'Pass them to a person' : `Run “${t.id.replace(/[_-]+/g, ' ')}”`;
  return [...tools].sort((a, b) => rank(a) - rank(b)).map((t) => ({ id: t.id, label: label(t), builtin: t.builtin || '' }));
}

// ---- limits ---------------------------------------------------------------------------------------------------------------------------------------
// Each limit as it is asked: in minutes for the length of a call (the configuration keeps seconds), the others as they are.
export const LIMITS = [
  {
    key: 'max_call_duration_s',
    label: 'Longest call',
    unit: 'minutes',
    help: 'The call ends this long after it starts.',
    toInput: (s) => (s ? Math.round((s / 60) * 10) / 10 : ''),
    fromInput: (m) => Math.max(30, Math.round(Number(m) * 60)),
  },
  {
    key: 'max_silence_s',
    label: 'Longest silence',
    unit: 'seconds',
    help: 'It ends the call when the caller has said nothing for this long, whatever the nudges.',
    toInput: (s) => s ?? '',
    fromInput: (v) => Math.max(1, Math.round(Number(v))),
  },
  {
    key: 'max_tool_calls_per_call',
    label: 'Most tool uses in one call',
    unit: '',
    help: 'Lookups, hand-overs and other tools together. The call ends at the next one.',
    toInput: (v) => v ?? '',
    fromInput: (v) => Math.max(1, Math.round(Number(v))),
  },
  {
    key: 'max_handoffs_per_call',
    label: 'Most moves between agents in one call',
    unit: '',
    help: 'Only when several agents share the work. The call ends instead of moving again.',
    toInput: (v) => v ?? '',
    fromInput: (v) => Math.max(1, Math.round(Number(v))),
  },
];

//   { values: { key: number }, say, sayRef }
export function limitsOf(config) {
  const l = isObj(config?.guardrails?.limits) ? config.guardrails.limits : {};
  const values = {};
  LIMITS.forEach(({ key }) => {
    if (Number.isFinite(Number(l[key])) && l[key] !== null && l[key] !== '') values[key] = Number(l[key]);
  });
  return { values, say: sayText(l.say), sayRef: sayRef(l.say) };
}

// A limit as typed: '' takes it away; anything else is made a whole number within what the schema allows. What it says when a limit ends the call
// stays when the last limit goes (the box is emptied for a moment while a new number is typed): it is shown, and cleared by hand.
export function setLimit(config, key, typed) {
  const limit = LIMITS.find((l) => l.key === key);
  if (!limit) return config;
  return edit(config, (g) => {
    const limits = isObj(g.limits) ? { ...g.limits } : {};
    const text = String(typed ?? '').trim();
    if (!text || !Number.isFinite(Number(text)) || Number(text) <= 0) delete limits[key];
    else limits[key] = limit.fromInput(text);
    g.limits = limits;
  });
}

// Kept as typed (a space typed at its end included); nothing but spaces takes it away.
export function setLimitSay(config, text) {
  return edit(config, (g) => {
    const limits = isObj(g.limits) ? { ...g.limits } : {};
    const say = String(text || '');
    if (say.trim()) limits.say = say;
    else delete limits.say;
    g.limits = limits;
  });
}

// ---- handing over and ending, by itself ---------------------------------------------------------------------------------------------------------
// Three rules people ask for, as switches; any other rule is in the list below them. Each is known by its id.
export const MOMENTS = [
  {
    id: 'frustrated_to_person',
    label: 'Pass a frustrated caller to a person',
    text: 'When someone sounds frustrated two turns in a row, it offers them a person.',
    needs: 'transfer',
    make: (tool) => ({
      id: 'frustrated_to_person',
      when: { sentiment: 'frustrated', consecutive_turns: 2 },
      action: 'tool',
      tool,
      say: 'I’m sorry this is taking a while. Let me get you to someone who can help.',
    }),
  },
  {
    id: 'asks_for_person',
    label: 'Pass people who ask for a manager or to complain',
    text: 'When the caller uses one of these words, it passes them to a person.',
    needs: 'transfer',
    keywords: ['manager', 'complaint', 'supervisor'],
    make: (tool, keywords) => ({ id: 'asks_for_person', when: { keywords }, action: 'tool', tool, say: 'Of course. Let me get you to a person.' }),
  },
  {
    id: 'abusive_end',
    label: 'End the call when someone is abusive',
    text: 'It says a short, polite goodbye and ends the call.',
    needs: '',
    make: () => ({
      id: 'abusive_end',
      when: { sentiment: 'abusive' },
      action: 'end_call',
      say: 'I’m going to end this call now. Please get in touch again when you’re ready. Goodbye.',
    }),
  },
];

const transferTool = (config) => list(config?.tools).find((t) => isObj(t) && t.builtin === 'transfer_or_callback' && t.id)?.id || '';
// a check on what is said already has this id (the server takes the ids of the checks and of these rules as one set)
const checkHasId = (config, id) => [...list(config?.guardrails?.input), ...list(config?.guardrails?.output)].some((c) => isObj(c) && c.id === id);

// The switch a rule is, when it is one: known by its id, and still doing what the switch says (when it applies and what it does then, in words; what
// it says may be anything). A rule changed in the list below to do something else is not that switch any more, and is not named as it.
export function momentOf(rule, config) {
  const moment = isObj(rule) ? MOMENTS.find((m) => m.id === rule.id) : null;
  if (!moment) return null;
  const words = strings(rule.when?.keywords);
  const made = moment.make(transferTool(config) || rule.tool || '', words.length ? words : moment.keywords);
  return ruleWords(made, config) === ruleWords(rule, config) ? moment : null;
}

//   { [id]: { on, changed, keywords?, possible, why } } for the three switches. A rule changed in the list below stays on, and `changed` says what it
//   does now; the words of one are asked here only while it still listens for words.
export function momentsOf(config) {
  const rules = list(config?.guardrails?.escalation).filter(isObj);
  const transfer = transferTool(config);
  return Object.fromEntries(
    MOMENTS.map((m) => {
      const rule = rules.find((r) => r.id === m.id);
      const same = !!rule && momentOf(rule, config) === m;
      const clash = !rule && checkHasId(config, m.id);
      const possible = !clash && (m.needs !== 'transfer' || !!transfer);
      return [
        m.id,
        {
          on: !!rule,
          changed: rule && !same ? `Changed in the list below. ${ruleWords(rule, config)}.` : '',
          keywords: m.keywords ? (rule ? (same ? tidyList(rule.when.keywords) : []) : m.keywords) : undefined,
          possible,
          why: possible
            ? ''
            : clash
              ? `A check below already has the id “${m.id}”. Rename it to switch this on.`
              : 'Switch on “Pass people to a person” on the Tools page first: this uses it.',
        },
      ];
    }),
  );
}

// Switching one on adds its rule at the end of the list; one already there stays as it is, with whatever was changed in the list below. Switching it
// off takes the rule away.
export function setMoment(config, id, on, { keywords } = {}) {
  const moment = MOMENTS.find((m) => m.id === id);
  if (!moment) return config;
  const there = list(config?.guardrails?.escalation).some((r) => isObj(r) && r.id === id);
  if (on && (there || checkHasId(config, id))) return config;
  return edit(config, (g, next) => {
    const rules = list(g.escalation).filter((r) => !(isObj(r) && r.id === id));
    if (on) {
      const tool = transferTool(next);
      if (moment.needs === 'transfer' && !tool) {
        g.escalation = list(g.escalation);
        return;
      }
      rules.push(moment.make(tool, tidyList(keywords && keywords.length ? keywords : moment.keywords || [])));
    }
    g.escalation = rules;
  });
}

// The words a switched-on rule listens for, changed where the rule is: what it says, its tool, its place in the list and anything else changed in the
// list below stay as they are. With no word left it would never apply (and the schema needs one), so the last word stays: `{ config, refused }` says so.
export function setMomentWords(config, id, keywords) {
  const words = tidyList(keywords);
  if (!words.length) return { config, refused: 'It needs at least one word. To stop it, switch it off.' };
  const index = list(config?.guardrails?.escalation).findIndex((r) => isObj(r) && r.id === id);
  if (index < 0) return { config, refused: '' };
  const next = edit(config, (g) => {
    g.escalation = list(g.escalation).map((r, i) => (i === index ? { ...r, when: { ...(isObj(r.when) ? r.when : {}), keywords: words } } : r));
  });
  return { config: next, refused: '' };
}

// One rule in words, for its row in the list: "When the caller sounds frustrated (2 turns in a row): pass them to a person".
const SENTIMENT_WORDS = { frustrated: 'sounds frustrated', negative: 'is unhappy', abusive: 'is abusive' };
export function ruleWords(rule, config) {
  if (!isObj(rule)) return '';
  const w = isObj(rule.when) ? rule.when : {};
  const parts = [];
  if (w.sentiment) parts.push(`the caller ${SENTIMENT_WORDS[w.sentiment] || w.sentiment}`);
  if (strings(w.keywords).length)
    parts.push(
      `they say ${strings(w.keywords)
        .map((k) => `“${k}”`)
        .join(' or ')}`,
    );
  if (w.intent) parts.push(`they want to ${String(w.intent).replace(/[_-]+/g, ' ')}`);
  if (w.state) parts.push(`what it remembers as “${w.state}” matches`);
  let when = parts.length ? `When ${parts.join(' and ')}` : 'When its condition is met';
  if (Number(w.consecutive_turns) > 1) when += ` (${w.consecutive_turns} turns in a row)`;
  const tool = list(config?.tools).find((t) => isObj(t) && t.id === rule.tool);
  const then =
    rule.action === 'end_call'
      ? 'end the call'
      : rule.action === 'handoff'
        ? `pass them to ${rule.to ? agentWords(config, rule.to) : 'another agent'}`
        : tool?.builtin === 'transfer_or_callback'
          ? 'pass them to a person'
          : tool?.builtin === 'end_call'
            ? 'end the call'
            : `run “${rule.tool ? words(rule.tool) : 'a tool'}”`;
  return `${when}: ${then}`;
}
const words = (id) => {
  const text = String(id).replace(/[_-]+/g, ' ').trim();
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : '';
};
// an agent by its own name (or, alone, the agent's), else its id in words
function agentWords(config, id) {
  const agents = list(config?.agents?.items).filter(isObj);
  const agent = agents.find((a) => a.id === id);
  if (typeof agent?.name === 'string' && agent.name.trim()) return agent.name.trim();
  if (agent && agents.length === 1 && typeof config?.meta?.name === 'string' && config.meta.name.trim()) return config.meta.name.trim();
  return words(id);
}

// A check on what is said, in words, for its row and its panel: what it is and what it does when it finds something ("politely declines").
const TRIGGER_WORDS = {
  deflect: 'politely declines',
  redact_in_logs: 'hides it in the call log',
  rewrite: 'rewrites it',
  block: 'blocks it',
  end_call: 'ends the call',
};
const ENFORCED = {
  code: 'Checked in code, every time.',
  both: 'Checked in code, and the agent is told too.',
  prompt: 'Told to the agent as advice: not checked.',
};
export function checkWords(rule) {
  if (!isObj(rule)) return { then: '', how: '' };
  const action = rule.on_trigger?.action;
  return {
    then: rule.type === 'field_firewall' ? 'keeps them out' : rule.type === 'statement' ? '' : TRIGGER_WORDS[action] || (action ? String(action) : ''),
    how: ENFORCED[rule.enforcement] || '',
  };
}
