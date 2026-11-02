import { describe, expect, it } from 'vitest';
import {
  answeredBy,
  changeWords,
  checkWords,
  createBody,
  environmentOption,
  formOf,
  hasPhoneChannel,
  lastCallWords,
  noPhoneSystem,
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
  ruleTarget,
  setUpWords,
  setupWarnings,
  statusWords,
  supportDetails,
} from './numbers';

// Phone numbers on the platform, ported from Weave React numbers.test: reading the API's rows, saying what they mean in
// plain words, the form's checks, and only what changed being sent. (The real create, change and release are never sent
// from a unit test; the browser suite does that against the stand-in API.)
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

describe('phone numbers', () => {
  it('a row is read tolerantly, and what is not ours is read-only', () => {
    const rows = normalizeNumbers([hand, ours, { nothing: true }]);
    expect(rows).toHaveLength(2);
    expect(rows[0].managed).toBe(false);
    expect(rows[1].options.maxCallDurationS).toBe(1800);
    expect(normalizeNumber(null).number).toBe('');
    expect(normalizeNumbers({ numbers: [ours] }).map((r) => r.number)).toEqual(['+6563002000']);
    expect(normalizeNumber({ number: '1', managed: undefined }).managed).toBe(false);
    expect(normalizeNumber({ number: '1', problems: [{ problem: 'No line.', fix: 'Add one.' }] }).problems).toEqual(['No line. Add one.']);
  });

  it('the status says what is going on, in a customer’s words', () => {
    const row = normalizeNumber(ours);
    expect(statusWords(row).label).toBe('Waiting for calls');
    expect(statusWords({ ...row, status: 'ready' }).tone).toBe('good');
    const bad = statusWords({ ...row, status: 'problem', problems: ['Nothing is deployed to production.'] });
    expect(bad.tone).toBe('bad');
    expect(bad.words).toMatch(/Nothing is deployed/);
    expect(statusWords(normalizeNumber(hand)).label).toBe('Set up outside Studio');
    expect(statusWords(normalizeNumber(hand)).words).toMatch(/can’t be changed or released here/);
  });

  it('who answers a call is said for every case', () => {
    const row = normalizeNumber(ours);
    expect(answeredBy(row, 'Acme Support')).toBe('Answered by version 0.1.1 of Acme Support, in Production.');
    expect(answeredBy({ ...row, deployment: { deployed: false, version: '' } }, 'Acme')).toMatch(/Nothing is deployed to Production for Acme yet/);
    expect(answeredBy({ ...row, phoneChannel: false }, 'Acme')).toMatch(/has no phone channel/);
    expect(answeredBy(normalizeNumber(hand))).toMatch(/Sent to agent-x by the phone system/);
    expect(optionWords(row)).toBe('calls are recorded · calls end after 30 minutes');
  });

  it('the check as a number is typed: free, ours, someone else’s, invalid', () => {
    expect(checkWords(normalizeCheck({ status: 'free' }))).toEqual({ tone: 'good', words: 'This number is free.' });
    expect(checkWords(normalizeCheck({ status: 'taken_by_builder', owner: { bot: 'acme', environment: 'staging' } })).words).toMatch(/already used by acme \(Staging\)/);
    expect(checkWords(normalizeCheck({ status: 'taken_external', owner: { trunk: 'cimb poc fs' } })).words).toMatch(/“cimb poc fs”, which Studio does not manage/);
    expect(checkWords(normalizeCheck({ status: 'invalid', reason: 'Too short.' })).words).toBe('Too short.');
    expect(checkWords(normalizeCheck({ status: 'something new' })).tone).toBe('muted');
    expect(normalizeCheck({ status: 'free', warnings: ['a trunk with no numbers'] }).warnings).toEqual(['a trunk with no numbers']);
  });

  it('the settings give the form its shape, and a typed number is held against the server’s pattern', () => {
    const settings = normalizeNumberSettings({ number_pattern: '^\\+?[0-9]{3,20}$', environments: ['development', 'production'], defaults: { record_audio: true, krisp: false }, livekit_configured: false });
    expect(settings.environments).toEqual(['development', 'production']);
    expect(settings.livekitConfigured).toBe(false);
    expect(numberProblem('+6563001234', settings.pattern)).toBe('');
    expect(numberProblem('65 (63) 001', settings.pattern)).toMatch(/the way your phone system expects/);
    expect(numberProblem('', settings.pattern)).toBe('');
    expect(numberProblem('abc', '')).toBe('');
    expect(normalizeNumberSettings(null).environments).toHaveLength(3);
  });

  it('only what was changed is sent', () => {
    const defaults = { recordAudio: true, krisp: false, allowedAddresses: [] };
    const form = { number: ' +6563009999 ', environment: 'staging', recordAudio: true, krisp: false, allowedAddresses: '', maxMinutes: '' };
    expect(createBody(form, defaults)).toEqual({ number: '+6563009999', environment: 'staging' });
    expect(createBody({ ...form, recordAudio: false, krisp: true, allowedAddresses: '203.0.113.7, 10.0.0.0/8', maxMinutes: '30' }, defaults)).toEqual({
      number: '+6563009999',
      environment: 'staging',
      record_audio: false,
      krisp: true,
      allowed_addresses: ['203.0.113.7', '10.0.0.0/8'],
      max_call_duration_s: 1800,
    });
    const before = normalizeNumber(ours);
    expect(patchBody(before, { environment: 'production', recordAudio: true, krisp: false, allowedAddresses: '', maxMinutes: '30' })).toEqual({});
    expect(patchBody(before, { environment: 'staging', recordAudio: false, krisp: false, allowedAddresses: '1.2.3.4', maxMinutes: '60' })).toEqual({
      environment: 'staging',
      record_audio: false,
      allowed_addresses: ['1.2.3.4'],
      max_call_duration_s: 3600,
    });
    expect(parseAddresses('a, b;c  d')).toEqual(['a', 'b', 'c', 'd']);
    expect(formOf(before, defaults)).toEqual({ number: '+6563002000', environment: 'production', recordAudio: true, krisp: false, allowedAddresses: '', maxMinutes: '30' });
  });

  it('a longest call is minutes in the form and seconds on the wire, from half a minute to a day', () => {
    expect(parseMaxDuration('')).toEqual({ value: undefined, error: '' });
    expect(parseMaxDuration('30')).toEqual({ value: 1800, error: '' });
    expect(parseMaxDuration('0.5')).toEqual({ value: 30, error: '' });
    expect(parseMaxDuration('0.1').error).toMatch(/half a minute/);
    expect(parseMaxDuration('2000').error).toMatch(/24 hours/);
    expect(parseMaxDuration('soon').error).toMatch(/number of minutes/);
  });

  it('what went wrong is told without technical words, and “no such feature” is told apart from a real failure', () => {
    expect(numbersProblem({ status: 503, kind: 'unavailable', message: 'x' })).toMatch(/no phone-system \(LiveKit\) credentials/);
    expect(numbersProblem({ status: 502, message: 'trunk refused' })).toMatch(/refused this: trunk refused/);
    expect(numbersProblem({ status: 409, message: '+65 is taken by acme' })).toBe('+65 is taken by acme');
    expect(numbersProblem({ status: 404, message: '+6599 is not a number of this builder.' })).toBe('+6599 is not a number of this builder.');
    expect(numbersProblem({ status: 404, message: 'Request failed (404).' })).toMatch(/could not find that number or agent/);
    expect(numbersProblem({ status: 405, message: 'x' })).toMatch(/cannot manage phone numbers yet/);
    expect(numbersProblem(null)).toBe('');
    expect(notSupported({ status: 404, kind: 'not_found' })).toBe(true);
    expect(notSupported({ status: 0, kind: 'network' })).toBe(false);
    expect(notSupported({ status: 401, kind: 'auth' })).toBe(false);
  });

  it('the real server’s shapes are read: agents as pairs, nulls, and a recording object', () => {
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
    expect(real.rule?.agents).toEqual(['CIMBBot']);
    expect(real.bot).toBe('');
    expect(real.options.maxCallDurationS).toBeUndefined();
    expect(answeredBy(real)).toBe('Sent to CIMBBot by the phone system.');
    const mine = normalizeNumber({
      number: '90004',
      managed: true,
      bot: 'voice-test',
      environment: 'development',
      trunk: { id: 'ST_dw2jApjw7HJR', name: 'agent-builder voice-test' },
      rule: { id: 'SDR_pUusmoNDbzpB', name: 'agent-builder voice-test (development)', agents: [['agent-builder-runtime', '{"bot":"voice-test","ref":"development"}']] },
      options: { record_audio: false, krisp: false, allowed_addresses: [], max_call_duration_s: null },
    });
    expect(mine.rule?.agents).toEqual(['voice-test']);
    expect(mine.rule?.targets).toEqual([{ agent: 'agent-builder-runtime', bot: 'voice-test', ref: 'development' }]);
    expect(ruleTarget(['nigeriabot', ''])).toEqual({ agent: 'nigeriabot', bot: '', ref: '' });
    expect(ruleTarget(['x', '{not json'])).toEqual({ agent: 'x', bot: '', ref: '' });
    const settings = normalizeNumberSettings({ number_pattern: String.raw`^\+?[0-9]{3,15}$`, recording: { format: 'MP3, audio only', path: '/out/{room_name}-{time}' }, livekit_configured: true });
    expect(settings.recording).toEqual({ format: 'MP3, audio only', path: '/out/{room_name}-{time}' });
    expect(normalizeNumberSettings({ recording: 'old text' }).recording.format).toBe('old text');
  });

  it('an empty “longest call” takes the limit away, and leaving it alone sends nothing', () => {
    const before = normalizeNumber(ours);
    const form = { environment: 'production', recordAudio: true, krisp: false, allowedAddresses: '', maxMinutes: '' };
    expect(patchBody(before, form)).toEqual({ max_call_duration_s: null });
    expect(patchBody(normalizeNumber({ ...ours, options: { ...ours.options, max_call_duration_s: null } }), form)).toEqual({});
    expect(patchBody(before, { ...form, maxMinutes: 'soon' })).toEqual({});
  });

  it('the trunk and rule are only details for support, with their ids, and the last call is said in words', () => {
    const row = normalizeNumber({
      ...ours,
      rule: { id: 'SDR_2', name: 'agent-builder acme (production)', agents: [['agent-builder-runtime', '{"bot":"acme","ref":"production"}']] },
      last_call: { id: 'c1', at: '2026-10-22T09:55:00Z', caller: '+6591234567', status: 'unfinished' },
    });
    expect(supportDetails(row)).toEqual([
      { label: 'Trunk', value: 'builder (ST_2)' },
      { label: 'Dispatch rule', value: 'agent-builder acme (production) (SDR_2)' },
      { label: 'Sends calls to', value: 'agent-builder-runtime, for acme (production)' },
    ]);
    expect(supportDetails(normalizeNumber(hand)).at(-1)).toEqual({ label: 'Sends calls to', value: 'agent-x' });
    const now = Date.parse('2026-10-22T10:00:00Z');
    expect(lastCallWords(row, now)).toBe('Last call 5 min ago, from +6591234567 (cut off)');
    expect(lastCallWords({ lastCall: { id: 'c1', at: '2026-10-22T09:55:00Z', status: 'ended', caller: '' } }, now)).toBe('Last call 5 min ago');
    expect(lastCallWords(normalizeNumber(ours), now)).toBe('');
  });

  it('before a number is set up: which version answers in each environment, and a warning when no call would be answered', () => {
    const current = { development: { version: '0.1.1' }, staging: { version: '0.1.0' } };
    expect(environmentOption('development', current)).toBe('Development · runs v0.1.1');
    expect(environmentOption('production', current)).toBe('Production · nothing deployed');
    expect(environmentOption('production', null)).toBe('Production');
    expect(setupWarnings({ env: 'production', deployed: '', phone: null, botName: 'Acme' })[0]).toMatch(/Nothing is deployed to Production for Acme yet/);
    expect(setupWarnings({ env: 'staging', deployed: '0.1.0', phone: false })[0]).toMatch(/Version 0\.1\.0, deployed to Staging, has no phone line that is on/);
    expect(setupWarnings({ env: 'staging', deployed: '0.1.0', phone: true })).toEqual([]);
    expect(setupWarnings({ env: 'staging', deployed: '0.1.0', phone: null })).toEqual([]);
    expect(setupWarnings({ env: 'staging', deployed: null, phone: null })).toEqual([]);
    expect(hasPhoneChannel({ channels: [{ type: 'sip_voice', enabled: true }] })).toBe(true);
    expect(hasPhoneChannel({ channels: [{ type: 'sip_voice', enabled: false }, { type: 'web_chat' }] })).toBe(false);
    expect(hasPhoneChannel(null)).toBe(false);
  });

  it('a change is said in sentences before it is sent, and setting a number up twice says nothing changed', () => {
    expect(changeWords({ environment: 'staging', record_audio: false, allowed_addresses: [], max_call_duration_s: null })).toEqual([
      'Move it to Staging: calls are then answered by the version deployed there.',
      'Stop recording the audio of calls.',
      'Accept calls from any address.',
      'Take away the longest-call limit.',
    ]);
    expect(changeWords({ krisp: true, allowed_addresses: ['10.0.0.0/8'], max_call_duration_s: 3600 })).toEqual([
      'Start filtering background noise.',
      'Only accept calls from 10.0.0.0/8.',
      'End calls after 60 minutes.',
    ]);
    const args = { number: '99999', botName: 'Acme', env: 'production' };
    expect(setUpWords({ changed: ['already set up'] }, args)).toBe('99999 was already set up for Acme in Production. Nothing was changed.');
    expect(setUpWords({ changed: ['trunk', 'dispatch rule'] }, args)).toBe('99999 was set up for Acme in Production.');
    expect(setUpWords(null, args)).toBe('99999 was set up for Acme in Production.');
  });

  it('no phone-system credentials (503 from the API) is “not available”, not “no numbers”, and not a server that is down', () => {
    expect(noPhoneSystem({ status: 503, kind: 'unavailable' })).toBe(true);
    expect(noPhoneSystem({ status: 503, kind: 'network' })).toBe(false);
    expect(noPhoneSystem({ status: 404, kind: 'not_found' })).toBe(false);
    expect(notSupported({ status: 503, kind: 'unavailable' })).toBe(false);
    expect(noPhoneSystem(null)).toBe(false);
  });
});
