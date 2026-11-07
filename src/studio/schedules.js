// A schedule (the config's `schedules`), open or closed at a moment by its own time zone: closed days win over one-off
// changes, which win over the week. Shared by the Channels page and the simulated agent (a transfer only during its
// hours). Pure: no DOM.

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// the date and time a schedule's own clock shows now: { date: 'YYYY-MM-DD', day: 'mon', minutes }
export function clockIn(timezone, now = new Date()) {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone || 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(now)
        .map((p) => [p.type, p.value]),
    );
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      day: parts.weekday.slice(0, 3).toLowerCase(),
      minutes: Number(parts.hour) * 60 + Number(parts.minute),
    };
  } catch {
    return null;
  }
}
export const toMin = (t) => (typeof t === 'string' && /^\d\d:\d\d$/.test(t) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : null);
// open or closed now, by its own clock: closed days win over one-off changes, which win over the week
export function openNow(schedule, now = new Date()) {
  const clock = clockIn(schedule?.timezone, now);
  if (!clock) return null;
  if (list(schedule?.holidays).includes(clock.date)) return false;
  const once = isObj(schedule?.overrides) ? schedule.overrides[clock.date] : undefined;
  if (once === 'closed') return false;
  const inside = (r) => {
    const a = toMin(r.start);
    const b = toMin(r.end);
    return a !== null && b !== null && clock.minutes >= a && clock.minutes < b;
  };
  if (isObj(once)) return inside(once);
  return list(schedule?.weekly).some((r) => isObj(r) && list(r.days).includes(clock.day) && inside(r));
}
