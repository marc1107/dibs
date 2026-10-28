import { localToUtc } from "@shared/time";
import { describe, expect, it } from "vitest";
import type { ViewBooking } from "./calendar";
import { applyOutbox, type OutboxEntry } from "./overlay";

const existing: ViewBooking = {
  id: "b1",
  ownerId: "tim",
  createdBy: "tim",
  seriesId: null,
  startsAt: localToUtc("2026-10-28", "00:00"),
  endsAt: localToUtc("2026-10-29", "00:00"),
  originalStartsAt: localToUtc("2026-10-28", "00:00"),
  originalEndsAt: localToUtc("2026-10-29", "00:00"),
  allDay: true,
  status: "active",
  note: null,
  createdAt: "",
  updatedAt: "",
};

const entry = (action: OutboxEntry["action"]): OutboxEntry => ({
  clientId: "c1",
  seq: 1,
  action,
  queuedOffline: true,
  createdAt: "2026-10-26T07:00:00.000Z",
  label: "",
});

describe("applyOutbox", () => {
  it("shows queued bookings as pending and predicts requests", () => {
    const list = applyOutbox(
      [existing],
      [entry({ type: "create", payload: { clientId: crypto.randomUUID(), startDate: "2026-10-28", endDate: "2026-10-28", allDay: true } })],
      "lena",
    );
    expect(list).toHaveLength(2);
    expect(list[1]).toMatchObject({ pending: true, ownerId: "lena", status: "requested" });
  });

  it("applies queued cancellations and edits", () => {
    const cancelled = applyOutbox([existing], [entry({ type: "cancel", bookingId: "b1", payload: { clientId: crypto.randomUUID() } })], "tim");
    expect(cancelled[0]).toMatchObject({ status: "cancelled", pending: true });
    const edited = applyOutbox(
      [existing],
      [
        entry({
          type: "update",
          bookingId: "b1",
          payload: { clientId: crypto.randomUUID(), startDate: "2026-10-28", endDate: "2026-10-28", allDay: false, startTime: "08:00", endTime: "09:00" },
        }),
      ],
      "tim",
    );
    expect(edited[0]).toMatchObject({ startsAt: localToUtc("2026-10-28", "08:00"), allDay: false, pending: true });
  });
});
