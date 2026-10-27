// Call records for the Calls screen: status words, time range to `since`, filters to a query, and merging several
// agents' pages (the API lists calls one agent at a time). Pure: no network, no DOM.

const list = (v) => (Array.isArray(v) ? v : []);

// ended: finished and closed; in_progress: written to in the last two minutes;
// unfinished: the log stops with no ending (the worker died, or the call was cut off)
export const CALL_STATUS = {
  ended: { label: 'Ended', tone: 'good', hint: 'The call finished.' },
  in_progress: { label: 'In progress', tone: 'warn', hint: 'Something was written to this call in the last two minutes.' },
  unfinished: { label: 'Cut off', tone: 'bad', hint: 'The record stops without an ending: the worker stopped, or the call was cut off.' },
};
export const statusOf = (status) => CALL_STATUS[status] || { label: status || 'Unknown', tone: 'idle', hint: '' };

// How a call went, in a word: still going, cut off, passed to a person, or handled by the agent itself.
// `status` is the API's filter; it calls handled and passed-on both "ended", so the list splits them by hand-overs.
export const OUTCOMES = {
  handled: { label: 'Handled', tone: 'good', status: 'ended', hint: 'The agent finished the call itself.' },
  handoff: { label: 'Passed to a person', tone: 'info', status: 'ended', hint: 'The agent handed the caller over to a person.' },
  cutoff: { label: 'Cut off', tone: 'bad', status: 'unfinished', hint: CALL_STATUS.unfinished.hint },
  progress: { label: 'In progress', tone: 'warn', status: 'in_progress', hint: CALL_STATUS.in_progress.hint },
};
export function outcomeOf(call) {
  if (call?.status === 'in_progress') return 'progress';
  if (call?.status === 'unfinished') return 'cutoff';
  if (call?.status === 'ended') return (call?.handoffs || 0) > 0 ? 'handoff' : 'handled';
  return '';
}

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
  // rounded first, so 119.6 s is 2 min (not "1 min 60 s")
  const total = Math.round(seconds);
  if (total < 60) return `${total} s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
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
    // who called, when the call has no number: a visitor of a web channel, else a number that was withheld
    callerHint: call?.caller ? '' : /web|chat|widget/.test(String(call?.channel?.type || call?.channel || '')) ? 'Web visitor' : 'No number',
    channel: channelLabel(call?.channel),
    duration: formatSeconds(call?.duration_s),
    turns: turnsOf(call),
    handoffs: call?.handoffs ?? 0,
    statusLabel: s.label,
    tone: s.tone,
    hint: s.hint,
    outcome: outcomeOf(call),
    outcomeLabel: OUTCOMES[outcomeOf(call)]?.label || s.label,
    outcomeTone: OUTCOMES[outcomeOf(call)]?.tone || s.tone,
    outcomeHint:
      outcomeOf(call) === 'handoff' && (call?.handoffs || 0) > 1
        ? `The agent handed the caller over ${call.handoffs} times.`
        : OUTCOMES[outcomeOf(call)]?.hint || s.hint,
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

// What a call's records were, in words: "12 records: 3 from the caller, 3 from the agent, 2 tool calls". `counts` is
// the server's tally per kind of record.
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

// Several agents' calls, newest first, with no gap. An agent with more to send has sent only its newest, so below its
// oldest, others' calls could show while its own are still to come. The list stops at the newest such point; older
// calls come with "Load more".
//   pages: every page so far ({ id, calls }); more: the ids of the agents with more to send
export function callsWithoutGaps(pages, more) {
  const all = mergeCalls(pages);
  let cutoff = -Infinity;
  list(more).forEach((id) => {
    const times = list(pages)
      .filter((p) => p?.id === id)
      .flatMap((p) => list(p.calls))
      .map((c) => Date.parse(c?.started_at || ''))
      .filter(Number.isFinite);
    if (times.length) cutoff = Math.max(cutoff, Math.min(...times));
  });
  return cutoff === -Infinity ? all : all.filter((c) => Date.parse(c?.started_at || 0) >= cutoff);
}
