// Build › Channels in plain words, for any agent: the ways people reach it (what each carries, what it can do there,
// whether it works), when its team is in (the hours a hand-over and a step's check read), and how it knows who is
// calling. Pure: no React, no DOM, so the tests run it in Node.
//
// From the schema: a schedule is read by a transfer ("only transfer while open") and by any condition { schedule, open };
// it does not close a channel. WhatsApp, SMS, email and custom channels are kept but not connected to the runtime yet
// (the server's channel-types list, runs_today). Entry fields are for reference: the runtime doesn't read them.

import { allowedModalities, canForms, canKeypad, findVoiceOnly, infoOf, isVoiceChannel, mislabelledChat } from '../../../form/channelTypes.js';
import { channelGreetingTarget, channelName, greetingOf } from '../../../simple/simpleModel.js';
import { humanize } from '../../rowNames.js';
import { TYPE_LABELS, modalityNotes } from '../../../form/presets.js';
import { clockIn, openNow, toMin } from '../../../schedules.js';

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
export const together = (words, last = 'and') => (words.length > 1 ? `${words.slice(0, -1).join(', ')} ${last} ${words.at(-1)}` : words[0] || '');

// the three ways in that work today, in the order people meet them, and how the sentence says each
export const WAYS = [
  { type: 'web_chat', icon: 'chat', words: 'chatting on your website' },
  { type: 'web_voice', icon: 'mic', words: 'talking on your website' },
  { type: 'sip_voice', icon: 'phone', words: 'calling a phone number' },
];
const ICONS = { web_chat: 'chat', web_voice: 'mic', sip_voice: 'phone', whatsapp: 'chat', sms: 'chat', email: 'mail', custom: 'plug' };

// what a person can use on it, and how it answers, in words
const IN_WORDS = { text: 'type', audio: 'talk', image: 'send photos', video: 'show the camera' };
const OUT_WORDS = { text: 'it writes', audio: 'it speaks' };
export const IN_ICONS = { text: 'chat', audio: 'mic', image: 'image', video: 'camera' };
export const OUT_ICONS = { text: 'chat', audio: 'voice' };

// each way in: its kind, first words, what it carries, what it can do there, and whether it works
// in the order people meet them: chat, talk, phone, then the rest as they were added
const ORDER = (type) => {
  const at = WAYS.findIndex((w) => w.type === type);
  return at < 0 ? WAYS.length : at;
};
export function waysOf(config, types) {
  return list(config?.channels)
    .map((ch, index) => {
      const channel = isObj(ch) ? ch : {};
      const kind = infoOf(types, channel.type);
      const greeting = greetingOf(config, channelGreetingTarget(config, index));
      const own = channel.greeting && channel.greeting.say !== undefined;
      const inputs = list(channel.modalities?.input);
      const outputs = list(channel.modalities?.output);
      const caps = isObj(channel.capabilities) ? channel.capabilities : {};
      // what doesn't fit it, as the part's "Needs a look" row says it (channelsPart fitOf): a chat that carries audio,
      // voice-only settings on a channel with no voice, or a model it needs and hasn't got
      const voiceOnly = kind && !isVoiceChannel(channel, types) ? findVoiceOnly(channel.overrides) : [];
      const speech = modalityNotes(channel, config).find((note) => note.level === 'warn');
      const problem = mislabelledChat(channel)
        ? 'This chat carries audio: it is really a voice channel'
        : voiceOnly.length
          ? 'It has voice settings that do nothing on it'
          : speech
            ? speech.text
            : '';
      return {
        index,
        key: typeof channel.id === 'string' ? channel.id : String(index),
        type: channel.type || '',
        name: TYPE_LABELS[channel.type] || channelName(channel.type),
        icon: ICONS[channel.type] || 'chat',
        on: channel.enabled !== false,
        says: greeting.text,
        own: !!own,
        carries: [
          ...inputs.map((m) => ({ dir: 'in', m, words: IN_WORDS[m] || m, icon: IN_ICONS[m] || 'chat' })),
          ...outputs.map((m) => ({ dir: 'out', m, words: OUT_WORDS[m] || m, icon: OUT_ICONS[m] || 'chat' })),
        ],
        can: [
          { key: 'forms', words: 'forms', icon: 'records', ok: caps.forms ?? canForms(types, channel.type), allowed: canForms(types, channel.type) },
          { key: 'human_transfer', words: 'hand-over', icon: 'user', ok: caps.human_transfer ?? true, allowed: true },
          { key: 'dtmf', words: 'keypad', icon: 'keypad', ok: caps.dtmf ?? false, allowed: canKeypad(types, channel.type) },
        ],
        state:
          kind && kind.runsToday === false
            ? { tone: 'warn', words: 'Not connected yet' }
            : problem
              ? { tone: 'bad', words: 'Needs a look', why: problem }
              : channel.enabled === false
                ? { tone: 'off', words: 'Off' }
                : { tone: 'good', words: 'On' },
      };
    })
    .sort((a, b) => ORDER(a.type) - ORDER(b.type) || a.index - b.index);
}

