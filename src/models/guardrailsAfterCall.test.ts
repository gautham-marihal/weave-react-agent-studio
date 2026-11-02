import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../types/studio';
import { starters } from '../data/starters';
import { unknownKeys } from '../test/schemaKeys';
import { applyStarter } from './setup';
import { LIMITS, checkWords, endingTools, limitsOf, momentsOf, previewWords, readGuardrailPreview, ruleWords, setLimit, setLimitSay, setMoment, setMomentWords, setOffTopic, setTopics, topicsOf } from './guardrails';
import { addQuestion, afterCallOf, entityLabel, notDoneYet, readRedactionPreview, recordsInWords, removeQuestion, setLog, setNotice, setQuestion, setRecording, setRedaction, setSummary } from './afterCall';

const bare = (): AgentConfig => ({
  schema_version: '1.2',
  meta: { id: 'a', name: 'A', version: '0.1.0', status: 'draft' },
  runtime: { engine: 'livekit-agents', provider_mode: 'plugins' },
  defaults: { models: { llm: { provider: 'openai', model: 'gpt-4.1-mini' } } },
  persona: { name: 'A', tone: 'warm' },
  channels: [{ id: 'web-chat', type: 'web_chat', enabled: true, modalities: { input: ['text'], output: ['text'] }, greeting: { say: 'Hi' } }],
  agents: { entry: 'assistant', items: [{ id: 'assistant', name: 'A', kind: 'standalone', instructions: { role: 'Help.' }, tools: [] }] },
});
const care = () => applyStarter(bare(), { company: 'Acme', starter: starters[0] });
// The kinds GET /redaction/entities returned on the live API (2026-10-26).
const KNOWN = ['card_number', 'bank_account', 'national_id', 'phone_number', 'email', 'date_of_birth', 'otp', 'pin'];

describe('guardrails: topics', () => {
  it('kept to and stayed away from, tidied, and gone when emptied', () => {
    let c = setTopics(bare(), 'allowed', [' orders ', 'orders', '', 'deliveries']);
    c = setTopics(c, 'blocked', ['medical advice']);
    expect(topicsOf(c)).toEqual({ allowed: ['orders', 'deliveries'], blocked: ['medical advice'], offTopic: null });
    expect(unknownKeys(c)).toEqual([]);
    c = setTopics(c, 'allowed', []);
    c = setTopics(c, 'blocked', []);
    expect(c.guardrails).toBeUndefined();
  });

  it('going off topic ends in one of its tools, named in words; no tool, no rule', () => {
    const tools = endingTools(care());
    expect(tools.map((t) => t.label)).toEqual(['End the conversation', 'Pass them to a person']);
    let c = setOffTopic(care(), { strikes: 3, then: tools[0].id, say: 'Let me stop here. ' });
    expect(c.guardrails?.topics?.on_off_topic).toEqual({ max_strikes: 3, then: tools[0].id, say: 'Let me stop here. ' });
    expect(topicsOf(c).offTopic).toEqual({ strikes: 3, then: tools[0].id, say: 'Let me stop here. ', sayRef: '' });
    c = setOffTopic(c, { strikes: 0, then: tools[1].id, sayRef: 'goodbye' });
    expect(c.guardrails?.topics?.on_off_topic).toEqual({ max_strikes: 1, then: tools[1].id, say: { message: 'goodbye' } });
    expect(unknownKeys(c)).toEqual([]);
    expect(setOffTopic(c, null).guardrails).toBeUndefined();
    expect(setOffTopic(bare(), { strikes: 2, then: '' }).guardrails).toBeUndefined();
  });
});

describe('guardrails: limits', () => {
  it('as asked (minutes for a call), within what the schema allows; their line kept until cleared', () => {
    let c = setLimit(bare(), 'max_call_duration_s', '10');
    expect(c.guardrails?.limits?.max_call_duration_s).toBe(600);
    c = setLimit(c, 'max_call_duration_s', '0.2');
    expect(c.guardrails?.limits?.max_call_duration_s).toBe(30);
    c = setLimit(c, 'max_silence_s', '45.6');
    expect(c.guardrails?.limits?.max_silence_s).toBe(46);
    c = setLimitSay(c, 'I have to go now.');
    expect(limitsOf(c).values).toEqual({ max_call_duration_s: 30, max_silence_s: 46 });
    expect(LIMITS[0].toInput(600)).toBe(10);
    expect(unknownKeys(c)).toEqual([]);
    c = setLimit(c, 'max_call_duration_s', '');
    c = setLimit(c, 'max_silence_s', 'abc');
    expect(c.guardrails?.limits).toEqual({ say: 'I have to go now.' });
    c = setLimitSay(c, ' ');
    expect(c.guardrails).toBeUndefined();
  });
});

