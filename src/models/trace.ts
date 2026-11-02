// The records of a call or a test conversation (FRONTEND_GUIDE 10.3/10.4: the same records) read into rows a person can
// follow. Each record is `{ t, seq, elapsed_s, event, ...fields }`. Pure: no network, no DOM.
// The API may add record kinds, so an unknown record still gets a row (its readable name and fields), never dropped.

import type { TraceEvent } from '../types/testConsole';

export type CallEventRecord = Record<string, unknown>;

/** How a row reads: what was said by whom, something that went well or badly, or bookkeeping. */
export type RowTone = 'plain' | 'agent' | 'caller' | 'good' | 'bad' | 'muted';

export interface TraceRow {
  id: string;
  seq: number;
  /** "0:12.3", the time since the call began; '' when the record has none. */
  at: string;
  kind: string;
  group: string;
  tone: RowTone;
  label: string;
  text: string;
  facts: Array<[string, string]>;
  ms?: number;
  problem: boolean;
  raw: unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const first = (...values: unknown[]): unknown => values.find((v) => v !== undefined && v !== null && v !== '');
const words = (v: unknown): string => String(v ?? '');

// "web_chat" → "web chat", "sip_voice" → "phone": a channel as a sentence says it
const CHANNEL_WORDS: Record<string, string> = { sip_voice: 'phone', web_voice: 'web voice', web_chat: 'web chat', whatsapp: 'WhatsApp', sms: 'SMS', email: 'email' };
const channelWords = (type: string) => CHANNEL_WORDS[type] ?? type.replace(/_/g, ' ');

// ---- text
// The API's call log can hold UTF-8 read back as Windows-1252 ("Iâ€™m" for "I’m"); the transcript endpoint has it right.
// This fixes a string only when it has that unmistakable pattern, so correct text is never touched.
const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};
const LOOKS_BROKEN = /[ÂÃâ][\u0080-¿ŒœŠšŸŽžƒˆ˜–-›€™]/;

export function fixMojibake<T>(text: T): T {
  if (typeof text !== 'string' || !LOOKS_BROKEN.test(text)) return text;
  try {
    const bytes = Uint8Array.from(
      Array.from(text, (ch) => {
        const code = ch.codePointAt(0) ?? 0;
        const b = code < 0x100 ? code : CP1252[code];
        if (b === undefined) throw new Error('not cp1252');
        return b;
      })
    );
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes) as T;
  } catch {
    return text;
  }
}

// ---- the kinds
export interface TraceGroup {
  id: string;
  label: string;
  kinds: string[];
}

export const GROUPS: TraceGroup[] = [
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
  // Studio's own rows beside the records: the banking gateway's timeline, and notes about the test conversation
  { id: 'gateway', label: 'Banking gateway', kinds: [] },
  { id: 'session', label: 'Test conversation', kinds: [] },
];

export const groupOf = (event: string): string => (GROUPS.find((g) => g.kinds.includes(event)) ?? { id: 'other' }).id;

export const humanize = (name: unknown): string =>
  String(name || 'event')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());

