import type { BookingDetailDto, BookingsResponse, HistoryResponse, MutationResult } from "@shared/api";
import { localToUtc } from "@shared/time";
import { describe, expect, it } from "vitest";
import { book, household, okResult, only, uuid } from "./helpers";

const range = "from=2030-01-01T00:00:00Z&to=2031-01-01T00:00:00Z";

describe("creating bookings", () => {
  it("books a whole day as 00:00–24:00 Berlin time", async () => {
    const { tim } = await household();
    const b = only(await book(tim, { startDate: "2030-10-30", endDate: "2030-10-30" }));
    expect(b).toMatchObject({
      status: "active",
      allDay: true,
      startsAt: localToUtc("2030-10-30", "00:00"),
      endsAt: localToUtc("2030-10-31", "00:00"),
    });
    expect(b.originalStartsAt).toBe(b.startsAt);
  });

  it("books a timed range with Von on the first and Bis on the last day", async () => {
    const { tim } = await household();
    const b = only(
      await book(tim, { startDate: "2030-10-30", endDate: "2030-11-01", allDay: false, startTime: "17:00", endTime: "09:30" }),
    );
    expect(b.startsAt).toBe(localToUtc("2030-10-30", "17:00"));
    expect(b.endsAt).toBe(localToUtc("2030-11-01", "09:30"));
  });

  it("turns an overlapping booking into a request instead of rejecting it (202)", async () => {
    const { tim, lena } = await household();
    const first = only(await book(tim, { startDate: "2030-10-30", endDate: "2030-10-30", allDay: false, startTime: "17:00", endTime: "18:30" }));
    const res = await book(lena, { startDate: "2030-10-30", endDate: "2030-10-30", allDay: false, startTime: "18:00", endTime: "23:00" });
    expect(res.status).toBe(202);
    const result = okResult(res);
    expect(result.outcome).toBe("requested");
    expect(result.bookings[0]!.status).toBe("requested");
    expect(result.requests).toEqual([expect.objectContaining({ targetBookingId: first.id, status: "open" })]);
  });

  it("does not ask people about overlaps with their own bookings", async () => {
    const { tim } = await household();
    await book(tim, { startDate: "2030-10-30", endDate: "2030-10-30" });
    const second = await book(tim, { startDate: "2030-10-30", endDate: "2030-10-30", allDay: false, startTime: "10:00", endTime: "11:00" });
    expect(only(second).status).toBe("active");
  });

  it("treats touching bookings as free", async () => {
    const { tim, lena } = await household();
    await book(tim, { startDate: "2030-10-30", endDate: "2030-10-30", allDay: false, startTime: "08:00", endTime: "12:00" });
    const b = only(await book(lena, { startDate: "2030-10-30", endDate: "2030-10-30", allDay: false, startTime: "12:00", endTime: "14:00" }));
    expect(b.status).toBe("active");
  });

  it("is idempotent per client UUID", async () => {
    const { tim } = await household();
    const body = { clientId: uuid(), startDate: "2030-10-30", endDate: "2030-10-30", allDay: true };
    const a = await tim.json<MutationResult>("/api/bookings", { method: "POST", json: body });
    const b = await tim.json<MutationResult>("/api/bookings", { method: "POST", json: body });
    expect(b.body).toEqual(a.body);
    const all = await tim.json<BookingsResponse>(`/api/bookings?${range}`);
    expect(all.body.bookings).toHaveLength(1);
  });

  it("validates input with the shared schema", async () => {
    const { tim } = await household();
    const cases = [
      { startDate: "2030-10-30", endDate: "2030-10-29" },
      { startDate: "2030-10-30", endDate: "2030-10-30", allDay: false, startTime: "17:10", endTime: "18:00" },
      { startDate: "2030-10-30", endDate: "2030-10-30", allDay: false, startTime: "18:00", endTime: "17:00" },
      { startDate: "2030-10-30", endDate: "2030-10-30", repeat: "weekly" },
      { startDate: "2030-02-30", endDate: "2030-02-30" },
    ];
    for (const c of cases) expect((await book(tim, c)).status).toBe(400);
  });
});

