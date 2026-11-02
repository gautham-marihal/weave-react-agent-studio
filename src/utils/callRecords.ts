// A call as GET /bots/{id}/calls lists it, read into the CallRecord the screens use. One place, so every screen
// says the same about a call. Pure.

import type { CallSummaryItem } from '../api/types';
import type { CallChannel, CallOutcome, CallRecord } from '../types/studio';
import { callerHint } from '../models/calls';

/** ended -> resolved or handed over; unfinished (the log stopped without an end) -> cut off; else still in progress. */
export function callOutcome(status: string, handoffs = 0): CallOutcome {
  if (status === 'ended') return handoffs > 0 ? 'handed_over' : 'resolved';
  if (status === 'unfinished') return 'cut_off';
  return 'in_progress';
}

export function callChannel(channel: CallSummaryItem['channel']): CallChannel {
  const type = typeof channel === 'object' && channel !== null ? channel.type : channel;
  if (type === 'web_chat') return 'web_chat';
  if (type === 'sip_voice' || type === 'phone') return 'phone';
  return 'web_voice';
}

/** draft = a test conversation; an environment name; anything else (a version, "latest") is shown as it is. */
export function callEnvironment(ref: string | undefined): CallRecord['environment'] {
  if (!ref || ref === 'draft') return 'test';
  if (ref === 'development' || ref === 'staging' || ref === 'production') return ref;
  return 'other';
}

export function toCallRecord(c: CallSummaryItem, agentId: string): CallRecord {
  const channelId = typeof c.channel === 'object' && c.channel !== null ? c.channel.id : c.channel;
  return {
    id: c.id,
    agentId: c.bot || agentId,
    channel: callChannel(c.channel),
    environment: callEnvironment(c.ref),
    ref: c.ref,
    version: c.version || 'draft',
    started_at: c.started_at,
    duration_s: c.duration_s || 0,
    outcome: callOutcome(c.status, c.handoffs || 0),
    caller: c.caller || callerHint(c.channel),
    summary: `Call in ${channelId || 'channel'} · ${c.duration_s || 0}s (${c.agent_turns || 0} agent turns)`,
    transcript: [],
    tool_calls: [],
    errors: [],
  };
}

export interface CallSummary {
  calls: number;
  /** Shares of the calls that have ended (hand-over, cut off); null when none has ended. */
  handoverRate: number | null;
  cutoffRate: number | null;
  inProgress: number;
}

/** Counts and rates over a set of calls. Calls still in progress are counted but left out of the rates. */
export function summarizeCalls(calls: CallRecord[]): CallSummary {
  const finished = calls.filter((c) => c.outcome !== 'in_progress');
  const share = (outcome: CallRecord['outcome']) =>
    finished.length ? finished.filter((c) => c.outcome === outcome).length / finished.length : null;
  return {
    calls: calls.length,
    handoverRate: share('handed_over'),
    cutoffRate: share('cut_off'),
    inProgress: calls.length - finished.length,
  };
}
