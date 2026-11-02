// Business hours (`schedules`): a schedule as a week (one bar per day, shaded where it is open), the same in words, the
// closed or different days, where the agent follows it (a phone transfer, a condition), and the edits the Channels
// page makes. Hours change nothing on their own: a transfer or a rule follows them. Pure: no React, no network.
import type { AgentConfig } from '../types/studio';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = <T = unknown,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export const DAYS: Day[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const DAY_NAMES: Record<Day, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

/** One weekly window: on these days, from start up to (not including) end. */
export interface WeeklyRule {
  days: Day[];
  start: string;
  end: string;
}
export interface Schedule {
  description?: string;
  timezone: string;
  weekly: WeeklyRule[];
  holidays?: string[];
  overrides?: Record<string, 'closed' | { start: string; end: string }>;
}

/** "08:30" -> 510; "24:00" -> 1440; anything else -> null. */
export function minutesOf(text: unknown): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(String(text ?? ''));
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes <= 1440 && Number(m[2]) < 60 ? minutes : null;
}
const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** For each day, the open windows [from, to) in minutes, merged and sorted. */
export function weekWindows(schedule: unknown): Record<Day, [number, number][]> {
  const week = Object.fromEntries(DAYS.map((d) => [d, [] as [number, number][]])) as Record<Day, [number, number][]>;
  list<Json>(isObj(schedule) ? schedule.weekly : [])
    .filter(isObj)
    .forEach((rule) => {
      const from = minutesOf(rule.start);
      const to = minutesOf(rule.end);
      if (from === null || to === null || to <= from) return;
      list<string>(rule.days).forEach((day) => {
        if (week[day as Day]) week[day as Day].push([from, to]);
      });
    });
  DAYS.forEach((day) => {
    const merged: [number, number][] = [];
    week[day]
      .sort((a, b) => a[0] - b[0])
      .forEach((w) => {
        const last = merged[merged.length - 1];
        if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1]);
        else merged.push([w[0], w[1]]);
      });
    week[day] = merged;
  });
  return week;
}

/** "Monday to Friday 08:00–20:00; Saturday 09:00–17:00.", days that share their hours grouped, runs shortened. */
export function describeWeek(schedule: unknown): string {
  const week = weekWindows(schedule);
  const hours = (day: Day) => week[day].map(([a, b]) => `${clock(a)}–${clock(b)}`).join(', ');
  const groups: { text: string; days: Day[] }[] = [];
  DAYS.forEach((day) => {
    const text = hours(day);
    if (!text) return;
    const last = groups[groups.length - 1];
    if (last && last.text === text && DAYS.indexOf(last.days[last.days.length - 1]) === DAYS.indexOf(day) - 1) last.days.push(day);
    else groups.push({ text, days: [day] });
  });
  if (!groups.length) return 'Never open.';
  if (groups.length === 1 && groups[0].days.length === 7 && groups[0].text === '00:00–24:00') return 'Open all day, every day.';
  return `${groups
    .map((g) => `${g.days.length > 2 ? `${DAY_NAMES[g.days[0]]} to ${DAY_NAMES[g.days[g.days.length - 1]]}` : g.days.map((d) => DAY_NAMES[d]).join(' and ')} ${g.text}`)
    .join('; ')}.`;
}

