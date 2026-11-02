import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../types/studio';
import { unknownKeys } from '../test/schemaKeys';
import {
  addException,
  addWindow,
  describeWeek,
  exceptions,
  freeScheduleId,
  minutesOf,
  officeHours,
  openAt,
  removeException,
  removeWindow,
  renameSchedule,
  scheduleProblems,
  scheduleUses,
  scheduleWords,
  setSchedule,
  setWindow,
  followerWords,
  weekWindows,
} from './schedule';
import { callerIdOf, callerIdProblems, callerIdWords, newSource, setCallerId, startCallerId } from './channelsIdentity';

// The example configuration's support hours, as the schema's own example writes them.
const supportHours = {
  description: 'When a person can take a transferred call.',
  timezone: 'America/New_York',
  weekly: [
    { days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '08:00', end: '20:00' },
    { days: ['sat'], start: '09:00', end: '17:00' },
  ],
  holidays: ['2026-12-25'],
  overrides: { '2026-12-24': { start: '09:00', end: '13:00' } },
};
const withHours = (): AgentConfig => ({
  schedules: { support_hours: supportHours },
  telephony: { transfers: [{ id: 'desk', target: '+15550100', schedule: 'support_hours' }] },
});

describe('the week of a schedule', () => {
  it('shows open windows per day, in words and as bars', () => {
    expect(describeWeek(supportHours)).toBe('Monday to Friday 08:00–20:00; Saturday 09:00–17:00.');
    const week = weekWindows(supportHours);
    expect(week.mon).toEqual([[480, 1200]]);
    expect(week.sun).toEqual([]);
    expect(openAt(supportHours, 'tue', 9 * 60)).toBe(true);
    expect(openAt(supportHours, 'tue', 20 * 60)).toBe(false);
    expect(openAt(supportHours, 'sun', 12 * 60)).toBe(false);
    expect(describeWeek({ weekly: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], start: '00:00', end: '24:00' }] })).toBe('Open all day, every day.');
    expect(describeWeek({ weekly: [] })).toBe('Never open.');
    expect(
      weekWindows({
        weekly: [
          { days: ['mon'], start: '09:00', end: '12:00' },
          { days: ['mon'], start: '11:00', end: '14:00' },
          { days: ['mon'], start: '15:00', end: '16:00' },
        ],
      }).mon
    ).toEqual([
      [540, 840],
      [900, 960],
    ]);
    expect(minutesOf('24:00')).toBe(1440);
    expect(minutesOf('25:00')).toBeNull();
    expect(minutesOf('nope')).toBeNull();
  });

  it('lists holidays and exceptions in date order, a holiday winning', () => {
    expect(exceptions(supportHours)).toEqual([
      { date: '2026-12-24', text: 'Open 09:00–13:00' },
      { date: '2026-12-25', text: 'Closed all day' },
    ]);
    expect(exceptions({ holidays: ['2026-01-01'], overrides: { '2026-01-01': 'closed', '2026-01-02': 'closed' } })).toEqual([
      { date: '2026-01-01', text: 'Closed all day' },
      { date: '2026-01-02', text: 'Closed all day' },
    ]);
  });
});

describe('where a schedule is followed', () => {
  it('finds the transfer that follows it, and a condition naming it; one nothing follows is unused', () => {
    expect(scheduleUses(withHours(), 'support_hours')).toEqual([['telephony', 'transfers', 0, 'schedule']]);
    expect(followerWords(withHours(), ['telephony', 'transfers', 0, 'schedule'])).toBe('the phone transfer “desk”');
    const cond: AgentConfig = { ...withHours(), tools: [{ id: 'x', type: 'builtin', effects: [{ when: { schedule: 'support_hours', open: true }, do: [] }] }] };
    expect(scheduleUses(cond, 'support_hours')).toHaveLength(2);
    expect(scheduleUses(withHours(), 'other')).toEqual([]);
  });

  it('says the hours in a few words', () => {
    expect(scheduleWords({})).toMatch(/^None yet/);
    expect(scheduleWords(withHours())).toBe('Monday to Friday 08:00–20:00; Saturday 09:00–17:00, America/New_York');
  });
});

