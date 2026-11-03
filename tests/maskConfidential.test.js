import test from 'node:test';
import assert from 'node:assert/strict';
import { MASK, maskConversation, maskText } from '../src/studio/privacy/maskConfidential.js';

// Confidential details in conversations the studio shows (src/studio/privacy/maskConfidential.js).

test('PINs, codes and one-time passwords show as ****, however they are written', () => {
  assert.equal(maskText('My PIN is 246810'), `My PIN is ${MASK}`);
  assert.equal(maskText('TPIN 1 2 3 4 5 6'), `TPIN ${MASK}`);
  assert.equal(maskText('key code: 1234-5678'), `key code: ${MASK}`);
  assert.equal(maskText('the OTP was 123456.'), `the OTP was ${MASK}.`);
  assert.equal(maskText('it is two four six eight one zero'), `it is ${MASK}`);
  assert.equal(maskText('246810'), MASK, 'six digits on their own');
  assert.equal(maskText('1234567'), MASK, 'a seven-digit phone code on its own');
});

test('account, card and ID numbers keep only their last four digits; NRICs are hidden', () => {
  assert.equal(maskText('account 501234567001 please'), `account ${MASK}7001 please`);
  assert.equal(maskText('card 4111 1111 1111 1111'), `card ${MASK}1111`);
  assert.equal(maskText('my IC is 880101145678'), `my IC is ${MASK}`, 'after the word IC it is a secret');
  assert.equal(maskText('NRIC S1234567A'), `NRIC ${MASK}`);
  assert.equal(maskText('Mr Tan, S7654321Z'), `Mr Tan, ${MASK}`);
});

test('what is not confidential is left alone: amounts, dates, times, short numbers, ordinary words', () => {
  for (const text of [
    'You have S$128,450.75 available.',
    'Your appointment is on 2026-10-28 at 10:00.',
    'The account ending 7001 has two cheques.',
    'Service code 328 goes to fixed deposits.',
    'Please hold for one moment.',
    'It costs 4200 a month.',
    // agents say an account's last four aloud, on purpose
    'You have a Current Account in MYR ending three three four four, and a Savings Account ending seven seven zero one.',
    // references and cheque numbers are what a caller needs to keep
    'I have stopped cheque number 000232. Your reference is STP-000002.',
    'Your reference is S T P dash zero zero zero zero zero two.',
    'Cheque 102231 is not presented yet.',
    'You want to stop cheque number zero zero zero two four zero.',
  ])
    assert.equal(maskText(text), text, text);
  assert.equal(maskText(''), '');
  assert.equal(maskText(undefined), undefined);
});

test('a caller’s answer to a question for a secret is masked whole, and only that answer', () => {
  const lines = [
    { role: 'bot', text: 'Please say your 6-digit telephone PIN.' },
    { role: 'user', text: '2468' },
    { role: 'bot', text: 'And the last four characters of your NRIC?' },
    { role: 'user', text: 'It is 321B' },
    { role: 'bot', text: 'Which account, by its last four digits?' },
    { role: 'user', text: '7001' },
    { role: 'system', text: 'The agent ended the conversation.' },
  ];
  assert.deepEqual(
    maskConversation(lines).map((l) => l.text),
    [lines[0].text, MASK, lines[2].text, `It is ${MASK}`, lines[4].text, '7001', lines[6].text],
  );
  assert.equal(maskConversation(lines)[5], lines[5], 'an unchanged line is the same object');
  assert.equal(lines[1].text, '2468', 'the lines given are not changed');
});

test('lines can name their speaker another way', () => {
  const live = [
    { who: 'agent', text: 'What is your key code?' },
    { who: 'caller', text: '1234 5678' },
  ];
  assert.equal(maskConversation(live)[1].text, MASK);
  const items = [
    { type: 'line', role: 'agent', text: 'Your PIN, please.' },
    { type: 'handover', from: 'a', to: 'b' },
    { type: 'line', role: 'caller', text: '111111' },
  ];
  assert.equal(maskConversation(items)[2].text, MASK, 'a hand-over between them keeps the question in force');
  assert.deepEqual(maskConversation(null), []);
});

test('a phone banking code and a TPIN are hidden in a bank conversation, the money and dates stay', () => {
  const lines = [
    { role: 'agent', text: 'Please provide your seven-digit phone banking code.' },
    { role: 'user', text: 'Yeah, so it is 5409881.' },
    { role: 'agent', text: 'Thank you, Mr. Tan Wei Ming. Please say your TPIN now.' },
    { role: 'user', text: 'one two three four' },
    { role: 'agent', text: 'Your balance is SGD 12,480.55 on account ending 6169, as of 2026-11-01.' },
    { role: 'user', text: 'I paid 5,200 on 1.11, thanks. Call me at three.' },
  ];
  assert.deepEqual(
    maskConversation(lines).map((l) => l.text),
    [lines[0].text, `Yeah, so it is ${MASK}.`, lines[2].text, MASK, lines[4].text, lines[5].text],
  );
  assert.equal(maskText('Account 923253456169, please.'), `Account ${MASK}6169, please.`);
  assert.equal(
    maskConversation([
      { role: 'agent', text: 'Your customer ID?' },
      { role: 'user', text: '1449287' },
    ])[1].text,
    MASK,
  );
});
