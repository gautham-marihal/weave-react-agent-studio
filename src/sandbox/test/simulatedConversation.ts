// Sandbox's simulated test conversation, the parts that are plain data: which channel it shows, the words that say it
// is simulated, the call records it writes (the same shape a real call's log has, so the trace and "make a scenario"
// read it as they read a real one), the conversation kept as one of the agent's calls when it ends, and the
// notification that says so. Pure: no React, no DOM, no storage. Ported from Weave React's studio/test/useSimulatedSession.js
// and AgentWorkspace.jsx (handleFinished).

import type { ChannelSpec } from '../../api/types';
import type { ChannelType } from '../../types/studio';

/** The channel label a simulated test conversation is kept under on the Calls page (as Weave React labels it). */
export const TEST_CHANNEL_LABEL = 'Test: simulated chat';

/** How long the imitation "thinks" before each reply, and before the greeting. */
export const THINK_MS = 380;
export const OPEN_MS = 250;

/** The words a simulated conversation shows where a real one talks about LiveKit and the runtime. */
export const SIMULATED_WORDS = {
  replyTag: 'Simulated',
  replyTagTitle: 'Made up by a simulation in your browser, not by the real agent',
  chip: 'Simulated · Sandbox',
  intro:
    'Starts a simulated conversation in your browser: made-up replies from simple rules, using your current edits. It is not the agent running, so tools and hand-offs are only imitated.',
  starting: 'Starting a simulated conversation (no server, no real agent)…',
  unsaved: 'It uses your current edits, saved or not: nothing is saved first.',
  note: 'Replies in this conversation are made up in your browser by simple rules. Nothing here is the real agent or its models.',
  traceNote: 'These records were made by the simulated conversation, in the same shape a real call has. No runtime wrote them.',
} as const;
export type SimulatedWords = typeof SIMULATED_WORDS;

/** The channel the imitation plays, as `chooseSimulatedChannel` gives it. */
export interface PlayedChannel {
  id: string;
  type: string;
  voice: boolean;
}

const VOICE = ['sip_voice', 'web_voice'];
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * What the conversation's channel is, for the screen: typed text in and out (a simulation has no microphone), plus
 * pictures when the channel takes them. `type` is what it really is, never a phone line drawn as a chat.
 */
export function shownChannel(played: PlayedChannel | null, config: unknown): ChannelSpec {
  const channels = isObj(config) ? list(config.channels).filter(isObj) : [];
  const cfg = played ? channels.find((c) => c.id === played.id) : undefined;
  const inputs = isObj(cfg?.modalities) ? list(cfg.modalities.input) : [];
  return {
    id: played?.id || 'simulated',
    type: played?.type || 'web_chat',
    input: ['text', ...(inputs.includes('image') ? ['image'] : [])],
    output: ['text'],
  };
}

/** The tab a conversation belongs to on the Test page: the one it was started from, else chat. */
export function tabOf(asked: ChannelType | undefined): ChannelType {
  return asked === 'web_voice' ? 'web_voice' : 'web_chat';
}

/** Said at the start when the conversation plays a voice channel as text ('' when it plays a text channel). */
export function voiceNote(played: PlayedChannel | null, askedId?: string): string {
  if (!played?.voice) return '';
  return askedId === played.id
    ? `Simulated as the voice channel “${played.id}”, written out as text: a simulation has no microphone.`
    : `This agent has no text channel, so it is simulated on its voice channel “${played.id}”, written out as text.`;
}

/** Whether a channel type is spoken (shown as text in a simulation). */
export const isVoiceType = (type: unknown): boolean => VOICE.includes(String(type));

/** One record of what happened, in the shape of the API's call log: { t, seq, elapsed_s, event, ...fields }. */
export type CallLogRecord = Record<string, unknown> & { t: string; seq: number; elapsed_s: number; event: string };

export function makeRecord(seq: number, startedAt: number, now: number, event: string, fields: Record<string, unknown> = {}): CallLogRecord {
  return { t: new Date(now).toISOString(), seq, elapsed_s: Math.round(Math.max(0, now - startedAt)) / 1000, event, ...fields };
}

