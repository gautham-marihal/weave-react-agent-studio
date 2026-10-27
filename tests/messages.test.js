import test from 'node:test';
import assert from 'node:assert/strict';
import {
  baseOf,
  hasLanguage,
  languageHint,
  languageProblem,
  languageStatus,
  primaryOf,
  toLanguages,
  toPlain,
  wantedLanguages,
} from '../src/studio/form/messages.ts';
import { isPromptPath, isTemplateString, scopeAt, wordCount } from '../src/studio/form/templates.ts';

const config = {
  defaults: { language: { primary: 'en-US', speaks: ['en', 'es', 'fr'] } },
  tools: [{ id: 'lookup', parameters: { type: 'object', properties: { account_id: { type: 'string' } } } }],
};

test('the languages a message should cover: primary first, a base language counted once', () => {
  assert.deepEqual(wantedLanguages(config), ['en-US', 'es', 'fr']);
  assert.deepEqual(wantedLanguages({}), []);
  assert.equal(primaryOf({ defaults: { language: { speaks: ['de'] } } }), 'de');
  assert.equal(baseOf('pt-BR'), 'pt');
});

test('language status: a text for "en" serves "en-US"; what is missing is named', () => {
  const status = languageStatus({ en: 'Hello', es: 'Hola' }, config);
  assert.deepEqual(status.missing, ['fr']);
  assert.equal(status.primaryMissing, false);
  assert.equal(languageStatus({ es: 'Hola' }, config).primaryMissing, true);
  assert.equal(languageStatus('Hello', config).kind, 'plain');
  assert.equal(hasLanguage({ en: 'x' }, 'en-GB'), true);
  assert.equal(hasLanguage({ en: 'x' }, 'es'), false);
});

test('the card header names the languages and what is missing', () => {
  assert.equal(languageHint({ text: { en: 'a', es: 'b' } }, config), 'en, es · missing fr');
  assert.equal(languageHint({ text: { en: 'a', es: 'b', fr: 'c' } }, config), 'en, es, fr');
  assert.equal(languageHint({ text: 'plain' }, config), '');
});

test('switching between one text and per-language keeps the words', () => {
  assert.deepEqual(toLanguages('Hello', config), { en: 'Hello' });
  assert.deepEqual(toLanguages('Hello', {}), { en: 'Hello' });
  assert.deepEqual(toLanguages({ en: 'a' }, config), { en: 'a' });
  assert.equal(toPlain({ es: 'Hola', en: 'Hello' }, config), 'Hello');
  assert.equal(toPlain({ es: 'Hola' }, config), 'Hola');
  assert.equal(toPlain('x', config), 'x');
});

test('a language code to add is checked', () => {
  assert.match(languageProblem('', {}), /Type a language/);
  assert.match(languageProblem('English', {}), /such as fr/);
  assert.match(languageProblem('en', { en: 'x' }), /already/);
  assert.equal(languageProblem('pt-BR', { en: 'x' }), '');
});

test('which strings are templates, and how big a prompt is', () => {
  assert.equal(isTemplateString(['agents', 'items', 0, 'instructions', 'role'], { 'x-ui': { widget: 'textarea' } }, ''), true);
  assert.equal(isTemplateString(['channels', 0, 'greeting', 'say'], {}, 'Hi'), true);
  assert.equal(isTemplateString(['meta', 'name'], {}, 'Hello {{state.x}}'), true);
  assert.equal(isTemplateString(['meta', 'name'], {}, 'Hello'), false);
  assert.equal(isTemplateString(['tools', 0, 'description'], {}, 'x'), false);
  assert.equal(isPromptPath(['agents', 'items', 0, 'instructions', 'role']), true);
  assert.equal(isPromptPath(['channels', 0, 'instructions_append']), true);
  assert.equal(isPromptPath(['messages', 0, 'text']), false);
  assert.equal(wordCount('  one two\nthree  '), 3);
  assert.equal(wordCount(''), 0);
});

test('arguments are known only inside a tool', () => {
  assert.deepEqual(scopeAt(config, ['tools', 0, 'request', 'path']).names.args, ['account_id']);
  assert.equal(scopeAt(config, ['agents', 'items', 0, 'instructions', 'role']).names.args, null);
});
