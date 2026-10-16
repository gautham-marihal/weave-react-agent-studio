import test from 'node:test';
import assert from 'node:assert/strict';
import {
  answeredBy,
  checkWords,
  createBody,
  normalizeCheck,
  normalizeNumber,
  normalizeNumberSettings,
  normalizeNumbers,
  notSupported,
  numberProblem,
  numbersProblem,
  optionWords,
  parseAddresses,
  parseMaxDuration,
  patchBody,
  statusWords,
} from '../src/pages/numbersModel.js';
import { createDemoApi, memoryStorage } from '../src/demo/demoApi.js';

// FRONTEND_GUIDE 2.md section 10.5: phone numbers on the real platform. These cover reading the API's rows, saying what they mean in plain words, the form's
// checks, and the imitation demo mode uses (the real create, change and release are never sent from a test).
const hand = { number: '+6563001000', managed: false, trunk: { id: 'ST_1', name: 'singtel poc' }, rule: { id: 'SDR_1', name: 'r', agents: [['agent-x', '']] } };
const ours = {
  number: '+6563002000',
  managed: true,
  bot: 'acme',
  environment: 'production',
  trunk: { id: 'ST_2', name: 'builder' },
  rule: { id: 'SDR_2', name: 'builder acme', agents: [['acme', 'production']] },
  options: { record_audio: true, krisp: false, allowed_addresses: [], max_call_duration_s: 1800 },
  problems: [],
  deployment: { deployed: true, version: '0.1.1' },
  phone_channel: true,
  last_call: null,
  routing: 'no_calls_yet',
  routing_note: 'Creating a trunk does not make a number ring.',
  status: 'waiting_for_calls',
};

test('a row is read tolerantly, and what is not ours is read-only', () => {
  const rows = normalizeNumbers([hand, ours, { nothing: true }]);
  assert.equal(rows.length, 2, 'a row with no number is dropped');
  assert.equal(rows[0].managed, false);
  assert.equal(rows[1].options.maxCallDurationS, 1800);
  assert.equal(normalizeNumber(null).number, '');
  assert.deepEqual(
    normalizeNumbers({ numbers: [ours] }).map((r) => r.number),
    ['+6563002000'],
    'a list wrapped in an object is read too',
  );
  assert.equal(normalizeNumber({ number: '1', managed: undefined }).managed, false, 'unknown means not ours: it cannot be changed');
});

test('the status says what is going on, in a customer’s words', () => {
  const row = normalizeNumber(ours);
  assert.equal(statusWords(row).label, 'Waiting for calls');
  assert.equal(statusWords({ ...row, status: 'ready' }).tone, 'good');
  const bad = statusWords({ ...row, status: 'problem', problems: ['Nothing is deployed to production.'] });
  assert.equal(bad.tone, 'bad');
  assert.match(bad.words, /Nothing is deployed/);
  assert.equal(statusWords(normalizeNumber(hand)).label, 'Set up by hand');
});

test('who answers a call is said for every case', () => {
  const row = normalizeNumber(ours);
  assert.equal(answeredBy(row, 'Acme Support'), 'Answered by version 0.1.1 of Acme Support, in Production.');
  assert.match(answeredBy({ ...row, deployment: { deployed: false, version: '' } }, 'Acme'), /Nothing is deployed to Production for Acme yet/);
  assert.match(answeredBy({ ...row, phoneChannel: false }, 'Acme'), /has no phone channel/);
  assert.match(answeredBy(normalizeNumber(hand)), /Sent to agent-x by the phone system/);
  assert.equal(optionWords(row), 'calls are recorded · calls end after 30 minutes');
});

