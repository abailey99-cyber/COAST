/**
 * Working-time maths (decisions B14): weekdays only, within the working day,
 * in UK time, with an optional list of holidays (empty for now — England &
 * Wales bank holidays can be passed in later without changing callers).
 * Pure: the current time is always passed in.
 */

export interface WorkingCalendar {
  timeZone: string;
  /** Local hour the working day starts, e.g. 9. */
  dayStartHour: number;
  /** Local hour the working day ends, e.g. 17. */
  dayEndHour: number;
  /** Local calendar dates ("2026-12-25") that aren't working days. */
  holidays: readonly string[];
}

export const DEFAULT_CALENDAR: WorkingCalendar = {
  timeZone: "Europe/London",
  dayStartHour: 9,
  dayEndHour: 17,
  holidays: [],
};

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function localParts(date: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: WEEKDAYS[get("weekday")] ?? 0,
  };
}

/** The UTC instant of a local wall-clock time in `timeZone` (handles BST/GMT). */
export function zonedTime(year: number, month: number, day: number, hour: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour);
  const offset = (d: number) => {
    const p = localParts(new Date(d), timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - d;
  };
  let t = guess - offset(guess);
  t = guess - offset(t); // second pass settles DST edges
  return new Date(t);
}

function isoDay(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Working hours between two instants (0 if end ≤ start). */
export function workingHoursBetween(start: Date, end: Date, cal: WorkingCalendar = DEFAULT_CALENDAR): number {
  if (!(end.getTime() > start.getTime())) return 0;
  const startLocal = localParts(start, cal.timeZone);
  let ms = 0;
  // Walk local calendar days from the start's day to the end's day.
  let cursor = new Date(Date.UTC(startLocal.year, startLocal.month - 1, startLocal.day));
  for (let guard = 0; guard < 3700; guard++) {
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth() + 1;
    const d = cursor.getUTCDate();
    const dayStart = zonedTime(y, m, d, cal.dayStartHour, cal.timeZone);
    if (dayStart.getTime() >= end.getTime() && guard > 0) break;
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !cal.holidays.includes(isoDay(y, m, d))) {
      const dayEnd = zonedTime(y, m, d, cal.dayEndHour, cal.timeZone);
      const from = Math.max(dayStart.getTime(), start.getTime());
      const to = Math.min(dayEnd.getTime(), end.getTime());
      if (to > from) ms += to - from;
    }
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return ms / 3_600_000;
}
