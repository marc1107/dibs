import type { BookingDto } from "@shared/api";
import { addDays, isoWeekday, localToUtc, overlaps, overlapMinutes, todayLocal, type Interval, type LocalDate } from "@shared/time";

/** A booking as shown in the UI; `pending` = still in the offline outbox ("wird gesendet"). */
export type ViewBooking = BookingDto & { pending?: boolean };

export interface MonthCell {
  date: LocalDate | null;
}

/** Monday-first grid for a month (leading blanks, no trailing blanks). */
export function monthGrid(year: number, month: number): MonthCell[] {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: MonthCell[] = Array.from({ length: isoWeekday(first) - 1 }, () => ({ date: null }));
  for (let d = 0; d < days; d++) cells.push({ date: addDays(first, d) });
  return cells;
}

export function monthRange(year: number, month: number): Interval {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return { startsAt: localToUtc(first, "00:00"), endsAt: localToUtc(next, "00:00") };
}

export function dayInterval(date: LocalDate): Interval {
  return { startsAt: localToUtc(date, "00:00"), endsAt: localToUtc(date, "24:00") };
}

/** Monday of the week containing `date`. */
export function weekStart(date: LocalDate): LocalDate {
  return addDays(date, 1 - isoWeekday(date));
}

export interface DaySegment {
  booking: ViewBooking;
  /** Booking covers the whole local day. */
  full: boolean;
  /** Position within the day, 0–1. */
  from: number;
  to: number;
  /** Freed rest after "Jetzt zurückgeben" (shown grey striped). */
  freed: boolean;
}

/** What to draw for one calendar day, in start order. */
export function daySegments(bookings: ViewBooking[], date: LocalDate): DaySegment[] {
  const day = dayInterval(date);
  const span = Date.parse(day.endsAt) - Date.parse(day.startsAt);
  const pos = (iso: string) => Math.min(1, Math.max(0, (Date.parse(iso) - Date.parse(day.startsAt)) / span));
  const out: DaySegment[] = [];
  for (const b of bookings) {
    if (b.status === "cancelled" || b.status === "rejected") continue;
    if (overlaps(b, day)) {
      out.push({ booking: b, full: b.startsAt <= day.startsAt && b.endsAt >= day.endsAt, from: pos(b.startsAt), to: pos(b.endsAt), freed: false });
    }
    if (b.status === "ended_early" && b.originalEndsAt > b.endsAt) {
      const rest = { startsAt: b.endsAt, endsAt: b.originalEndsAt };
      if (overlaps(rest, day)) out.push({ booking: b, full: false, from: pos(rest.startsAt), to: pos(rest.endsAt), freed: true });
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

/** The active booking holding the car right now. */
export function currentHolder(bookings: ViewBooking[], now: Date): ViewBooking | undefined {
  const t = now.toISOString();
  return bookings.find((b) => (b.status === "active" || b.status === "ended_early") && b.startsAt <= t && b.endsAt > t);
}

export function upcoming(bookings: ViewBooking[], now: Date, limit = 5): ViewBooking[] {
  const t = now.toISOString();
  return bookings
    .filter((b) => (b.status === "active" || b.status === "requested") && b.endsAt > t)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, limit);
}

export interface Conflict {
  booking: ViewBooking;
  minutes: number;
}

/** Client-side preview of the server rule: other people's active bookings that overlap. */
export function findConflicts(bookings: ViewBooking[], ownerId: string, intervals: Interval[], excludeId?: string): Conflict[] {
  const out: Conflict[] = [];
  for (const b of bookings) {
    if (b.status !== "active" || b.ownerId === ownerId || b.id === excludeId) continue;
    const minutes = intervals.reduce((sum, iv) => sum + overlapMinutes(b, iv), 0);
    if (minutes > 0) out.push({ booking: b, minutes });
  }
  return out.sort((a, b) => a.booking.startsAt.localeCompare(b.booking.startsAt));
}

export const isPast = (date: LocalDate, now = new Date()) => date < todayLocal(now);
