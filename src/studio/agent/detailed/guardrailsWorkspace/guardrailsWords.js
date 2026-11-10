// Build › Guardrails in plain words, for any agent: the checks on what callers say and on what it says, the topics it
// keeps to, when it hands over or ends the call, its own rules, and its limits, each with what really happens to it.
// Pure: no React, no DOM, so the tests run it.
//
// From the schema and agent config guide 2 (§2.7, §3.24): `enforcement` code = checked by the runtime every time, both =
// checked and told to the model, prompt = told to the model (a rule in words is only ever that). Checks on what callers
// say run before the model sees the message. The server keeps but does not act on yet: topics, escalation rules, and
// checks on what the agent says other than a rule in words; its own report says so (`unsupported`), and before it has
// answered the guide's list stands in. Limits run.

import { LIMITS, MOMENTS, guardNotRun, limitsOf, momentOf, momentsOf, ruleWords, topicsOf } from '../../blocks/guardrailModel.js';
import { humanize } from '../../rowNames.js';

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v) => list(v).filter((s) => typeof s === 'string' && s.trim());
const clip = (t, n = 60) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
export const together = (words, last = 'and') => (words.length > 1 ? `${words.slice(0, -1).join(', ')} ${last} ${words.at(-1)}` : words[0] || '');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// What the server keeps but does not run: from its report when it has answered, else the guide's list.
// { topics, escalation, output: [indexes of checks on what it says] }
export function notRunOf(config, unsupported) {
  const g = isObj(config?.guardrails) ? config.guardrails : {};
  if (Array.isArray(unsupported)) return guardNotRun(unsupported);
  return {
    topics: isObj(g.topics) && Object.keys(g.topics).length > 0,
    escalation: list(g.escalation).length > 0,
    output: list(g.output)
      .map((c, i) => (isObj(c) && c.type && c.type !== 'statement' ? i : -1))
      .filter((i) => i >= 0),
  };
}

// each kind of check: its name, its icon, and what it does as a verb ("refuses tricks")
export const KINDS = {
  prompt_injection: { name: 'Refuse tricks', icon: 'shield', verb: 'refuses tricks' },
  pii_detect: { name: 'Personal details', icon: 'eye', verb: 'hides personal details' },
  regex_block: { name: 'Blocked words', icon: 'block', verb: 'watches for blocked words' },
  field_firewall: { name: 'Secret fields', icon: 'lock', verb: 'keeps secret fields out' },
  statement: { name: 'A rule in words', icon: 'quote', verb: 'follows a rule in words' },
};
const ACTION_WORDS = {
  deflect: 'Politely declines',
  redact_in_logs: 'Hides it in the log',
  rewrite: 'Rewrites it away',
  block: 'Blocks it',
  end_call: 'Ends the call',
};
const ENTITY_WORDS = {
  card_number: 'card numbers',
  national_id: 'national ids',
  bank_account: 'bank accounts',
  phone_number: 'phone numbers',
  email: 'emails',
};
const entityWords = (e) => ENTITY_WORDS[e] || String(e).replace(/[_-]+/g, ' ');

// what a check looks for, in a few words
export function looksFor(check) {
  if (!isObj(check)) return '';
  if (check.type === 'pii_detect') return strings(check.entities).length ? together(strings(check.entities).map(entityWords)) : 'nothing chosen yet';
  if (check.type === 'regex_block') return strings(check.patterns).length ? plural(strings(check.patterns).length, 'pattern') : 'no patterns yet';
  if (check.type === 'field_firewall') return strings(check.fields).length ? together(strings(check.fields)) : 'no fields yet';
  if (check.type === 'statement') return typeof check.text === 'string' && check.text.trim() ? `“${clip(check.text.trim(), 50)}”` : 'no words yet';
  if (check.type === 'prompt_injection') return 'attempts to change its instructions';
  return '';
}
// the same, in two or three words (for a chip)
const SHORT = { deflect: 'declines', redact_in_logs: 'hidden in the log', rewrite: 'rewritten', block: 'blocked', end_call: 'ends the call' };
export function doesShort(check) {
  if (!isObj(check)) return '';
  if (check.type === 'field_firewall') return 'kept out';
  if (check.type === 'statement') return 'told to it';
  return SHORT[check.on_trigger?.action] || 'does nothing yet';
}
// what it does when it finds it
export function doesWhat(check) {
  if (!isObj(check)) return '';
  if (check.type === 'field_firewall') return 'Keeps them out of what it sees and says';
  if (check.type === 'statement') return 'Told to the agent';
  return ACTION_WORDS[check.on_trigger?.action] || 'Does nothing yet';
}

// what a check is missing, in words (the schema needs at least one kind, pattern or field, and the words of a rule; the
// guide: a check that blocks with nothing to say is silence on a voice call)
const talks = (config) => list(config?.channels).some((c) => isObj(c) && c.enabled !== false && ['sip_voice', 'web_voice'].includes(c.type));
export function gapOf(check, config) {
  if (!isObj(check)) return '';
  if (check.type === 'pii_detect' && !strings(check.entities).length) return 'It looks for nothing yet: choose the personal details';
  if (check.type === 'regex_block' && !strings(check.patterns).length) return 'No patterns yet: add the words or patterns to look for';
  if (check.type === 'field_firewall' && !strings(check.fields).length) return 'No fields yet: name the fields to keep out';
  if (check.type === 'statement' && !(typeof check.text === 'string' && check.text.trim())) return 'No words yet: write the rule';
  if (check.on_trigger?.action === 'block' && !check.on_trigger.say && talks(config))
    return 'It blocks saying nothing: silence on a call. Give it words to say';
  return '';
}

