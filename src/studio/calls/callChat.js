import { describeRecords } from '../trace/records.js';

// A call's records read as a chat: every line in order, said by the caller or by the agent speaking at that moment,
// with how far into the call it was ("00:11"). Where one agent passes the caller to another, a line of its own says so,
// so it is plain which agent said what. Pure: no React.

/** Seconds into the call as "mm:ss" (or "h:mm:ss" past an hour); '' when not known. */
export function clockOf(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '';
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const mm = String(Math.floor((whole % 3600) / 60)).padStart(2, '0');
  const ss = String(whole % 60).padStart(2, '0');
  return hours ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * @param {object[]} records  the call's records, in order (GET /bots/{id}/calls/{call})
 * @returns {{ items: object[], agents: string[], caller: string, turns: number }}
 *   items: { type: 'line', role: 'caller' | 'agent', agent, text, time, interrupted }
 *        | { type: 'handover', from, to, time }
 *   agents: the agent ids that spoke or took over, in order of first appearance
 *   caller: who called, as the records name them ('' when they don't)
 */
export function chatOf(records) {
  const items = [];
  const agents = [];
  let current = '';
  let caller = '';
  const meet = (agent) => {
    if (agent && !agents.includes(agent)) agents.push(agent);
  };

  for (const row of describeRecords(records)) {
    const raw = row.raw || {};
    const time = clockOf(raw.elapsed_s);
    if (row.kind === 'call_started' && raw.caller) caller = String(raw.caller);
    if (row.kind === 'agent_entered') {
      const next = typeof raw.agent === 'string' ? raw.agent : '';
      if (current && next && next !== current) items.push({ type: 'handover', from: current, to: next, time });
      if (next) current = next;
      meet(next);
    }
    if (row.kind === 'user_said' && row.text.trim()) {
      items.push({ type: 'line', role: 'caller', agent: '', text: row.text, time, interrupted: false });
    }
    if (row.kind === 'agent_said' && row.text.trim()) {
      // a line can name its own agent; otherwise it is the one that took over last
      const agent = typeof raw.agent === 'string' && raw.agent ? raw.agent : current;
      meet(agent);
      items.push({ type: 'line', role: 'agent', agent, text: row.text, time, interrupted: !!raw.interrupted });
    }
  }
  const turns = items.filter((item) => item.type === 'line').length;
  return { items, agents, caller, turns };
}
