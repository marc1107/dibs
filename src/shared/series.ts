import type { Repeat } from "./constants";
import { addDays, diffDays, toInterval, type Interval, type LocalDate, type LocalTime } from "./time";

export interface OccurrenceSpec {
  startDate: LocalDate;
  endDate: LocalDate;
  allDay: boolean;
  startTime?: LocalTime | null;
  endTime?: LocalTime | null;
  repeat?: Repeat;
  until?: LocalDate | null;
}

export interface Occurrence extends Interval {
  startDate: LocalDate;
}

const STEP_DAYS: Record<Repeat, number> = { none: 0, weekly: 7, biweekly: 14 };

/**
 * Materialises a booking (or a whole series) into concrete UTC intervals.
 * Each occurrence is computed from local wall-clock values, so a weekly 17:00 slot
 * stays at 17:00 across daylight-saving changes.
 */
export function expandOccurrences(spec: OccurrenceSpec): Occurrence[] {
  const span = diffDays(spec.startDate, spec.endDate);
  const step = STEP_DAYS[spec.repeat ?? "none"];
  const one = (startDate: LocalDate): Occurrence => ({
    startDate,
    ...toInterval({ ...spec, startDate, endDate: addDays(startDate, span) }),
  });

  if (step === 0 || !spec.until) return [one(spec.startDate)];

  const out: Occurrence[] = [];
  for (let date = spec.startDate; diffDays(date, spec.until) >= 0; date = addDays(date, step)) {
    out.push(one(date));
  }
  return out;
}

/** Proposed series end: last day of the current year. */
export function defaultSeriesEnd(startDate: LocalDate): LocalDate {
  return `${startDate.slice(0, 4)}-12-31`;
}
