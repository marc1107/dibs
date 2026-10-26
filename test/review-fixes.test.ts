import type { BookingDetailDto, MutationResult, RequestsResponse, SyncResponse } from "@shared/api";
import { localToUtc } from "@shared/time";
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createBooking, endNow } from "../src/worker/services/bookings";
import { respond, withdraw } from "../src/worker/services/requests";
import { book, household, okResult, serviceCtx, uuid } from "./helpers";

const D = "2030-10-30";
const timed = (startTime: string, endTime: string) => ({ startDate: D, endDate: D, allDay: false, startTime, endTime });

describe("requests waiting on the same first booking", () => {
  it("are re-evaluated when the first booker gives way to someone else", async () => {
    const { marc, tim, lena } = await household();
    await book(tim, timed("10:00", "14:00"));
    const lenaReq = okResult(await book(lena, timed("12:00", "16:00"))).requests[0]!;
    const marcRes = okResult(await book(marc, timed("13:00", "14:00")));
    await tim.fetch(`/api/requests/${lenaReq.id}/respond`, { method: "POST", json: { action: "grant" } });

    // Tim no longer blocks Marc; Marc now waits for Lena (whose booking just became active).
    const timInbox = await tim.json<RequestsResponse>("/api/requests");
    expect(timInbox.body.incoming).toHaveLength(0);
    const marcDetail = await marc.json<BookingDetailDto>(`/api/bookings/${marcRes.bookings[0]!.id}`);
    const open = marcDetail.body.outgoing.filter((r) => r.status === "open");
    expect(open.map((r) => r.target.ownerId)).toEqual([lena.id]);
  });
});

describe("idempotency", () => {
  it("returns the existing bookings when a create is replayed after its stored result was lost", async () => {
    const { tim } = await household();
    const payload = { clientId: uuid(), startDate: D, endDate: D, allDay: true };
    const first = await tim.json<SyncResponse>("/api/sync", { method: "POST", json: { actions: [{ type: "create", payload }] } });
    await env.DB.prepare("DELETE FROM client_action").run();
    const replay = await tim.json<SyncResponse>("/api/sync", { method: "POST", json: { actions: [{ type: "create", payload }] } });
    expect(replay.status).toBe(200);
    expect(replay.body.results[0]).toMatchObject({ ok: true, outcome: "created" });
    const ids = (r: SyncResponse) => (r.results[0] as Extract<MutationResult, { ok: true }>).bookings.map((b) => b.id);
    expect(ids(replay.body)).toEqual(ids(first.body));
  });
});

describe("answer guards", () => {
  it("applies an answer only once even if two answers race", async () => {
    const { marc, tim, lena } = await household();
    await book(tim, timed("08:00", "20:00"));
    const req = okResult(await book(lena, timed("12:00", "14:00"))).requests[0]!;
    const timCtx = serviceCtx({ id: tim.id, name: "Tim", role: "member" }, new Date("2030-10-01T00:00:00Z"));
    const marcCtx = serviceCtx({ id: marc.id, name: "Marc", role: "admin" }, new Date("2030-10-01T00:00:00Z"));
    const results = await Promise.allSettled([respond(timCtx, req.id, { action: "grant" }), respond(marcCtx, req.id, { action: "grant" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const parts = await env.DB.prepare("SELECT count(*) AS n FROM booking WHERE owner_id = ? AND status = 'active'").bind(tim.id).first<{ n: number }>();
    expect(parts?.n).toBe(2);
  });

  it("refuses to withdraw a confirmed request whose booking is already over", async () => {
    const { tim, lena } = await household();
    await book(tim, timed("15:00", "18:30"));
    const res = okResult(await book(lena, timed("18:00", "23:00")));
    await tim.fetch(`/api/requests/${res.requests[0]!.id}/respond`, { method: "POST", json: { action: "counter", counterTime: localToUtc(D, "18:30") } });
    const lenaCtx = serviceCtx({ id: lena.id, name: "Lena", role: "member" }, new Date(localToUtc("2030-10-31", "08:00")));
    await expect(withdraw(lenaCtx, res.requests[0]!.id)).rejects.toMatchObject({ code: "already_over" });
  });
});

describe("returning the car in the first minute", () => {
  it("cancels instead of storing a zero-length booking", async () => {
    const { tim } = await household();
    const actor = { id: tim.id, name: "Tim", role: "member" as const };
    const created = await createBooking(serviceCtx(actor, new Date(localToUtc(D, "06:00"))), {
      clientId: uuid(), ...timed("08:00", "10:00"), repeat: "none", note: null,
    });
    const b = okResult({ body: created }).bookings[0]!;
    const res = await endNow(serviceCtx(actor, new Date(Date.parse(localToUtc(D, "08:00")) + 30_000)), b.id);
    expect(okResult({ body: res }).bookings[0]!.status).toBe("cancelled");
  });
});
