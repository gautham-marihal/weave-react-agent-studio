import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../types/studio';
import { starters } from '../data/starters';
import { unknownKeys } from '../test/schemaKeys';
import { applyStarter } from './setup';
import {
  CHECK_KINDS,
  addCheck,
  addRule,
  checkParts,
  fieldWords,
  freeId,
  guardrailIds,
  limitsOf,
  newCheck,
  removeItem,
  ruleMissing,
  ruleWords,
  setItem,
  setLimit,
  setLimitSay,
  setOffTopic,
  setRuleAction,
  setRuleWhen,
  setTopics,
  topicsOf,
} from './guardrails';

const bare = (): AgentConfig => ({
  schema_version: '1.2',
  meta: { id: 'a', name: 'A', version: '0.1.0', status: 'draft' },
  defaults: { models: { llm: { provider: 'openai', model: 'gpt-4.1-mini' } } },
  agents: { entry: 'assistant', items: [{ id: 'assistant', name: 'A', kind: 'standalone', instructions: { role: 'Help.' }, tools: [] }, { id: 'billing', name: 'Billing', kind: 'specialist', instructions: { role: 'Bills.' }, tools: [] }] },
  tools: [
    { id: 'end_call', type: 'builtin', builtin: 'end_call' },
    { id: 'transfer', type: 'builtin', builtin: 'transfer_or_callback' },
  ],
});
const care = () => applyStarter(bare(), { company: 'Acme', starter: starters[0] });
// a box bound to the draft, typed into key by key: each key hands on what the box shows plus that key, as the page does
const typed = (config: AgentConfig, text: string, read: (c: AgentConfig) => string, write: (c: AgentConfig, t: string) => AgentConfig) => [...text].reduce((c, key) => write(c, read(c) + key), config);

describe('guardrails while typing (ported from build-guardrails.test.js)', () => {
  it('a space typed in what it says is kept, so a sentence can be typed key by key', () => {
    let c = setOffTopic(bare(), { strikes: 3, then: 'end_call' });
    c = typed(c, 'I can only help with orders.', (cc) => topicsOf(cc).offTopic?.say ?? '', (cc, text) => setOffTopic(cc, { ...topicsOf(cc).offTopic, say: text, sayRef: '' }));
    expect(topicsOf(c).offTopic?.say).toBe('I can only help with orders.');
    c = setLimit(c, 'max_call_duration_s', '5');
    c = typed(c, 'Sorry, time is up.', (cc) => limitsOf(cc).say, (cc, text) => setLimitSay(cc, text));
    expect(limitsOf(c).say).toBe('Sorry, time is up.');
    expect(setLimitSay(c, '   ').guardrails?.limits?.say).toBeUndefined();
  });

  it('retyping the only limit keeps what it says when a limit ends the call', () => {
    let c = setLimitSay(setLimit(bare(), 'max_call_duration_s', '5'), 'Sorry, time is up.');
    c = setLimit(c, 'max_call_duration_s', '');
    expect(limitsOf(c).say).toBe('Sorry, time is up.');
    c = setLimit(c, 'max_call_duration_s', '10');
    expect(c.guardrails?.limits).toEqual({ max_call_duration_s: 600, say: 'Sorry, time is up.' });
  });

  it('a topic written twice is shown once, and removing it removes it', () => {
    const c = setTopics(bare(), 'allowed', ['orders', 'orders ', 'billing']);
    expect(topicsOf(c).allowed).toEqual(['orders', 'billing']);
    expect(topicsOf(setTopics(c, 'allowed', ['billing'])).allowed).toEqual(['billing']);
  });
});