// what the line under a way in says: what the person uses, and how it answers
export function carriesWords(way) {
  const ins = way.carries.filter((c) => c.dir === 'in').map((c) => c.words);
  const outs = way.carries.filter((c) => c.dir === 'out').map((c) => c.words.replace(/^it /, ''));
  if (!ins.length && !outs.length) return '';
  return `${ins.length ? `they ${together(ins, 'or')}` : ''}${ins.length && outs.length ? ' · ' : ''}${outs.length ? `it ${together(outs, 'and')}` : ''}`;
}

// what each kind may carry (null: anything)
export const allowedFor = (types, type) => ({ input: allowedModalities(types, type, 'input'), output: allowedModalities(types, type, 'output') });

// ---- when its team is in
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const DAY_NAMES = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const hm = (t) => (typeof t === 'string' ? t.replace(/^0(\d)/, '$1') : '');
export function dayWords(days) {
  const set = DAYS.filter((d) => list(days).includes(d));
  if (set.length === 7) return 'every day';
  if (set.join() === 'mon,tue,wed,thu,fri') return 'on weekdays';
  if (set.join() === 'sat,sun') return 'at weekends';
  const at = set.map((d) => DAYS.indexOf(d));
  const run = at.length >= 3 && at.every((n, i) => !i || n === at[i - 1] + 1);
  return run ? `${DAY_NAMES[set[0]]}–${DAY_NAMES[set.at(-1)]}` : together(set.map((d) => DAY_NAMES[d]));
}
export const timeWords = (start, end) => (start === '00:00' && end === '24:00' ? 'all day' : `${hm(start)} to ${hm(end)}`);
export function weekWords(schedule) {
  const rules = list(schedule?.weekly).filter(isObj);
  if (!rules.length) return 'no hours yet';
  return rules.map((r) => `${dayWords(r.days)}, ${timeWords(r.start, r.end)}`).join('; ');
}

// typed as people type it ("9", "9:30", "1730") to the schema's HH:MM
export function asTime(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  const m = t.match(/^(\d{1,2})(?::?(\d{2}))?$/);
  if (!m) return t;
  return `${m[1].padStart(2, '0')}:${m[2] || '00'}`;
}

// open or closed now, by its own clock (studio/schedules.js, shared with the simulated agent)
export { openNow };
// the open spans of each day of its week, as fractions of the day, for the strip: { mon: [[0.375, 0.708]], … }
function weekSpans(schedule) {
  const spans = Object.fromEntries(DAYS.map((d) => [d, []]));
  list(schedule?.weekly)
    .filter(isObj)
    .forEach((r) => {
      const a = toMin(r.start);
      const b = toMin(r.end);
      if (a === null || b === null || b <= a) return;
      list(r.days).forEach((d) => spans[d]?.push([a / 1440, b / 1440]));
    });
  return spans;
}

