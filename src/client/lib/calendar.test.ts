import { localToUtc } from "@shared/time";
import { describe, expect, it } from "vitest";
import { currentHolder, daySegments, findConflicts, monthGrid, type ViewBooking } from "./calendar";

const booking = (over: Partial<ViewBooking>): ViewBooking => ({
  id: "b1",
  ownerId: "tim",
  createdBy: "tim",
  seriesId: null,
  startsAt: localToUtc("2026-10-28", "17:00"),
  endsAt: localToUtc("2026-10-28", "22:00"),
  originalStartsAt: localToUtc("2026-10-28", "17:00"),
  originalEndsAt: localToUtc("2026-10-28", "22:00"),
  allDay: false,
  status: "active",
  note: null,
  createdAt: "",
  updatedAt: "",
  ...over,
});

describe("monthGrid", () => {
  it("starts on Monday (October 2026 starts on a Thursday)", () => {
    const cells = monthGrid(2026, 10);
    expect(cells.slice(0, 3).every((c) => c.date === null)).toBe(true);
    expect(cells[3]!.date).toBe("2026-10-01");
    expect(cells.at(-1)!.date).toBe("2026-10-31");
  });
});

describe("daySegments", () => {
  it("marks whole days as full and timed parts with their position", () => {
    const full = booking({ startsAt: localToUtc("2026-10-24", "00:00"), endsAt: localToUtc("2026-10-27", "00:00"), allDay: true });
    expect(daySegments([full], "2026-10-25")[0]).toMatchObject({ full: true, from: 0, to: 1 });
    const part = daySegments([booking({})], "2026-10-28")[0]!;
    expect(part.full).toBe(false);
    expect(part.from).toBeCloseTo(17 / 24);
  });

  it("shows the freed rest of an early return separately", () => {
    const b = booking({ status: "ended_early", endsAt: localToUtc("2026-10-28", "19:00") });
    const segs = daySegments([b], "2026-10-28");
    expect(segs.map((s) => s.freed)).toEqual([false, true]);
  });

  it("hides cancelled bookings", () => {
    expect(daySegments([booking({ status: "cancelled" })], "2026-10-28")).toEqual([]);
  });
});

describe("currentHolder", () => {
  it("finds the booking running now", () => {
    expect(currentHolder([booking({})], new Date(localToUtc("2026-10-28", "18:00")))?.id).toBe("b1");
    expect(currentHolder([booking({})], new Date(localToUtc("2026-10-28", "23:00")))).toBeUndefined();
  });
});

describe("findConflicts", () => {
  it("ignores own and non-active bookings and sums overlap minutes", () => {
    const iv = [{ startsAt: localToUtc("2026-10-28", "21:30"), endsAt: localToUtc("2026-10-28", "23:00") }];
    const list = [booking({}), booking({ id: "own", ownerId: "lena" }), booking({ id: "req", status: "requested" })];
    expect(findConflicts(list, "lena", iv)).toEqual([{ booking: list[0], minutes: 30 }]);
  });
});
