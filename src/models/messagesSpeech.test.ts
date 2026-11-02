import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../types/studio';
import { unknownKeys } from '../test/schemaKeys';
import {
  PRONUNCIATION_KINDS,
  addRule,
  entriesToText,
  moveRule,
  normalizeSpeech,
  pronunciationOf,
  pronunciationWords,
  removeRule,
  ruleWords,
  setApplyTo,
  setRule,
  speechRequest,
  speechVerdict,
  textToEntries,
} from './messagesSpeech';

const bare = (): AgentConfig => ({ schema_version: '1.2', defaults: { models: { llm: { provider: 'openai', model: 'gpt-4.1-mini' } } } });

describe('pronunciation rules', () => {
  it('every kind can be added, writes only the schema’s paths, and reads in words', () => {
    let c = bare();
    PRONUNCIATION_KINDS.forEach((k) => {
      c = addRule(c, k.type);
    });
    const { rules } = pronunciationOf(c);
    expect(rules.map((r) => r.type)).toEqual(['dictionary', 'replace', 'spell', 'digits', 'currency', 'time', 'date']);
    expect(unknownKeys(c)).toEqual([]);
    expect(pronunciationWords(rules[4])).toBe('Says amounts after $ in dollars and cents');
    expect(pronunciationWords(rules[3])).toBe('Reads numbers of 6 or more digits in groups of 4');
    expect(pronunciationWords(rules[0])).toBe('A word list with no words yet');
  });

  it('a rule changes, moves and goes; the empty parts go with it', () => {
    let c = addRule(addRule(bare(), 'replace'), 'time');
    c = setRule(c, 0, { pattern: '\\bSMS\\b', replacement: 'text message' });
    expect(pronunciationWords(pronunciationOf(c).rules[0])).toBe('Says “text message” for /\\bSMS\\b/');
    c = setRule(c, 0, { ignore_case: true });
    c = setRule(c, 0, { ignore_case: undefined });
    expect('ignore_case' in pronunciationOf(c).rules[0]).toBe(false);
    c = moveRule(c, 1, 0);
    expect(pronunciationOf(c).rules.map((r) => r.type)).toEqual(['time', 'replace']);
    expect(moveRule(c, 0, 9)).toBe(c);
    c = removeRule(removeRule(c, 0), 0);
    expect(c.defaults?.conversation).toBeUndefined();
    expect(c.defaults?.models?.llm?.model).toBe('gpt-4.1-mini');
  });

  it('which speech goes through the rules: the default is written as nothing', () => {
    let c = setApplyTo(bare(), 'all');
    expect(pronunciationOf(c).applyTo).toBe('all');
    c = setApplyTo(c, '');
    expect(c.defaults?.conversation).toBeUndefined();
  });

  it('a word list is typed one per line, written = said', () => {
    expect(textToEntries('Nimbus = Nim-bus\nbad line\nAcme=Ack-me\n')).toEqual({ Nimbus: 'Nim-bus', Acme: 'Ack-me' });
    expect(entriesToText({ Nimbus: 'Nim-bus' })).toBe('Nimbus = Nim-bus');
    expect(ruleWords('currency')).toBe('an amount of money');
    expect(ruleWords('new_kind')).toBe('new kind');
  });
});

describe('Try a line: the server’s answer (ported from tryPanels.test.js)', () => {
  it('reads the answer tolerantly and says what happened', () => {
    const view = normalizeSpeech({
      spoken: 'It costs 12 dollars and 50 cents at 4 30 P M.',
      text: 'It costs $12.50 at 4:30 PM.',
      changes: [
        { rule: 1, type: 'currency', from: '$12.50', to: '12 dollars and 50 cents' },
        { rule: 3, type: 'time', label: 'times', from: '4:30 PM', to: '4 30 P M' },
      ],
      apply_to: 'model',
      streaming: { spoken_as_it_arrives: ['at ', '4 30 P M'] },
      problems: [{ message: 'bad pattern' }, 'another'],
    });
    expect(view.changes).toHaveLength(2);
    expect(view.changes[0].label).toBe('an amount of money');
    expect(view.changes[1].label).toBe('times');
    expect(view.streaming).toEqual(['at ', '4 30 P M']);
    expect(view.problems).toEqual(['bad pattern', 'another']);
    expect(speechVerdict(view)).toBe('2 changes before the voice speaks it.');
  });

  it('a line the rules leave alone, and one they do not apply to, are said so', () => {
    expect(speechVerdict(normalizeSpeech({ spoken: 'Hello', changes: [] }))).toMatch(/Nothing in this line is changed/);
    expect(speechVerdict(normalizeSpeech({ applies: false, why_not: 'Fixed lines do not go through the rules.' }))).toBe('Fixed lines do not go through the rules.');
    expect(speechVerdict(normalizeSpeech(null))).toMatch(/Nothing in this line/);
    expect(normalizeSpeech('nonsense').streaming).toBeNull();
  });

  it('asks with the line, whose words, and the pieces it arrives in', () => {
    const c = bare();
    expect(speechRequest(c, 'at 4:30', { source: 'fixed', pieces: 'at 4| :30' })).toEqual({ config: c, text: 'at 4:30', source: 'fixed', chunks: ['at 4', ':30'] });
    expect(speechRequest(c, 'x', { agent: 'a', channel: 'phone' })).toEqual({ config: c, text: 'x', agent: 'a', channel: 'phone', source: 'model' });
  });
});