describe("series", () => {
  const weekly = { startDate: "2030-10-02", endDate: "2030-10-02", allDay: false, startTime: "17:00", endTime: "22:00", repeat: "weekly", until: "2030-12-31" };

  it("materialises every occurrence as its own booking", async () => {
    const { tim } = await household();
    const res = okResult(await book(tim, weekly));
    expect(res.bookings).toHaveLength(13);
    expect(new Set(res.bookings.map((b) => b.seriesId)).size).toBe(1);
    // Wall-clock time stays 17:00 across the DST change on 27 Oct 2030.
    expect(res.bookings[0]!.startsAt).toBe(localToUtc("2030-10-02", "17:00"));
    expect(res.bookings.at(-1)!.startsAt).toBe(localToUtc("2030-12-25", "17:00"));
  });

  it("turns only the colliding occurrence into a request", async () => {
    const { tim, lena } = await household();
    await book(lena, { startDate: "2030-10-16", endDate: "2030-10-16" });
    const res = okResult(await book(tim, weekly));
    expect(res.outcome).toBe("requested");
    const requested = res.bookings.filter((b) => b.status === "requested");
    expect(requested).toHaveLength(1);
    expect(requested[0]!.startsAt).toBe(localToUtc("2030-10-16", "17:00"));
    expect(res.bookings.filter((b) => b.status === "active")).toHaveLength(12);
    expect(res.requests).toHaveLength(1);
  });

  it("changes a single occurrence without touching the rest", async () => {
    const { tim } = await household();
    const res = okResult(await book(tim, weekly));
    const second = res.bookings[1]!;
    const upd = await tim.json<MutationResult>(`/api/bookings/${second.id}`, {
      method: "PATCH",
      json: { clientId: uuid(), startDate: "2030-10-10", endDate: "2030-10-10", allDay: false, startTime: "08:00", endTime: "09:00", scope: "this" },
    });
    expect(okResult(upd).bookings[0]!.startsAt).toBe(localToUtc("2030-10-10", "08:00"));
    const all = await tim.json<BookingsResponse>(`/api/bookings?${range}`);
    expect(all.body.bookings.filter((b) => b.startsAt.endsWith(localToUtc("2030-10-02", "17:00").slice(10)))).not.toHaveLength(0);
    expect(all.body.bookings.find((b) => b.id === res.bookings[2]!.id)!.startsAt).toBe(localToUtc("2030-10-16", "17:00"));
  });

  it("changes this and all following occurrences and splits the series", async () => {
    const { tim } = await household();
    const res = okResult(await book(tim, weekly));
    const third = res.bookings[2]!;
    const upd = okResult(
      await tim.json<MutationResult>(`/api/bookings/${third.id}`, {
        method: "PATCH",
        json: { clientId: uuid(), startDate: "2030-10-16", endDate: "2030-10-16", allDay: false, startTime: "18:00", endTime: "20:00", note: "Training", scope: "following" },
      }),
    );
    expect(upd.bookings).toHaveLength(11);
    expect(upd.bookings.every((b) => b.note === "Training")).toBe(true);
    expect(upd.bookings[0]!.startsAt).toBe(localToUtc("2030-10-16", "18:00"));
    expect(upd.bookings.at(-1)!.endsAt).toBe(localToUtc("2030-12-25", "20:00"));
    expect(upd.bookings[0]!.seriesId).not.toBe(third.seriesId);
    const first = await tim.json<BookingDetailDto>(`/api/bookings/${res.bookings[0]!.id}`);
    expect(first.body.booking.startsAt).toBe(localToUtc("2030-10-02", "17:00"));
  });

  it("cancels this and all following occurrences", async () => {
    const { tim } = await household();
    const res = okResult(await book(tim, weekly));
    const out = okResult(
      await tim.json<MutationResult>(`/api/bookings/${res.bookings[10]!.id}/cancel`, { method: "POST", json: { clientId: uuid(), scope: "following" } }),
    );
    expect(out.bookings.every((b) => b.status === "cancelled")).toBe(true);
    expect(out.bookings).toHaveLength(3);
    const all = await tim.json<BookingsResponse>(`/api/bookings?${range}`);
    expect(all.body.bookings).toHaveLength(10);
  });
});

describe("editing and cancelling", () => {
  it("refuses to move an active booking onto someone else's slot", async () => {
    const { tim, lena } = await household();
    await book(lena, { startDate: "2030-10-31", endDate: "2030-10-31" });
    const b = only(await book(tim, { startDate: "2030-10-30", endDate: "2030-10-30" }));
    const res = await tim.json<MutationResult>(`/api/bookings/${b.id}`, {
      method: "PATCH",
      json: { clientId: uuid(), startDate: "2030-10-30", endDate: "2030-10-31", allDay: true },
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ ok: false, error: "conflict" });
  });

  it("reports stale edits with the current server state", async () => {
    const { marc, tim } = await household();
    const b = only(await book(tim, { startDate: "2030-10-30", endDate: "2030-10-30" }));
    await marc.fetch(`/api/bookings/${b.id}`, {
      method: "PATCH",
      json: { clientId: uuid(), startDate: "2030-10-30", endDate: "2030-10-30", allDay: false, startTime: "08:00", endTime: "10:00" },
    });
    const res = await tim.json<MutationResult>(`/api/bookings/${b.id}`, {
      method: "PATCH",
      json: { clientId: uuid(), startDate: "2030-10-30", endDate: "2030-10-30", allDay: true, note: "x", baseUpdatedAt: b.updatedAt },
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ ok: false, error: "stale", server: { startsAt: localToUtc("2030-10-30", "08:00") } });
  });

  it("keeps cancelled bookings out of the calendar but in the history", async () => {
    const { tim } = await household();
    const b = only(await book(tim, { startDate: "2030-10-30", endDate: "2030-10-30", note: "Baumarkt" }));
    await tim.fetch(`/api/bookings/${b.id}/cancel`, { method: "POST", json: { clientId: uuid() } });
    const cal = await tim.json<BookingsResponse>(`/api/bookings?${range}`);
    expect(cal.body.bookings).toHaveLength(0);
    const hist = await tim.json<HistoryResponse>("/api/history");
    expect(hist.body.bookings[0]).toMatchObject({ id: b.id, status: "cancelled", note: "Baumarkt" });
    expect(hist.body.audit.map((a) => a.action)).toEqual(expect.arrayContaining(["booking.created", "booking.cancelled"]));
    const cancelled = hist.body.audit.find((a) => a.action === "booking.cancelled")!;
    expect(cancelled.before).toMatchObject({ status: "active" });
    expect(cancelled.after).toMatchObject({ status: "cancelled" });
  });

  it("activates a waiting request automatically when the first booking is cancelled", async () => {
    const { tim, lena } = await household();
    const first = only(await book(tim, { startDate: "2030-10-30", endDate: "2030-10-30" }));
    const req = only(await book(lena, { startDate: "2030-10-30", endDate: "2030-10-30" }));
    expect(req.status).toBe("requested");
    await tim.fetch(`/api/bookings/${first.id}/cancel`, { method: "POST", json: { clientId: uuid() } });
    const detail = await lena.json<BookingDetailDto>(`/api/bookings/${req.id}`);
    expect(detail.body.booking.status).toBe("active");
    expect(detail.body.outgoing[0]!.status).toBe("granted");
  });
});