// what reads a schedule: transfers that pass callers on only while open, and steps that check it
function checksIn(node, id, found = { n: 0 }) {
  if (Array.isArray(node)) node.forEach((n) => checksIn(n, id, found));
  else if (isObj(node)) {
    if (node.schedule === id && typeof node.open === 'boolean') found.n += 1;
    Object.values(node).forEach((v) => checksIn(v, id, found));
  }
  return found.n;
}
export function schedulesOf(config, now = new Date()) {
  const all = isObj(config?.schedules) ? config.schedules : {};
  return Object.entries(all).map(([key, s]) => {
    const schedule = isObj(s) ? s : {};
    const clock = clockIn(schedule.timezone, now);
    const transfers = list(config?.telephony?.transfers).filter((t) => isObj(t) && t.schedule === key);
    const checks = checksIn({ ...config, schedules: undefined }, key);
    return {
      key,
      name: (typeof schedule.description === 'string' && schedule.description) || humanize(key),
      week: weekWords(schedule),
      timezone: schedule.timezone || '',
      closedAhead: clock ? list(schedule.holidays).filter((d) => d >= clock.date).length : list(schedule.holidays).length,
      open: openNow(schedule, now),
      spans: weekSpans(schedule),
      today: clock?.day || '',
      nowAt: clock ? clock.minutes / 1440 : null,
      users: [
        ...transfers.map((t) => `the transfer “${humanize(t.id)}”`),
        ...(checks ? [`${checks} ${checks === 1 ? 'step that checks' : 'steps that check'} it`] : []),
      ],
    };
  });
}

// ---- who is calling
const SOURCE_WORDS = {
  participant_attribute: (s) => `a detail of the connection (${s.name || 'not named'})`,
  participant_identity: () => 'the caller’s identity',
  static: (s) => `a fixed number${s.value ? ` (${s.value})` : ''}`,
};
export function callerOf(config) {
  const id = config?.identity?.caller_id;
  const sources = list(id?.sources).filter(isObj);
  const tidy = id?.normalize?.type || '';
  return {
    set: sources.length > 0,
    sources: sources.map((s) => (SOURCE_WORDS[s.from] || (() => s.from || 'a source'))(s)),
    tidy,
    country: id?.normalize?.default_country || '',
    words: !sources.length ? '' : tidy === 'e164' ? 'their number, made international' : 'their number, as it comes',
  };
}

// ---- the sentence and the line under the name
export function sentenceOf(config, types, now = new Date()) {
  const ways = waysOf(config, types);
  const on = WAYS.filter((w) => ways.some((x) => x.type === w.type && x.on));
  const off = WAYS.filter((w) => !on.includes(w));
  const others = ways.filter((x) => x.on && !WAYS.some((w) => w.type === x.type));
  const schedules = schedulesOf(config, now);
  return {
    on,
    off,
    others,
    hours: schedules.length === 1 ? schedules[0].week : schedules.length ? `in ${schedules.length} sets of hours` : '',
    caller: callerOf(config).words,
  };
}
export function summaryLine(config, types, now = new Date()) {
  const ways = waysOf(config, types);
  const on = ways.filter((w) => w.on).length;
  const bad = ways.filter((w) => w.state.tone === 'bad').length;
  const later = ways.filter((w) => w.on && w.state.tone === 'warn').length;
  const schedules = schedulesOf(config, now);
  const parts = [
    on ? `${on} ${on === 1 ? 'way' : 'ways'} in` : 'No way in yet',
    schedules.length ? (schedules.length === 1 ? `its team is in ${schedules[0].week.split(';')[0]}` : `${schedules.length} sets of hours`) : 'no hours set',
    bad && `${bad} ${bad === 1 ? 'needs' : 'need'} a look`,
    later && `${later} not connected yet`,
  ].filter(Boolean);
  return parts.join(' · ');
}