describe('guardrails: handing over and ending by itself', () => {
  it('needs the hand-over for passing to a person, and says so', () => {
    const s = momentsOf(bare());
    expect(s.frustrated_to_person.possible).toBe(false);
    expect(s.frustrated_to_person.why).toMatch(/Tools page/);
    expect(setMoment(bare(), 'frustrated_to_person', true).guardrails).toBeUndefined();
  });

  it('switches write rules, each rule reads in words, and switching off takes them away', () => {
    let c = setMoment(care(), 'frustrated_to_person', true);
    c = setMoment(c, 'asks_for_person', true, { keywords: ['manager', 'refund', 'manager'] });
    c = setMoment(c, 'abusive_end', true);
    const state = momentsOf(c);
    expect(state.frustrated_to_person.on && state.asks_for_person.on && state.abusive_end.on).toBe(true);
    expect(state.asks_for_person.keywords).toEqual(['manager', 'refund']);
    expect(unknownKeys(c)).toEqual([]);
    const [frustrated, asks, abusive] = (c.guardrails?.escalation ?? []) as Record<string, unknown>[];
    expect(ruleWords(frustrated, c)).toBe('When the caller sounds frustrated (2 turns in a row): pass them to a person');
    expect(ruleWords(asks, c)).toBe('When they say “manager” or “refund”: pass them to a person');
    expect(ruleWords(abusive, c)).toBe('When the caller is abusive: end the call');
    expect(ruleWords({ id: 'x', when: { intent: 'cancel_plan' }, action: 'handoff', to: 'retention' }, c)).toBe('When they want to cancel plan: pass them to Retention');
    c = setMoment(c, 'frustrated_to_person', false);
    c = setMoment(c, 'asks_for_person', false);
    c = setMoment(c, 'abusive_end', false);
    expect(c.guardrails).toBeUndefined();
  });

  it('changing the words keeps the rest of the rule; the last word stays and says why', () => {
    let c = setMoment(care(), 'asks_for_person', true);
    c = setMomentWords(c, 'asks_for_person', ['complaint']).config;
    expect(((c.guardrails?.escalation ?? [])[0] as { when: { keywords: string[] }; say: string }).when.keywords).toEqual(['complaint']);
    expect(((c.guardrails?.escalation ?? [])[0] as { say: string }).say).toMatch(/person/);
    const refused = setMomentWords(c, 'asks_for_person', [' ']);
    expect(refused.refused).toMatch(/at least one word/);
    expect(refused.config).toBe(c);
  });

  it('a rule changed by hand is shown as changed, not as its switch', () => {
    let c = setMoment(care(), 'abusive_end', true);
    c = { ...c, guardrails: { ...c.guardrails, escalation: [{ id: 'abusive_end', when: { sentiment: 'negative' }, action: 'end_call' }] } };
    expect(momentsOf(c).abusive_end.changed).toMatch(/Changed in the list below\. When the caller is unhappy: end the call/);
  });

  it('a switch whose id a check already has is not switched on (the server would refuse the second)', () => {
    const c = { ...care(), guardrails: { input: [{ id: 'abusive_end', type: 'prompt_injection', enforcement: 'code', on_trigger: { action: 'deflect' } }] } };
    expect(momentsOf(c).abusive_end.possible).toBe(false);
    expect(setMoment(c, 'abusive_end', true)).toBe(c);
  });

  it('a check on what is said, in words', () => {
    expect(checkWords({ type: 'prompt_injection', enforcement: 'both', on_trigger: { action: 'deflect' } })).toEqual({ what: 'Attempts to change its instructions', then: 'politely declines', how: 'Checked in code, and the agent is told too.' });
    expect(checkWords({ type: 'pii_detect', entities: ['card_number'], enforcement: 'code', on_trigger: { action: 'redact_in_logs' } })).toMatchObject({ what: 'Personal details: card number', then: 'hides it in the call log' });
    expect(checkWords({ type: 'field_firewall', enforcement: 'code' }).then).toBe('keeps them out');
    expect(checkWords({ type: 'statement', enforcement: 'prompt' })).toMatchObject({ then: '', how: 'Told to the agent as advice: not checked.' });
  });

  it('reads the server’s preview as it answered (live answer shape)', () => {
    const p = readGuardrailPreview({ matched: [{ rule: 'pii_in', type: 'pii_detect', action: 'redact_in_logs', kinds: ['card_number'], found: [{ text: '4111 1111 1111 1111', start: 31, end: 50, what: 'card_number' }] }], action: 'redact_in_logs', says_instead: null, model_sees: 'x', saved_as: 'my card is [REDACTED]', not_checked_in_code: [] });
    expect(p.matched).toEqual([{ rule: 'pii_in', kinds: ['card_number'], found: ['4111 1111 1111 1111'] }]);
    expect(previewWords(p)).toBe('Found by pii_in (card number). It hides it in the call log.');
    expect(previewWords(readGuardrailPreview({}))).toMatch(/Nothing it checks for/);
  });
});

