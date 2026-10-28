import { TZDate } from "@date-fns/tz";
import { SLOT_MINUTES, TIMEZONE } from "./constants";

/** A calendar date in Europe/Berlin, "YYYY-MM-DD". */
export type LocalDate = string;
/** A wall-clock time in Europe/Berlin, "HH:mm" (or "24:00" as an end time). */
export type LocalTime = string;

export interface Interval {
  startsAt: string;
  endsAt: string;
}

const DAY_MS = 86_400_000;

function parseDate(date: LocalDate): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y!, m!, d!];
}

function parseTime(time: LocalTime): [number, number] {
  const [h, m] = time.split(":").map(Number);
  return [h!, m!];
}

/** Adds whole calendar days to a local date (DST-agnostic, pure date arithmetic). */
export function addDays(date: LocalDate, days: number): LocalDate {
  const [y, m, d] = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Number of calendar days from `a` to `b` (b - a). */
export function diffDays(a: LocalDate, b: LocalDate): number {
  const [ay, am, ad] = parseDate(a);
  const [by, bm, bd] = parseDate(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS);
}

/** ISO weekday, Monday = 1 … Sunday = 7. */
export function isoWeekday(date: LocalDate): number {
  const [y, m, d] = parseDate(date);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Converts a Berlin wall-clock moment to a UTC ISO string. "24:00" means 00:00 of the next day. */
export function localToUtc(date: LocalDate, time: LocalTime): string {
  if (time === "24:00") return localToUtc(addDays(date, 1), "00:00");
  const [y, m, d] = parseDate(date);
  const [hh, mm] = parseTime(time);
  return new Date(+new TZDate(y, m - 1, d, hh, mm, TIMEZONE)).toISOString();
}

/** Splits a UTC instant into Berlin local date and time. */
export function utcToLocal(iso: string): { date: LocalDate; time: LocalTime } {
  const z = new TZDate(iso, TIMEZONE);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${z.getFullYear()}-${pad(z.getMonth() + 1)}-${pad(z.getDate())}`,
    time: `${pad(z.getHours())}:${pad(z.getMinutes())}`,
  };
}

/** Local end date/time for display: an end at local midnight is shown as "24:00" of the previous day. */
export function utcToLocalEnd(iso: string): { date: LocalDate; time: LocalTime } {
  const local = utcToLocal(iso);
  if (local.time === "00:00") return { date: addDays(local.date, -1), time: "24:00" };
  return local;
}

export function todayLocal(now: Date = new Date()): LocalDate {
  return utcToLocal(now.toISOString()).date;
}

/** Builds the UTC interval for a (possibly multi-day) booking. */
export function toInterval(spec: {
  startDate: LocalDate;
  endDate: LocalDate;
  allDay: boolean;
  startTime?: LocalTime | null;
  endTime?: LocalTime | null;
}): Interval {
  if (spec.allDay) {
    return { startsAt: localToUtc(spec.startDate, "00:00"), endsAt: localToUtc(spec.endDate, "24:00") };
  }
  return {
    startsAt: localToUtc(spec.startDate, spec.startTime ?? "00:00"),
    endsAt: localToUtc(spec.endDate, spec.endTime ?? "24:00"),
  };
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.startsAt < b.endsAt && a.endsAt > b.startsAt;
}

export function overlapMinutes(a: Interval, b: Interval): number {
  const start = Math.max(Date.parse(a.startsAt), Date.parse(b.startsAt));
  const end = Math.min(Date.parse(a.endsAt), Date.parse(b.endsAt));
  return Math.max(0, Math.round((end - start) / 60_000));
}

export function addMinutes(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

/** Rounds an instant down to the slot grid (used for "Jetzt zurückgeben"). */
export function floorToSlot(date: Date, slot = 1): string {
  const ms = slot * 60_000;
  return new Date(Math.floor(date.getTime() / ms) * ms).toISOString();
}

/** All valid times on the 15-minute grid, "00:00" … "23:45" (+ "24:00" for end times). */
export function timeSlots(includeMidnightEnd = false): LocalTime[] {
  const out: LocalTime[] = [];
  for (let m = 0; m < 24 * 60; m += SLOT_MINUTES) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  if (includeMidnightEnd) out.push("24:00");
  return out;
}

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MONTHS_SHORT = ["Jan", "Feb", "März", "Apr", "Mai", "Juni", "Juli", "Aug", "Sep", "Okt", "Nov", "Dez"];
export const MONTHS_LONG = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

/** "Mi 28. Okt" */
export function formatDay(date: LocalDate, withMonth = true): string {
  const [, m, d] = parseDate(date);
  const label = `${WEEKDAYS[isoWeekday(date) - 1]} ${d}.`;
  return withMonth ? `${label} ${MONTHS_SHORT[m - 1]}` : label;
}

/** Human-readable booking range, e.g. "Mi 28. Okt · 17:00–22:00" or "Fr 24. – So 26. Okt". */
export function formatRange(interval: Interval, allDay: boolean): string {
  const s = utcToLocal(interval.startsAt);
  const e = utcToLocalEnd(interval.endsAt);
  const sameMonth = s.date.slice(0, 7) === e.date.slice(0, 7);
  if (s.date === e.date) {
    return allDay ? formatDay(s.date) : `${formatDay(s.date)} · ${s.time}–${e.time}`;
  }
  if (allDay) return `${formatDay(s.date, !sameMonth)} – ${formatDay(e.date)}`;
  return `${formatDay(s.date)} ${s.time} – ${formatDay(e.date)} ${e.time}`;
}

/** "30 Min.", "2 Std.", "1 Std. 30 Min.", whole days as "1 Tag" / "3 Tage". */
export function formatDuration(minutes: number): string {
  if (minutes >= 1440 && minutes % 1440 === 0) {
    const d = minutes / 1440;
    return d === 1 ? "1 Tag" : `${d} Tage`;
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} Min.`;
  return m === 0 ? `${h} Std.` : `${h} Std. ${m} Min.`;
}
