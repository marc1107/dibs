import type { AuditEntryDto, BookingsResponse, SyncResponse } from "@shared/api";
import { describe, expect, it } from "vitest";
import { book, household, only, uuid } from "./helpers";

const day = (startDate: string) => ({ clientId: uuid(), startDate, endDate: startDate, allDay: true });

describe("offline sync", () => {
  it("applies queued actions in order and reports a result per action", async () => {
    const { tim } = await household();
    const existing = only(await book(tim, { startDate: "2030-11-04", endDate: "2030-11-04" }));
    const create = day("2030-11-05");
    const res = await tim.json<SyncResponse>("/api/sync", {
      method: "POST",
      json: {
        actions: [
          { type: "create", payload: create, queuedOffline: true },
          { type: "cancel", bookingId: existing.id, payload: { clientId: uuid(), baseUpdatedAt: existing.updatedAt }, queuedOffline: true },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.results.map((r) => [r.clientId === create.clientId, r.ok && r.outcome])).toEqual([
      [true, "created"],
      [false, "cancelled"],
    ]);
  });

  it("turns a booking whose slot was taken meanwhile into a request (server receive time counts)", async () => {
    const { tim, lena } = await household();
    await book(lena, { startDate: "2030-11-05", endDate: "2030-11-05" });
    const res = await tim.json<SyncResponse>("/api/sync", {
      method: "POST",
      json: { actions: [{ type: "create", payload: day("2030-11-05"), queuedOffline: true }] },
    });
    expect(res.body.results[0]).toMatchObject({ ok: true, outcome: "requested" });
  });

  it("lets the server state win for edits of meanwhile changed bookings", async () => {
    const { marc, tim } = await household();
    const b = only(await book(tim, { startDate: "2030-11-05", endDate: "2030-11-05" }));
    await marc.fetch(`/api/bookings/${b.id}`, { method: "PATCH", json: { ...day("2030-11-05"), note: "vom Admin" } });
    const res = await tim.json<SyncResponse>("/api/sync", {
      method: "POST",
      json: {
        actions: [
          { type: "update", bookingId: b.id, payload: { ...day("2030-11-06"), baseUpdatedAt: b.updatedAt }, queuedOffline: true },
        ],
      },
    });
    expect(res.body.results[0]).toMatchObject({ ok: false, error: "stale", server: { note: "vom Admin" } });
  });

  it("applies edits of unchanged own bookings", async () => {
    const { tim } = await household();
    const b = only(await book(tim, { startDate: "2030-11-05", endDate: "2030-11-05" }));
    const res = await tim.json<SyncResponse>("/api/sync", {
      method: "POST",
      json: {
        actions: [{ type: "update", bookingId: b.id, payload: { ...day("2030-11-06"), baseUpdatedAt: b.updatedAt }, queuedOffline: true }],
      },
    });
    expect(res.body.results[0]).toMatchObject({ ok: true, outcome: "updated" });
  });

  it("never duplicates when the same batch is sent twice", async () => {
    const { tim } = await household();
    const json = { actions: [{ type: "create", payload: day("2030-11-05"), queuedOffline: true }] };
    const a = await tim.json<SyncResponse>("/api/sync", { method: "POST", json });
    const b = await tim.json<SyncResponse>("/api/sync", { method: "POST", json });
    expect(b.body).toEqual(a.body);
    const all = await tim.json<BookingsResponse>("/api/bookings?from=2030-11-01T00:00:00Z&to=2030-12-01T00:00:00Z");
    expect(all.body.bookings).toHaveLength(1);
  });

  it("marks queued actions as offline-sync in the audit log", async () => {
    const { marc, tim } = await household();
    await tim.fetch("/api/sync", { method: "POST", json: { actions: [{ type: "create", payload: day("2030-11-05"), queuedOffline: true }] } });
    const audit = await marc.json<{ entries: AuditEntryDto[] }>("/api/admin/audit");
    expect(audit.body.entries.find((e) => e.action === "booking.created")).toMatchObject({ source: "offline-sync", actorId: tim.id });
  });

  it("does not accept another person's action IDs", async () => {
    const { tim, lena } = await household();
    const payload = day("2030-11-05");
    await tim.fetch("/api/sync", { method: "POST", json: { actions: [{ type: "create", payload }] } });
    const res = await lena.json<SyncResponse>("/api/sync", { method: "POST", json: { actions: [{ type: "create", payload }] } });
    expect(res.body.results[0]).toMatchObject({ ok: false, error: "forbidden" });
  });
});
