// Model for the top of the Guardrails page (topics, call limits, hand-over and ending rules). Each part is written back
// complete, and an empty part is removed so nothing unchosen is written. Pure: no React, no DOM.

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const clone = (v) => JSON.parse(JSON.stringify(v));
const strings = (v) => list(v).filter((s) => typeof s === 'string' && s.trim());

// A line's text, or '' when it refers to a fixed message (the field then says which).
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

// ---- topics ---------------------------------------------------------------------------------------------------------
//   { allowed: [..], blocked: [..], offTopic: null | { strikes, then, say, sayRef } }; duplicate topics show once
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

// Off-topic rule: after `strikes` tries, say `say` and run tool `then`; null removes it. A new rule without a tool
// isn't written (the schema needs one), but a hand-made one is kept until a tool is chosen. `say` is kept as typed.
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

// Tools that can run when the tries are used up, by name: ending the conversation and passing to a person first.
export function endingTools(config) {
  const tools = list(config?.tools).filter((t) => isObj(t) && typeof t.id === 'string' && t.id);
  const rank = (t) => (t.builtin === 'end_call' ? 0 : t.builtin === 'transfer_or_callback' ? 1 : 2);
  const label = (t) =>
    t.builtin === 'end_call' ? 'End the conversation' : t.builtin === 'transfer_or_callback' ? 'Pass them to a person' : `Run “${t.id.replace(/[_-]+/g, ' ')}”`;
  return [...tools].sort((a, b) => rank(a) - rank(b)).map((t) => ({ id: t.id, label: label(t), builtin: t.builtin || '' }));
}

// ---- limits ---------------------------------------------------------------------------------------------------------
// Each limit as asked: call length in minutes (the configuration keeps seconds), the others as they are.
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

// '' removes the limit; anything else becomes a whole number within the schema's range. The closing line stays when the
// last limit goes (the box is briefly empty while retyping); it is cleared by hand.
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

// Kept exactly as typed; only spaces removes it.
export function setLimitSay(config, text) {
  return edit(config, (g) => {
    const limits = isObj(g.limits) ? { ...g.limits } : {};
    const say = String(text || '');
    if (say.trim()) limits.say = say;
    else delete limits.say;
    g.limits = limits;
  });
}

// ---- handing over and ending, by itself -----------------------------------------------------------------------------
// Three common rules as switches, each known by its id; any other rule is in the list below.
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
// a check already has this id (the server treats check ids and rule ids as one set)
const checkHasId = (config, id) => [...list(config?.guardrails?.input), ...list(config?.guardrails?.output)].some((c) => isObj(c) && c.id === id);

// The switch a rule is: matched by id and still doing what the switch says (its line may be anything). A rule changed
// in the list below to do something else is no longer that switch.
export function momentOf(rule, config) {
  const moment = isObj(rule) ? MOMENTS.find((m) => m.id === rule.id) : null;
  if (!moment) return null;
  const words = strings(rule.when?.keywords);
  const made = moment.make(transferTool(config) || rule.tool || '', words.length ? words : moment.keywords);
  return ruleWords(made, config) === ruleWords(rule, config) ? moment : null;
}

// -> { [id]: { on, changed, keywords?, possible, why, needsHandOver } } for the three switches
//   changed: what a rule edited in the list below does now (it stays on)
//   needsHandOver: it hands over but the agent can't yet, so switching it on switches hand-over on too
export const BRINGS_HAND_OVER = 'Switching it on also switches on “Pass people to a person” on the Tools page, which it uses.';
export function momentsOf(config) {
  const rules = list(config?.guardrails?.escalation).filter(isObj);
  const transfer = transferTool(config);
  return Object.fromEntries(
    MOMENTS.map((m) => {
      const rule = rules.find((r) => r.id === m.id);
      const same = !!rule && momentOf(rule, config) === m;
      const clash = !rule && checkHasId(config, m.id);
      return [
        m.id,
        {
          on: !!rule,
          changed: rule && !same ? `Changed in the list below. ${ruleWords(rule, config)}.` : '',
          keywords: m.keywords ? (rule ? (same ? tidyList(rule.when.keywords) : []) : m.keywords) : undefined,
          possible: !clash,
          why: clash ? `A check below already has the id “${m.id}”. Rename it to switch this on.` : '',
          needsHandOver: m.needs === 'transfer' && !transfer,
        },
      ];
    }),
  );
}

// On adds the rule at the end of the list (an existing one stays as it is); off removes it.
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

// Changes a switched-on rule's words in place, leaving the rest as is. The last word can't go (the rule would never
// apply, and the schema needs one): `{ config, refused }` says so.
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

// One rule in words for its row: "When the caller sounds frustrated (2 turns in a row): pass them to a person".
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
// a workflow agent's own name (or, if it is the only one, the agent's), else its id in words
function agentWords(config, id) {
  const agents = list(config?.agents?.items).filter(isObj);
  const agent = agents.find((a) => a.id === id);
  if (typeof agent?.name === 'string' && agent.name.trim()) return agent.name.trim();
  if (agent && agents.length === 1 && typeof config?.meta?.name === 'string' && config.meta.name.trim()) return config.meta.name.trim();
  return words(id);
}

// A check in words, for its row and panel: what it is and what it does on a hit ("politely declines").
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
