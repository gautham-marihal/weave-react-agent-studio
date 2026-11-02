// A banking agent's Sandbox test conversation, the parts that are plain data: the words that say what it is, the
// voice bubble's wording and state, the transcript as the Test console shows it, and the call it is kept as when it
// ends. Pure: no React, no DOM, no network. Used by useBankingConversation.

import type { ChatMessage } from '../../types/testConsole';
import type { SandboxConversationWords } from '../../hooks/useTestSession';
import type { BubbleState } from '../../components/agent/test/VoiceBubble';
import type { VoiceStatus } from '../../hooks/useBrowserVoice';
import type { BankingLine } from './useBankingAssistant';

/**
 * What a banking conversation played in this browser says about itself. `source` is where its banking answers come
 * from. In Live it is a rehearsal on the mock bank, and says so first: the real agent is the other choice there.
 */
export function bankingWords(source: string, studio: 'live' | 'sandbox' = 'sandbox'): SandboxConversationWords {
  if (studio === 'live')
    return {
      replyTag: 'Rehearsal',
      replyTagTitle: 'Played by simple rules in your browser, not the real agent; the banking facts come from the mock bank (test data)',
      chip: 'Rehearsal · mock bank',
      intro: `Starts a banking rehearsal with your current edits, on the mock bank: test data and test logins, never a real customer’s accounts (${source}). The agent’s turns are played by simple rules in your browser (no language model); every banking answer comes from the banking gateway’s own tools. To talk to the real agent instead, choose it under “Played by”.`,
      starting: 'Opening a test session on the mock bank…',
      unsaved: 'It uses your current edits, saved or not: nothing is saved first.',
      note: 'A rehearsal on the mock bank: the agent’s turns are played by simple rules in your browser, and banking answers are test data.',
      traceNote: 'These records were made by the rehearsal in the same shape a real call has; the gateway rows are the mock bank gateway’s own timeline.',
    };
  return {
    replyTag: 'Simulated',
    replyTagTitle: 'The agent’s turn is played by simple rules in your browser; the banking facts in it come from the banking gateway',
    chip: 'Sandbox · banking',
    intro: `Starts a banking conversation in Sandbox, with your current edits. The agent’s turns are played by simple rules in your browser (no language model); every banking answer comes from the banking gateway’s tools (${source}). Sign in, choose accounts and confirm on the customer’s device beside the conversation.`,
    starting: 'Opening a banking gateway session…',
    unsaved: 'It uses your current edits, saved or not: nothing is saved first.',
    note: 'The agent’s turns are played by simple rules in your browser. Banking answers come from the banking gateway and say where they came from.',
    traceNote: 'These records were made by the Sandbox conversation in the same shape a real call has; the gateway rows are the banking gateway’s own timeline.',
  };
}

/** The voice bubble's wording when the browser's speech service speaks and listens (no LiveKit, no language model). */
export const VOICE_WORDING: Partial<Record<BubbleState, string>> = {
  idle: 'Start a voice conversation with the banking agent',
  connecting: 'Turning on the microphone',
  listening: 'Speak naturally: balances, transactions, cheques, rates, appointments…',
  thinking: 'Checking with the bank systems',
  tool_execution: 'Calling the banking gateway',
  auth_required: 'Key your PIN, NRIC digits or one-time password on the secure keypad. Secrets are never spoken.',
  speaking: 'The agent is answering',
  muted: 'Unmute to speak; the agent still answers aloud',
  ended: 'Voice is off. You can keep typing',
};

export const VOICE_TITLE = 'Banking voice · your browser’s speech';

/** Said when a voice channel cannot be spoken in this browser, so the conversation is typed instead. */
export function noSpeechNote({ recognition, synthesis }: { recognition: boolean; synthesis: boolean }): string | null {
  if (recognition && synthesis) return null;
  if (!recognition && !synthesis) return 'This browser has no speech support (no speech recognition and no speech synthesis), so this voice conversation is typed: type what the caller says, and read the agent’s replies.';
  if (!recognition) return 'This browser has no speech recognition, so you type what the caller says. The agent’s replies are still spoken.';
  return 'This browser cannot speak (no speech synthesis), so the agent’s replies are shown only. You can still talk to it.';
}

/** The voice bubble's state from the browser voice and the conversation. */
export function bubbleStateOf(voice: { status: VoiceStatus; active: boolean; muted: boolean }, { thinking, secureStep }: { thinking: boolean; secureStep: string | null }): BubbleState {
  if (voice.status === 'error' || voice.status === 'unsupported') return 'error';
  if (voice.status === 'connecting') return 'connecting';
  if (!voice.active) return 'ended';
  if (voice.status === 'speaking') return 'speaking';
  if (secureStep) return 'auth_required';
  if (thinking || voice.status === 'processing') return 'tool_execution';
  return voice.muted ? 'muted' : 'listening';
}

/** The id a line has in the Test console's transcript. */
export const messageId = (callId: string, line: { id: number }) => `${callId}:${line.id}`;

/**
 * The transcript as the Test console shows it: agent lines tagged as simulated turns, the caller's lines with how they
 * were given, and what is being heard right now. Digits heard while an identifier or a secret is asked for show as dots.
 */
export function toChatMessages(callId: string, lines: readonly BankingLine[], heard: { text: string; maskDigits: boolean }): ChatMessage[] {
  const out: ChatMessage[] = lines.map((line) => ({
    id: messageId(callId, line),
    from: line.role === 'assistant' ? 'agent' : line.role === 'customer' ? 'user' : 'system',
    text: line.text,
    ...(line.role === 'customer' && line.via === 'voice' ? { via: 'voice' as const } : line.role === 'customer' && line.via === 'chat' ? { via: 'text' as const } : {}),
    ...(line.role === 'assistant' ? { sandbox: true } : {}),
  }));
  const text = heard.text.trim();
  if (text) out.push({ id: `${callId}:heard`, from: 'user', text: heard.maskDigits ? text.replace(/\d/g, '•') : text, via: 'voice', partial: true });
  return out;
}

/** The label a banking test conversation is kept under on the Calls page. */
export const bankingChannelLabel = (type: string, studio: 'live' | 'sandbox' = 'sandbox') =>
  studio === 'live'
    ? type === 'web_voice'
      ? 'Test: banking voice (rehearsal, mock bank)'
      : 'Test: banking chat (rehearsal, mock bank)'
    : type === 'web_voice'
      ? 'Test: banking voice (Sandbox)'
      : 'Test: banking chat (Sandbox)';