test('the check as a number is typed: free, ours, someone else’s, invalid', () => {
  assert.deepEqual(checkWords(normalizeCheck({ status: 'free' })), { tone: 'good', words: 'This number is free.' });
  assert.match(
    checkWords(normalizeCheck({ status: 'taken_by_builder', owner: { bot: 'acme', environment: 'staging' } })).words,
    /already used by acme \(Staging\)/,
  );
  assert.match(
    checkWords(normalizeCheck({ status: 'taken_external', owner: { trunk: 'cimb poc fs' } })).words,
    /“cimb poc fs”, which this builder does not manage/,
  );
  assert.equal(checkWords(normalizeCheck({ status: 'invalid', reason: 'Too short.' })).words, 'Too short.');
  assert.equal(checkWords(normalizeCheck({ status: 'something new' })).tone, 'muted', 'a status this studio has not met says nothing');
  assert.deepEqual(normalizeCheck({ status: 'free', warnings: ['a trunk with no numbers'] }).warnings, ['a trunk with no numbers']);
});

test('the settings give the form its shape, and a typed number is held against the server’s pattern', () => {
  const settings = normalizeNumberSettings({
    number_pattern: '^\\+?[0-9]{3,20}$',
    environments: ['development', 'production'],
    defaults: { record_audio: true, krisp: false },
    livekit_configured: false,
  });
  assert.deepEqual(settings.environments, ['development', 'production']);
  assert.equal(settings.livekitConfigured, false);
  assert.equal(numberProblem('+6563001234', settings.pattern), '');
  assert.match(numberProblem('65 (63) 001', settings.pattern), /the way your phone system expects/);
  assert.equal(numberProblem('', settings.pattern), '', 'nothing typed yet is not a problem');
  assert.equal(numberProblem('abc', ''), '', 'no pattern from the server, nothing to hold it against');
  assert.equal(normalizeNumberSettings(null).environments.length, 3);
});

test('only what was changed is sent', () => {
  const defaults = { recordAudio: true, krisp: false, allowedAddresses: [] };
  const form = { number: ' +6563009999 ', environment: 'staging', recordAudio: true, krisp: false, allowedAddresses: '', maxMinutes: '' };
  assert.deepEqual(createBody(form, defaults), { number: '+6563009999', environment: 'staging' }, 'the server’s own defaults apply to the rest');
  assert.deepEqual(createBody({ ...form, recordAudio: false, krisp: true, allowedAddresses: '203.0.113.7, 10.0.0.0/8', maxMinutes: '30' }, defaults), {
    number: '+6563009999',
    environment: 'staging',
    record_audio: false,
    krisp: true,
    allowed_addresses: ['203.0.113.7', '10.0.0.0/8'],
    max_call_duration_s: 1800,
  });
  const before = normalizeNumber(ours);
  assert.deepEqual(
    patchBody(before, { environment: 'production', recordAudio: true, krisp: false, allowedAddresses: '', maxMinutes: '30' }),
    {},
    'nothing changed, nothing sent',
  );
  assert.deepEqual(patchBody(before, { environment: 'staging', recordAudio: false, krisp: false, allowedAddresses: '1.2.3.4', maxMinutes: '60' }), {
    environment: 'staging',
    record_audio: false,
    allowed_addresses: ['1.2.3.4'],
    max_call_duration_s: 3600,
  });
  assert.deepEqual(parseAddresses('a, b;c  d'), ['a', 'b', 'c', 'd']);
});

test('a longest call is minutes in the form and seconds on the wire, from half a minute to a day', () => {
  assert.deepEqual(parseMaxDuration(''), { value: undefined, error: '' });
  assert.deepEqual(parseMaxDuration('30'), { value: 1800, error: '' });
  assert.deepEqual(parseMaxDuration('0.5'), { value: 30, error: '' });
  assert.match(parseMaxDuration('0.1').error, /half a minute/);
  assert.match(parseMaxDuration('2000').error, /24 hours/);
  assert.match(parseMaxDuration('soon').error, /number of minutes/);
});

