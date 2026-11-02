// Home's words and numbers: the greeting, the line under it, which agent "Next step" is about, and the test
// conversations had in the studio. Pure: no React, no network.

import type { CallSummaryItem } from '../api/types';

/** "Good morning" before noon, "Good afternoon" until six, then "Good evening". */
export function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** The line under the greeting: how many agents, how many published. */
export function workspaceLine({ agents, published, workspaceName }: { agents: number; published: number; workspaceName?: string }): string {
  if (agents === 0) return 'Your workspace is ready. Start by creating an agent.';
  const where = workspaceName ? ` in ${workspaceName}` : '';
  return `${agents} agent${agents === 1 ? '' : 's'}${where}, ${published} published.`;
}

/**
 * The agent "Next step" is about: the one chosen on Home, else the one opened last, else the one saved most recently.
 * An id that no longer names an agent is passed over.
 */
export function focusAgent<T extends { id: string; savedAt: string }>(agents: T[], chosen: string, remembered: string): T | undefined {
  return (
    agents.find((a) => a.id === chosen) ??
    agents.find((a) => a.id === remembered) ??
    [...agents].sort((a, b) => (Date.parse(b.savedAt) || 0) - (Date.parse(a.savedAt) || 0))[0]
  );
}

/** A call of the draft (the Test page's conversations): its ref is "draft" or none. */
export const isTestConversation = (call: Pick<CallSummaryItem, 'ref'>): boolean => !call.ref || call.ref === 'draft' || call.ref === 'test';

export interface ConversationStats {
  count: number;
  /** Average length in seconds (0 when there are none). */
  avgSec: number;
  minutes: number;
  /** What the person said or typed (the caller's turns). */
  messages: number;
}

/** Counts over the test conversations that started in the last `days` days. */
export function testConversationStats(calls: CallSummaryItem[], days: number, now: number): ConversationStats {
  const since = now - days * 86_400_000;
  const mine = calls.filter((c) => isTestConversation(c) && (Date.parse(c.started_at) || 0) >= since);
  const totalSec = mine.reduce((sum, c) => sum + (Number(c.duration_s) || 0), 0);
  return {
    count: mine.length,
    avgSec: mine.length ? totalSec / mine.length : 0,
    minutes: totalSec / 60,
    messages: mine.reduce((sum, c) => sum + (Number(c.caller_turns) || 0), 0),
  };
}

/** Minutes as a short number: "0.5", "4", "12". */
export const minutesText = (minutes: number): string =>
  minutes >= 10 ? String(Math.round(minutes)) : minutes.toFixed(1).replace(/\.0$/, '');
