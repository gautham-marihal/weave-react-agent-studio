// A schedule (business hours) as a week you can see: seven rows, one bar per day, shaded where the line is open; plus the same thing in words, and the days
// that are closed or different on purpose (holidays, one-off exceptions). Pure: no React, no DOM.

import { isObj } from '../form/engine.js';

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const list = (v) => (Array.isArray(v) ? v : []);

// "08:30" -> 510; "24:00" -> 1440; anything else -> null
export function minutesOf(text) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(text || ''));
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes <= 1440 && Number(m[2]) < 60 ? minutes : null;
}
const clock = (minutes) =>
  `${String(Math.floor(minutes / 60) % 24 === 0 && minutes >= 1440 ? 24 : Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

// For each day, the open windows [from, to) in minutes, merged and sorted.
export function weekWindows(schedule) {
  const week = Object.fromEntries(DAYS.map((d) => [d, []]));
  list(schedule?.weekly)
    .filter(isObj)
    .forEach((rule) => {
      const from = minutesOf(rule.start);
      const to = minutesOf(rule.end);
      if (from === null || to === null || to <= from) return;
      list(rule.days).forEach((day) => {
        if (week[day]) week[day].push([from, to]);
      });
    });
  DAYS.forEach((day) => {
    const sorted = week[day].sort((a, b) => a[0] - b[0]);
    const merged = [];
    sorted.forEach((w) => {
      const last = merged[merged.length - 1];
      if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1]);
      else merged.push([...w]);
    });
    week[day] = merged;
  });
  return week;
}

// "Monday to Friday 08:00–20:00; Saturday 09:00–17:00", days that share their hours grouped, runs of days shortened.
export function describeWeek(schedule) {
  const week = weekWindows(schedule);
  const hours = (day) => week[day].map(([a, b]) => `${clock(a)}–${clock(b)}`).join(', ');
  const groups = [];
  DAYS.forEach((day) => {
    const text = hours(day);
    if (!text) return;
    const last = groups[groups.length - 1];
    if (last && last.text === text && DAYS.indexOf(last.days[last.days.length - 1]) === DAYS.indexOf(day) - 1) last.days.push(day);
    else groups.push({ text, days: [day] });
  });
  if (!groups.length) return 'Never open.';
  if (groups.length === 1 && groups[0].days.length === 7 && groups[0].text === '00:00–24:00') return 'Open all day, every day.';
  return `${groups.map((g) => `${g.days.length > 2 ? `${DAY_NAMES[g.days[0]]} to ${DAY_NAMES[g.days[g.days.length - 1]]}` : g.days.map((d) => DAY_NAMES[d]).join(' and ')} ${g.text}`).join('; ')}.`;
}

// Closed days and exceptions, in date order.
export function exceptions(schedule) {
  const out = [];
  list(schedule?.holidays).forEach((date) => out.push({ date, text: 'Closed all day' }));
  if (isObj(schedule?.overrides))
    Object.entries(schedule.overrides).forEach(([date, value]) => {
      if (list(schedule?.holidays).includes(date)) return; // a holiday wins
      out.push({ date, text: value === 'closed' ? 'Closed all day' : isObj(value) ? `Open ${value.start}–${value.end}` : 'Different hours' });
    });
  return out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

// Is the line open at this moment (a Date in the schedule's own time zone is the caller's job: this takes the weekday and minutes)?
export function openAt(schedule, day, minutes) {
  return (weekWindows(schedule)[day] || []).some(([a, b]) => minutes >= a && minutes < b);
}
