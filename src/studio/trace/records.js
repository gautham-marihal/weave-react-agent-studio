// The records of a call or test scenario (the same ones, FRONTEND_GUIDE 10.3/10.4) read into rows a person can follow.
// Each record is `{ t, seq, elapsed_s, event, ...fields }`. Pure: no network, no DOM.
// The API may add record kinds, so an unknown record still gets a row (its readable name and fields), never dropped.

import { isObj } from '../form/engine.js';
import { channelName } from '../simple/simpleModel.js';

// "web_chat" → "web chat", "sip_voice" → "phone": a channel as a sentence says it
const channelWords = (type) => {
  const name = channelName(type);
  return name === String(type) ? String(type).replace(/_/g, ' ') : name.toLowerCase();
};

const list = (v) => (Array.isArray(v) ? v : []);
const first = (...values) => values.find((v) => v !== undefined && v !== null && v !== '');

// ---- text
// The API's call log holds UTF-8 read back as Windows-1252 ("Iâ€™m" for "I’m"); the transcript endpoint has it right.
// This fixes a string only when it has that unmistakable pattern, so correct text is never touched.
const CP1252 = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};
const LOOKS_BROKEN = /[ÂÃâ][\u0080-¿ŒœŠšŸŽžƒˆ˜–-›€™]/;
export function fixMojibake(text) {
  if (typeof text !== 'string' || !LOOKS_BROKEN.test(text)) return text;
  try {
    const bytes = Uint8Array.from(
      Array.from(text, (ch) => {
        const code = ch.codePointAt(0);
        const b = code < 0x100 ? code : CP1252[code];
        if (b === undefined) throw new Error('not cp1252');
        return b;
      }),
    );
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return text;
  }
}

// ---- the kinds
export const GROUPS = [
  { id: 'conversation', label: 'Conversation', kinds: ['user_said', 'agent_said'] },
  { id: 'tools', label: 'Tools', kinds: ['tool_called'] },
  { id: 'api', label: 'API requests', kinds: ['http_request'] },
  { id: 'knowledge', label: 'Knowledge', kinds: ['knowledge_search'] },
  { id: 'state', label: 'State', kinds: ['state_changed'] },
  { id: 'tasks', label: 'Tasks', kinds: ['task_started', 'task_step', 'task_finished', 'task_skipped'] },
  { id: 'safety', label: 'Safety rules and limits', kinds: ['guardrail_triggered', 'limit_reached'] },
  { id: 'model', label: 'Model', kinds: ['model_request'] },
  { id: 'lifecycle', label: 'Call', kinds: ['call_started', 'agent_entered', 'session_closed', 'call_ended'] },
  { id: 'errors', label: 'Errors', kinds: ['error'] },
];
export const groupOf = (event) => (GROUPS.find((g) => g.kinds.includes(event)) || { id: 'other' }).id;

const humanize = (name) =>
  String(name || 'event')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());

