import type { AuditEntryDto, BookingDetailDto, RequestDetailDto, RequestsResponse } from "@shared/api";
import { localToUtc } from "@shared/time";
import { describe, expect, it } from "vitest";
import { book, household, okResult, only, type Client } from "./helpers";

const D = "2030-10-30";
const timed = (startTime: string, endTime: string, extra: Record<string, unknown> = {}) => ({
  startDate: D,
  endDate: D,
  allDay: false,
  startTime,
  endTime,
  ...extra,
});

async function setup(first: [string, string], second: [string, string]) {
  const h = await household();
  const target = only(await book(h.tim, timed(...first)));
  const res = okResult(await book(h.lena, timed(...second)));
  const incoming = res.bookings[0]!;
  const request = res.requests[0]!;
  return { ...h, target, incoming, request };
}

const respond = (c: Client, id: string, json: unknown) => c.json<RequestDetailDto>(`/api/requests/${id}/respond`, { method: "POST", json });
const detail = (c: Client, id: string) => c.json<BookingDetailDto>(`/api/bookings/${id}`).then((r) => r.body);

describe("Klar, nimm's (grant)", () => {
  it("shortens the own booking to the start of the request", async () => {
    const { tim, lena, target, incoming, request } = await setup(["15:00", "18:30"], ["18:00", "23:00"]);
    const res = await respond(tim, request.id, { action: "grant" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("granted");
    const t = await detail(tim, target.id);
    expect(t.booking).toMatchObject({ status: "active", endsAt: localToUtc(D, "18:00"), originalEndsAt: localToUtc(D, "18:30") });
    expect(t.incoming[0]).toMatchObject({ status: "granted", decidedBy: tim.id });
    expect((await detail(lena, incoming.id)).booking.status).toBe("active");
  });

  it("splits the own booking when the request lies in the middle", async () => {
    const { tim, target, request } = await setup(["08:00", "20:00"], ["12:00", "14:00"]);
    await respond(tim, request.id, { action: "grant" });
    const t = await detail(tim, target.id);
    expect(t.booking.endsAt).toBe(localToUtc(D, "12:00"));
    const day = await tim.json<{ bookings: { ownerId: string; startsAt: string; endsAt: string; status: string }[] }>(
      `/api/bookings?from=${localToUtc(D, "00:00")}&to=${localToUtc(D, "24:00")}`,
    );
    const timParts = day.body.bookings.filter((b) => b.ownerId === tim.id).map((b) => [b.startsAt, b.endsAt]);
    expect(timParts).toEqual([
      [localToUtc(D, "08:00"), localToUtc(D, "12:00")],
      [localToUtc(D, "14:00"), localToUtc(D, "20:00")],
    ]);
  });

  it("cancels the own booking when the request covers it completely", async () => {
    const { tim, target, request } = await setup(["10:00", "12:00"], ["09:00", "13:00"]);
    await respond(tim, request.id, { action: "grant" });
    expect((await detail(tim, target.id)).booking.status).toBe("cancelled");
  });
});

describe("Brauch's bis X (counter)", () => {
  it("starts the request at X and confirms it immediately", async () => {
    const { tim, lena, target, incoming, request } = await setup(["15:00", "18:30"], ["18:00", "23:00"]);
    const res = await respond(tim, request.id, { action: "counter", counterTime: localToUtc(D, "18:30") });
    expect(res.body).toMatchObject({ status: "partial", counterTime: localToUtc(D, "18:30") });
    const inc = await detail(lena, incoming.id);
    expect(inc.booking).toMatchObject({ status: "active", startsAt: localToUtc(D, "18:30"), originalStartsAt: localToUtc(D, "18:00") });
    expect((await detail(tim, target.id)).booking.endsAt).toBe(localToUtc(D, "18:30"));
  });

  it("shortens the own booking when X is earlier than its end (−15)", async () => {
    const { tim, target, request } = await setup(["15:00", "18:30"], ["18:00", "23:00"]);
    await respond(tim, request.id, { action: "counter", counterTime: localToUtc(D, "18:15") });
    expect((await detail(tim, target.id)).booking.endsAt).toBe(localToUtc(D, "18:15"));
  });

  it("extends the own booking when X is later than its end (+15)", async () => {
    const { tim, target, request } = await setup(["15:00", "18:30"], ["18:00", "23:00"]);
    await respond(tim, request.id, { action: "counter", counterTime: localToUtc(D, "18:45") });
    expect((await detail(tim, target.id)).booking.endsAt).toBe(localToUtc(D, "18:45"));
  });

  it("rejects X outside the requested time or off the 15-minute grid", async () => {
    const { tim, request } = await setup(["15:00", "18:30"], ["18:00", "23:00"]);
    expect((await respond(tim, request.id, { action: "counter", counterTime: localToUtc(D, "23:00") })).status).toBe(400);
    expect((await respond(tim, request.id, { action: "counter", counterTime: "2030-10-30T17:10:00.000Z" })).status).toBe(400);
  });

  it("lets the requester withdraw after a counter offer", async () => {
    const { tim, lena, incoming, request } = await setup(["15:00", "18:30"], ["18:00", "23:00"]);
    await respond(tim, request.id, { action: "counter", counterTime: localToUtc(D, "18:30") });
    const res = await lena.json<RequestDetailDto>(`/api/requests/${request.id}/withdraw`, { method: "POST" });
    expect(res.body.status).toBe("withdrawn");
    expect((await detail(lena, incoming.id)).booking.status).toBe("cancelled");
  });
});

describe("Nein, brauche es (decline)", () => {
  it("rejects the request and keeps the own booking", async () => {
    const { tim, lena, target, incoming, request } = await setup(["15:00", "18:30"], ["18:00", "23:00"]);
    await respond(tim, request.id, { action: "decline" });
    expect((await detail(lena, incoming.id)).booking.status).toBe("rejected");
    expect((await detail(tim, target.id)).booking.endsAt).toBe(localToUtc(D, "18:30"));
  });
});

describe("request rules", () => {
  it("only the first booker or the admin may answer", async () => {
    const { lena, request } = await setup(["15:00", "18:30"], ["18:00", "23:00"]);
    expect((await respond(lena, request.id, { action: "grant" })).status).toBe(403);
  });

  it("lets the admin decide on behalf and records it in the audit log", async () => {
    const { marc, lena, incoming, request } = await setup(["15:00", "18:30"], ["18:00", "23:00"]);
    const res = await respond(marc, request.id, { action: "grant" });
    expect(res.body).toMatchObject({ status: "granted", decidedBy: marc.id });
    expect((await detail(lena, incoming.id)).booking.status).toBe("active");
    const audit = await marc.json<{ entries: AuditEntryDto[] }>("/api/admin/audit");
    expect(audit.body.entries.find((e) => e.action === "request.granted")).toMatchObject({ source: "admin", actorId: marc.id });
  });

  it("cannot answer twice", async () => {
    const { tim, request } = await setup(["15:00", "18:30"], ["18:00", "23:00"]);
    await respond(tim, request.id, { action: "grant" });
    expect((await respond(tim, request.id, { action: "decline" })).status).toBe(409);
  });

  it("sends one sub-request per affected booking and activates only when all are resolved", async () => {
    const { marc, tim, lena } = await household();
    await book(tim, timed("08:00", "10:00"));
    await book(marc, timed("12:00", "14:00"));
    const res = okResult(await book(lena, timed("09:00", "13:00")));
    expect(res.requests).toHaveLength(2);
    const [r1, r2] = res.requests;
    const incomingId = res.bookings[0]!.id;
    const timReq = (await tim.json<RequestsResponse>("/api/requests")).body.incoming[0]!;
    const marcReq = (await marc.json<RequestsResponse>("/api/requests")).body.incoming[0]!;
    expect(new Set([timReq.id, marcReq.id])).toEqual(new Set([r1!.id, r2!.id]));
    await respond(tim, timReq.id, { action: "grant" });
    expect((await detail(lena, incomingId)).booking.status).toBe("requested");
    await respond(marc, marcReq.id, { action: "grant" });
    expect((await detail(lena, incomingId)).booking.status).toBe("active");
  });

  it("shows the first sent of two open requests for the same slot on top", async () => {
    const { marc, tim, lena } = await household();
    await book(tim, timed("08:00", "12:00"));
    const first = okResult(await book(lena, timed("10:00", "11:00"))).requests[0]!;
    const second = okResult(await book(marc, timed("10:00", "11:00"))).requests[0]!;
    const list = await tim.json<RequestsResponse>("/api/requests");
    expect(list.body.incoming.map((r) => r.id)).toEqual([first.id, second.id]);
    const own = await lena.json<RequestsResponse>("/api/requests");
    expect(own.body.outgoing.map((r) => r.id)).toEqual([first.id]);
  });

  it("lets the admin see other people's open requests", async () => {
    const { marc, request } = await setup(["15:00", "18:30"], ["18:00", "23:00"]);
    const list = await marc.json<RequestsResponse>("/api/requests");
    expect(list.body.others.map((r) => r.id)).toEqual([request.id]);
  });

  it("asks again if the slot was taken by someone else while the request was pending", async () => {
    const { marc, tim, lena } = await household();
    await book(tim, timed("08:00", "12:00"));
    const res = okResult(await book(lena, timed("10:00", "14:00")));
    // Marc books 12:00–14:00, which is free (Lena's booking is only requested).
    const marcBooking = only(await book(marc, timed("12:00", "14:00")));
    expect(marcBooking.status).toBe("active");
    await respond(tim, res.requests[0]!.id, { action: "grant" });
    const inc = await detail(lena, res.bookings[0]!.id);
    expect(inc.booking.status).toBe("requested");
    expect(inc.outgoing.filter((r) => r.status === "open").map((r) => r.targetBookingId)).toEqual([marcBooking.id]);
  });
});
