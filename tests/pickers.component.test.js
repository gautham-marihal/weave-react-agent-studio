import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { $, $$, actions, byText, setupDom, teardownDom, textOf } from './component/dom.js';
import { applyStarter } from '../src/studio/starters.ts';
import { minimalConfig } from '../src/demo/demoApi.js';

// The language, voice and model pickers of the Agent page's panels, mounted in jsdom with a config in state: what is clicked and typed is replayed, and the
// configuration that comes out is read back.
const { mountScreen, act } = await setupDom();
const a = actions(act);
after(() => teardownDom());

const agent = () => applyStarter(minimalConfig('acme', 'Acme'), 'support');
// a picker's button: named by what it chooses, then what is chosen ("Main language: English")
const picker = (app, label) => $$(app.container, 'button.pkTrigger').find((b) => textOf(b).startsWith(`${label}:`));
const mainLanguage = (app) => picker(app, 'Main language');
const option = (label) => $$(document.body, '[role="option"]').find((o) => textOf(o).includes(label));
const key = (el, name) =>
  act(async () => {
    el.dispatchEvent(new window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  });

test('language picker: choosing the main language writes it, and its base language is spoken too', async () => {
  const app = await mountScreen('languagepicker', agent(), { ready: '.pkPicker' });
  await a.click(mainLanguage(app));
  await a.type($(app.container, 'input[aria-label="Main language: search"]'), 'span');
  assert.deepEqual(
    $$(document.body, '[role="option"]').map((o) => textOf($(o, 'strong'))),
    ['Spanish (Spain)', 'Spanish (Mexico)'],
  );
  await a.click(option('Spanish (Mexico)'));
  assert.equal(app.config.defaults.language.primary, 'es-MX');
  assert.ok(app.config.defaults.language.speaks.includes('es'));
  assert.match(textOf($(app.container, '.pkValue')), /Spanish \(Mexico\)/);
  assert.equal($(app.container, '.pkMenu'), null, 'the list closes after one choice');
  await app.unmount();
});

test('language picker: other languages are added from a list that stays open and taken away with the chip’s cross; the main one cannot be removed', async () => {
  const app = await mountScreen('languagepicker', agent(), { ready: '.pkPicker' });
  await a.click(mainLanguage(app));
  await a.click(option('English (United States)'));
  await a.click(picker(app, 'Add a language'));
  await a.click(option('French'));
  assert.ok($(app.container, '.pkMenu'), 'the list stays open to add more');
  await a.click(option('German'));
  const names = $$(app.container, '.pkChips li').map((c) => textOf(c));
  assert.ok(names[0].includes('English') && names[0].includes('main'));
  assert.ok(names.some((n) => n.includes('French')) && names.some((n) => n.includes('German')));
  assert.ok(app.config.defaults.language.speaks.includes('fr') && app.config.defaults.language.speaks.includes('de'));
  assert.equal(option('French'), undefined, 'a language that is added is not offered again');
  await a.click($(app.container, 'button[aria-label="Remove French"]'));
  assert.ok(!app.config.defaults.language.speaks.includes('fr'));
  assert.equal($(app.container, 'button[aria-label="Remove English"]'), null, 'the main language has no cross');
  await app.unmount();
});

test('language picker: the keyboard works the list: arrows, Enter and Escape', async () => {
  const app = await mountScreen('languagepicker', agent(), { ready: '.pkPicker' });
  await a.click(mainLanguage(app));
  const search = $(app.container, 'input[aria-label="Main language: search"]');
  assert.equal(document.activeElement, search, 'the search box has the keyboard');
  await key(search, 'ArrowDown');
  await key(search, 'Enter');
  assert.equal(app.config.defaults.language.primary, 'en-GB', 'the second one was picked');
  await a.click(mainLanguage(app));
  await key($(app.container, 'input[aria-label="Main language: search"]'), 'Escape');
  assert.equal($(app.container, '.pkMenu'), null, 'Escape closes it');
  assert.equal(document.activeElement, mainLanguage(app), 'and the keyboard goes back to the button');
  await app.unmount();
});

test('voice picker: a search narrows the voices, picking one sets the engine and the voice, and the one in use is marked', async () => {
  const app = await mountScreen('voicepicker', agent(), { ready: '.pkVoices' });
  assert.ok($$(app.container, '.pkVoices > li:not(.pkNone)').length >= 20);
  await a.type($(app.container, 'input[aria-label="Search voices"]'), 'sarah');
  assert.equal($$(app.container, '.pkVoices > li:not(.pkNone)').length, 1);
  await a.click($(app.container, '.pkVoiceMain'));
  assert.equal(app.config.defaults.models.tts.provider, 'elevenlabs');
  assert.equal(app.config.defaults.models.tts.voice_id, 'EXAVITQu4vr4xnSDxMaL');
  assert.equal($(app.container, '.pkVoices > li').className, 'on');
  assert.match(textOf($(app.container, '.pkNow')), /Sarah/);
  assert.match(textOf($(app.container, '[role="status"]')), /voice engine is now ElevenLabs/);
  await a.type($(app.container, 'input[aria-label="Search voices"]'), 'zzzz');
  assert.match(textOf($(app.container, '.pkVoices .pkNone')), /No voice matches/);
  await app.unmount();
});

test('voice picker: the filters combine, and a voice id of your own can still be typed', async () => {
  const app = await mountScreen('voicepicker', agent(), { ready: '.pkVoices' });
  await a.choose($(app.container, '.rxSelect[aria-label="Engine"]'), 'cartesia');
  await a.choose($(app.container, '.rxSelect[aria-label="Gender"]'), 'Male');
  assert.ok($$(app.container, '.pkVoices > li:not(.pkNone)').length > 0);
  assert.ok($$(app.container, '.pkVoices .pkEngine').every((e) => /Cartesia/.test(textOf(e))));
  assert.equal($$(app.container, '.pkVoiceText small').filter((s) => /Female/.test(textOf(s))).length, 0);
  await a.type($(app.container, 'input[aria-label="Voice id"]'), 'my-own-voice-123');
  assert.equal(app.config.defaults.models.tts.voice_id, 'my-own-voice-123');
  await app.unmount();
});

test('model picker: the three parts say what is chosen, a list opens for one, and a model of another provider switches the provider', async () => {
  const app = await mountScreen('modelpicker', agent(), { ready: '.pkPart' });
  assert.deepEqual(
    $$(app.container, '.pkPart').map((p) => p.getAttribute('data-stage')),
    ['llm', 'stt', 'tts'],
  );
  const llm = () => $(app.container, '.pkPart[data-stage="llm"]');
  assert.match(textOf($(llm(), '.pkChosen')), /GPT-4\.1 Mini/);
  await a.click($(llm(), '.pkChosen button'));
  assert.ok($(llm(), '.pkModelList'));
  await a.click(byText(llm(), '.pkPills button', 'Anthropic'));
  assert.ok($$(llm(), '.pkModelList li:not(.pkNone) .pkEngine').every((e) => /Anthropic/.test(textOf(e))));
  await a.click($(llm(), '.pkModelList li:not(.pkNone) button'));
  assert.equal(app.config.defaults.models.llm.provider, 'anthropic');
  assert.ok(app.config.defaults.models.llm.model);
  assert.ok($(llm(), '.pkModelList li.on'), 'the model in use is marked');
  await app.unmount();
});

test('model picker: another model id can be typed, and is kept with the provider in use', async () => {
  const app = await mountScreen('modelpicker', agent(), { ready: '.pkPart' });
  const llm = () => $(app.container, '.pkPart[data-stage="llm"]');
  await a.click($(llm(), '.pkChosen button'));
  await a.type($(app.container, '#pk-other-llm'), 'gpt-9-custom');
  await a.click(byText(llm(), 'button', 'Use it'));
  assert.equal(app.config.defaults.models.llm.model, 'gpt-9-custom');
  assert.equal(app.config.defaults.models.llm.provider, 'openai');
  assert.match(textOf($(llm(), '.pkStatus')), /isn.t in the catalogue/);
  await app.unmount();
});

test('language picker: the other language settings are here too: switching on detection, and the languages it only recognises', async () => {
  const app = await mountScreen('languagepicker', agent(), { ready: '.pkPicker' });
  await a.click($(app.container, 'input[aria-label="Detect the caller’s language automatically"]'));
  assert.equal(app.config.defaults.language.auto_detect, true);
  await a.click(picker(app, 'Add a language to recognise'));
  await a.click(option('Japanese'));
  assert.deepEqual(app.config.defaults.language.also_understands, ['ja']);
  assert.ok($(app.container, 'button[aria-label="Stop recognising Japanese"]'));
  await a.click($(app.container, 'button[aria-label="Stop recognising Japanese"]'));
  assert.equal(app.config.defaults.language.also_understands, undefined, 'an empty list is not written');
  await a.click($(app.container, 'input[aria-label="Detect the caller’s language automatically"]'));
  assert.equal(app.config.defaults.language.auto_detect, undefined, 'and neither is false');
  await app.unmount();
});
