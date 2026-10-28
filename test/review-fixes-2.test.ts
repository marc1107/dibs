import type { BookingsResponse, SyncResponse } from "@shared/api";
import { localToUtc } from "@shared/time";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/worker/db/client";
import { booking } from "../src/worker/db/schema";
import { guard, GuardError, runBatch } from "../src/worker/lib/batch";
import { otherActiveOverlaps } from "../src/worker/services/bookings";
import { book, household, only, uuid } from "./helpers";

const D = "2030-10-30";
const timed = (startTime: string, endTime: string) => ({ startDate: D, endDate: D, allDay: false, startTime, endTime });
const day = (startDate: string) => ({ clientId: uuid(), startDate, endDate: startDate, allDay: true });

describe("sync attributes failures to the right action", () => {
  it("rejects only the malformed action and applies the others", async () => {
    const { tim } = await household();
    const res = await tim.json<SyncResponse>("/api/sync", {
      method: "POST",
      json: {
        actions: [
          { type: "create", payload: day("2030-11-04") },
          { type: "create", payload: { ...day("2030-11-05"), endDate: "2030-11-01" } },
          { type: "create", payload: day("2030-11-06") },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.results.map((r) => (r.ok ? r.outcome : r.error))).toEqual(["created", "invalid", "created"]);
  });

  it("stops at an unexpected failure, reports it for that action and keeps earlier results", async () => {
    const { tim } = await household();
    const failing = { ...day("2030-11-05"), repeat: "weekly", until: "2030-11-30" };
    await env.DB.prepare("ALTER TABLE series RENAME TO series_hidden").run();
    let res;
    try {
      res = await tim.json<SyncResponse>("/api/sync", {
        method: "POST",
        json: { actions: [{ type: "create", payload: day("2030-11-04") }, { type: "create", payload: failing }, { type: "create", payload: day("2030-11-06") }] },
      });
    } finally {
      await env.DB.prepare("ALTER TABLE series_hidden RENAME TO series").run();
    }
    expect(res.status).toBe(200);
    expect(res.body.results.map((r) => [r.clientId === failing.clientId, r.ok ? r.outcome : r.error])).toEqual([
      [false, "created"],
      [true, "server"],
    ]);
    // Nothing of the failed action was stored, so a retry succeeds.
    const retry = await tim.json<SyncResponse>("/api/sync", { method: "POST", json: { actions: [{ type: "create", payload: failing }] } });
    expect(retry.body.results[0]).toMatchObject({ ok: true, outcome: "created" });
  });
});

describe("write-time overlap guard for edits", () => {
  it("rolls back an edit that would overlap another person's active booking", async () => {
    const { tim, lena } = await household();
    only(await book(tim, timed("10:00", "12:00")));
    const lenaBooking = only(await book(lena, timed("08:00", "09:00")));
    const db = createDb(env.DB);
    const moved = [{ startsAt: localToUtc(D, "10:30"), endsAt: localToUtc(D, "11:00") }];
    await expect(
      runBatch(env.DB, [
        guard(otherActiveOverlaps(lena.id, moved, [lenaBooking.id])),
        db.update(booking).set({ startsAt: moved[0]!.startsAt, endsAt: moved[0]!.endsAt }).where(eq(booking.id, lenaBooking.id)),
      ]),
    ).rejects.toBeInstanceOf(GuardError);
    const after = await db.query.booking.findFirst({ where: eq(booking.id, lenaBooking.id) });
    expect(after?.startsAt).toBe(lenaBooking.startsAt);
  });

  it("lets non-overlapping and own intervals through", async () => {
    const { tim } = await household();
    const own = only(await book(tim, timed("10:00", "12:00")));
    const free = [{ startsAt: localToUtc(D, "12:00"), endsAt: localToUtc(D, "13:00") }, { startsAt: own.startsAt, endsAt: own.endsAt }];
    await expect(runBatch(env.DB, [guard(otherActiveOverlaps(tim.id, free, [own.id]))])).resolves.toHaveLength(1);
  });

  it("never leaves two overlapping active bookings when an edit races a new booking", async () => {
    const { tim, lena } = await household();
    const lenaBooking = only(await book(lena, timed("08:00", "09:00")));
    await Promise.all([
      lena.fetch(`/api/bookings/${lenaBooking.id}`, { method: "PATCH", json: { clientId: uuid(), ...timed("10:00", "11:00") } }),
      book(tim, timed("10:00", "11:00")),
    ]);
    const all = await tim.json<BookingsResponse>(`/api/bookings?from=${localToUtc(D, "00:00")}&to=${localToUtc(D, "24:00")}`);
    const active = all.body.bookings.filter((b) => b.status === "active");
    for (const a of active) {
      for (const b of active) {
        if (a.ownerId !== b.ownerId) expect(a.startsAt < b.endsAt && a.endsAt > b.startsAt).toBe(false);
      }
    }
  });
});
