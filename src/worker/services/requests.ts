import type { RequestDetailDto, RequestsResponse } from "@shared/api";
import { counterPlan, grantEffect, type GrantEffect } from "@shared/resolution";
import type { RespondInput } from "@shared/schemas";
import { formatRange, utcToLocal, type Interval } from "@shared/time";
import { and, asc, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { booking, request } from "../db/schema";
import { AppError, forbidden, notFound } from "../lib/errors";
import { newId } from "../lib/ids";
import { coversWholeDays, endNowChanges, reevaluateRequestsTargeting, requestDetails, tryActivate } from "./bookings";
import { auditInsert, isAdmin, nowIso, sourceFor, type ServiceCtx } from "./context";
import { bookingSnapshot, loadBooking, toBookingDto, userNames, type BookingRow, type RequestRow } from "./mappers";
import { guard, GuardError, runBatch, type Statement } from "../lib/batch";

async function loadRequest(ctx: ServiceCtx, id: string) {
  const r = await ctx.db.query.request.findFirst({ where: eq(request.id, id) });
  if (!r) throw notFound("Anfrage nicht gefunden");
  const [incoming, target] = await Promise.all([loadBooking(ctx.db, r.bookingId), loadBooking(ctx.db, r.targetBookingId)]);
  if (!incoming || !target) throw notFound("Buchung zur Anfrage nicht gefunden");
  return { r, incoming, target };
}

/** Statements that apply a grant effect to the target booking (cut, trim, split or cancel). */
function applyEffect(ctx: ServiceCtx, target: BookingRow, effect: GrantEffect, reason: string): Statement[] {
  const now = nowIso(ctx);
  const source = sourceFor(ctx, target.ownerId);
  const update = (changes: Partial<BookingRow>, action: string) => {
    const after = { ...target, ...changes, updatedAt: now };
    const iv: Interval = { startsAt: after.startsAt, endsAt: after.endsAt };
    const withDays = { ...changes, allDay: coversWholeDays(iv), updatedAt: now };
    return [
      ctx.db.update(booking).set(withDays).where(eq(booking.id, target.id)),
      auditInsert(ctx, {
        action,
        bookingId: target.id,
        before: bookingSnapshot(target),
        after: { ...bookingSnapshot({ ...target, ...withDays }), reason },
        source,
      }),
    ];
  };
  switch (effect.kind) {
    case "none":
      return [];
    case "cancel":
      return update({ status: "cancelled" }, "booking.cancelled_by_request");
    case "shorten":
      return update({ endsAt: effect.endsAt }, "booking.shortened");
    case "trimStart":
      return update({ startsAt: effect.startsAt }, "booking.shortened");
    case "split": {
      const second = {
        id: newId(),
        ownerId: target.ownerId,
        createdBy: target.createdBy,
        seriesId: target.seriesId,
        startsAt: effect.secondStartsAt,
        endsAt: target.endsAt,
        originalStartsAt: effect.secondStartsAt,
        originalEndsAt: target.endsAt,
        allDay: coversWholeDays({ startsAt: effect.secondStartsAt, endsAt: target.endsAt }),
        status: "active" as const,
        note: target.note,
        clientId: `split:${newId()}`,
        timezone: target.timezone,
        reminderSentAt: target.reminderSentAt,
        createdAt: now,
        updatedAt: now,
      };
      return [
        ...update({ endsAt: effect.firstEndsAt }, "booking.split"),
        ctx.db.insert(booking).values(second),
        auditInsert(ctx, { action: "booking.split_part", bookingId: second.id, after: { ...bookingSnapshot(second), splitFrom: target.id, reason }, source }),
      ];
    }
  }
}

function requestAudit(ctx: ServiceCtx, r: RequestRow, after: Partial<RequestRow>, action: string, ownerId: string) {
  return auditInsert(ctx, {
    action,
    bookingId: r.bookingId,
    before: { requestId: r.id, status: r.status },
    after: { requestId: r.id, ...after },
    source: sourceFor(ctx, ownerId),
  });
}

export async function respond(ctx: ServiceCtx, requestId: string, input: RespondInput) {
  const { r, incoming, target } = await loadRequest(ctx, requestId);
  if (target.ownerId !== ctx.actor.id && !isAdmin(ctx)) throw forbidden("Nur die Erstbuchende (oder der Admin) kann antworten");
  if (r.status !== "open") throw new AppError("conflict", "Diese Anfrage wurde bereits beantwortet");

  const names = await userNames(ctx.db);
  const now = nowIso(ctx);
  const decided = { decidedBy: ctx.actor.id, decidedAt: now };
  const requesterName = names.get(incoming.ownerId) ?? "jemand";
  const answerer = names.get(target.ownerId) ?? "Die Erstbuchende";
  // Guard: if someone else answered in the meantime, the whole batch is rolled back.
  const statements: Statement[] = [guard(sql`NOT EXISTS (SELECT 1 FROM request WHERE id = ${r.id} AND status = 'open')`)];
  let answer: { title: string; body: string };

  if (input.action === "grant") {
    const effect = target.status === "active" ? grantEffect(target, incoming) : ({ kind: "none" } as const);
    statements.push(
      ...applyEffect(ctx, target, effect, `für ${requesterName}`),
      ctx.db.update(request).set({ status: "granted", ...decided }).where(eq(request.id, r.id)),
      requestAudit(ctx, r, { status: "granted" }, "request.granted", target.ownerId),
    );
    answer = { title: `${answerer}: Klar, nimm's`, body: formatRange(incoming, incoming.allDay) };
  } else if (input.action === "counter") {
    const x = input.counterTime;
    if (new Date(x).getTime() % (15 * 60_000) !== 0) throw new AppError("invalid", "Uhrzeit im 15-Minuten-Raster wählen");
    const plan = counterPlan(target, incoming, new Date(x).toISOString());
    if (!plan) throw new AppError("invalid", "X muss innerhalb der angefragten Zeit liegen");
    if (plan.extendTargetTo) {
      const blocking = await ctx.db
        .select()
        .from(booking)
        .where(
          and(
            eq(booking.status, "active"),
            ne(booking.ownerId, target.ownerId),
            ne(booking.id, incoming.id),
            lt(booking.startsAt, plan.extendTargetTo),
            gt(booking.endsAt, target.endsAt),
          ),
        );
      if (blocking.length > 0) throw new AppError("conflict", "Verlängern geht nicht, danach ist das Auto schon vergeben");
    }
    const extended = plan.extendTargetTo ? { ...target, endsAt: plan.extendTargetTo } : target;
    if (plan.extendTargetTo) statements.push(...applyEffect(ctx, target, { kind: "shorten", endsAt: plan.extendTargetTo }, "verlängert"));
    statements.push(
      ...applyEffect(ctx, extended, plan.effect, `für ${requesterName}`),
      ctx.db
        .update(booking)
        .set({ startsAt: plan.incoming.startsAt, allDay: coversWholeDays(plan.incoming), updatedAt: now })
        .where(eq(booking.id, incoming.id)),
      auditInsert(ctx, {
        action: "booking.counter_applied",
        bookingId: incoming.id,
        before: bookingSnapshot(incoming),
        after: bookingSnapshot({ ...incoming, startsAt: plan.incoming.startsAt }),
        source: sourceFor(ctx, target.ownerId),
      }),
      ctx.db.update(request).set({ status: "partial", counterTime: plan.incoming.startsAt, ...decided }).where(eq(request.id, r.id)),
      requestAudit(ctx, r, { status: "partial", counterTime: plan.incoming.startsAt }, "request.countered", target.ownerId),
    );
    answer = {
      title: `${answerer} braucht's bis ${utcToLocal(plan.incoming.startsAt).time}`,
      body: `Danach gehört das Auto dir: ${formatRange(plan.incoming, false)}. Du kannst die Anfrage noch zurückziehen.`,
    };
  } else {
    statements.push(
      ctx.db.update(request).set({ status: "declined", ...decided }).where(eq(request.id, r.id)),
      ctx.db
        .update(request)
        .set({ status: "withdrawn", decidedAt: now })
        .where(and(eq(request.bookingId, incoming.id), eq(request.status, "open"), ne(request.id, r.id))),
      ctx.db.update(booking).set({ status: "rejected", updatedAt: now }).where(eq(booking.id, incoming.id)),
      requestAudit(ctx, r, { status: "declined" }, "request.declined", target.ownerId),
      auditInsert(ctx, {
        action: "booking.rejected",
        bookingId: incoming.id,
        before: bookingSnapshot(incoming),
        after: bookingSnapshot({ ...incoming, status: "rejected" }),
        source: sourceFor(ctx, target.ownerId),
      }),
    );
    answer = { title: `${answerer} braucht das Auto selbst`, body: `Deine Anfrage ${formatRange(incoming, incoming.allDay)} wurde abgelehnt.` };
  }

  try {
    await runBatch(ctx.env.DB, statements);
  } catch (err) {
    if (err instanceof GuardError) throw new AppError("conflict", "Diese Anfrage wurde bereits beantwortet");
    throw err;
  }
  if (input.action !== "decline") await tryActivate(ctx, incoming.id);
  // Others waiting on the same first booking: it may no longer block them, or they now wait for the requester.
  if (input.action !== "decline") await reevaluateRequestsTargeting(ctx, [target.id]);

  const byAdmin = ctx.actor.id !== target.ownerId;
  ctx.notifier.add([incoming.ownerId], "request_answer", {
    ...answer,
    title: byAdmin ? `${ctx.actor.name} (Admin) hat entschieden` : answer.title,
    url: `/bookings/${incoming.id}`,
    tag: `request-${r.id}`,
  });
  if (byAdmin) {
    ctx.notifier.add([target.ownerId], "booking_changed", {
      title: `${ctx.actor.name} hat eine Anfrage von ${requesterName} entschieden`,
      body: answer.title,
      url: `/bookings/${target.id}`,
    });
  }
  return detailOf(ctx, r.id);
}

export async function withdraw(ctx: ServiceCtx, requestId: string) {
  const { r, incoming } = await loadRequest(ctx, requestId);
  const mayWithdraw = incoming.ownerId === ctx.actor.id || incoming.createdBy === ctx.actor.id || isAdmin(ctx);
  if (!mayWithdraw) throw forbidden("Nur die Anfragende kann zurückziehen");
  if (r.status !== "open" && r.status !== "partial") throw new AppError("conflict", "Diese Anfrage ist nicht mehr offen");

  const now = nowIso(ctx);
  if (incoming.status === "active" && incoming.endsAt <= now) throw new AppError("already_over", "Diese Buchung ist schon vorbei");
  const running = incoming.status === "active" && incoming.startsAt <= now;
  const bookingChanges = running ? endNowChanges(incoming, ctx.now, now) : { status: "cancelled" as const, updatedAt: now };
  const openOthers = await ctx.db
    .select()
    .from(request)
    .where(and(eq(request.bookingId, incoming.id), eq(request.status, "open")));

  await runBatch(ctx.env.DB, [
    ctx.db
      .update(request)
      .set({ status: "withdrawn", decidedAt: now })
      .where(and(eq(request.bookingId, incoming.id), inArray(request.status, ["open", "partial"]))),
    ctx.db.update(booking).set(bookingChanges).where(eq(booking.id, incoming.id)),
    requestAudit(ctx, r, { status: "withdrawn" }, "request.withdrawn", incoming.ownerId),
    auditInsert(ctx, {
      action: bookingChanges.status === "ended_early" ? "booking.ended_early" : "booking.cancelled",
      bookingId: incoming.id,
      before: bookingSnapshot(incoming),
      after: bookingSnapshot({ ...incoming, ...bookingChanges }),
      source: sourceFor(ctx, incoming.ownerId),
    }),
  ]);
  if (incoming.status === "active") await reevaluateRequestsTargeting(ctx, [incoming.id]);

  const names = await userNames(ctx.db);
  const targetIds = [...new Set([r.targetBookingId, ...openOthers.map((o) => o.targetBookingId)])];
  const targets = await ctx.db.select().from(booking).where(inArray(booking.id, targetIds));
  ctx.notifier.add(
    targets.map((t) => t.ownerId),
    "booking_changed",
    {
      title: `${names.get(incoming.ownerId) ?? "Jemand"} hat die Anfrage zurückgezogen`,
      body: formatRange(incoming, incoming.allDay),
      url: `/requests`,
      tag: `request-${r.id}`,
    },
  );
  return detailOf(ctx, r.id);
}

async function detailOf(ctx: ServiceCtx, id: string): Promise<RequestDetailDto> {
  const r = await ctx.db.query.request.findFirst({ where: eq(request.id, id) });
  const [detail] = await requestDetails(ctx, r ? [r] : []);
  if (!detail) throw notFound();
  return detail;
}

export async function getRequest(ctx: ServiceCtx, id: string): Promise<RequestDetailDto> {
  return detailOf(ctx, id);
}

export async function listRequests(ctx: ServiceCtx): Promise<RequestsResponse> {
  const incomingB = alias(booking, "incoming_b");
  const targetB = alias(booking, "target_b");
  const now = nowIso(ctx);
  const rows = await ctx.db
    .select({ r: request, incoming: incomingB, target: targetB })
    .from(request)
    .innerJoin(incomingB, eq(incomingB.id, request.bookingId))
    .innerJoin(targetB, eq(targetB.id, request.targetBookingId))
    .where(inArray(request.status, ["open", "partial"]))
    .orderBy(asc(request.createdAt));

  const me = ctx.actor.id;
  const toDetail = (x: (typeof rows)[number]): RequestDetailDto => ({
    id: x.r.id,
    bookingId: x.r.bookingId,
    targetBookingId: x.r.targetBookingId,
    status: x.r.status,
    counterTime: x.r.counterTime,
    decidedBy: x.r.decidedBy,
    createdAt: x.r.createdAt,
    decidedAt: x.r.decidedAt,
    booking: toBookingDto(x.incoming),
    target: toBookingDto(x.target),
  });
  // First sent first: open requests to me are ordered by creation time.
  const incoming = rows.filter((x) => x.r.status === "open" && x.target.ownerId === me).map(toDetail);
  const outgoing = rows
    .filter((x) => x.incoming.ownerId === me && (x.r.status === "open" || x.incoming.endsAt > now))
    .filter((x) => x.incoming.status === "requested" || x.incoming.status === "active")
    .map(toDetail);
  const others = isAdmin(ctx)
    ? rows.filter((x) => x.r.status === "open" && x.target.ownerId !== me && x.incoming.ownerId !== me).map(toDetail)
    : [];
  return { incoming, outgoing, others };
}
