import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSISTANT, MIN_DESCRIPTION, generateDraft } from '../src/demo/draftAssistant.js';
import { minimalConfig } from '../src/demo/demoApi.js';
import { validateDemo } from '../src/demo/demoValidate.js';

const make = (description, options) => generateDraft(description, minimalConfig('acme-bot', 'Acme bot'), options);

test('it says it is not an AI model, and refuses a description too short to read', () => {
  assert.equal(ASSISTANT.isAi, false);
  assert.match(ASSISTANT.description, /not an AI model/);
  const short = make('help people');
  assert.equal(short.ok, false);
  assert.match(short.problem, /Describe what the agent should do/);
  assert.ok(MIN_DESCRIPTION > 'help people'.length);
  assert.equal(generateDraft('A long enough description here', null).ok, false);
});

test('it picks the starter whose words the description uses, and says why', () => {
  const booking = make('An agent that takes appointment bookings for a dental clinic and confirms the time slot.');
  assert.equal(booking.ok, true);
  assert.equal(booking.summary.kind, 'Booking concierge');
  assert.match(booking.assumptions[0], /Booking concierge.*“appointment”|“book/);
  assert.equal(make('Answers frequently asked questions about our return policy.').summary.kind, 'Knowledge guide');
  assert.equal(make('Collects customer feedback with a rating after each delivery.').summary.kind, 'Feedback collector');
  const vague = make('Something nice that talks to people about stuff.');
  assert.equal(vague.summary.kind, 'Customer care');
  assert.match(vague.assumptions[0], /Nothing in the description says what kind/);
});

test('the description itself goes into the role, so nothing the author wrote is lost', () => {
  const description = 'A friendly agent for Acme Telecom that helps customers with their bills. Never promise a refund. Always ask for the account number first.';
  const out = make(description);
  const role = out.config.agents.items[0].instructions.role;
  assert.ok(role.includes(description));
  assert.match(role, /customer care agent/, 'the starter’s own role is kept');
  assert.equal(out.config.persona.company, 'Acme Telecom');
  assert.equal(out.config.persona.tone, 'friendly');
  assert.deepEqual(out.config.agents.items[0].instructions.rules, ['Never promise a refund.', 'Always ask for the account number first.']);
  assert.equal(out.config.meta.id, 'acme-bot', 'the draft’s id is kept');
  assert.match(out.config.meta.description, /^A friendly agent for Acme Telecom/);
});

test('a name in the description wins; otherwise the name given is kept', () => {
  assert.equal(make('Answers customer questions. The agent is called Maya and is warm.').config.persona.name, 'Maya');
  assert.equal(make('Answers customer questions about orders.', { name: 'Orders' }).config.persona.name, 'Orders');
  assert.equal(make('Answers customer questions about orders.').config.persona.name, 'Acme bot');
});

test('channels follow what is said; voice brings speech models and a recording notice', () => {
  const chat = make('Customer support on our website chat.');
  assert.deepEqual(chat.summary.channels, ['web-chat']);
  assert.equal(chat.config.persona.disclosures, undefined);
  const phone = make('Customer support by phone, answering calls about orders.');
  assert.ok(phone.summary.channels.includes('phone'));
  assert.equal(phone.config.defaults.models.stt.provider, 'openai');
  assert.equal(phone.config.defaults.models.tts.provider, 'openai');
  assert.match(phone.config.persona.disclosures.recording_notice, /recorded/);
  assert.ok(phone.assumptions.some((a) => /recording notice was added/.test(a)));
  const both = make('Support over the phone and on our website chat, and by WhatsApp.');
  assert.deepEqual(both.summary.channels.sort(), ['phone', 'web-chat', 'whatsapp'].sort());
});

test('languages become speech settings, with a question about the fixed lines', () => {
  const out = make('Customer care in Spanish and English for a bank.');
  assert.deepEqual(out.config.defaults.language, { primary: 'en-US', speaks: ['en', 'es'] });
  assert.ok(out.questions.some((q) => /Spanish/.test(q)));
  const only = make('Customer care that only speaks French to callers.');
  assert.equal(only.config.defaults.language.primary, 'fr-FR');
  assert.notEqual(make('Customer care for Spanish speakers.').config.persona.company, 'Spanish');
});

test('a person to hand over to adds the callback tool once, and a question about the number', () => {
  const out = make('Customer support that passes the caller to a human when it cannot help.');
  assert.ok(out.config.tools.some((t) => t.builtin === 'transfer_or_callback'));
  assert.ok(out.questions.some((q) => /number/.test(q)));
  assert.equal(out.config.tools.filter((t) => t.id === 'escalate_to_human').length, 1);
});

test('what it cannot decide is asked, not guessed', () => {
  const out = make('Customer support that looks up order status in our CRM and takes card numbers.');
  assert.ok(out.questions.some((q) => /Which system/.test(q)));
  assert.ok(out.questions.some((q) => /sensitive/.test(q)));
  assert.ok(out.questions.at(-1).includes('try the draft'));
  assert.equal(out.config.tools.some((t) => t.type === 'http'), false, 'it does not invent a connection');
});

test('every draft it makes is a valid configuration, and the same description gives the same draft', () => {
  const descriptions = [
    'Customer support by phone for Acme Telecom about bills, in Spanish and English. Never guess account details. Transfer to a human if asked.',
    'A front desk that greets visitors on the website chat and routes them.',
    'Books salon appointments over WhatsApp and SMS. Always confirm the time.',
    'Collects feedback by email with a rating. Be brief and polite.',
    'Answers frequently asked questions about our policies on the phone and on chat.',
  ];
  descriptions.forEach((d) => {
    const out = make(d);
    const report = validateDemo(out.config, 'acme-bot');
    assert.equal(report.valid, true, `${d}\n${JSON.stringify(report.errors)}`);
    assert.deepEqual(make(d).config, out.config);
  });
  const base = minimalConfig('acme-bot', 'Acme bot');
  const before = JSON.stringify(base);
  generateDraft(descriptions[0], base);
  assert.equal(JSON.stringify(base), before, 'the draft it was given is not changed');
});
