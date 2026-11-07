import test from 'node:test';
import assert from 'node:assert/strict';
import {
  constantsIn,
  detailsOf,
  lintWords,
  logsWords,
  nameProblem,
  shownValue,
  summaryLine,
  timeIn,
  typedValue,
  usesOf,
} from '../src/studio/agent/detailed/engineWorkspace/engineWords.js';

// Build › Engine and details in plain words (engineWords.js), for any agent: who it is, how it runs, its fixed values
// with where each is used, the studio's checks and its logs.

const config = () => ({
  meta: { id: 'acme-support', version: '1.4.2', status: 'published', environment: 'staging' },
  runtime: { engine: 'livekit-agents', provider_mode: 'plugins', timezone: 'Asia/Singapore' },
  constants: { payment_url: 'https://pay.example.com', callback_hours: 4 },
  agents: { items: [{ id: 'main', instructions: 'Send {{const.payment_url}} and {{ const.payment_url }} when asked.' }] },
  builder: { lint: { max_prompt_words_per_agent: 450, max_tools_per_agent: 8 } },
  observability: { log_level: 'INFO', metrics: true, otel: { enabled: true, endpoint: 'https://otel.example.com:4318' } },
});

test('who it is and how it runs, with what is set elsewhere', () => {
  const d = detailsOf(config());
  assert.deepEqual(
    [d.id, d.version, d.status, d.env, d.engineWords, d.modeWords, d.tz],
    ['acme-support', '1.4.2', 'published', 'staging', 'LiveKit Agents', 'your own model keys', 'Asia/Singapore'],
  );
  assert.equal(summaryLine(d), 'Version 1.4.2 · published · staging');
  assert.equal(summaryLine(detailsOf({ meta: { id: 'x' } })), 'Draft · not published yet');
  assert.deepEqual([d.drain, d.closeRoom], [true, true], 'hanging up finishes its words and ends the room unless switched off');
});

test('a time zone tells the time there, and a name that is not one says so', () => {
  assert.match(timeIn('Asia/Singapore', new Date('2026-11-06T06:32:00Z')), /^14:32$/);
  assert.equal(timeIn('Mars/Olympus'), null);
  assert.equal(timeIn(''), null);
});

test('fixed values: where each is used, a number stays a number, and names the schema takes', () => {
  assert.equal(usesOf(config(), 'payment_url'), 2, 'spaces inside the braces count too');
  assert.equal(usesOf(config(), 'callback_hours'), 0);
  assert.deepEqual(
    constantsIn(config()).map((c) => [c.name, c.shown, c.uses]),
    [
      ['payment_url', 'https://pay.example.com', 2],
      ['callback_hours', '4', 0],
    ],
  );
  assert.deepEqual(
    [typedValue('4'), typedValue('4.5'), typedValue('true'), typedValue('4 hours'), typedValue('["a","b"]'), typedValue('[broken')],
    [4, 4.5, true, '4 hours', ['a', 'b'], '[broken'],
  );
  assert.equal(shownValue(['a']), '["a"]');
  assert.deepEqual(
    [typedValue('0123456789'), typedValue('12345678901234567890'), typedValue('1.50'), typedValue('-7')],
    ['0123456789', '12345678901234567890', '1.50', -7],
    'a phone number, a long digit string or a padded decimal stays words',
  );
  assert.equal(nameProblem('pay_url', []), '');
  assert.match(nameProblem('Pay URL', []), /Lower-case/);
  assert.match(nameProblem('pay_url', ['pay_url']), /Another value/);
  assert.match(nameProblem('', []), /name/);
});

test('the studio checks and the logs in a line', () => {
  const d = detailsOf(config());
  assert.equal(lintWords(d.lint), '450 words or 8 tools');
  assert.equal(lintWords(detailsOf({}).lint), '');
  assert.equal(logsWords(d.logs), 'Log detail: what matters · metrics on · tracing off · sent to otel.example.com:4318');
  assert.equal(logsWords(detailsOf({}).logs), 'Log detail: the worker’s own · metrics off · tracing off · no export');
});
