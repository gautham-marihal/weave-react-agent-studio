import { describe, expect, it } from 'vitest';
import { chooseSimulatedChannel, createSimulatedAgent } from '../sandboxEngine.js';
import { readCall } from '../../models/replayFacts';
import { traceFromRecord } from '../../utils/testSession';
import { callerHint, channelLabel } from '../../models/calls';
import {
  TEST_CHANNEL_LABEL,
  closingRecords,
  conversationToKeep,
  makeRecord,
  sessionNotification,
  shownChannel,
  stateChanges,
  tabOf,
  versionLabelOf,
  voiceNote,
} from './simulatedConversation';

// Ported from Weave React's tests/simulatedChannel.test.js (UI review 2.10): a simulated conversation is typed text,
// so it is played on a text channel, and it never shows the phone line with a chat's face on it.
const phone = { id: 'phone', type: 'sip_voice', enabled: true, modalities: { input: ['audio'], output: ['audio'] } };
const chat = { id: 'web-chat', type: 'web_chat', enabled: true };
const config = (...channels: object[]) => ({
  persona: { disclosures: { recording_notice: 'This call may be recorded.' } },
  channels,
  agents: { entry: 'a', items: [{ id: 'a' }] },
});
const greetingOn = (cfg: object, id: string) =>
  createSimulatedAgent(cfg, { channelId: id })
    .greeting()
    .map((m) => m.text)
    .join(' ');

describe('the channel a simulated conversation plays', () => {
  it('chooses a text channel before a voice one, whatever order they are in', () => {
    expect(chooseSimulatedChannel(config(phone, chat))).toEqual({ id: 'web-chat', type: 'web_chat', voice: false });
    expect(chooseSimulatedChannel(config(chat, phone))).toEqual({ id: 'web-chat', type: 'web_chat', voice: false });
    expect(chooseSimulatedChannel(config(phone, { id: 'wa', type: 'whatsapp', enabled: true }))?.id).toBe('wa');
  });

  it('skips a channel that is switched off while another is on, and uses one that was asked for', () => {
    expect(chooseSimulatedChannel(config({ ...chat, enabled: false }, phone))?.id).toBe('phone');
    expect(chooseSimulatedChannel(config(chat, phone), 'phone')?.id).toBe('phone');
    expect(chooseSimulatedChannel(config(chat, phone), 'nope')?.id).toBe('web-chat');
  });

  it('plays a voice-only agent on its voice channel, and says so', () => {
    const played = chooseSimulatedChannel(config(phone)) as { id: string; type: string; voice: boolean };
    expect(played).toEqual({ id: 'phone', type: 'sip_voice', voice: true });
    expect(chooseSimulatedChannel(config())).toBeNull();
    expect(voiceNote(played)).toMatch(/no text channel, so it is simulated on its voice channel “phone”/);
    expect(voiceNote(played, 'phone')).toMatch(/Simulated as the voice channel “phone”, written out as text/);
    expect(voiceNote({ id: 'web-chat', type: 'web_chat', voice: false })).toBe('');
  });

  it('greets on chat without the voice-only line, and on the phone with it', () => {
    const both = config(phone, chat);
    expect(greetingOn(both, 'web-chat')).not.toMatch(/may be recorded/);
    expect(greetingOn(both, 'phone')).toMatch(/may be recorded/);
    expect(greetingOn(both, String(chooseSimulatedChannel(both)?.id))).not.toMatch(/may be recorded/);
  });

  it('is shown as typed text, keeping what the channel really is, with pictures when it takes them', () => {
    const withImages = config({ ...chat, modalities: { input: ['text', 'image'] } });
    expect(shownChannel({ id: 'web-chat', type: 'web_chat', voice: false }, withImages)).toEqual({ id: 'web-chat', type: 'web_chat', input: ['text', 'image'], output: ['text'] });
    expect(shownChannel({ id: 'phone', type: 'sip_voice', voice: true }, config(phone))).toEqual({ id: 'phone', type: 'sip_voice', input: ['text'], output: ['text'] });
    expect(shownChannel(null, {}).id).toBe('simulated');
    expect(tabOf('web_voice')).toBe('web_voice');
    expect(tabOf(undefined)).toBe('web_chat');
  });
});

