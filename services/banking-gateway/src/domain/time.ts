// Bank-local time. Every business rule in the deck (greetings, cut-offs, office hours, "7 calendar days") is in
// Singapore time, whatever time zone the server runs in.

export const BANK_TIME_ZONE = 'Asia/Singapore';

export interface LocalParts {
  /** YYYY-MM-DD in bank time. */
  readonly date: string;
  /** 0 = Sunday … 6 = Saturday. */
  readonly weekday: number;
  readonly hour: number;
  readonly minute: number;
  /** Minutes since local midnight. */
  readonly minutes: number;
}

const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: BANK_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
});

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function localParts(epochMs: number): LocalParts {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(epochMs)).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAYS.indexOf(String(parts.weekday)),
    hour,
    minute,
    minutes: hour * 60 + minute,
  };
}

/** "HH:MM" → minutes since midnight. */
export function clockMinutes(hhmm: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) throw new RangeError(`Expected HH:MM, got ${hhmm}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Adds whole days to a YYYY-MM-DD date (calendar arithmetic, no time zone involved). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Deck p1: 0000-1159 morning, 1200-1759 afternoon, 1800-2359 evening. */
export function greetingPeriod(epochMs: number): 'morning' | 'afternoon' | 'evening' {
  const { hour } = localParts(epochMs);
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}
