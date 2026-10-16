// Reading call records for the Calls screen: how a status is worded, how a time range becomes the API's `since`, how the filters become a
// query, and how the pages of several agents are merged into one list. The API lists calls one agent at a time, so "all agents" asks each
// agent and merges here. Pure: no network, no DOM.

const list = (v) => (Array.isArray(v) ? v : []);

// ended: the call finished and was closed; in_progress: written to in the last two minutes; unfinished: the log stops with no ending
// (the worker died, or the call was cut off).
export const CALL_STATUS = {
  ended: { label: 'Ended', tone: 'good', hint: 'The call finished.' },
  in_progress: { label: 'In progress', tone: 'warn', hint: 'Something was written to this call in the last two minutes.' },
  unfinished: { label: 'Cut off', tone: 'bad', hint: 'The record stops without an ending: the worker stopped, or the call was cut off.' },
};
export const statusOf = (status) => CALL_STATUS[status] || { label: status || 'Unknown', tone: 'idle', hint: '' };

export const RANGES = [
  { id: '24h', label: 'Past 24 hours', hours: 24 },
  { id: '7d', label: 'Past 7 days', hours: 24 * 7 },
  { id: '30d', label: 'Past 30 days', hours: 24 * 30 },
  { id: 'all', label: 'All time', hours: null },
];
export const sinceFor = (rangeId, nowMs = Date.now()) => {
  const r = RANGES.find((x) => x.id === rangeId);
  return r?.hours ? new Date(nowMs - r.hours * 3600 * 1000).toISOString() : undefined;
};

// The filters of the screen -> the query of GET /bots/{id}/calls.
export function queryFor({ range = '7d', caller = '', channel = '', status = '' } = {}, { limit = 25, cursor, nowMs } = {}) {
  return {
    limit,
    cursor,
    since: sinceFor(range, nowMs),
    caller: String(caller || '').trim() || undefined,
    channel: channel || undefined,
    status: status || undefined,
  };
}

export function formatSeconds(seconds) {
  if (typeof seconds !== 'number' || Number.isNaN(seconds)) return '';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min${s ? ` ${s} s` : ''}`;
}

export const channelLabel = (channel) => {
  const type = channel?.type;
  const names = { sip_voice: 'Phone', web_voice: 'Web voice', web_chat: 'Web chat', whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email' };
  return names[type] || channel?.id || type || '';
};

export const turnsOf = (call) => `${call?.caller_turns ?? 0} / ${call?.agent_turns ?? 0}`;

// One row for the table, with the agent's name when it is known.
export function rowOf(call, botName) {
  const s = statusOf(call?.status);
  return {
    id: call?.id,
    bot: call?.bot,
    botName: botName || call?.bot || '',
    startedAt: call?.started_at,
    caller: call?.caller || '',
    channel: channelLabel(call?.channel),
    duration: formatSeconds(call?.duration_s),
    turns: turnsOf(call),
    handoffs: call?.handoffs ?? 0,
    statusLabel: s.label,
    tone: s.tone,
    hint: s.hint,
    version: call?.version || '',
    ref: call?.ref || '',
    raw: call,
  };
}

// Pages from several agents -> one list, newest first, with the same call never twice.
export function mergeCalls(pages) {
  const seen = new Set();
  const out = [];
  list(pages)
    .flatMap((p) => list(p?.calls))
    .sort((a, b) => Date.parse(b?.started_at || 0) - Date.parse(a?.started_at || 0))
    .forEach((c) => {
      const key = `${c.bot}/${c.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(c);
      }
    });
  return out;
}

export const ALL_AGENTS_LIMIT = 30; // asking every agent is one request each: past this many, the screen asks the user to choose one
export const PER_AGENT_PAGE = 25;

// The distinct channels seen in some calls, for the channel filter.
export const channelsIn = (calls) => [
  ...new Map(
    list(calls)
      .map((c) => [c?.channel?.id, c?.channel])
      .filter(([id]) => id),
  ).values(),
];

// NDJSON of a call's records, for "Download" in demo mode (the real API serves its own file).
export const ndjson = (events) =>
  `${list(events)
    .map((e) => JSON.stringify(e))
    .join('\n')}\n`;

// What a call's records were, in words: "12 records: 3 from the caller, 3 from the agent, 2 tool calls". `counts` is the server's tally per kind of record.
const COUNT_WORDS = {
  user_said: ['from the caller', 'from the caller'],
  agent_said: ['from the agent', 'from the agent'],
  tool_called: ['tool call', 'tool calls'],
  http_request: ['API request', 'API requests'],
  knowledge_search: ['knowledge search', 'knowledge searches'],
  state_changed: ['state change', 'state changes'],
  error: ['error', 'errors'],
};
export function countsLine(counts) {
  const entries = Object.entries(counts && typeof counts === 'object' ? counts : {}).filter(([, n]) => typeof n === 'number' && n > 0);
  if (!entries.length) return '';
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  const known = Object.keys(COUNT_WORDS)
    .filter((kind) => entries.some(([k]) => k === kind))
    .map((kind) => {
      const n = counts[kind];
      const [one, many] = COUNT_WORDS[kind];
      return `${n} ${n === 1 ? one : many}`;
    });
  return `${total} record${total === 1 ? '' : 's'}${known.length ? `: ${known.join(', ')}` : ''}`;
}