/** Closed days and exceptions, in date order (a holiday wins over an exception on the same day). */
export function exceptions(schedule: unknown): { date: string; text: string }[] {
  const s = isObj(schedule) ? schedule : {};
  const holidays = list<string>(s.holidays);
  const out = holidays.map((date) => ({ date, text: 'Closed all day' }));
  if (isObj(s.overrides))
    Object.entries(s.overrides).forEach(([date, value]) => {
      if (holidays.includes(date)) return;
      out.push({ date, text: value === 'closed' ? 'Closed all day' : isObj(value) ? `Open ${String(value.start)}–${String(value.end)}` : 'Different hours' });
    });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Is it open at this weekday and minute? Turning a date into the schedule's time zone is the caller's job. */
export const openAt = (schedule: unknown, day: Day, minutes: number): boolean => (weekWindows(schedule)[day] ?? []).some(([a, b]) => minutes >= a && minutes < b);

// ---- where a schedule is followed ---------------------------------------------------------------------------------------------------------------
/** The places that follow a schedule (a `schedule` key naming it: a phone transfer, a condition), as paths. */
export function scheduleUses(config: AgentConfig, id: string): (string | number)[][] {
  const out: (string | number)[][] = [];
  const walk = (value: unknown, path: (string | number)[]) => {
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, [...path, i]));
    else if (isObj(value))
      Object.entries(value).forEach(([key, v]) => {
        if (key === 'schedule' && v === id) out.push([...path, key]);
        else walk(v, [...path, key]);
      });
  };
  Object.entries(isObj(config) ? config : {}).forEach(([key, v]) => {
    if (key !== 'schedules') walk(v, [key]);
  });
  return out;
}

/** A place that follows a schedule, in words: "Phone transfer “desk”", "a condition in Tools". */
export function followerWords(config: AgentConfig, path: (string | number)[]): string {
  if (path[0] === 'telephony' && path[1] === 'transfers' && typeof path[2] === 'number') {
    const t = list<Json>(config?.telephony?.transfers)[path[2]];
    return `the phone transfer “${isObj(t) && typeof t.id === 'string' ? t.id : path[2]}”`;
  }
  const where: Record<string, string> = { tools: 'a tool', agents: 'an agent', tasks: 'a task', guardrails: 'a guardrail', telephony: 'the phone settings' };
  return `a condition in ${where[String(path[0])] ?? String(path[0])}`;
}

export const schedulesOf = (config: AgentConfig): [string, Json][] => Object.entries(isObj(config?.schedules) ? (config.schedules as Json) : {}).filter((e): e is [string, Json] => isObj(e[1]));

/** Business hours in a few words: one schedule's week and time zone, or the names of several. */
export function scheduleWords(config: AgentConfig): string {
  const all = schedulesOf(config);
  if (!all.length) return 'None yet. Opening hours your hand-overs and rules can follow; on their own they change nothing.';
  if (all.length === 1) {
    const [, s] = all[0];
    return `${describeWeek(s).replace(/[.]$/, '')}${typeof s.timezone === 'string' && s.timezone ? `, ${s.timezone}` : ''}`;
  }
  return `${all.length} schedules: ${all.map(([id, s]) => (typeof s.description === 'string' && s.description.trim()) || id.replace(/[_-]+/g, ' ')).join(', ')}`;
}

// ---- editing ------------------------------------------------------------------------------------------------------------------------------------
export const SCHEDULE_ID = /^[a-z][a-z0-9_-]{0,63}$/;
export const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const START = /^([01]\d|2[0-3]):[0-5]\d$/;
export const END = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

/** The starter: Monday to Friday, 9 to 5, in the time zone given (the browser's, never a guess). */
export function officeHours(timezone: string): Schedule {
  return { description: 'Office hours', timezone, weekly: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '17:00' }] };
}

