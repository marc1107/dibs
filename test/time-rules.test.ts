import type { MutationResult } from "@shared/api";
import { localToUtc } from "@shared/time";
import { describe, expect, it } from "vitest";
import { cancelBooking, createBooking, endNow } from "../src/worker/services/bookings";
import { sendDueReminders } from "../src/worker/services/reminders";
import { Notifier } from "../src/worker/services/notifier";
import { updatePrefs } from "../src/worker/services/users";
import { household, serviceCtx, uuid } from "./helpers";

const D = "2030-10-30";
const at = (time: string) => new Date(localToUtc(D, time));

function ok(r: MutationResult) {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r;
}

async function setup() {
  const h = await household();
  const actor = { id: h.tim.id, name: "Tim", role: "member" as const };
  const ctx = (now: Date) => serviceCtx(actor, now);
  const b = ok(
    await createBooking(ctx(at("06:00")), {
      clientId: uuid(),
      startDate: D,
      endDate: D,
      allDay: false,
      startTime: "08:00",
      endTime: "18:00",
      repeat: "none",
      note: null,
    }),
  ).bookings[0]!;
  return { ...h, actor, ctx, b };
}

describe("Jetzt zurückgeben", () => {
  it("ends a running booking now and frees the rest", async () => {
    const { ctx, b } = await setup();
    const res = ok(await endNow(ctx(new Date(Date.parse(localToUtc(D, "15:20")) + 37_000)), b.id));
    expect(res.bookings[0]).toMatchObject({
      status: "ended_early",
      endsAt: localToUtc(D, "15:20"),
      originalEndsAt: localToUtc(D, "18:00"),
    });
  });

  it("refuses bookings that have not started yet", async () => {
    const { ctx, b } = await setup();
    await expect(endNow(ctx(at("07:00")), b.id)).rejects.toMatchObject({ code: "not_started" });
  });
});

describe("cancelling depending on time", () => {
  it("stores a cancellation of a running booking as ended early", async () => {
    const { ctx, b } = await setup();
    const res = ok(await cancelBooking(ctx(at("12:00")), b.id, { clientId: uuid(), scope: "this" }));
    expect(res.outcome).toBe("ended_early");
    expect(res.bookings[0]).toMatchObject({ status: "ended_early", endsAt: localToUtc(D, "12:00") });
  });

  it("ignores and reports a cancellation of a booking that is already over", async () => {
    const { ctx, b } = await setup();
    const res = ok(await cancelBooking(ctx(at("19:00")), b.id, { clientId: uuid(), scope: "this" }));
    expect(res.outcome).toBe("ignored");
    expect(res.message).toMatch(/vorbei/);
    expect(res.bookings[0]!.status).toBe("active");
  });

  it("frees the rest for a waiting request when ended early", async () => {
    const { ctx, b, lena } = await setup();
    const lenaCtx = serviceCtx({ id: lena.id, name: "Lena", role: "member" }, at("06:30"));
    const req = ok(
      await createBooking(lenaCtx, { clientId: uuid(), startDate: D, endDate: D, allDay: false, startTime: "16:00", endTime: "20:00", repeat: "none", note: null }),
    ).bookings[0]!;
    expect(req.status).toBe("requested");
    const endCtx = ctx(at("15:00"));
    await endNow(endCtx, b.id);
    const after = await lenaCtx.db.query.booking.findFirst({ where: (t, { eq }) => eq(t.id, req.id) });
    expect(after?.status).toBe("active");
    expect(endCtx.notifier.peek().some((n) => n.type === "request_answer" && n.userIds.includes(lena.id))).toBe(true);
  });
});

describe("reminders", () => {
  it("are off by default", async () => {
    const { ctx } = await setup();
    const notifier = new Notifier();
    await sendDueReminders(ctx(at("07:00")).db, notifier, at("07:00"));
    expect(notifier.size).toBe(0);
  });

  it("are sent once, an hour before a timed booking, when enabled", async () => {
    const { ctx, actor } = await setup();
    await updatePrefs(ctx(at("06:00")), { notifications: { reminder: true } });
    const early = new Notifier();
    await sendDueReminders(ctx(at("06:45")).db, early, at("06:45"));
    expect(early.size).toBe(0);
    const due = new Notifier();
    await sendDueReminders(ctx(at("07:00")).db, due, at("07:00"));
    expect(due.peek()).toEqual([expect.objectContaining({ type: "reminder", userIds: [actor.id] })]);
    const again = new Notifier();
    await sendDueReminders(ctx(at("07:15")).db, again, at("07:15"));
    expect(again.size).toBe(0);
  });
});
