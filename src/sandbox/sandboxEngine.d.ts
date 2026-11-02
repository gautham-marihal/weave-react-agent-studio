// Types for the generated Sandbox simulations (sandboxEngine.js). Configurations are the agent's JSON (AgentConfig).

export interface SandboxMessage {
  role: 'assistant' | 'user' | 'system';
  text: string;
  /** Always true: a reply made up in the browser, not by the agent's model. */
  simulated?: boolean;
  /** 'notice' for the recording notice said before the greeting. */
  kind?: string;
}

export interface SandboxToolCall {
  tool: string;
  args?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SandboxReply {
  messages: SandboxMessage[];
  toolCalls: SandboxToolCall[];
  handoff: { from?: string; to?: string; [key: string]: unknown } | null;
  ended: boolean;
}

/** An imitation of the agent, answering by simple rules from its configuration. */
export interface SandboxAgent {
  greeting: () => SandboxMessage[];
  reply: (userText: string, options?: { hits?: unknown[] }) => SandboxReply;
  readonly name: string;
  readonly channel: Record<string, unknown> | null;
  readonly currentAgent: string | null;
  readonly state: Record<string, unknown>;
  readonly toolCalls: SandboxToolCall[];
  readonly ended: boolean;
}

export function createSimulatedAgent(config: unknown, options?: { channelId?: string; state?: Record<string, unknown> }): SandboxAgent;
export function speechText(speech: unknown, config: unknown): string;
export function widenQuestion(text: string): string;

/** What the rule-based "Describe it" is, in words for the screen. */
export const ASSISTANT: { kind: string; label: string; isAi: boolean; description: string };
export const MIN_DESCRIPTION: number;
export type DraftResult =
  | { ok: true; config: Record<string, unknown>; summary: string[]; assumptions: string[]; questions: string[]; source: string }
  | { ok: false; problem: string };
export function generateDraft(description: string, base: unknown, options?: { name?: string; company?: string }): DraftResult;

/** A call played again on the imitation agent: the facts a replay compares (see React's replay/callFacts.js). */
export function playSimulated(config: unknown, original: unknown): Record<string, unknown>;
/** The channel a conversation in the browser plays (a wanted id, else the first web one). */
export function chooseSimulatedChannel(config: unknown, wanted?: string): Record<string, unknown> | null;

export function genderOfBrowserVoice(voice: SpeechSynthesisVoice): 'female' | 'male' | null;
export function pickBrowserVoice(
  voices: SpeechSynthesisVoice[],
  wanted: { locale?: string; gender?: string }
): { voice: SpeechSynthesisVoice | null; certain: boolean; pitch?: number };