describe('after the call', () => {
  it('a summary: not set means the server decides; what it covers', () => {
    expect(afterCallOf(bare()).summary.on).toBeNull();
    let c = setSummary(bare(), { on: true });
    c = setSummary(c, { prompt: 'Why they called.' });
    expect(c.post_call?.summary).toEqual({ enabled: true, prompt: 'Why they called.' });
    c = setSummary(c, { prompt: '  ' });
    expect(c.post_call?.summary).toEqual({ enabled: true });
    expect(setSummary(c, { on: false }).post_call?.summary?.enabled).toBe(false);
    expect(setSummary(c, { on: null }).post_call).toBeUndefined();
    const withPrompt = setSummary(setSummary(bare(), { on: true }), { prompt: 'x' });
    expect(setSummary(withPrompt, { on: null }).post_call?.summary).toEqual({ enabled: true, prompt: 'x' });
  });

  it('questions: ids made once from their words, kinds of answer', () => {
    let c = addQuestion(bare(), { question: 'Was the problem solved?', type: 'boolean' });
    c = addQuestion(c, { question: 'Was the problem solved?', type: 'boolean' });
    c = addQuestion(c, { question: 'Why did they call?', type: 'enum', values: ['A question', 'A problem'] });
    const ids = () => (c.post_call?.analysis ?? []).map((q: { id: string }) => q.id);
    expect(ids()).toEqual(['was_the_problem_solved', 'was_the_problem_solved_2', 'why_did_they_call']);
    expect(unknownKeys(c)).toEqual([]);
    c = setQuestion(c, 0, { question: 'Was it solved?' });
    expect(ids()[0]).toBe('was_the_problem_solved');
    c = setQuestion(c, 2, { values: ['A booking', ' ', 'A complaint '] });
    expect(c.post_call?.analysis?.[2].values).toEqual(['A booking', 'A complaint']);
    c = setQuestion(c, 2, { type: 'number' });
    expect(c.post_call?.analysis?.[2].values).toBeUndefined();
    c = setQuestion(c, 1, { type: 'enum' });
    expect(c.post_call?.analysis?.[1].values).toEqual(['Yes', 'No']);
    c = removeQuestion(removeQuestion(removeQuestion(c, 2), 1), 0);
    expect(c.post_call).toBeUndefined();
  });

  it('recording, the call log, and what callers hear first', () => {
    let c = setRecording(bare(), { transcript: true, days: '30' });
    expect(c.post_call?.recording).toEqual({ transcript: true, retention_days: 30 });
    expect(afterCallOf(c).recording.audio).toBeNull();
    c = setRecording(c, { days: '0.4' });
    expect(c.post_call?.recording?.retention_days).toBe(1);
    c = setRecording(c, { days: '' });
    expect(c.post_call?.recording).toEqual({ transcript: true });
    c = setLog(c, { on: true, days: 14 });
    expect(c.observability?.session_log).toEqual({ enabled: true, retention_days: 14 });
    expect(setLog(setLog(c, { on: null }), { days: '' }).observability).toBeUndefined();
    c = setNotice(c, 'This call is recorded.');
    expect(afterCallOf(c).notice).toBe('This call is recorded.');
    expect(unknownKeys(c)).toEqual([]);
    const kept = setNotice({ ...bare(), persona: { name: 'A', tone: 'warm', disclosures: { recording_notice: 'x' } } }, '');
    expect(kept.persona?.disclosures).toBeUndefined();
    expect(kept.persona?.tone).toBe('warm');
  });

  it('hiding sensitive details: on once set and not switched off, kinds from the server, raised to schema 1.2', () => {
    expect(afterCallOf(bare()).redaction.on).toBe(false);
    let c = setRedaction({ ...bare(), schema_version: '1.1' }, { entities: ['pin', 'card_number', 'nonsense'] }, KNOWN);
    expect(c.post_call?.redaction).toEqual({ entities: ['card_number', 'pin'] });
    expect(c.schema_version).toBe('1.2');
    expect(unknownKeys(c)).toEqual([]);
    c = setRedaction(c, { on: false }, KNOWN);
    expect(c.post_call?.redaction?.enabled).toBe(false);
    c = setRedaction(c, { on: true, entities: [] }, KNOWN);
    expect(c.post_call?.redaction).toEqual({ enabled: true });
    expect(setRedaction(c, { on: false }, KNOWN).post_call).toBeUndefined();
  });

  it('switched on from nothing, it starts with what the agent already handles', () => {
    const withChecks = { ...bare(), guardrails: { input: [{ id: 'p', type: 'pii_detect', entities: ['email', 'made_up'], enforcement: 'code', on_trigger: { action: 'redact_in_logs' } }] }, state: { variables: { pin_code: { type: 'string', sensitive: true } } } };
    expect(setRedaction(withChecks, { on: true }, KNOWN).post_call?.redaction).toEqual({ enabled: true, entities: ['card_number', 'email', 'pin'] });
  });

  it('a kind the studio has no words for is shown by its own name', () => {
    expect(entityLabel('card_number')).toBe('Card numbers');
    expect(entityLabel('passport_number')).toBe('Passport number');
  });

  it('says the server does not do a part only when the validator says so', () => {
    expect(notDoneYet([{ feature: 'call recording settings', where: 'post_call.recording' }])).toEqual({ summary: false, questions: false, recording: true, redaction: false });
    expect(notDoneYet([])).toEqual({ summary: false, questions: false, recording: false, redaction: false });
    const lines = recordsInWords(afterCallOf(setRecording(bare(), { audio: true })), [{ feature: 'call recording settings', where: 'post_call.recording' }]);
    expect(lines.join(' ')).toMatch(/The audio of each call is kept\. The server does not do this yet\./);
    expect(recordsInWords(afterCallOf(bare())).join(' ')).toMatch(/server’s default/);
  });

  it('reads the server’s redaction preview as it answered (live answer shape)', () => {
    const p = readRedactionPreview({ redacted: 'My card is [REDACTED]', found: [{ kind: 'card_number', start: 11, end: 30, text: '4111 1111 1111 1111' }], applies_to: ['saved transcripts and metrics'], model_sees: 'Entities never change what the model hears.' });
    expect(p).toEqual({ redacted: 'My card is [REDACTED]', found: [{ kind: 'card_number', text: '4111 1111 1111 1111' }], appliesTo: ['saved transcripts and metrics'], modelSees: 'Entities never change what the model hears.' });
  });
});

import { personalDetailsOf, setPersonalDetails } from './guardrails';

describe('guardrails: a personal-details check on what the caller says', () => {
  it('switches on with the kinds chosen, is a real pii_detect check, and goes when off', () => {
    let c = setPersonalDetails(bare(), true, ['card_number', 'email']);
    expect(personalDetailsOf(c)).toEqual({ on: true, entities: ['card_number', 'email'] });
    expect(c.guardrails?.input?.[0]).toEqual({ id: 'personal_details', type: 'pii_detect', entities: ['card_number', 'email'], enforcement: 'code', on_trigger: { action: 'redact_in_logs' } });
    expect(unknownKeys(c)).toEqual([]);
    expect(setPersonalDetails(c, true, [])).toEqual(c);
    c = setPersonalDetails(c, false, []);
    expect(c.guardrails).toBeUndefined();
  });
});