// "0:12.3" for the seconds since the call began
export function formatElapsed(seconds) {
  if (typeof seconds !== 'number' || Number.isNaN(seconds)) return '';
  const tenths = Math.floor(seconds * 10 + 1e-6); // a clock counts whole tenths up, it does not round
  const whole = Math.floor(tenths / 10);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${tenths % 10}`;
}

const short = (value, max = 160) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text && text.length > max ? `${text.slice(0, max)}…` : (text ?? '');
};
const ms = (r) => {
  const v = first(r.ms, r.duration_ms, r.elapsed_ms);
  return typeof v === 'number' ? v : undefined;
};

// One record as a row: { id, seq, at, kind, group, tone, label, text, facts: [[label, value]], ms, problem, raw }.
//   tone: 'plain' | 'agent' | 'caller' | 'good' | 'bad' | 'muted'
export function describeRecord(record, index = 0) {
  const r = isObj(record) ? record : {};
  const kind = String(r.event || r.kind || 'event');
  const base = {
    id: r.seq ?? index,
    seq: r.seq ?? index + 1,
    at: formatElapsed(r.elapsed_s),
    kind,
    group: groupOf(kind),
    tone: 'plain',
    label: humanize(kind),
    text: '',
    facts: [],
    ms: ms(r),
    problem: false,
    raw: r,
  };
  switch (kind) {
    case 'user_said':
      return { ...base, tone: 'caller', label: 'Caller', text: fixMojibake(String(r.text ?? '')) };
    case 'agent_said':
      return {
        ...base,
        tone: 'agent',
        label: 'Agent',
        text: fixMojibake(String(r.text ?? '')),
        facts: [
          ...(r.interrupted ? [['interrupted', 'yes']] : []),
          ...(isObj(r.timing)
            ? Object.entries(r.timing).map(([k, v]) => [humanize(k).toLowerCase(), typeof v === 'number' ? `${Math.round(v * 1000)} ms` : String(v)])
            : []),
        ],
      };
    case 'tool_called': {
      const error = first(r.error, r.err);
      const result = first(r.result, r.output);
      return {
        ...base,
        label: 'Tool',
        tone: error ? 'bad' : 'plain',
        problem: !!error,
        text: `${r.tool || r.name || 'a tool'}${r.args !== undefined ? `(${short(r.args, 100)})` : '()'}`,
        facts: [...(result !== undefined ? [['returned', short(result)]] : []), ...(error ? [['failed', short(error)]] : [])],
      };
    }
    case 'http_request': {
      const status = r.status;
      const bad = typeof status === 'number' && status >= 400;
      return {
        ...base,
        label: 'API',
        tone: bad ? 'bad' : 'plain',
        problem: bad,
        text: `${r.method || 'GET'} ${first(r.path, r.url, '')}`,
        facts: [
          ...(status !== undefined ? [['status', String(status)]] : []),
          ...(r.mocked === true ? [['answered by', 'a mock']] : []),
          ...(r.connection ? [['connection', String(r.connection)]] : []),
        ],
      };
    }
    case 'knowledge_search': {
      const hits = list(first(r.hits, r.results));
      return {
        ...base,
        label: 'Knowledge',
        text: `“${short(first(r.query, r.q, ''), 100)}”${r.base ? ` in ${r.base}` : ''}`,
        facts: [
          ['found', `${hits.length} passage${hits.length === 1 ? '' : 's'}`],
          ...hits.slice(0, 3).map((h) => [typeof h?.score === 'number' ? `score ${h.score.toFixed(2)}` : 'passage', short(first(h?.source, h?.text, ''), 80)]),
        ],
      };
    }
    case 'state_changed':
      return {
        ...base,
        label: 'State',
        text: `${first(r.name, r.variable, r.key, 'a value')} → ${short(first(r.value, r.new, r.to), 80)}`,
        facts: first(r.old, r.before, r.from) !== undefined ? [['was', short(first(r.old, r.before, r.from), 80)]] : [],
      };
    // a multi-step task (FRONTEND_GUIDE 10.3): started, each step, finished, or skipped (caller already verified)
    case 'task_started':
      return { ...base, label: 'Task', text: `Started “${first(r.task, r.id, 'a task')}”` };
    case 'task_step': {
      const problem = r.passed === false || !!r.error;
      return {
        ...base,
        label: 'Task step',
        tone: problem ? 'bad' : 'plain',
        problem: !!r.error,
        text: `${first(r.task, '')}${first(r.task, '') ? ' · ' : ''}${first(r.step, r.step_id, r.id, 'a step')}`,
        facts: [
          ...(r.passed !== undefined ? [['answer', r.passed ? 'accepted' : 'not accepted']] : []),
          ...(r.attempt !== undefined ? [['attempt', String(r.attempt)]] : []),
          ...(r.error ? [['failed', short(r.error)]] : []),
        ],
      };
    }
    case 'task_finished': {
      const how = String(first(r.outcome, r.result, '') || '');
      return {
        ...base,
        label: 'Task',
        tone: how === 'verified' ? 'good' : how === 'failed' ? 'bad' : 'plain',
        text: `Finished “${first(r.task, r.id, 'a task')}”${how ? ` as ${how}` : ''}`,
      };
    }
    case 'task_skipped':
      return { ...base, tone: 'muted', label: 'Task', text: `Skipped “${first(r.task, r.id, 'a task')}”: already satisfied` };
    // a safety rule caught what the caller said, and a call limit ended the call
    case 'guardrail_triggered':
      return {
        ...base,
        label: 'Safety rule',
        text: `“${first(r.rule, r.id, 'a rule')}” caught what the caller said`,
        facts: [...(r.action ? [['it', String(r.action).replace(/_/g, ' ')]] : []), ...(list(r.kinds).length ? [['found', list(r.kinds).join(', ')]] : [])],
      };
    case 'limit_reached':
      return {
        ...base,
        tone: 'bad',
        problem: true,
        label: 'Limit',
        text: `A call limit ended the call: ${String(first(r.limit, r.name, 'a limit')).replace(/_/g, ' ')}`,
        facts: r.value !== undefined ? [['limit', String(r.value)]] : [],
      };
    case 'model_request':
      return {
        ...base,
        tone: 'muted',
        label: 'Model',
        text: `${r.model || 'the model'} was asked${r.agent ? ` as ${r.agent}` : ''}`,
        facts: [
          ...(r.messages !== undefined ? [['messages', String(r.messages)]] : []),
          ...(list(r.tools).length ? [['tools offered', list(r.tools).join(', ')]] : []),
        ],
      };
    case 'agent_entered':
      return { ...base, tone: 'muted', label: 'Agent', text: `${r.agent || 'An agent'} ${r.first ? 'answers first' : 'takes over'}` };
    case 'call_started':
      return {
        ...base,
        tone: 'muted',
        label: 'Call',
        text: `Started${r.channel?.type ? ` on ${channelWords(r.channel.type)}` : r.channel?.id ? ` on ${r.channel.id}` : ''}`,
        facts: [
          ...(r.caller ? [['caller', String(r.caller)]] : []),
          ...(list(r.not_supported_yet).length
            ? [
                [
                  'not supported yet',
                  list(r.not_supported_yet)
                    .map((x) => short(x, 60))
                    .join('; '),
                ],
              ]
            : []),
        ],
      };
    case 'session_closed': {
      const problem = !!r.error;
      return {
        ...base,
        tone: problem ? 'bad' : 'muted',
        problem,
        label: 'Call',
        text: `Closed${r.reason ? `: ${String(r.reason).replace(/_/g, ' ')}` : ''}`,
        facts: problem ? [['error', short(r.error)]] : [],
      };
    }
    case 'call_ended':
      return {
        ...base,
        tone: 'muted',
        label: 'Call',
        text: `Ended after ${r.duration_s ?? '?'} s`,
        facts: [
          ...(r.caller_turns !== undefined ? [['caller turns', String(r.caller_turns)]] : []),
          ...(r.agent_turns !== undefined ? [['agent turns', String(r.agent_turns)]] : []),
          ...(r.handoffs ? [['handoffs', String(r.handoffs)]] : []),
        ],
      };
    case 'error':
      return {
        ...base,
        tone: 'bad',
        problem: true,
        label: 'Error',
        text: short(first(r.message, r.error, r.detail, 'Something went wrong'), 240),
        facts: r.where ? [['where', String(r.where)]] : [],
      };
    default: {
      // an unknown record: its readable name and other fields (time, order and bookkeeping are shown elsewhere)
      const { t: _t, seq: _seq, elapsed_s: _elapsed, event, kind: _kind, ...rest } = r;
      return {
        ...base,
        label: humanize(kind),
        text: '',
        facts: Object.entries(rest)
          .filter(([, v]) => v !== undefined)
          .slice(0, 6)
          .map(([k, v]) => [k, short(v, 100)]),
      };
    }
  }
}

export const describeRecords = (records) => list(records).map((r, i) => describeRecord(r, i));

// The counts for the filter chips: { conversation: 6, tools: 2, ... , errors: 1 }, every group present.
export function groupCounts(rows) {
  const counts = Object.fromEntries(GROUPS.map((g) => [g.id, 0]));
  counts.other = 0;
  list(rows).forEach((row) => {
    counts[row.group] = (counts[row.group] || 0) + 1;
  });
  return counts;
}

// Rows for the groups turned on (none = all). Unknown kinds are in "other", which is always shown.
export function filterRows(rows, active) {
  const on = new Set(active);
  if (!on.size) return list(rows);
  return list(rows).filter((row) => on.has(row.group) || row.group === 'other');
}

// The conversation alone, from records: [{ role: 'caller' | 'agent', text, at }].
export const conversationOf = (records) =>
  describeRecords(records)
    .filter((r) => r.kind === 'user_said' || r.kind === 'agent_said')
    .map((r) => ({ role: r.kind === 'user_said' ? 'caller' : 'agent', text: r.text, at: r.at }));

// What a trace tells at a glance: how many turns, tools, requests, errors, and how long.
export function traceSummary(records) {
  const rows = describeRecords(records);
  const counts = groupCounts(rows);
  const last = list(records).reduce((m, r) => (typeof r?.elapsed_s === 'number' ? Math.max(m, r.elapsed_s) : m), 0);
  return {
    rows: rows.length,
    said: counts.conversation,
    tools: counts.tools,
    requests: counts.api,
    searches: counts.knowledge,
    errors: rows.filter((r) => r.problem).length,
    seconds: last,
  };
}

// Plain text of a trace, for "Copy": one line per record.
export const traceAsText = (records) =>
  describeRecords(records)
    .map((r) => `${r.at.padStart(7)}  ${r.label.padEnd(9)} ${r.text}${r.facts.length ? `  [${r.facts.map(([k, v]) => `${k}: ${v}`).join('; ')}]` : ''}`)
    .join('\n');

// The state at the end of a call: what `call_ended` carries, else the last value each `state_changed` set.
export function finalStateOf(records) {
  const ended = [...list(records)].reverse().find((r) => r?.event === 'call_ended' && isObj(r.state));
  if (ended) return ended.state;
  const state = {};
  list(records).forEach((r) => {
    if (r?.event === 'state_changed') {
      const name = first(r.name, r.variable, r.key);
      if (name) state[name] = first(r.value, r.new, r.to);
    }
  });
  return state;
}

// The names of the tools a call used, in order of first use.
export const toolsUsedIn = (records) => [
  ...new Set(
    list(records)
      .filter((r) => r?.event === 'tool_called')
      .map((r) => r.tool || r.name)
      .filter(Boolean),
  ),
];
