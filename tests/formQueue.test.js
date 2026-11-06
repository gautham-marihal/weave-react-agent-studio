import test from 'node:test';
import assert from 'node:assert/strict';
import { addForm, formTimeLimit, formValues, readForm, removeForm, updateForm } from '../src/studio/test/formQueue.js';

// FORM_PROTOCOL.md: several forms can be open at once, everything is matched by request_id, a form already shown can
// be ignored, and an optional field left blank is left out of what is sent.

const form = (id, title = id) => readForm({ type: 'form', request_id: id, title, fields: [{ name: 'phone', type: 'phone', required: true }] });

test('forms queue by request id: the oldest shows, a repeat is ignored, and each is answered by its own id', () => {
  let queue = addForm([], form('f_1', 'Callback'));
  queue = addForm(queue, form('f_2', 'Survey'));
  queue = addForm(queue, form('f_1', 'Callback again'));
  assert.deepEqual(
    queue.map((f) => [f.requestId, f.title]),
    [
      ['f_1', 'Callback'],
      ['f_2', 'Survey'],
    ],
    'the second "f_1" changes nothing, so what was typed is kept',
  );
  queue = updateForm(queue, 'f_2', { errors: { phone: 'Enter a valid phone number.' } });
  assert.deepEqual(queue[0].errors, {}, 'errors for another form do not touch the one shown');
  assert.equal(queue[1].errors.phone, 'Enter a valid phone number.');
  queue = removeForm(queue, 'f_1');
  assert.equal(queue[0].requestId, 'f_2', 'once the first is accepted or cancelled, the next shows');
  assert.equal(readForm({ type: 'form', title: 'no id' }), null, 'a form without a request id is not shown');
  assert.equal(readForm({ type: 'form', request_id: 'f_3' }).title, 'The agent needs some details');
});

test('what is sent: numbers as numbers, ticks as true or false, and an optional field left blank is left out', () => {
  const fields = [
    { name: 'name', type: 'text', required: true },
    { name: 'age', type: 'number' },
    { name: 'count', type: 'number', required: true },
    { name: 'email', type: 'email' },
    { name: 'agree', type: 'checkbox', required: true },
    { name: 'news', type: 'checkbox' },
  ];
  assert.deepEqual(formValues(fields, { name: 'Ada', age: '', count: '3', email: '', agree: true, news: false }), {
    name: 'Ada',
    count: 3,
    agree: true,
    news: false,
  });
  assert.deepEqual(formValues(fields, { name: 'Ada', age: '41', count: '0', email: 'ada@example.com', agree: true, news: true }), {
    name: 'Ada',
    age: 41,
    count: 0,
    email: 'ada@example.com',
    agree: true,
    news: true,
  });
});

test('an error from the agent for no field of the form is still said, so a refusal is never silent', async () => {
  const { otherErrors } = await import('../src/studio/test/formQueue.js');
  const shown = form('f_9');
  assert.deepEqual(otherErrors({ ...shown, errors: { phone: 'Enter a valid phone number.' } }), [], 'a field’s own error shows under it');
  assert.deepEqual(otherErrors({ ...shown, errors: { form: 'This form has expired.', phone: 'x' } }), ['This form has expired.']);
  assert.deepEqual(otherErrors({ ...shown, errors: { _form: 'Couldn’t send the form: offline' } }), ['Couldn’t send the form: offline']);
  assert.deepEqual(otherErrors({ ...shown, errors: {} }), []);
});

test('the time to fill a form follows the agent’s silence rule, a channel’s own rule winning', () => {
  const config = {
    defaults: { conversation: { inactivity: { enabled: true, timeout_s: 150, max_nudges: 2 } } },
    channels: [{ id: 'web-chat' }, { id: 'web-voice', overrides: { conversation: { inactivity: { enabled: true, timeout_s: 30, max_nudges: 0 } } } }],
  };
  assert.equal(formTimeLimit(config, 'web-chat'), 450, '2.5 minutes before each of two nudges, then the last wait');
  assert.equal(formTimeLimit(config, 'web-voice'), 30, 'the channel’s own rule');
  assert.equal(formTimeLimit({ defaults: { conversation: { inactivity: { enabled: false, timeout_s: 30 } } } }, 'x'), null, 'switched off: nothing ends it');
  assert.equal(formTimeLimit({}, 'x'), null);
});