/** "0:12.3" for the seconds since the call began. */
export function formatElapsed(seconds: unknown): string {
  if (typeof seconds !== 'number' || Number.isNaN(seconds)) return '';
  const tenths = Math.floor(seconds * 10 + 1e-6); // a clock counts whole tenths up, it does not round
  const whole = Math.floor(tenths / 10);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${tenths % 10}`;
}

const short = (value: unknown, max = 160): string => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text && text.length > max ? `${text.slice(0, max)}…` : (text ?? '');
};
const msOf = (r: Record<string, unknown>): number | undefined => {
  const v = first(r.ms, r.duration_ms, r.elapsed_ms);
  return typeof v === 'number' ? v : undefined;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One record as a row a person can read. */
export function describeRecord(record: unknown, index = 0): TraceRow {
  const r = isObj(record) ? record : {};
  const kind = String(r.event || r.kind || 'event');
  const seq = typeof r.seq === 'number' ? r.seq : index + 1;
  const base: TraceRow = {
    id: String(r.seq ?? index),
    seq,
    at: formatElapsed(r.elapsed_s),
    kind,
    group: groupOf(kind),
    tone: 'plain',
    label: humanize(kind),
    text: '',
    facts: [],
    ms: msOf(r),
    problem: false,
    raw: r,
  };
  switch (kind) {
    case 'user_said':
      return { ...base, tone: 'caller', label: 'Caller', text: fixMojibake(words(r.text)) };
    case 'agent_said':
      return {
        ...base,
        tone: 'agent',
        label: 'Agent',
        text: fixMojibake(words(r.text)),
        facts: [
          ...(r.interrupted ? [['interrupted', 'yes'] as [string, string]] : []),
          ...(isObj(r.timing)
            ? Object.entries(r.timing).map(([k, v]): [string, string] => [humanize(k).toLowerCase(), typeof v === 'number' ? `${Math.round(v * 1000)} ms` : String(v)])
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
        text: `${words(r.tool || r.name || 'a tool')}${r.args !== undefined ? `(${short(r.args, 100)})` : '()'}`,
        facts: [
          ...(result !== undefined ? [['returned', short(result)] as [string, string]] : []),
          ...(error ? [['failed', short(error)] as [string, string]] : []),
        ],
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
        text: `${words(r.method || 'GET')} ${words(first(r.path, r.url, ''))}`,
        facts: [
          ...(status !== undefined ? [['status', String(status)] as [string, string]] : []),
          ...(r.mocked === true ? [['answered by', 'a mock'] as [string, string]] : []),
          ...(r.connection ? [['connection', String(r.connection)] as [string, string]] : []),
        ],
      };
    }
    case 'knowledge_search': {
      const hits = list(first(r.hits, r.results));
      return {
        ...base,
        label: 'Knowledge',
        text: `“${short(first(r.query, r.q, ''), 100)}”${r.base ? ` in ${words(r.base)}` : ''}`,
        facts: [
          ['found', plural(hits.length, 'passage')],
          ...hits.slice(0, 3).map((h): [string, string] => {
            const hit = isObj(h) ? h : {};
            return [typeof hit.score === 'number' ? `score ${hit.score.toFixed(2)}` : 'passage', short(first(hit.source, hit.text, ''), 80)];
          }),
        ],
      };
    }
    case 'state_changed': {
      const was = first(r.old, r.before, r.from, r.previous);
      return {
        ...base,
        label: 'State',
        text: `${words(first(r.name, r.variable, r.key, 'a value'))} → ${short(first(r.value, r.new, r.to), 80)}`,
        facts: was !== undefined ? [['was', short(was, 80)]] : [],
      };
    }
    // a multi-step task (FRONTEND_GUIDE 10.3): started, each step, finished, or skipped (caller already verified)
    case 'task_started':
      return { ...base, label: 'Task', text: `Started “${words(first(r.task, r.id, 'a task'))}”` };
    case 'task_step': {
      const problem = r.passed === false || !!r.error;
      const task = words(first(r.task, ''));
      return {
        ...base,
        label: 'Task step',
        tone: problem ? 'bad' : 'plain',
        problem: !!r.error,
        text: `${task}${task ? ' · ' : ''}${words(first(r.step, r.step_id, r.id, 'a step'))}`,
        facts: [
          ...(r.passed !== undefined ? [['answer', r.passed ? 'accepted' : 'not accepted'] as [string, string]] : []),
          ...(r.attempt !== undefined ? [['attempt', String(r.attempt)] as [string, string]] : []),
          ...(r.error ? [['failed', short(r.error)] as [string, string]] : []),
        ],
      };
    }
    case 'task_finished': {
      const how = words(first(r.outcome, r.result, ''));
      return {
        ...base,
        label: 'Task',
        tone: how === 'verified' ? 'good' : how === 'failed' ? 'bad' : 'plain',
        text: `Finished “${words(first(r.task, r.id, 'a task'))}”${how ? ` as ${how}` : ''}`,
      };
    }
    case 'task_skipped':
      return { ...base, tone: 'muted', label: 'Task', text: `Skipped “${words(first(r.task, r.id, 'a task'))}”: already satisfied` };
    // a safety rule caught what the caller said, and a call limit ended the call
    case 'guardrail_triggered':
      return {
        ...base,
        label: 'Safety rule',
        text: `“${words(first(r.rule, r.id, 'a rule'))}” caught what the caller said`,
        facts: [
          ...(r.action ? [['it', String(r.action).replace(/_/g, ' ')] as [string, string]] : []),
          ...(list(r.kinds).length ? [['found', list(r.kinds).join(', ')] as [string, string]] : []),
        ],
      };
    case 'limit_reached':
      return {
        ...base,
        tone: 'bad',
        problem: true,
        label: 'Limit',
        text: `A call limit ended the call: ${words(first(r.limit, r.name, 'a limit')).replace(/_/g, ' ')}`,
        facts: r.value !== undefined ? [['limit', String(r.value)]] : [],
      };
    case 'model_request':
      return {
        ...base,
        tone: 'muted',
        label: 'Model',
        text: `${words(r.model || 'the model')} was asked${r.agent ? ` as ${words(r.agent)}` : ''}`,
        facts: [
          ...(r.messages !== undefined ? [['messages', String(r.messages)] as [string, string]] : []),
          ...(list(r.tools).length ? [['tools offered', list(r.tools).join(', ')] as [string, string]] : []),
        ],
      };
    case 'agent_entered':
      return { ...base, tone: 'muted', label: 'Agent', text: `${words(r.agent || 'An agent')} ${r.first ? 'answers first' : 'takes over'}` };
    case 'call_started': {
      const channel = isObj(r.channel) ? r.channel : {};
      return {
        ...base,
        tone: 'muted',
        label: 'Call',
        text: `Started${channel.type ? ` on ${channelWords(String(channel.type))}` : channel.id ? ` on ${words(channel.id)}` : ''}`,
        facts: [
          ...(r.caller ? [['caller', String(r.caller)] as [string, string]] : []),
          ...(list(r.not_supported_yet).length
            ? [['not supported yet', list(r.not_supported_yet).map((x) => short(x, 60)).join('; ')] as [string, string]]
            : []),
        ],
      };
    }
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
          ...(r.caller_turns !== undefined ? [['caller turns', String(r.caller_turns)] as [string, string]] : []),
          ...(r.agent_turns !== undefined ? [['agent turns', String(r.agent_turns)] as [string, string]] : []),
          ...(r.handoffs ? [['handoffs', String(r.handoffs)] as [string, string]] : []),
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
      const rest = Object.entries(r).filter(([k, v]) => !['t', 'seq', 'elapsed_s', 'event', 'kind'].includes(k) && v !== undefined);
      return { ...base, facts: rest.slice(0, 6).map(([k, v]): [string, string] => [k, short(v, 100)]) };
    }
  }
}

export const describeRecords = (records: unknown): TraceRow[] => list(records).map((r, i) => describeRecord(r, i));

/** The counts for the filter chips: { conversation: 6, tools: 2, ... }, every group present, plus `other`. */
export function groupCounts(rows: TraceRow[]): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(GROUPS.map((g) => [g.id, 0]));
  counts.other = 0;
  rows.forEach((row) => {
    counts[row.group] = (counts[row.group] || 0) + 1;
  });
  return counts;
}

/** Rows of the groups turned on (none = all). Unknown kinds are in "other", which is always shown. */
export function filterRows(rows: TraceRow[], active: string[]): TraceRow[] {
  const on = new Set(active);
  if (!on.size) return rows;
  return rows.filter((row) => on.has(row.group) || row.group === 'other');
}

export interface ConversationLine {
  role: 'caller' | 'agent';
  text: string;
  at: string;
  /** Seconds into the call, when the record has it. */
  atS?: number;
  seq: number;
}

/** The conversation alone, from records. */
export const conversationOf = (records: unknown): ConversationLine[] =>
  describeRecords(records)
    .filter((r) => r.kind === 'user_said' || r.kind === 'agent_said')
    .map((r) => {
      const elapsed = (r.raw as Record<string, unknown>).elapsed_s;
      return { role: r.kind === 'user_said' ? 'caller' : 'agent', text: r.text, at: r.at, atS: typeof elapsed === 'number' ? elapsed : undefined, seq: r.seq };
    });

export interface TraceSummary {
  rows: number;
  said: number;
  tools: number;
  requests: number;
  searches: number;
  errors: number;
  seconds: number;
}

/** What rows tell at a glance: how many turns, tools, requests, problems, and how long. */
export function summarizeRows(rows: TraceRow[]): TraceSummary {
  const counts = groupCounts(rows);
  const seconds = rows.reduce((m, row) => {
    const elapsed = isObj(row.raw) ? row.raw.elapsed_s : undefined;
    return typeof elapsed === 'number' ? Math.max(m, elapsed) : m;
  }, 0);
  return {
    rows: rows.length,
    said: counts.conversation,
    tools: counts.tools,
    requests: counts.api,
    searches: counts.knowledge,
    errors: rows.filter((r) => r.problem).length,
    seconds,
  };
}
export const traceSummary = (records: unknown): TraceSummary => summarizeRows(describeRecords(records));

/** One line per row, for "Copy as text". */
export const rowsAsText = (rows: TraceRow[]): string =>
  rows
    .map((r) => `${r.at.padStart(7)}  ${r.label.padEnd(9)} ${r.text}${r.facts.length ? `  [${r.facts.map(([k, v]) => (k ? `${k}: ${v}` : v)).join('; ')}]` : ''}`)
    .join('\n');
export const traceAsText = (records: unknown): string => rowsAsText(describeRecords(records));

/** The state at the end of a call: what `call_ended` carries, else the last value each `state_changed` set. */
export function finalStateOf(records: unknown): Record<string, unknown> {
  const ended = [...list(records)].reverse().find((r) => isObj(r) && r.event === 'call_ended' && isObj(r.state));
  if (isObj(ended) && isObj(ended.state)) return ended.state;
  const state: Record<string, unknown> = {};
  list(records).forEach((r) => {
    if (isObj(r) && r.event === 'state_changed') {
      const name = first(r.name, r.variable, r.key);
      if (name) state[String(name)] = first(r.value, r.new, r.to);
    }
  });
  return state;
}

/** The names of the tools a call used, in order of first use. */
export const toolsUsedIn = (records: unknown): string[] => [
  ...new Set(
    list(records)
      .filter((r): r is Record<string, unknown> => isObj(r) && r.event === 'tool_called')
      .map((r) => words(r.tool || r.name))
      .filter(Boolean)
  ),
];

// ---- the Test stage's trace
// The Test stage keeps its own rows (TraceEvent): records from the call's stream (with `raw`), notes about the test
// conversation itself, and the banking gateway's timeline. They read as rows of the same view.

const EVENT_GROUP: Record<TraceEvent['kind'], string> = {
  session: 'session',
  agent: 'lifecycle',
  llm: 'model',
  tool: 'tools',
  handoff: 'lifecycle',
  form: 'session',
  end: 'lifecycle',
  error: 'errors',
};

const isGateway = (e: TraceEvent) => e.id.startsWith('gw_') || e.label.startsWith('Gateway');

export function rowFromTraceEvent(e: TraceEvent, index = 0): TraceRow {
  const at = formatElapsed(e.at_ms / 1000);
  if (e.raw !== undefined && isObj(e.raw) && (e.raw.event || e.raw.kind)) {
    // a record of the call: read like any other, at the time the conversation saw it
    return { ...describeRecord(e.raw, index), id: e.id, seq: index + 1, at };
  }
  const gateway = isGateway(e);
  const bad = e.status === 'error';
  return {
    id: e.id,
    seq: index + 1,
    at,
    kind: gateway ? 'gateway' : e.kind,
    group: gateway ? 'gateway' : bad ? 'errors' : EVENT_GROUP[e.kind] ?? 'other',
    tone: bad ? 'bad' : e.status === 'ok' ? 'good' : 'muted',
    label: gateway ? 'Gateway' : e.kind === 'error' ? 'Error' : 'Test',
    text: gateway ? e.label.replace(/^Gateway · /, '') : e.label,
    facts: e.detail ? [['', e.detail]] : [],
    problem: bad,
    raw: e,
  };
}

export const rowsFromTraceEvents = (events: TraceEvent[]): TraceRow[] => events.map((e, i) => rowFromTraceEvent(e, i));

/** Rows with what callers said hidden (a screen others can see): only how many words they spoke, in text and raw fields. */
export const withoutCallerWords = (rows: TraceRow[]): TraceRow[] =>
  rows.map((row) => {
    // the caller's number is not shown either
    if (row.kind === 'call_started' && isObj(row.raw) && row.raw.caller)
      return { ...row, facts: row.facts.filter(([k]) => k !== 'caller'), raw: { ...row.raw, caller: '(hidden)' } };
    if (row.kind !== 'user_said') return row;
    const n = row.text.split(/\s+/).filter(Boolean).length;
    return { ...row, text: `Caller spoke (${n} word${n === 1 ? '' : 's'})`, raw: isObj(row.raw) ? { ...row.raw, text: '(hidden)' } : row.raw };
  });