describe('checks, one at a time', () => {
  it('a new check is named clear of the ids on all three guardrail lists', () => {
    const c = bare();
    c.guardrails = {
      input: [{ id: 'personal_details', type: 'pii_detect', entities: ['card_number'], enforcement: 'code', on_trigger: { action: 'redact_in_logs' } }],
      escalation: [{ id: 'rule', when: { sentiment: 'abusive' }, action: 'end_call' }],
    };
    expect(guardrailIds(c).sort()).toEqual(['personal_details', 'rule']);
    expect(newCheck(c, 'output', 'pii')?.id).toBe('personal_details_2');
    expect(newCheck(c, 'output', 'statement')?.id).toBe('rule_2');
    expect(guardrailIds({} as AgentConfig)).toEqual([]);
    expect(freeId(['a', 'a_2'], 'a')).toBe('a_3');
  });

  it('every kind can be added on its side and is a check the schema allows; the agent’s words are not checked for tricks', () => {
    expect(CHECK_KINDS.output.some((k) => k.type === 'prompt_injection')).toBe(false);
    let c = bare();
    (['input', 'output'] as const).forEach((side) =>
      CHECK_KINDS[side].forEach((k) => {
        const made = addCheck(c, side, k.id);
        expect(made.index).toBe((c.guardrails?.[side] ?? []).length);
        c = made.config;
      })
    );
    expect(c.guardrails?.input).toHaveLength(5);
    expect(c.guardrails?.output).toHaveLength(4);
    expect(new Set(guardrailIds(c)).size).toBe(9);
    expect(unknownKeys(c)).toEqual([]);
    expect(addCheck(c, 'input', 'nonsense').index).toBe(-1);
  });

  it('a check changes field by field; undefined takes a field out, and the last one gone takes the list away', () => {
    let { config: c } = addCheck(bare(), 'input', 'blocklist');
    c = setItem(c, 'input', 0, { patterns: ['\\brefund\\b'], on_trigger: { action: 'deflect', say: 'I can’t promise that.' } });
    expect(c.guardrails?.input?.[0]).toMatchObject({ type: 'regex_block', patterns: ['\\brefund\\b'], on_trigger: { action: 'deflect' } });
    c = setItem(c, 'input', 0, { on_trigger: undefined });
    expect('on_trigger' in (c.guardrails?.input?.[0] as Record<string, unknown>)).toBe(false);
    c = removeItem(c, 'input', 0);
    expect(c.guardrails).toBeUndefined();
  });

  it('each kind asks for its own parts, in the words of its side', () => {
    expect(checkParts('pii_detect')).toMatchObject({ entities: true, onTrigger: true, patterns: false });
    expect(checkParts('field_firewall')).toMatchObject({ fields: true, onTrigger: false });
    expect(checkParts('statement')).toMatchObject({ text: true, onTrigger: false });
    expect(fieldWords('patterns', 'input').label).toBe('Patterns to look for');
    expect(fieldWords('patterns', 'output').help).not.toMatch(/replaced/);
    expect(fieldWords('patterns', 'output').help).toMatch(/the agent says/);
    expect(fieldWords('entities', 'input').label).toBe('Kinds of detail to look for');
    expect(fieldWords('to', 'escalation').label).toBe('Hand over to');
  });
});

describe('hand-over and ending rules of your own', () => {
  it('a new rule says what is missing until it is finished', () => {
    const made = addRule(bare());
    let c = made.config;
    const index = made.index;
    expect(index).toBe(0);
    const rule = () => c.guardrails?.escalation?.[0] as Record<string, unknown>;
    expect(ruleMissing(rule())).toBe('Not finished yet: say when it applies.');
    c = setRuleWhen(c, 0, 'keywords', ['manager', 'complaint']);
    expect(ruleMissing(rule())).toBe('');
    expect(ruleWords(rule(), c)).toBe('When they say “manager” or “complaint”: end the call');
    c = setRuleAction(c, 0, 'handoff');
    expect(ruleMissing(rule())).toBe('Not finished yet: say what it does then.');
    c = setRuleAction(c, 0, 'handoff', 'billing');
    expect(ruleWords(rule(), c)).toBe('When they say “manager” or “complaint”: pass them to Billing');
    c = setRuleAction(c, 0, 'tool', 'transfer');
    expect(rule()).toMatchObject({ action: 'tool', tool: 'transfer' });
    expect('to' in rule()).toBe(false);
    expect(ruleWords(rule(), c)).toMatch(/pass them to a person$/);
    c = setRuleWhen(c, 0, 'sentiment', 'frustrated');
    c = setRuleWhen(c, 0, 'consecutive_turns', 2);
    c = setRuleWhen(c, 0, 'keywords', []);
    expect(rule().when).toEqual({ sentiment: 'frustrated', consecutive_turns: 2 });
    expect(unknownKeys(c)).toEqual([]);
  });

  it('a rule is named clear of the checks’ ids', () => {
    const { config: c } = addCheck(bare(), 'input', 'statement');
    expect(addRule(c).config.guardrails?.escalation?.[0]).toMatchObject({ id: 'rule_2' });
  });

  it('works on a starter agent too', () => {
    const c = care();
    const before = (c.guardrails?.escalation ?? []).length;
    expect(addRule(c).index).toBe(before);
  });
});