describe('the records a simulated conversation writes', () => {
  it('are numbered and timed like a call log, and the trace reads them', () => {
    const r = makeRecord(3, 1_000, 3_500, 'tool_called', { tool: 'lookup_order', args: { id: 1 }, simulated: true });
    expect(r).toMatchObject({ seq: 3, elapsed_s: 2.5, event: 'tool_called', tool: 'lookup_order' });
    expect(traceFromRecord(r)).toMatchObject({ kind: 'tool', label: 'lookup_order' });
    expect(traceFromRecord(makeRecord(4, 0, 0, 'agent_entered', { agent: 'billing', first: false }))).toMatchObject({ kind: 'handoff' });
  });

  it('say only what changed in what the agent remembers', () => {
    expect(stateChanges({ a: 1, b: null }, { a: 1, b: 'x', c: [1] })).toEqual([
      { variable: 'b', previous: null, value: 'x' },
      { variable: 'c', previous: null, value: [1] },
    ]);
    expect(stateChanges({ a: { x: 1 } }, { a: { x: 1 } })).toEqual([]);
  });

  it('close with how it ended and its totals, which readCall understands', () => {
    const lines = [
      { from: 'agent' as const, text: 'Hello' },
      { from: 'user' as const, text: 'Hi' },
      { from: 'system' as const, text: 'note' },
      { from: 'agent' as const, text: 'Bye' },
    ];
    const [closed, ended] = closingRecords('user', { startedAt: 0, now: 4_000, lines, handoffs: 1, state: { x: 1 } });
    expect(closed).toEqual(['session_closed', { reason: 'participant_disconnected', error: null }]);
    expect(ended[1]).toMatchObject({ duration_s: 4, caller_turns: 1, agent_turns: 2, handoffs: 1, state: { x: 1 } });
    expect(closingRecords('agent', { startedAt: 0, now: 0, lines, handoffs: 0, state: {} })[0][1].reason).toBe('agent');
    const events = [makeRecord(1, 0, 0, 'call_started', { channel: { id: 'web-chat', type: 'web_chat' } }), makeRecord(2, 0, 0, 'user_said', { text: 'Hi' }), makeRecord(3, 0, 0, ended[0], ended[1])];
    expect(readCall(events).turns.map((t) => t.say)).toEqual(['Hi']);
  });
});

describe('keeping a finished conversation as one of the agent’s calls', () => {
  const done = {
    agentId: 'acme',
    agentName: 'Acme',
    ref: 'draft',
    version: 'draft',
    channel: { id: 'web-chat', type: 'web_chat', input: ['text'], output: ['text'] },
    lines: [
      { from: 'agent' as const, text: 'Hello' },
      { from: 'system' as const, text: 'You ended the simulated conversation.' },
      { from: 'user' as const, text: 'Where is my order?' },
      { from: 'user' as const, text: '' },
    ],
    tools: [{ tool: 'lookup_order', args: { id: 1 } }, { tool: 'to_billing', handoff: 'billing' }],
    state: { order: 1 },
    agent: 'billing',
    startedAt: Date.parse('2026-11-02T10:00:00Z'),
    endedAt: Date.parse('2026-11-02T10:00:42Z'),
  };

  it('keeps what was said (not the notes), the tools, the state, under the test channel label', () => {
    expect(conversationToKeep(done)).toEqual({
      startedAt: '2026-11-02T10:00:00.000Z',
      channel: { id: 'web-chat', type: 'web_chat', label: TEST_CHANNEL_LABEL },
      messages: [
        { role: 'assistant', text: 'Hello' },
        { role: 'user', text: 'Where is my order?' },
      ],
      tools: [
        { tool: 'lookup_order', args: { id: 1 } },
        { tool: 'to_billing', args: {}, handoff: 'billing' },
      ],
      state: { order: 1 },
      agent: 'billing',
      version: 'draft',
    });
    expect(TEST_CHANNEL_LABEL).toBe('Test: simulated chat');
  });

  it('keeps nothing when nothing was said', () => {
    expect(conversationToKeep({ ...done, lines: [{ from: 'system', text: 'note' }] })).toBeNull();
  });

  it('is named on the Calls page by its label, and calls without one as before', () => {
    const kept = conversationToKeep(done)?.channel as { id: string; type: string };
    expect(channelLabel(kept)).toBe(TEST_CHANNEL_LABEL);
    expect(callerHint(kept)).toBe(TEST_CHANNEL_LABEL);
    expect(channelLabel({ id: 'web-chat', type: 'web_chat' })).toBe('Web chat');
    expect(callerHint({ id: 'web-chat', type: 'web_chat' })).toBe('Web visitor');
    expect(callerHint({ id: 'phone', type: 'sip_voice' })).toBe('No number');
  });

  it('tells the bell as Weave React did: a test conversation, or a simulated phone call', () => {
    expect(sessionNotification({ agentName: 'Acme', channelLabel: TEST_CHANNEL_LABEL, durationS: 42, versionLabel: 'Draft', userMessages: 1 })).toEqual({
      title: 'Acme had a test conversation',
      description: '42 s on Draft, 1 message. Simulated in Sandbox, and kept with its calls.',
    });
    expect(sessionNotification({ agentName: 'Acme', channelLabel: 'Phone (inbound)', durationS: 75, versionLabel: 'Draft', userMessages: 3 })).toEqual({
      title: 'Acme answered a simulated call',
      description: '1 min 15 s talk time after 0 s on hold.',
    });
    expect(versionLabelOf('draft')).toBe('Draft');
    expect(versionLabelOf('0.1.1')).toBe('Version 0.1.1');
  });
});
