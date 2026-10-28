import { describe, expect, it } from "vitest";
import { defaultSeriesEnd, expandOccurrences } from "./series";
import { localToUtc } from "./time";

describe("expandOccurrences", () => {
  it("returns a single occurrence without repeat", () => {
    const occ = expandOccurrences({ startDate: "2026-10-28", endDate: "2026-10-28", allDay: true });
    expect(occ).toHaveLength(1);
  });

  it("creates weekly occurrences up to and including the end date", () => {
    const occ = expandOccurrences({
      startDate: "2026-10-28",
      endDate: "2026-10-28",
      allDay: false,
      startTime: "17:00",
      endTime: "22:00",
      repeat: "weekly",
      until: "2026-12-31",
    });
    expect(occ).toHaveLength(10);
    expect(occ.at(-1)?.startDate).toBe("2026-12-30");
  });

  it("keeps local wall-clock time across the DST change", () => {
    const occ = expandOccurrences({
      startDate: "2026-10-21",
      endDate: "2026-10-21",
      allDay: false,
      startTime: "17:00",
      endTime: "22:00",
      repeat: "weekly",
      until: "2026-10-28",
    });
    expect(occ.map((o) => o.startsAt)).toEqual([localToUtc("2026-10-21", "17:00"), localToUtc("2026-10-28", "17:00")]);
    expect(occ[0]!.startsAt.slice(11, 16)).toBe("15:00");
    expect(occ[1]!.startsAt.slice(11, 16)).toBe("16:00");
  });

  it("supports every second week and multi-day occurrences", () => {
    const occ = expandOccurrences({
      startDate: "2026-11-06",
      endDate: "2026-11-08",
      allDay: true,
      repeat: "biweekly",
      until: "2026-12-04",
    });
    expect(occ.map((o) => o.startDate)).toEqual(["2026-11-06", "2026-11-20", "2026-12-04"]);
    expect(occ[0]!.endsAt).toBe(localToUtc("2026-11-09", "00:00"));
  });

  it("proposes the end of the current year", () => {
    expect(defaultSeriesEnd("2026-10-28")).toBe("2026-12-31");
  });
});
