import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../types/studio';
import { unknownKeys } from '../test/schemaKeys';
import {
  addMessage,
  baseOf,
  freeMessageId,
  hasLanguage,
  languageHint,
  languageProblem,
  languageStatus,
  messageUses,
  messagesOf,
  moveItem,
  moveMessage,
  placeWords,
  primaryOf,
  removeMessage,
  setMessageField,
  setMessageText,
  speechText,
  textOf,
  toLanguages,
  toPlain,
  wantedLanguages,
} from './messages';

const config = {
  defaults: { language: { primary: 'en-US', speaks: ['en', 'es', 'fr'] } },
  tools: [{ id: 'lookup', parameters: { type: 'object', properties: { account_id: { type: 'string' } } } }],
};

describe('fixed lines: languages (ported from messages.test.js)', () => {
  it('the languages a message should cover: primary first, a base language counted once', () => {
    expect(wantedLanguages(config)).toEqual(['en-US', 'es', 'fr']);
    expect(wantedLanguages({})).toEqual([]);
    expect(primaryOf({ defaults: { language: { speaks: ['de'] } } })).toBe('de');
    expect(baseOf('pt-BR')).toBe('pt');
  });

  it('language status: a text for "en" serves "en-US"; what is missing is named', () => {
    const status = languageStatus({ en: 'Hello', es: 'Hola' }, config);
    expect(status.missing).toEqual(['fr']);
    expect(status.primaryMissing).toBe(false);
    expect(languageStatus({ es: 'Hola' }, config).primaryMissing).toBe(true);
    expect(languageStatus('Hello', config).kind).toBe('plain');
    expect(hasLanguage({ en: 'x' }, 'en-GB')).toBe(true);
    expect(hasLanguage({ en: 'x' }, 'es')).toBe(false);
  });

  it('the card header names the languages and what is missing', () => {
    expect(languageHint({ text: { en: 'a', es: 'b' } }, config)).toBe('en, es · missing fr');
    expect(languageHint({ text: { en: 'a', es: 'b', fr: 'c' } }, config)).toBe('en, es, fr');
    expect(languageHint({ text: 'plain' }, config)).toBe('');
  });

  it('switching between one text and per-language keeps the words', () => {
    expect(toLanguages('Hello', config)).toEqual({ en: 'Hello' });
    expect(toLanguages('Hello', {})).toEqual({ en: 'Hello' });
    expect(toLanguages({ en: 'a' }, config)).toEqual({ en: 'a' });
    expect(toPlain({ es: 'Hola', en: 'Hello' }, config)).toBe('Hello');
    expect(toPlain({ es: 'Hola' }, config)).toBe('Hola');
    expect(toPlain('x', config)).toBe('x');
  });

  it('a language code to add is checked', () => {
    expect(languageProblem('', {})).toMatch(/Type a language/);
    expect(languageProblem('English', {})).toMatch(/such as fr/);
    expect(languageProblem('en', { en: 'x' })).toMatch(/already/);
    expect(languageProblem('pt-BR', { en: 'x' })).toBe('');
  });
});

describe('what a line comes to', () => {
  const c = { defaults: { language: { primary: 'es' } }, messages: [{ id: 'bye', text: { en: 'Goodbye', es: 'Adiós' } }, { id: 'hi', text: 'Hello' }] };
  it('a typed line is itself; a reference reads the fixed line in the main language', () => {
    expect(speechText('Hi there', c)).toBe('Hi there');
    expect(speechText({ message: 'bye' }, c)).toBe('Adiós');
    expect(speechText({ message: 'hi' }, c)).toBe('Hello');
    expect(speechText({ message: 'missing' }, c)).toBe('');
    expect(speechText(undefined, c)).toBe('');
    expect(textOf({ text: { fr: 'Salut' } }, c)).toBe('Salut');
  });
});

const agent = (): AgentConfig => ({
  schema_version: '1.2',
  defaults: { language: { primary: 'en' } },
  channels: [{ id: 'web-chat', type: 'web_chat', enabled: true, greeting: { say: { message: 'hello' } } }],
  tools: [{ id: 'end_call', type: 'builtin', builtin: 'end_call', params: { say: { message: 'bye' } } }],
  messages: [
    { id: 'hello', text: 'Hi, how can I help?' },
    { id: 'bye', text: 'Goodbye!' },
    { id: 'spare', text: 'Anything else?' },
  ],
});

describe('the list of fixed lines', () => {
  it('adds a line with a free id, per language once more than one is spoken', () => {
    const one = addMessage(agent());
    expect(one.id).toBe('line');
    expect(messagesOf(one.config).at(-1)).toEqual({ id: 'line', text: '' });
    const two = addMessage(one.config);
    expect(two.id).toBe('line_2');
    const multi = addMessage({ ...agent(), defaults: { language: { primary: 'en-US', speaks: ['es'] } } }, 'Hi');
    expect(messagesOf(multi.config).at(-1)?.text).toEqual({ en: 'Hi', es: '' });
    expect(freeMessageId(agent(), 'Bye!')).toBe('bye_2');
  });

  it('changes text, note and interruptions; the default is written as nothing', () => {
    let c = setMessageText(agent(), 1, { en: 'Bye', es: 'Adiós' });
    expect(c.messages?.[1]).toEqual({ id: 'bye', text: { en: 'Bye', es: 'Adiós' } });
    c = setMessageField(c, 1, 'allow_interruptions', false);
    expect((c.messages?.[1] as Record<string, unknown>).allow_interruptions).toBe(false);
    c = setMessageField(c, 1, 'allow_interruptions', true);
    expect('allow_interruptions' in (c.messages?.[1] as Record<string, unknown>)).toBe(false);
    c = setMessageField(c, 1, 'description', 'Said at the end');
    expect((c.messages?.[1] as Record<string, unknown>).description).toBe('Said at the end');
    c = setMessageField(c, 1, 'description', '  ');
    expect('description' in (c.messages?.[1] as Record<string, unknown>)).toBe(false);
    expect(unknownKeys(c)).toEqual([]);
  });

  it('reorders by drag or keyboard: a move keeps every line, and a move out of range changes nothing', () => {
    const c = agent();
    expect(messagesOf(moveMessage(c, 2, 0)).map((m) => m.id)).toEqual(['spare', 'hello', 'bye']);
    expect(messagesOf(moveMessage(c, 0, 1)).map((m) => m.id)).toEqual(['bye', 'hello', 'spare']);
    expect(moveMessage(c, 0, 5)).toBe(c);
    expect(moveItem([1, 2, 3], 1, 1)).toEqual([1, 2, 3]);
  });

  it('removes a line, and the list goes when it is empty', () => {
    let c = removeMessage(agent(), 0);
    expect(messagesOf(c).map((m) => m.id)).toEqual(['bye', 'spare']);
    c = removeMessage(removeMessage(c, 0), 0);
    expect('messages' in c).toBe(false);
  });

  it('says where each line is used, and that an unused line is not', () => {
    const c = agent();
    expect(messageUses(c, 'hello')).toEqual(['channels.0.greeting.say']);
    expect(messageUses(c, 'bye')).toEqual(['tools.0.params.say']);
    expect(messageUses(c, 'spare')).toEqual([]);
    expect(placeWords('channels.0.greeting.say', c)).toBe('the greeting on web chat');
    expect(placeWords('tools.0.params.say', c)).toBe('the tool “end call”');
  });
});