test('what went wrong is told without technical words, and “no such feature” is told apart from a real failure', () => {
  assert.match(numbersProblem({ status: 503, message: 'x' }), /no phone-system \(LiveKit\) credentials/);
  assert.match(numbersProblem({ status: 502, message: 'trunk refused' }), /refused this: trunk refused/);
  assert.equal(numbersProblem({ status: 409, message: '+65 is taken by acme' }), '+65 is taken by acme');
  assert.equal(
    numbersProblem({ status: 404, message: '+6599 is not a number of this builder.' }),
    '+6599 is not a number of this builder.',
    'the server’s own sentence',
  );
  assert.match(
    numbersProblem({ status: 404, message: 'Request failed (404).' }),
    /could not find that number or agent/,
    'a missing number is not “no numbers feature”',
  );
  assert.match(numbersProblem({ status: 405, message: 'x' }), /cannot manage phone numbers yet/);
  assert.equal(numbersProblem(null), '');
  assert.equal(notSupported({ status: 404, kind: 'not_found' }), true);
  assert.equal(notSupported({ status: 0, kind: 'network' }), false, 'a server that cannot be reached is not “no numbers feature”');
  assert.equal(notSupported({ status: 401, kind: 'auth' }), false);
});

// ---- the imitation -----------------------------------------------------------------------------------------------------------------------------
const demo = () => createDemoApi({ seed: true, storage: memoryStorage() });
const phone = (api) => api.handle('PATCH', '/bots/acme-support/draft', {});

test('demo numbers: settings, a list with the hand-made ones, and a check of each kind', async () => {
  const api = demo();
  const settings = await api.handle('GET', '/numbers/settings');
  assert.equal(settings.status, 200);
  assert.equal(settings.body.livekit_configured, true);
  const all = await api.handle('GET', '/numbers');
  assert.equal(all.status, 200);
  assert.ok(
    all.body.every((r) => r.managed === false),
    'at first only the ones set up by hand',
  );
  assert.equal((await api.handle('GET', '/numbers/check?number=%2B6563001000')).body.status, 'taken_external');
  assert.equal((await api.handle('GET', '/numbers/check?number=abc')).body.status, 'invalid');
  assert.equal((await api.handle('GET', '/numbers/check?number=%2B6599990000')).body.status, 'free');
  await phone(api);
});

test('demo numbers: create, see its status, change, and release (and nothing of the hand-made ones can be touched)', async () => {
  const api = demo();
  const made = await api.handle('POST', '/bots/acme-support/numbers', { number: '+6599990000', environment: 'development', max_call_duration_s: 1800 });
  assert.equal(made.status, 201);
  assert.equal(made.body.managed, true);
  assert.equal(made.body.options.max_call_duration_s, 1800);
  assert.equal(made.body.options.record_audio, true, 'the default');
  assert.equal(made.body.routing, 'no_calls_yet');
  assert.match(made.body.routing_note, /FreeSWITCH/);
  assert.equal(made.body.status, 'problem', 'nothing deployed to development has a phone channel yet');
  assert.match(made.body.problems[0], /no phone channel/);
  assert.equal((await api.handle('GET', '/numbers/check?number=%2B6599990000')).body.status, 'taken_by_builder');
  assert.equal((await api.handle('GET', '/bots/acme-support/numbers')).body.length, 1);
  assert.equal((await api.handle('GET', '/bots/front-desk/numbers')).body.length, 0);
  const again = await api.handle('POST', '/bots/acme-support/numbers', { number: '+6599990000', environment: 'development' });
  assert.deepEqual(again.body.changed, ['already set up'], 'repeating it is safe');
  const other = await api.handle('POST', '/bots/front-desk/numbers', { number: '+6599990000', environment: 'development' });
  assert.equal(other.status, 409);
  const changed = await api.handle('PATCH', '/bots/acme-support/numbers/%2B6599990000', { environment: 'staging', krisp: true });
  assert.equal(changed.body.environment, 'staging');
  assert.equal(changed.body.options.krisp, true);
  assert.equal(changed.body.options.record_audio, true, 'only what is sent changes');
  assert.equal(
    (await api.handle('PATCH', '/bots/acme-support/numbers/%2B6563001000', { krisp: true })).status,
    409,
    'a number set up by hand cannot be changed',
  );
  assert.equal((await api.handle('DELETE', '/bots/acme-support/numbers/%2B6563001000')).status, 409);
  const gone = await api.handle('DELETE', '/bots/acme-support/numbers/%2B6599990000');
  assert.equal(gone.status, 200);
  assert.ok(gone.body.removed.length >= 1);
  assert.equal((await api.handle('GET', '/numbers')).body.filter((r) => r.managed).length, 0);
});

