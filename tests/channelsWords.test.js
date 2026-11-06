import test from 'node:test';
import assert from 'node:assert/strict';
import { FALLBACK } from '../src/studio/form/channelTypes.js';
import {
  asTime,
  callerOf,
  carriesWords,
  dayWords,
  openNow,
  schedulesOf,
  sentenceOf,
  summaryLine,
  waysOf,
  weekWords,
} from '../src/studio/agent/detailed/channelsWorkspace/channelsWords.js';

// any agent: a phone line, a web chat that also takes photos, and a WhatsApp line
const config = {
  channels: [
    { id: 'wa', type: 'whatsapp', enabled: true, modalities: { input: ['text'], output: ['text'] } },
    { id: 'phone', type: 'sip_voice', enabled: true, modalities: { input: ['audio'], output: ['audio'] }, capabilities: { dtmf: true } },
    { id: 'chat', type: 'web_chat', enabled: true, modalities: { input: ['text', 'image'], output: ['text'] }, greeting: { say: 'Hi! How can I help?' } },
  ],
  defaults: { models: { llm: { vision: true }, stt: { provider: 'deepgram' }, tts: { provider: 'cartesia' } } },
  schedules: {
    office: {
      description: 'Office hours',
      timezone: 'Asia/Singapore',
      weekly: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '17:00' }],
      holidays: ['2026-12-25'],
    },
  },
  telephony: { transfers: [{ id: 'front_desk', schedule: 'office' }] },
  tools: [{ id: 'after_hours', effects: [{ when: { schedule: 'office', open: false }, do: [] }] }],
  identity: { caller_id: { sources: [{ from: 'participant_attribute', name: 'sip.phoneNumber' }], normalize: { type: 'e164', default_country: 'SG' } } },
};

test('every way in, in the order people meet them, with what it carries and what it can do there', () => {
  const ways = waysOf(config, FALLBACK);
  assert.deepEqual(
    ways.map((w) => [w.name, w.state.words]),
    [
      ['Chat on your website', 'On'],
      ['Phone calls', 'On'],
      ['WhatsApp', 'Not connected yet'],
    ],
  );
  assert.equal(carriesWords(ways[0]), 'they type or send photos · it writes');
  assert.equal(ways[0].says, 'Hi! How can I help?');
  assert.deepEqual(
    ways[1].can.filter((c) => c.allowed).map((c) => `${c.words}:${c.ok}`),
    ['hand-over:true', 'keypad:true'],
    'a phone line has a keypad and no screen for a form',
  );
});

test('a chat that carries audio is really a voice channel, and says so', () => {
  const odd = { channels: [{ id: 'c', type: 'web_chat', enabled: true, modalities: { input: ['text', 'audio'], output: ['text'] } }] };
  assert.equal(waysOf(odd, FALLBACK)[0].state.words, 'Needs a look');
});

test('hours in words, open or closed by their own clock, and what reads them', () => {
  assert.equal(dayWords(['mon', 'tue', 'wed', 'thu', 'fri']), 'on weekdays');
  assert.equal(dayWords(['sat', 'sun']), 'at weekends');
  assert.equal(dayWords(['tue', 'wed', 'thu']), 'Tue–Thu');
  assert.equal(dayWords(['mon', 'wed']), 'Mon and Wed');
  assert.equal(weekWords({ weekly: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], start: '00:00', end: '24:00' }] }), 'every day, all day');
  const office = config.schedules.office;
  assert.equal(openNow(office, new Date('2026-11-06T03:00:00Z')), true, 'Friday 11:00 in Singapore');
  assert.equal(openNow(office, new Date('2026-11-07T03:00:00Z')), false, 'Saturday');
  assert.equal(openNow(office, new Date('2026-12-25T03:00:00Z')), false, 'a closed day');
  const [s] = schedulesOf(config, new Date('2026-11-06T03:00:00Z'));
  assert.deepEqual(s.users, ['the transfer “Front desk”', '1 step that checks it']);
  assert.equal(s.closedAhead, 1);
});

test('who is calling, the sentence and the line under the name', () => {
  assert.equal(callerOf(config).words, 'their number, made international');
  assert.deepEqual(callerOf(config).sources, ['a detail of the connection (sip.phoneNumber)']);
  const said = sentenceOf(config, FALLBACK, new Date('2026-11-06T03:00:00Z'));
  assert.deepEqual(
    said.on.map((w) => w.type),
    ['web_chat', 'sip_voice'],
  );
  assert.deepEqual(
    said.off.map((w) => w.type),
    ['web_voice'],
  );
  assert.equal(said.others.length, 1, 'WhatsApp, beside the three that work today');
  assert.equal(said.hours, 'on weekdays, 9:00 to 17:00');
  assert.equal(summaryLine(config, FALLBACK, new Date('2026-11-06T03:00:00Z')), '3 ways in · its team is in on weekdays, 9:00 to 17:00 · 1 not connected yet');
  assert.equal(summaryLine({}, FALLBACK), 'No way in yet · no hours set');
});

test('a time typed as people type it becomes the schedule’s HH:MM', () => {
  assert.equal(asTime('9'), '09:00');
  assert.equal(asTime('9:30'), '09:30');
  assert.equal(asTime('1730'), '17:30');
  assert.equal(asTime('24:00'), '24:00');
});
