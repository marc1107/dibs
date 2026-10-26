import { describe, expect, it } from "vitest";
import {
  addDays,
  diffDays,
  formatDuration,
  formatRange,
  isoWeekday,
  localToUtc,
  overlapMinutes,
  overlaps,
  toInterval,
  utcToLocal,
  utcToLocalEnd,
} from "./time";

describe("localToUtc", () => {
  it("converts winter time (CET, UTC+1)", () => {
    expect(localToUtc("2026-12-01", "17:00")).toBe("2026-12-01T16:00:00.000Z");
  });

  it("converts summer time (CEST, UTC+2)", () => {
    expect(localToUtc("2026-07-01", "17:00")).toBe("2026-07-01T15:00:00.000Z");
  });

  it("treats 24:00 as midnight of the next day", () => {
    expect(localToUtc("2026-10-28", "24:00")).toBe(localToUtc("2026-10-29", "00:00"));
  });

  it("handles the DST switch day (25 Oct 2026 has 25 hours)", () => {
    const start = localToUtc("2026-10-25", "00:00");
    const end = localToUtc("2026-10-25", "24:00");
    expect((Date.parse(end) - Date.parse(start)) / 3_600_000).toBe(25);
  });
});

describe("utcToLocal", () => {
  it("round-trips with localToUtc", () => {
    expect(utcToLocal(localToUtc("2026-03-29", "18:30"))).toEqual({ date: "2026-03-29", time: "18:30" });
  });

  it("shows an end at midnight as 24:00 of the previous day", () => {
    expect(utcToLocalEnd(localToUtc("2026-10-29", "00:00"))).toEqual({ date: "2026-10-28", time: "24:00" });
  });
});

describe("date arithmetic", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("counts days independent of DST", () => {
    expect(diffDays("2026-10-20", "2026-10-30")).toBe(10);
  });

  it("returns ISO weekdays", () => {
    expect(isoWeekday("2026-10-28")).toBe(3);
    expect(isoWeekday("2026-11-01")).toBe(7);
  });
});

describe("toInterval", () => {
  it("spans whole days for all-day bookings", () => {
    expect(toInterval({ startDate: "2026-10-24", endDate: "2026-10-26", allDay: true })).toEqual({
      startsAt: localToUtc("2026-10-24", "00:00"),
      endsAt: localToUtc("2026-10-27", "00:00"),
    });
  });

  it("uses Von for the first and Bis for the last day of a timed range", () => {
    expect(
      toInterval({ startDate: "2026-10-24", endDate: "2026-10-26", allDay: false, startTime: "17:00", endTime: "09:00" }),
    ).toEqual({ startsAt: localToUtc("2026-10-24", "17:00"), endsAt: localToUtc("2026-10-26", "09:00") });
  });
});

describe("overlaps", () => {
  const a = { startsAt: "2026-10-28T15:00:00.000Z", endsAt: "2026-10-28T16:30:00.000Z" };
  it("detects partial overlap and its length", () => {
    const b = { startsAt: "2026-10-28T16:00:00.000Z", endsAt: "2026-10-28T21:00:00.000Z" };
    expect(overlaps(a, b)).toBe(true);
    expect(overlapMinutes(a, b)).toBe(30);
  });

  it("does not treat touching intervals as overlapping", () => {
    const b = { startsAt: a.endsAt, endsAt: "2026-10-28T20:00:00.000Z" };
    expect(overlaps(a, b)).toBe(false);
  });
});

describe("formatting", () => {
  it("formats single days, ranges and durations in German", () => {
    expect(formatRange(toInterval({ startDate: "2026-10-28", endDate: "2026-10-28", allDay: false, startTime: "17:00", endTime: "22:00" }), false)).toBe(
      "Mi 28. Okt · 17:00–22:00",
    );
    expect(formatRange(toInterval({ startDate: "2026-10-24", endDate: "2026-10-26", allDay: true }), true)).toBe("Sa 24. – Mo 26. Okt");
    expect(formatDuration(30)).toBe("30 Min.");
    expect(formatDuration(90)).toBe("1 Std. 30 Min.");
  });
});