test('demo numbers: what is refused, and why', async () => {
  const api = demo();
  assert.equal((await api.handle('POST', '/bots/acme-support/numbers', { number: '+6599990000', environment: 'mars' })).status, 422);
  assert.equal((await api.handle('POST', '/bots/acme-support/numbers', { number: 'abc', environment: 'development' })).status, 422);
  assert.equal(
    (await api.handle('POST', '/bots/acme-support/numbers', { number: '+6563001000', environment: 'development' })).status,
    409,
    'taken by the phone system',
  );
  assert.equal(
    (await api.handle('POST', '/bots/acme-support/numbers', { number: '+6599990001', environment: 'development', max_call_duration_s: 5 })).status,
    422,
  );
  assert.equal(
    (await api.handle('POST', '/bots/acme-support/numbers', { number: '+6599990001', environment: 'development', allowed_addresses: ['not an address'] }))
      .status,
    422,
  );
  assert.equal((await api.handle('POST', '/bots/nobody/numbers', { number: '+6599990001', environment: 'development' })).status, 404);
  assert.equal((await api.handle('DELETE', '/bots/acme-support/numbers/%2B1')).status, 404);
});

// What the live server really sent (read with GET on 2026-10-16): a rule's agents are [bot, ref] pairs, `bot` and `environment` are null on a number set up by
// hand, and `recording` in the settings is an object.
test('the real server’s shapes are read: agents as pairs, nulls, and a recording object', () => {
  const real = normalizeNumber({
    number: '90000',
    managed: false,
    trunk: { id: 'ST_x', name: 'cimb poc fs' },
    bot: null,
    environment: null,
    rule: { id: 'SDR_x', name: 'CIMB POC FS dispatch rule', agents: [['CIMBBot', '']] },
    options: { record_audio: true, krisp: false, allowed_addresses: [], max_call_duration_s: null },
    problems: [],
  });
  assert.deepEqual(real.rule.agents, ['CIMBBot']);
  assert.equal(real.bot, '');
  assert.equal(real.options.maxCallDurationS, undefined);
  assert.equal(answeredBy(real), 'Sent to CIMBBot by the phone system.');
  const settings = normalizeNumberSettings({
    number_pattern: String.raw`^\+?[0-9]{3,15}$`,
    recording: { format: 'MP3, audio only', path: '/out/{room_name}-{time}' },
    livekit_configured: true,
  });
  assert.deepEqual(settings.recording, { format: 'MP3, audio only', path: '/out/{room_name}-{time}' });
  assert.equal(normalizeNumberSettings({ recording: 'old text' }).recording.format, 'old text', 'an older answer is still read');
  assert.deepEqual(normalizeCheck({ number: '+6500000001', status: 'free', owner: null, warnings: [] }).warnings, []);
});

test('an empty “longest call” takes the limit away, and leaving it alone sends nothing', () => {
  const before = normalizeNumber(ours); // 30 minutes
  const form = { environment: 'production', recordAudio: true, krisp: false, allowedAddresses: '', maxMinutes: '' };
  assert.deepEqual(patchBody(before, form), { max_call_duration_s: null });
  assert.deepEqual(
    patchBody(normalizeNumber({ ...ours, options: { ...ours.options, max_call_duration_s: null } }), form),
    {},
    'no limit before, none now: nothing to send',
  );
  assert.deepEqual(patchBody(before, { ...form, maxMinutes: 'soon' }), {}, 'a value that does not parse is not sent as a removal');
});