describe('editing hours', () => {
  it('starts Monday to Friday 9 to 5 in the time zone given, as the schema allows', () => {
    const config = setSchedule({}, freeScheduleId({}), officeHours('Europe/London'));
    expect(config.schedules.business_hours.weekly).toEqual([{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '17:00' }]);
    expect(config.schedules.business_hours.timezone).toBe('Europe/London');
    expect(unknownKeys(config)).toEqual([]);
    expect(describeWeek(config.schedules.business_hours)).toBe('Monday to Friday 09:00–17:00.');
    expect(freeScheduleId(config)).toBe('business_hours_2');
    expect(setSchedule(config, 'business_hours', null).schedules).toBeUndefined();
  });

  it('changes, adds and removes windows; the last one stays', () => {
    let s: Record<string, unknown> = { ...officeHours('UTC') };
    s = setWindow(s, 0, { days: ['fri', 'mon'], end: '18:00' });
    expect(s.weekly).toEqual([{ days: ['mon', 'fri'], start: '09:00', end: '18:00' }]);
    s = addWindow(s);
    expect((s.weekly as unknown[]).length).toBe(2);
    s = removeWindow(s, 1);
    expect(removeWindow(s, 0)).toBe(s);
  });

  it('adds a closed day or other hours, one per date', () => {
    let s: Record<string, unknown> = { ...officeHours('UTC') };
    s = addException(s, '2026-12-24', { start: '09:00', end: '13:00' });
    s = addException(s, '2026-12-24', null);
    expect(s.holidays).toEqual(['2026-12-24']);
    expect(s.overrides).toBeUndefined();
    s = addException(s, 'tomorrow', null);
    expect(exceptions(s)).toHaveLength(1);
    expect(removeException(s, '2026-12-24').holidays).toBeUndefined();
  });

  it('renames a schedule and what follows it', () => {
    const { config, problem } = renameSchedule(withHours(), 'support_hours', 'desk_hours');
    expect(problem).toBe('');
    expect(Object.keys(config.schedules)).toEqual(['desk_hours']);
    expect(config.telephony.transfers[0].schedule).toBe('desk_hours');
    expect(renameSchedule(withHours(), 'support_hours', 'Bad Id').problem).toMatch(/lowercase/);
  });

  it('says what is wrong with hours as typed', () => {
    expect(scheduleProblems({ ...officeHours('UTC') })).toEqual([]);
    expect(scheduleProblems({ timezone: '', weekly: [{ days: [], start: '9', end: '08:00' }] })).toEqual([
      'It needs a time zone, such as Europe/London.',
      'Window has no days ticked.',
      'Window needs a start like 09:00.',
    ]);
    expect(scheduleProblems({ timezone: 'UTC', weekly: [{ days: ['mon'], start: '10:00', end: '09:00' }] })).toEqual(['Window ends before it starts.']);
  });
});

describe('caller identity', () => {
  it('reads and writes identity.caller_id as the schema allows', () => {
    expect(callerIdOf({}).on).toBe(false);
    const config = setCallerId({}, { ...startCallerId(), normalize: { type: 'e164', default_country: 'US' } });
    expect(unknownKeys(config)).toEqual([]);
    const c = callerIdOf(config);
    expect(c.sources.map((s) => s.from)).toEqual(['participant_attribute', 'participant_identity']);
    expect(callerIdWords(c)).toBe('It reads who is calling from the call’s “sip.phoneNumber”, else the caller’s identity, without “^sip[:_]” and “@.*$”, written in international form (numbers without a country code are taken as US).');
    expect(setCallerId(config, null).identity).toBeUndefined();
  });

  it('says what is missing or wrong', () => {
    expect(callerIdProblems({ on: true, sources: [], normalize: null })).toEqual(['It needs at least one place to read the caller from.']);
    expect(callerIdProblems({ on: true, sources: [newSource('static'), { from: 'participant_identity', strip: ['('] }], normalize: { type: 'e164', default_country: 'us' } })).toEqual([
      'Source 1 needs a value.',
      'Source 2: “(” is not a pattern that can be read.',
      'The default country is two capital letters, such as US or GB.',
    ]);
    expect(callerIdWords({ on: false, sources: [], normalize: null })).toMatch(/server’s default/);
  });
});