// every check, on what callers say and on what it says: what it does, where, and what really happens to it
// how: 'run' (checked every time), 'told' (told to the agent only), 'kept' (kept, not run yet)
export function checksIn(config, unsupported) {
  const g = isObj(config?.guardrails) ? config.guardrails : {};
  const nr = notRunOf(config, unsupported);
  return ['input', 'output'].flatMap((where) =>
    list(g[where])
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => isObj(c))
      .map(({ c, i }) => {
        const kind = KINDS[c.type] || { name: humanize(c.type || 'check'), icon: 'shield', verb: 'checks' };
        const how = c.type === 'statement' || c.enforcement === 'prompt' ? 'told' : where === 'output' && nr.output.includes(i) ? 'kept' : 'run';
        return {
          key: typeof c.id === 'string' ? c.id : String(i),
          list: where,
          index: i,
          base: ['guardrails', where, i],
          id: c.id || '',
          type: c.type || '',
          name: c.id ? humanize(c.id) : kind.name,
          kindName: kind.name,
          icon: kind.icon,
          verb: kind.verb,
          looks: looksFor(c),
          does: doesWhat(c),
          short: doesShort(c),
          gap: gapOf(c, config),
          how,
          alsoTold: c.enforcement === 'both',
        };
      }),
  );
}

// the ready-made moments that are on, in words for the sentence and the band
export function momentsOn(config) {
  const m = momentsOf(config);
  return MOMENTS.filter((x) => m[x.id]?.on).map((x) => ({ id: x.id, label: x.label }));
}
// the rules of its own: every escalation rule that isn't one of the ready-made switches
export function ownRules(config) {
  return list(config?.guardrails?.escalation)
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => isObj(r) && !momentOf(r, config))
    .map(({ r, i }) => ({
      key: typeof r.id === 'string' && r.id ? r.id : String(i),
      index: i,
      base: ['guardrails', 'escalation', i],
      name: r.id ? humanize(r.id) : `Rule ${i + 1}`,
      words: ruleWords(r, config),
      when: whenWords(r),
      then: thenWords(r, config),
      gap: whenWords(r) ? '' : 'When isn’t said yet: it never acts',
    }));
}
const FEEL = { frustrated: 'they sound frustrated', negative: 'they are unhappy', abusive: 'they are abusive' };
const COMPARE = { equals: 'is', gte: 'is at least', lte: 'is at most' };
export function whenWords(rule) {
  const w = isObj(rule?.when) ? rule.when : {};
  const parts = [];
  if (typeof w.intent === 'string' && w.intent.trim()) parts.push(`what they want is “${w.intent.trim().replace(/[_-]+/g, ' ')}”`);
  if (strings(w.keywords).length)
    parts.push(
      `they say ${strings(w.keywords)
        .map((k) => `“${k}”`)
        .join(' or ')}`,
    );
  if (w.sentiment) parts.push(FEEL[w.sentiment] || w.sentiment);
  if (typeof w.state === 'string' && w.state) {
    const op = Object.keys(COMPARE).find((k) => w[k] !== undefined);
    parts.push(op ? `it remembers ${w.state} ${COMPARE[op]} ${JSON.stringify(w[op])}` : `it remembers ${w.state}`);
  }
  if (!parts.length) return '';
  const turns = Number(w.consecutive_turns) > 1 ? ` (${w.consecutive_turns} turns in a row)` : '';
  return `${parts.join(' and ')}${turns}`;
}
export function thenWords(rule, config) {
  const words = ruleWords(rule, config);
  return words.includes(': ') ? words.slice(words.indexOf(': ') + 2) : '';
}

// the limits that are set (call length in minutes, silence, tool uses), in words; most moves between agents is on Subagents
const LIMIT_KEYS = ['max_call_duration_s', 'max_silence_s', 'max_tool_calls_per_call'];
const minutes = (s) => {
  if (s < 60) return plural(s, 'second');
  const m = Math.round((s / 60) * 10) / 10;
  return plural(m, 'minute');
};
export function limitsIn(config) {
  const { values, say } = limitsOf(config);
  return LIMIT_KEYS.filter((k) => values[k] !== undefined).map((k) => ({
    key: k,
    label: LIMITS.find((l) => l.key === k)?.label || k,
    words: k === 'max_tool_calls_per_call' ? String(values[k]) : minutes(values[k]),
    value: values[k],
    say,
  }));
}

// the sentence's parts
export function sentenceOf(config, unsupported) {
  const checks = checksIn(config, unsupported);
  const topics = topicsOf(config);
  const moments = momentsOn(config);
  const rules = ownRules(config);
  const limits = limitsIn(config);
  return {
    input: checks.filter((c) => c.list === 'input'),
    output: checks.filter((c) => c.list === 'output'),
    allowed: topics.allowed,
    blocked: topics.blocked,
    offTopic: !!topics.offTopic,
    person: moments.filter((m) => m.id !== 'abusive_end'),
    abusive: moments.some((m) => m.id === 'abusive_end'),
    rules,
    limit: limits.find((l) => l.key === 'max_call_duration_s') || limits[0] || null,
    limits,
  };
}

// the line under the name: "5 checks · 3 topics · 3 moments · 3 limits"
export function summaryLine(config, unsupported, problems = 0) {
  const s = sentenceOf(config, unsupported);
  const checks = s.input.length + s.output.length;
  const moments = s.person.length + (s.abusive ? 1 : 0) + s.rules.length;
  const parts = [
    checks ? plural(checks, 'check') : '',
    s.allowed.length ? plural(s.allowed.length, 'topic') : s.blocked.length ? `${plural(s.blocked.length, 'topic')} off limits` : '',
    moments ? plural(moments, 'rule') : '',
    s.limits.length ? plural(s.limits.length, 'limit') : '',
    problems ? `${problems} ${problems === 1 ? 'needs' : 'need'} a look` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Nothing checked yet';
}