/** What the imitation remembers that changed in one turn, as `state_changed` records' fields. */
export function stateChanges(before: Record<string, unknown>, after: Record<string, unknown>): { variable: string; previous: unknown; value: unknown }[] {
  return Object.keys(after)
    .filter((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))
    .map((key) => ({ variable: key, previous: before[key] ?? null, value: after[key] ?? null }));
}

export interface SpokenLine {
  from: 'agent' | 'user' | 'system';
  text: string;
}

/** The records that close the log: how it closed, and the call's totals. */
export function closingRecords(
  reason: 'user' | 'agent' | 'closed',
  { startedAt, now, lines, handoffs, state }: { startedAt: number; now: number; lines: SpokenLine[]; handoffs: number; state: Record<string, unknown> },
): [string, Record<string, unknown>][] {
  const spoken = lines.filter((m) => m.from !== 'system' && m.text);
  return [
    ['session_closed', { reason: reason === 'user' ? 'participant_disconnected' : reason, error: null }],
    [
      'call_ended',
      {
        duration_s: Math.round((now - startedAt) / 1000),
        caller_turns: spoken.filter((m) => m.from === 'user').length,
        agent_turns: spoken.filter((m) => m.from === 'agent').length,
        handoffs,
        usage: [],
        state,
      },
    ],
  ];
}

export interface FinishedConversation {
  agentId: string;
  agentName: string;
  /** The ref talked to ("draft", "latest", an environment) and the version that answered ("draft" for the draft). */
  ref: string;
  version: string;
  channel: ChannelSpec;
  /** The label it is kept under on the Calls page (default "Test: simulated chat"). */
  channelLabel?: string;
  lines: SpokenLine[];
  tools: { tool: string; args?: Record<string, unknown>; handoff?: string }[];
  state: Record<string, unknown>;
  agent: string;
  startedAt: number;
  endedAt: number;
}

/**
 * The conversation as Sandbox keeps it among the agent's calls (`sandboxRecordConversation`), or null when nothing was
 * said. Its channel carries the label the Calls page shows ("Test: simulated chat").
 */
export function conversationToKeep(done: FinishedConversation): Record<string, unknown> | null {
  const messages = done.lines.filter((m) => m.from !== 'system' && m.text).map((m) => ({ role: m.from === 'user' ? 'user' : 'assistant', text: m.text }));
  if (!messages.length) return null;
  return {
    startedAt: new Date(done.startedAt).toISOString(),
    channel: { id: done.channel.id, type: done.channel.type, label: done.channelLabel ?? TEST_CHANNEL_LABEL },
    messages,
    tools: done.tools.map((t) => ({ tool: t.tool, args: t.args ?? {}, ...(t.handoff ? { handoff: t.handoff } : {}) })),
    state: done.state,
    agent: done.agent,
    version: done.version || 'draft',
  };
}

const talkTime = (seconds: number, least = 1): string => {
  const s = Math.max(least, Math.round(seconds));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`;
};

/**
 * The bell's line for a finished simulated session (Weave React's Dashboard recordSession): a phone session "answered
 * a simulated call", a test conversation "had a test conversation".
 */
export function sessionNotification({
  agentName,
  channelLabel,
  durationS,
  versionLabel,
  userMessages,
  holdS = 0,
}: {
  agentName: string;
  channelLabel: string;
  durationS: number;
  versionLabel: string;
  userMessages: number;
  holdS?: number;
}): { title: string; description: string } {
  if (channelLabel.startsWith('Phone'))
    return { title: `${agentName} answered a simulated call`, description: `${talkTime(durationS)} talk time after ${talkTime(holdS, 0)} on hold.` };
  return {
    title: `${agentName} had a test conversation`,
    description: `${talkTime(durationS)} on ${versionLabel}, ${userMessages} message${userMessages === 1 ? '' : 's'}. Simulated in Sandbox, and kept with its calls.`,
  };
}

/** "Draft", or "Version 0.1.1", as the notification names what was talked to. */
export const versionLabelOf = (version: string): string => (!version || version === 'draft' ? 'Draft' : `Version ${version}`);