/** A schedule id not taken yet. */
export function freeScheduleId(config: AgentConfig, base = 'business_hours'): string {
  const taken = new Set(schedulesOf(config).map(([id]) => id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
}

/** The config with schedule `id` set to `schedule` (null takes it away; the last one takes `schedules` away). */
export function setSchedule(config: AgentConfig, id: string, schedule: Schedule | Json | null): AgentConfig {
  const next = clone(config);
  const all: Json = { ...(isObj(next.schedules) ? (next.schedules as Json) : {}) };
  if (schedule) all[id] = clone(schedule);
  else delete all[id];
  if (Object.keys(all).length) next.schedules = all;
  else delete next.schedules;
  return next;
}

/** Renames a schedule and every place that follows it. '' and the new id when it is fine; else why not. */
export function renameSchedule(config: AgentConfig, from: string, to: string): { config: AgentConfig; problem: string } {
  const id = to.trim();
  if (id === from) return { config, problem: '' };
  if (!SCHEDULE_ID.test(id)) return { config, problem: 'Use lowercase letters, digits, _ or -, starting with a letter.' };
  if (schedulesOf(config).some(([k]) => k === id)) return { config, problem: `“${id}” is already a schedule.` };
  const uses = scheduleUses(config, from);
  const next = clone(config);
  const all = next.schedules as Json;
  next.schedules = Object.fromEntries(Object.entries(all).map(([k, v]) => [k === from ? id : k, v]));
  uses.forEach((path) => {
    let at: unknown = next;
    path.slice(0, -1).forEach((p) => (at = (at as Json)[p as string]));
    (at as Json).schedule = id;
  });
  return { config: next, problem: '' };
}

/** A weekly window, changed: days ticked, a start or an end. */
export function setWindow(schedule: Json, index: number, change: Partial<WeeklyRule>): Json {
  const weekly = list<Json>(schedule.weekly).map((w) => ({ ...w }));
  if (!weekly[index]) return schedule;
  if (change.days) weekly[index].days = DAYS.filter((d) => change.days?.includes(d));
  if (change.start !== undefined) weekly[index].start = change.start;
  if (change.end !== undefined) weekly[index].end = change.end;
  return { ...schedule, weekly };
}
export const addWindow = (schedule: Json): Json => ({ ...schedule, weekly: [...list(schedule.weekly), { days: ['sat'], start: '09:00', end: '13:00' }] });
/** The last window stays (the schema needs one); to close the line, remove the schedule. */
export const removeWindow = (schedule: Json, index: number): Json => (list(schedule.weekly).length > 1 ? { ...schedule, weekly: list(schedule.weekly).filter((_, i) => i !== index) } : schedule);

/** A closed day or a day with other hours. `hours` null: closed all day. */
export function addException(schedule: Json, date: string, hours: { start: string; end: string } | null): Json {
  if (!DATE.test(date)) return schedule;
  if (!hours) {
    const holidays = Array.from(new Set([...list<string>(schedule.holidays), date])).sort();
    const overrides = { ...(isObj(schedule.overrides) ? schedule.overrides : {}) };
    delete overrides[date];
    const next: Json = { ...schedule, holidays };
    if (Object.keys(overrides).length) next.overrides = overrides;
    else delete next.overrides;
    return next;
  }
  const overrides = { ...(isObj(schedule.overrides) ? schedule.overrides : {}), [date]: hours };
  const holidays = list<string>(schedule.holidays).filter((d) => d !== date);
  const next: Json = { ...schedule, overrides };
  if (holidays.length) next.holidays = holidays;
  else delete next.holidays;
  return next;
}
export function removeException(schedule: Json, date: string): Json {
  const next: Json = { ...schedule };
  const holidays = list<string>(schedule.holidays).filter((d) => d !== date);
  if (holidays.length) next.holidays = holidays;
  else delete next.holidays;
  const overrides = { ...(isObj(schedule.overrides) ? schedule.overrides : {}) };
  delete overrides[date];
  if (Object.keys(overrides).length) next.overrides = overrides;
  else delete next.overrides;
  return next;
}

/** Problems with a schedule as typed, in words (the server says the same on Save, later and further away). */
export function scheduleProblems(schedule: Json): string[] {
  const out: string[] = [];
  if (!String(schedule.timezone ?? '').trim()) out.push('It needs a time zone, such as Europe/London.');
  list<Json>(schedule.weekly).forEach((w, i) => {
    const n = list(schedule.weekly).length > 1 ? ` ${i + 1}` : '';
    if (!list(w.days).length) out.push(`Window${n} has no days ticked.`);
    if (!START.test(String(w.start))) out.push(`Window${n} needs a start like 09:00.`);
    if (!END.test(String(w.end))) out.push(`Window${n} needs an end like 17:00 (24:00 for midnight).`);
    const a = minutesOf(w.start);
    const b = minutesOf(w.end);
    if (a !== null && b !== null && b <= a) out.push(`Window${n} ends before it starts.`);
  });
  return out;
}
