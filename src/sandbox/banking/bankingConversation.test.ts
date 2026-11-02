import { describe, expect, it } from 'vitest';
import { bankingChannelLabel, bankingWords, bubbleStateOf, noSpeechNote, toChatMessages } from './bankingConversation';
import type { BankingLine } from './useBankingAssistant';

const line = (id: number, role: BankingLine['role'], text: string, extra: Partial<BankingLine> = {}): BankingLine => ({ id, role, text, at: id, ...extra });

describe('a banking conversation in Sandbox', () => {
  it('says the agent’s turns are simulated and where banking answers come from', () => {
    const words = bankingWords('Sandbox · banking gateway in this browser, mock bank systems');
    expect(words.replyTag).toBe('Simulated');
    expect(words.intro).toMatch(/simple rules in your browser/);
    expect(words.intro).toContain('banking gateway in this browser, mock bank systems');
  });

  it('shows agent lines as simulated turns, the caller’s with how they were given, and masks digits heard during sign-in', () => {
    const shown = toChatMessages('c1', [line(1, 'assistant', 'Hello'), line(2, 'customer', 'balance', { via: 'chat' }), line(3, 'customer', 'Phone Code •••4567', { via: 'voice', secure: true }), line(4, 'system', 'Ended')], {
      text: 'one 2 3',
      maskDigits: true,
    });
    expect(shown.map((m) => [m.from, m.via ?? null, m.sandbox ?? false])).toEqual([
      ['agent', null, true],
      ['user', 'text', false],
      ['user', 'voice', false],
      ['system', null, false],
      ['user', 'voice', false],
    ]);
    expect(shown[4]).toMatchObject({ text: 'one • •', partial: true });
    expect(shown[0]?.id).toBe('c1:1');
  });

  it('says plainly when the browser cannot speak or listen', () => {
    expect(noSpeechNote({ recognition: true, synthesis: true })).toBeNull();
    expect(noSpeechNote({ recognition: false, synthesis: false })).toMatch(/no speech support/);
    expect(noSpeechNote({ recognition: false, synthesis: true })).toMatch(/no speech recognition, so you type/);
    expect(noSpeechNote({ recognition: true, synthesis: false })).toMatch(/cannot speak/);
  });

  it('shows the voice state, asking for the keypad while a secret is due', () => {
    const on = { status: 'listening' as const, active: true, muted: false };
    expect(bubbleStateOf(on, { thinking: false, secureStep: null })).toBe('listening');
    expect(bubbleStateOf(on, { thinking: false, secureStep: 'pin' })).toBe('auth_required');
    expect(bubbleStateOf(on, { thinking: true, secureStep: null })).toBe('tool_execution');
    expect(bubbleStateOf({ ...on, status: 'speaking' }, { thinking: false, secureStep: 'pin' })).toBe('speaking');
    expect(bubbleStateOf({ ...on, active: false, status: 'idle' }, { thinking: false, secureStep: null })).toBe('ended');
    expect(bubbleStateOf({ ...on, status: 'error' }, { thinking: false, secureStep: null })).toBe('error');
  });

  it('is kept on the Calls page under a banking test label', () => {
    expect(bankingChannelLabel('web_chat')).toBe('Test: banking chat (Sandbox)');
    expect(bankingChannelLabel('web_voice')).toBe('Test: banking voice (Sandbox)');
  });

  it('in Live it is a rehearsal on the mock bank, and says so wherever it is named', () => {
    const words = bankingWords('Mock bank · banking gateway in this browser, test data only', 'live');
    expect(words.chip).toBe('Rehearsal · mock bank');
    expect(words.replyTag).toBe('Rehearsal');
    expect(words.intro).toMatch(/mock bank: test data and test logins, never a real customer’s accounts/);
    expect(words.intro).toMatch(/“Played by”/);
    expect(`${words.chip} ${words.intro} ${words.note}`).not.toMatch(/Sandbox/);
    expect(bankingChannelLabel('web_chat', 'live')).toBe('Test: banking chat (rehearsal, mock bank)');
    expect(bankingChannelLabel('web_voice', 'live')).toBe('Test: banking voice (rehearsal, mock bank)');
  });
});
