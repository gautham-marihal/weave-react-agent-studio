import { describe, expect, it } from 'vitest';
import { ASSISTANT, MIN_DESCRIPTION, generateDraft } from './sandboxEngine.js';
import { minimalConfig, proposeWithRules, summarySentence, RULES_NOTE, RULES_BADGE } from './rulesAssistant';
import { createDemoApi, memoryStorage } from './agentBuilderSandbox.js';
import schema from '../test/fixtures/agent-config.schema.json';
import type { AgentConfig } from '../types/studio';

// Sandbox's "Describe it" (ported from Weave React's tests/draftAssistant.test.js): simple rules, said to be so.
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- the drafts are free-form JSON here
const make = (description: string, options?: { name?: string; company?: string }) => {
  const out = generateDraft(description, minimalConfig('acme-bot', 'Acme bot'), options);
  return out as unknown as { ok: boolean; problem?: string; config: Any; summary: Any; assumptions: string[]; questions: string[] };
};
const sandbox = createDemoApi({ storage: memoryStorage(), loadSchema: async () => schema });
const validate = async (config: unknown) => (await sandbox.handle('POST', '/validate', config)).body as { valid: boolean; errors: unknown[]; warnings: unknown[] };

describe('the rules', () => {
  it('say they are not an AI model, and refuse a description too short to read', () => {
    expect(ASSISTANT.isAi).toBe(false);
    expect(ASSISTANT.description).toMatch(/not an AI model/);
    expect(RULES_BADGE).toMatch(/not AI/);
    expect(RULES_NOTE).toMatch(/not an AI model/);
    const short = make('help people');
    expect(short.ok).toBe(false);
    expect(short.problem).toMatch(/Describe what the agent should do/);
    expect(MIN_DESCRIPTION).toBeGreaterThan('help people'.length);
  });

  it('pick the starter whose words the description uses, and say why', () => {
    const booking = make('An agent that takes appointment bookings for a dental clinic and confirms the time slot.');
    expect(booking.summary.kind).toBe('Booking concierge');
    expect(make('Answers frequently asked questions about our return policy.').summary.kind).toBe('Knowledge guide');
    const vague = make('Something nice that talks to people about stuff.');
    expect(vague.summary.kind).toBe('Customer care');
    expect(vague.assumptions[0]).toMatch(/Nothing in the description says what kind/);
  });

  it('put the description itself into the role, so nothing the author wrote is lost', () => {
    const description = 'A friendly agent for Acme Telecom that helps customers with their bills. Never promise a refund. Always ask for the account number first.';
    const out = make(description);
    expect(out.config.agents.items[0].instructions.role).toContain(description);
    expect(out.config.persona.company).toBe('Acme Telecom');
    expect(out.config.persona.tone).toBe('friendly');
    expect(out.config.agents.items[0].instructions.rules).toEqual(['Never promise a refund.', 'Always ask for the account number first.']);
    expect(out.config.meta.id).toBe('acme-bot');
  });

  it('follow the channels that are said; voice brings speech models and a recording notice', () => {
    expect(make('Customer support on our website chat.').summary.channels).toEqual(['web-chat']);
    const phone = make('Customer support by phone, answering calls about orders.');
    expect(phone.summary.channels).toContain('phone');
    expect(phone.config.persona.disclosures.recording_notice).toMatch(/recorded/);
  });

  it('ask what they cannot decide, and invent no connection', () => {
    const out = make('Customer support that looks up order status in our CRM and takes card numbers.');
    expect(out.questions.some((q) => /Which system/.test(q))).toBe(true);
    expect((out.config.tools ?? []).some((t: Any) => t.type === 'http')).toBe(false);
  });

  it('make a valid configuration every time, the same for the same description, without changing the draft given', async () => {
    const descriptions = [
      'Customer support by phone for Acme Telecom about bills, in Spanish and English. Never guess account details. Transfer to a human if asked.',
      'A front desk that greets visitors on the website chat and routes them.',
      'Books salon appointments over WhatsApp and SMS. Always confirm the time.',
    ];
    for (const d of descriptions) {
      const out = make(d);
      const report = await validate(out.config);
      expect(report.valid, `${d}\n${JSON.stringify(report.errors)}`).toBe(true);
      expect(make(d).config).toEqual(out.config);
    }
    const base = minimalConfig('acme-bot', 'Acme bot');
    const before = JSON.stringify(base);
    generateDraft(descriptions[0], base);
    expect(JSON.stringify(base)).toBe(before);
  });
});

describe('a proposal from the rules', () => {
  const before = { ...minimalConfig('front-desk', 'Front Desk') } as AgentConfig;

  it('is a whole new draft with this agent’s id and name, a summary in words, and the server’s checks', async () => {
    const proposal = await proposeWithRules('A friendly receptionist for a dental clinic that books appointments by phone.', before, {
      validate: async (config) => validate(config) as never,
    });
    const config = proposal.config as unknown as Any;
    expect(config.meta.id).toBe('front-desk');
    expect(proposal.summary).toMatch(/^A first draft of a Booking concierge agent called Front Desk on phone/);
    expect(proposal.assumptions.length).toBeGreaterThan(0);
    expect(proposal.issues.errors).toEqual([]);
    expect(proposal.usage).toEqual({ input: 0, output: 0, cached: 0 });
  });

  it('is refused with the rules’ own words when the description is too short', async () => {
    await expect(proposeWithRules('help people', before, { validate: async () => ({}) })).rejects.toThrow(/Describe what the agent should do/);
  });

  it('is still made when the checks can’t be asked, but a stop stops it', async () => {
    const made = await proposeWithRules('Customer support on our website chat for a shoe shop.', before, { validate: () => Promise.reject(new Error('down')) });
    expect(made.issues).toEqual({ errors: [], warnings: [] });
    const abort = Object.assign(new Error('stopped'), { name: 'AbortError' });
    await expect(proposeWithRules('Customer support on our website chat for a shoe shop.', before, { validate: () => Promise.reject(abort) })).rejects.toThrow('stopped');
  });

  it('is summed up in a sentence', () => {
    expect(summarySentence({ kind: 'Customer care', name: 'Maya', channels: ['phone', 'web-chat'], tone: 'warm' })).toBe(
      'A first draft of a Customer care agent called Maya on phone and web-chat, in a warm tone.'
    );
    expect(summarySentence({})).toBe('A first draft of a support agent.');
  });
});
