import type { BookingDetailDto, BookingsResponse, HistoryResponse, MutationResult, RequestDetailDto } from "@shared/api";
import type { CancelBookingInput, CreateBookingInput, UpdateBookingInput } from "@shared/schemas";
import { expandOccurrences } from "@shared/series";
import {
  addDays,
  diffDays,
  floorToSlot,
  formatRange,
  overlapMinutes,
  toInterval,
  utcToLocal,
  utcToLocalEnd,
  type Interval,
} from "@shared/time";
import { and, desc, eq, gt, gte, inArray, lt, ne, or, sql } from "drizzle-orm";
import { auditLog, booking, request, series, user } from "../db/schema";
import { AppError, forbidden, notFound } from "../lib/errors";
import { newId } from "../lib/ids";
import { auditInsert, isAdmin, nowIso, sourceFor, type ServiceCtx } from "./context";
import { bookingSnapshot, loadBooking, toBookingDto, toRequestDto, userNames, type BookingRow } from "./mappers";
import { runBatch, type Statement } from "../lib/batch";

/** SQL fragment: another person's active booking `b` overlaps booking `n`. */
const OTHER_ACTIVE_OVERLAP = sql.raw(
  "b.status = 'active' AND b.owner_id != n.owner_id AND b.starts_at < n.ends_at AND b.ends_at > n.starts_at",
);

/** A booking covers whole Berlin days exactly when it starts and ends at local midnight. */
export function coversWholeDays(iv: Interval): boolean {
  return utcToLocal(iv.startsAt).time === "00:00" && utcToLocal(iv.endsAt).time === "00:00";
}

function canManage(ctx: ServiceCtx, b: BookingRow): boolean {
  return isAdmin(ctx) || b.ownerId === ctx.actor.id;
}

/** Active bookings of other people that overlap the interval. */
export async function conflictsFor(ctx: ServiceCtx, ownerId: string, iv: Interval, excludeIds: string[] = []) {
  const rows = await ctx.db
    .select()
    .from(booking)
    .where(
      and(
        eq(booking.status, "active"),
        ne(booking.ownerId, ownerId),
        lt(booking.startsAt, iv.endsAt),
        gt(booking.endsAt, iv.startsAt),
      ),
    );
  return rows.filter((r) => !excludeIds.includes(r.id));
}

function conflictMessage(conflicts: BookingRow[], names: Map<string, string>, iv: Interval): string {
  const c = conflicts[0]!;
  const who = names.get(c.ownerId) ?? "jemand anderem";
  const more = conflicts.length > 1 ? ` und ${conflicts.length - 1} weiteren` : "";
  return `Überschneidet sich mit ${who}${more} (${formatRange(c, c.allDay)}, ${overlapMinutes(c, iv)} Min.)`;
}

// ---------------------------------------------------------------------------
// Activation: a requested booking becomes active once nothing blocks it any more
// ---------------------------------------------------------------------------

/**
 * Re-evaluates a requested booking in one atomic batch:
 * 1. open requests whose target no longer overlaps (or is gone) are resolved automatically,
 * 2. the booking flips to active if no other active booking overlaps and no request is open,
 * 3. otherwise every overlapping active booking without an open request gets one.
 * Returns whether the booking was activated and which requests were newly created.
 */
export async function tryActivate(ctx: ServiceCtx, bookingId: string) {
  const now = nowIso(ctx);
  const openBefore = await ctx.db
    .select({ id: request.id })
    .from(request)
    .where(and(eq(request.bookingId, bookingId), eq(request.status, "open")));

  await runBatch(ctx.env.DB, [
    sql`
      UPDATE request SET status = 'granted', decided_at = ${now}
      WHERE booking_id = ${bookingId} AND status = 'open' AND target_booking_id IN (
        SELECT b.id FROM booking b, booking n
        WHERE n.id = ${bookingId} AND NOT (${OTHER_ACTIVE_OVERLAP})
      )`,
    sql`
      UPDATE booking SET status = 'active', updated_at = ${now}
      WHERE id = ${bookingId} AND status = 'requested'
        AND NOT EXISTS (SELECT 1 FROM booking b, booking n WHERE n.id = booking.id AND ${OTHER_ACTIVE_OVERLAP})
        AND NOT EXISTS (SELECT 1 FROM request r WHERE r.booking_id = booking.id AND r.status = 'open')`,
    sql`
      INSERT INTO request (id, booking_id, target_booking_id, status, created_at)
      SELECT lower(hex(randomblob(16))), n.id, b.id, 'open', ${now}
      FROM booking n JOIN booking b ON ${OTHER_ACTIVE_OVERLAP}
      WHERE n.id = ${bookingId} AND n.status = 'requested'
        AND NOT EXISTS (SELECT 1 FROM request r WHERE r.booking_id = n.id AND r.target_booking_id = b.id AND r.status = 'open')`,
  ]);

  const after = await loadBooking(ctx.db, bookingId);
  const openAfter = await ctx.db
    .select()
    .from(request)
    .where(and(eq(request.bookingId, bookingId), eq(request.status, "open")));
  const known = new Set(openBefore.map((r) => r.id));
  const created = openAfter.filter((r) => !known.has(r.id));
  const activated = after?.status === "active" && openAfter.length === 0;

  if (after && activated) {
    await auditInsert(ctx, { action: "booking.activated", bookingId, after: bookingSnapshot(after), source: sourceFor(ctx, after.ownerId) });
  }
  if (after && created.length > 0) await notifyNewRequests(ctx, after, created);
  return { booking: after, activated, created };
}

/** After a booking shrank or disappeared, requests waiting on it may now be resolvable. */
export async function reevaluateRequestsTargeting(ctx: ServiceCtx, targetIds: string[]) {
  if (targetIds.length === 0) return;
  const waiting = await ctx.db
    .selectDistinct({ bookingId: request.bookingId })
    .from(request)
    .where(and(inArray(request.targetBookingId, targetIds), eq(request.status, "open")));
  for (const { bookingId } of waiting) {
    const res = await tryActivate(ctx, bookingId);
    if (res.activated && res.booking) {
      ctx.notifier.add([res.booking.ownerId], "request_answer", {
        title: "Das Auto ist frei",
        body: `Deine Anfrage ${formatRange(res.booking, res.booking.allDay)} ist jetzt bestätigt.`,
        url: `/bookings/${res.booking.id}`,
        tag: `booking-${res.booking.id}`,
      });
    }
  }
}

async function notifyNewRequests(ctx: ServiceCtx, requester: BookingRow, created: { id: string; targetBookingId: string }[]) {
  const names = await userNames(ctx.db);
  const targets = await ctx.db
    .select()
    .from(booking)
    .where(inArray(booking.id, created.map((r) => r.targetBookingId)));
  for (const r of created) {
    const t = targets.find((x) => x.id === r.targetBookingId);
    if (!t) continue;
    ctx.notifier.add([t.ownerId], "request_to_me", {
      title: `${names.get(requester.ownerId) ?? "Jemand"} fragt nach dem Auto`,
      body: `${formatRange(requester, requester.allDay)} · ${overlapMinutes(t, requester)} Min. Überschneidung mit deiner Buchung`,
      url: `/requests/${r.id}`,
      tag: `request-${r.id}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createBooking(ctx: ServiceCtx, input: CreateBookingInput): Promise<MutationResult> {
  const ownerId = input.ownerId ?? ctx.actor.id;
  if (ownerId !== ctx.actor.id && !isAdmin(ctx)) throw forbidden("Nur der Admin kann für andere buchen");
  const owner = await ctx.db.query.user.findFirst({ where: eq(user.id, ownerId) });
  if (!owner || owner.status !== "active") throw new AppError("invalid", "Diese Person ist nicht freigeschaltet");

  const now = nowIso(ctx);
  const source = sourceFor(ctx, ownerId);
  const occurrences = expandOccurrences(input);
  const seriesId = input.repeat === "none" ? null : newId();
  const rows = occurrences.map((o, i) => ({
    id: newId(),
    owner_id: ownerId,
    created_by: ctx.actor.id,
    series_id: seriesId,
    starts_at: o.startsAt,
    ends_at: o.endsAt,
    all_day: input.allDay ? 1 : 0,
    note: input.note,
    client_id: seriesId ? `${input.clientId}:${i}` : input.clientId,
  }));
  const ids = JSON.stringify(rows.map((r) => r.id));
  const inNew = sql`(SELECT value FROM json_each(${ids}))`;

  const statements: Statement[] = [];
  if (seriesId && input.until) {
    const first = occurrences[0]!;
    const end = utcToLocalEnd(first.endsAt);
    const start = utcToLocal(first.startsAt);
    statements.push(
      ctx.db.insert(series).values({
        id: seriesId,
        ownerId,
        createdBy: ctx.actor.id,
        freq: input.repeat === "weekly" ? "weekly" : "biweekly",
        startLocal: `${start.date}T${start.time}`,
        endLocal: `${end.date}T${end.time}`,
        untilDate: input.until,
        allDay: input.allDay,
        note: input.note,
        createdAt: now,
      }),
    );
  }
  // Insert everything as "requested", then flip to "active" what does not overlap, then create
  // requests for the rest. All in one batch (= one transaction), so concurrent bookings cannot
  // both end up active on the same slot.
  statements.push(
    sql`
      INSERT INTO booking (id, owner_id, created_by, series_id, starts_at, ends_at, original_starts_at, original_ends_at,
                           all_day, status, note, client_id, created_at, updated_at)
      SELECT json_extract(value, '$.id'), json_extract(value, '$.owner_id'), json_extract(value, '$.created_by'),
             json_extract(value, '$.series_id'), json_extract(value, '$.starts_at'), json_extract(value, '$.ends_at'),
             json_extract(value, '$.starts_at'), json_extract(value, '$.ends_at'), json_extract(value, '$.all_day'),
             'requested', json_extract(value, '$.note'), json_extract(value, '$.client_id'), ${now}, ${now}
      FROM json_each(${JSON.stringify(rows)})`,
    sql`
      UPDATE booking SET status = 'active'
      WHERE id IN ${inNew} AND status = 'requested'
        AND NOT EXISTS (SELECT 1 FROM booking b, booking n WHERE n.id = booking.id AND ${OTHER_ACTIVE_OVERLAP})`,
    sql`
      INSERT INTO request (id, booking_id, target_booking_id, status, created_at)
      SELECT lower(hex(randomblob(16))), n.id, b.id, 'open', ${now}
      FROM booking n JOIN booking b ON ${OTHER_ACTIVE_OVERLAP}
      WHERE n.id IN ${inNew} AND n.status = 'requested'`,
    sql`
      INSERT INTO audit_log (id, at, actor_id, action, booking_id, before_json, after_json, source)
      SELECT lower(hex(randomblob(16))), ${now}, ${ctx.actor.id}, 'booking.created', n.id, NULL,
             json_object('startsAt', n.starts_at, 'endsAt', n.ends_at, 'status', n.status, 'note', n.note,
                         'ownerId', n.owner_id, 'allDay', json(CASE n.all_day WHEN 1 THEN 'true' ELSE 'false' END)),
             ${source}
      FROM booking n WHERE n.id IN ${inNew}`,
  );
  await runBatch(ctx.env.DB, statements);

  const created = await ctx.db
    .select()
    .from(booking)
    .where(inArray(booking.id, rows.map((r) => r.id)))
    .orderBy(booking.startsAt);
  const requests = await ctx.db
    .select()
    .from(request)
    .where(inArray(request.bookingId, created.map((b) => b.id)));

  await notifyCreated(ctx, created, requests);

  const anyRequested = created.some((b) => b.status === "requested");
  return {
    ok: true,
    outcome: anyRequested ? "requested" : "created",
    bookings: created.map(toBookingDto),
    requests: requests.map(toRequestDto),
  };
}

async function notifyCreated(ctx: ServiceCtx, created: BookingRow[], requests: (typeof request.$inferSelect)[]) {
  const first = created[0];
  if (!first) return;
  const names = await userNames(ctx.db);
  for (const b of created) {
    const own = requests.filter((r) => r.bookingId === b.id);
    if (own.length > 0) await notifyNewRequests(ctx, b, own);
  }
  const ownerName = names.get(first.ownerId) ?? "Jemand";
  const more = created.length > 1 ? ` (+${created.length - 1} weitere Termine)` : "";
  const verb = created.every((b) => b.status === "requested") ? "hat angefragt" : "hat reserviert";
  const others = [...names.keys()].filter((id) => id !== first.ownerId && id !== ctx.actor.id);
  ctx.notifier.add(others, "new_booking", {
    title: `${ownerName} ${verb}`,
    body: `${formatRange(first, first.allDay)}${more}${first.note ? ` · ${first.note}` : ""}`,
    url: `/bookings/${first.id}`,
    tag: `booking-${first.id}`,
  });
  if (first.ownerId !== ctx.actor.id) {
    ctx.notifier.add([first.ownerId], "booking_changed", {
      title: `${ctx.actor.name} hat für dich reserviert`,
      body: `${formatRange(first, first.allDay)}${more}`,
      url: `/bookings/${first.id}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

function assertWritable(ctx: ServiceCtx, b: BookingRow | undefined, baseUpdatedAt?: string | null): BookingRow {
  if (!b) throw notFound("Buchung nicht gefunden");
  if (!canManage(ctx, b)) throw forbidden("Nur die eigene Buchung (oder als Admin) änderbar");
  if (baseUpdatedAt && baseUpdatedAt !== b.updatedAt) {
    throw new AppError("stale", "Die Buchung wurde inzwischen geändert. Der aktuelle Stand gilt.", { server: toBookingDto(b) });
  }
  return b;
}

export async function updateBooking(ctx: ServiceCtx, id: string, input: UpdateBookingInput): Promise<MutationResult> {
  const b = assertWritable(ctx, await loadBooking(ctx.db, id), input.baseUpdatedAt);
  if (b.status !== "active" && b.status !== "requested") throw new AppError("invalid", "Diese Buchung ist nicht mehr aktiv");
  if (b.endsAt <= nowIso(ctx)) throw new AppError("already_over", "Diese Buchung ist schon vorbei");
  if (input.scope === "following" && b.seriesId) return updateFollowing(ctx, b, input);

  const iv = toInterval(input);
  const names = await userNames(ctx.db);
  if (b.status === "active") {
    const conflicts = await conflictsFor(ctx, b.ownerId, iv, [b.id]);
    if (conflicts.length > 0) {
      throw new AppError("conflict", `${conflictMessage(conflicts, names, iv)}. Reserviere die zusätzliche Zeit separat, dann wird sie zur Anfrage.`, {
        conflicts: conflicts.map(toBookingDto),
      });
    }
  }

  const now = nowIso(ctx);
  const changes = {
    startsAt: iv.startsAt,
    endsAt: iv.endsAt,
    allDay: input.allDay,
    note: input.note,
    updatedAt: now,
    ...(iv.startsAt !== b.startsAt ? { reminderSentAt: null } : {}),
  };
  const after = { ...b, ...changes };
  const statements: Statement[] = [
    ctx.db.update(booking).set(changes).where(eq(booking.id, b.id)),
    auditInsert(ctx, { action: "booking.updated", bookingId: b.id, before: bookingSnapshot(b), after: bookingSnapshot(after), source: sourceFor(ctx, b.ownerId) }),
  ];
  if (b.status === "requested") {
    // New times: previous questions are void, ask again for whatever overlaps now.
    statements.push(
      ctx.db
        .update(request)
        .set({ status: "withdrawn", decidedAt: now })
        .where(and(eq(request.bookingId, b.id), eq(request.status, "open"))),
    );
  }
  await runBatch(ctx.env.DB, statements);
  if (b.status === "requested") await tryActivate(ctx, b.id);
  else await reevaluateRequestsTargeting(ctx, [b.id]);

  notifyOwnerIfForeign(ctx, b, "hat deine Buchung geändert", formatRange(iv, input.allDay));
  return result(ctx, "updated", [b.id]);
}

/** "Dieser und alle folgenden": apply the new wall-clock times to this and every later occurrence. */
async function updateFollowing(ctx: ServiceCtx, b: BookingRow, input: UpdateBookingInput): Promise<MutationResult> {
  const occurrences = await followingOccurrences(ctx, b);
  const thisDate = utcToLocal(b.originalStartsAt).date;
  const dayShift = diffDays(thisDate, input.startDate);
  const span = diffDays(input.startDate, input.endDate);
  const planned = occurrences.map((o) => {
    const startDate = addDays(utcToLocal(o.originalStartsAt).date, dayShift);
    return { row: o, iv: toInterval({ ...input, startDate, endDate: addDays(startDate, span) }) };
  });

  const ids = planned.map((p) => p.row.id);
  const conflicts: BookingRow[] = [];
  for (const p of planned) {
    if (p.row.status === "active") conflicts.push(...(await conflictsFor(ctx, b.ownerId, p.iv, ids)));
  }
  if (conflicts.length > 0) {
    const names = await userNames(ctx.db);
    throw new AppError("conflict", `${conflictMessage(conflicts, names, planned[0]!.iv)}. Ändere diese Termine einzeln.`, {
      conflicts: conflicts.map(toBookingDto),
    });
  }

  const now = nowIso(ctx);
  const source = sourceFor(ctx, b.ownerId);
  const oldSeries = await ctx.db.query.series.findFirst({ where: eq(series.id, b.seriesId!) });
  const newSeriesId = newId();
  const firstStart = utcToLocal(planned[0]!.iv.startsAt);
  const firstEnd = utcToLocalEnd(planned[0]!.iv.endsAt);
  const statements: Statement[] = [];
  if (oldSeries) {
    statements.push(
      ctx.db.insert(series).values({
        ...oldSeries,
        id: newSeriesId,
        startLocal: `${firstStart.date}T${firstStart.time}`,
        endLocal: `${firstEnd.date}T${firstEnd.time}`,
        allDay: input.allDay,
        note: input.note,
        createdBy: ctx.actor.id,
        createdAt: now,
      }),
      ctx.db.update(series).set({ untilDate: addDays(thisDate, -1) }).where(eq(series.id, oldSeries.id)),
    );
  }
  const updates = planned.map((p) => ({ id: p.row.id, s: p.iv.startsAt, e: p.iv.endsAt }));
  statements.push(
    sql`
      UPDATE booking SET
        starts_at = (SELECT json_extract(value, '$.s') FROM json_each(${JSON.stringify(updates)}) WHERE json_extract(value, '$.id') = booking.id),
        ends_at = (SELECT json_extract(value, '$.e') FROM json_each(${JSON.stringify(updates)}) WHERE json_extract(value, '$.id') = booking.id),
        all_day = ${input.allDay ? 1 : 0}, note = ${input.note}, series_id = ${oldSeries ? newSeriesId : b.seriesId},
        reminder_sent_at = NULL, updated_at = ${now}
      WHERE id IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`,
    ctx.db
      .update(request)
      .set({ status: "withdrawn", decidedAt: now })
      .where(and(inArray(request.bookingId, ids), eq(request.status, "open"))),
    ...planned.map((p) =>
      auditInsert(ctx, {
        action: "booking.updated",
        bookingId: p.row.id,
        before: bookingSnapshot(p.row),
        after: bookingSnapshot({ ...p.row, startsAt: p.iv.startsAt, endsAt: p.iv.endsAt, allDay: input.allDay, note: input.note }),
        source,
      }),
    ),
  );
  await runBatch(ctx.env.DB, statements);
  for (const p of planned) if (p.row.status === "requested") await tryActivate(ctx, p.row.id);
  await reevaluateRequestsTargeting(ctx, planned.filter((p) => p.row.status === "active").map((p) => p.row.id));

  notifyOwnerIfForeign(ctx, b, `hat ${planned.length} Termine deiner Serie geändert`, formatRange(planned[0]!.iv, input.allDay));
  return result(ctx, "updated", ids);
}

async function followingOccurrences(ctx: ServiceCtx, b: BookingRow): Promise<BookingRow[]> {
  return ctx.db
    .select()
    .from(booking)
    .where(
      and(
        eq(booking.seriesId, b.seriesId!),
        gte(booking.originalStartsAt, b.originalStartsAt),
        inArray(booking.status, ["active", "requested"]),
      ),
    )
    .orderBy(booking.originalStartsAt);
}

function notifyOwnerIfForeign(ctx: ServiceCtx, b: BookingRow, what: string, body: string) {
  if (b.ownerId === ctx.actor.id) return;
  ctx.notifier.add([b.ownerId], "booking_changed", {
    title: `${ctx.actor.name} ${what}`,
    body,
    url: `/bookings/${b.id}`,
    tag: `booking-${b.id}`,
  });
}

async function result(ctx: ServiceCtx, outcome: Extract<MutationResult, { ok: true }>["outcome"], ids: string[], message?: string): Promise<MutationResult> {
  const rows = ids.length ? await ctx.db.select().from(booking).where(inArray(booking.id, ids)).orderBy(booking.startsAt) : [];
  const reqs = ids.length
    ? await ctx.db
        .select()
        .from(request)
        .where(or(inArray(request.bookingId, ids), inArray(request.targetBookingId, ids)))
    : [];
  return { ok: true, outcome, bookings: rows.map(toBookingDto), requests: reqs.map(toRequestDto), ...(message ? { message } : {}) };
}

// ---------------------------------------------------------------------------
// Cancel / end now
// ---------------------------------------------------------------------------

export async function cancelBooking(ctx: ServiceCtx, id: string, input: CancelBookingInput): Promise<MutationResult> {
  const b = assertWritable(ctx, await loadBooking(ctx.db, id), input.baseUpdatedAt);
  if (b.status !== "active" && b.status !== "requested") {
    return result(ctx, "ignored", [b.id], "Diese Buchung ist bereits beendet oder storniert.");
  }
  const now = nowIso(ctx);
  const nowRounded = floorToSlot(ctx.now);
  const targets = input.scope === "following" && b.seriesId ? await followingOccurrences(ctx, b) : [b];
  const source = sourceFor(ctx, b.ownerId);

  const statements: Statement[] = [];
  const freed: string[] = [];
  let endedEarly = 0;
  let cancelled = 0;
  for (const t of targets) {
    if (t.endsAt <= now) continue;
    const running = t.status === "active" && t.startsAt <= now;
    const changes = running
      ? { status: "ended_early" as const, endsAt: nowRounded, updatedAt: now }
      : { status: "cancelled" as const, updatedAt: now };
    statements.push(
      ctx.db.update(booking).set(changes).where(eq(booking.id, t.id)),
      auditInsert(ctx, {
        action: running ? "booking.ended_early" : "booking.cancelled",
        bookingId: t.id,
        before: bookingSnapshot(t),
        after: bookingSnapshot({ ...t, ...changes }),
        source,
      }),
      ctx.db
        .update(request)
        .set({ status: "withdrawn", decidedAt: now })
        .where(and(eq(request.bookingId, t.id), inArray(request.status, ["open", "partial"]))),
    );
    if (t.status === "active") freed.push(t.id);
    if (running) endedEarly++;
    else cancelled++;
  }
  if (statements.length === 0) {
    return result(ctx, "ignored", [b.id], "Diese Buchung ist schon vorbei – nichts zu stornieren.");
  }
  if (input.scope === "following" && b.seriesId) {
    statements.push(
      ctx.db
        .update(series)
        .set({ untilDate: addDays(utcToLocal(b.originalStartsAt).date, -1) })
        .where(eq(series.id, b.seriesId)),
    );
  }
  await runBatch(ctx.env.DB, statements);
  await reevaluateRequestsTargeting(ctx, freed);

  const label = targets.length > 1 ? `${targets.length} Termine` : formatRange(b, b.allDay);
  notifyOwnerIfForeign(ctx, b, "hat deine Buchung storniert", label);
  const ids = targets.map((t) => t.id);
  if (endedEarly > 0 && cancelled === 0) {
    return result(ctx, "ended_early", ids, "Die Buchung lief schon – sie wurde als vorzeitig beendet gespeichert.");
  }
  return result(ctx, "cancelled", ids);
}

export async function endNow(ctx: ServiceCtx, id: string): Promise<MutationResult> {
  const b = assertWritable(ctx, await loadBooking(ctx.db, id));
  const now = nowIso(ctx);
  if (b.status !== "active") throw new AppError("invalid", "Nur laufende Buchungen können zurückgegeben werden");
  if (b.endsAt <= now) throw new AppError("already_over", "Diese Buchung ist schon vorbei");
  if (b.startsAt > now) throw new AppError("not_started", "Die Buchung hat noch nicht begonnen – storniere sie stattdessen");

  const changes = { status: "ended_early" as const, endsAt: floorToSlot(ctx.now), updatedAt: now };
  await runBatch(ctx.env.DB, [
    ctx.db.update(booking).set(changes).where(eq(booking.id, b.id)),
    auditInsert(ctx, {
      action: "booking.ended_early",
      bookingId: b.id,
      before: bookingSnapshot(b),
      after: bookingSnapshot({ ...b, ...changes }),
      source: sourceFor(ctx, b.ownerId),
    }),
  ]);
  await reevaluateRequestsTargeting(ctx, [b.id]);
  notifyOwnerIfForeign(ctx, b, "hat deine Buchung beendet", `Frei ab ${utcToLocal(changes.endsAt).time}`);
  return result(ctx, "ended_early", [b.id]);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const VISIBLE = ["active", "requested", "ended_early"] as const;

export async function bookingsInRange(ctx: ServiceCtx, from: string, to: string): Promise<BookingsResponse> {
  const rows = await ctx.db
    .select()
    .from(booking)
    .where(
      and(
        inArray(booking.status, [...VISIBLE]),
        lt(booking.startsAt, to),
        or(gt(booking.endsAt, from), gt(booking.originalEndsAt, from)),
      ),
    )
    .orderBy(booking.startsAt);
  const ids = rows.map((r) => r.id);
  const reqs = ids.length
    ? await ctx.db
        .select()
        .from(request)
        .where(
          and(
            inArray(request.status, ["open", "partial", "granted"]),
            or(inArray(request.bookingId, ids), inArray(request.targetBookingId, ids)),
          ),
        )
    : [];
  return { bookings: rows.map(toBookingDto), requests: reqs.map(toRequestDto) };
}

export async function requestDetails(ctx: ServiceCtx, reqs: (typeof request.$inferSelect)[]): Promise<RequestDetailDto[]> {
  if (reqs.length === 0) return [];
  const ids = [...new Set(reqs.flatMap((r) => [r.bookingId, r.targetBookingId]))];
  const rows = await ctx.db.select().from(booking).where(inArray(booking.id, ids));
  const byId = new Map(rows.map((r) => [r.id, toBookingDto(r)]));
  return reqs
    .filter((r) => byId.has(r.bookingId) && byId.has(r.targetBookingId))
    .map((r) => ({ ...toRequestDto(r), booking: byId.get(r.bookingId)!, target: byId.get(r.targetBookingId)! }));
}

export async function bookingDetail(ctx: ServiceCtx, id: string): Promise<BookingDetailDto> {
  const b = await loadBooking(ctx.db, id);
  if (!b) throw notFound("Buchung nicht gefunden");
  const reqs = await ctx.db
    .select()
    .from(request)
    .where(or(eq(request.bookingId, id), eq(request.targetBookingId, id)))
    .orderBy(request.createdAt);
  const details = await requestDetails(ctx, reqs);
  return {
    booking: toBookingDto(b),
    outgoing: details.filter((r) => r.bookingId === id),
    incoming: details.filter((r) => r.targetBookingId === id),
  };
}

export async function history(ctx: ServiceCtx): Promise<HistoryResponse> {
  const rows = await ctx.db
    .select()
    .from(booking)
    .where(eq(booking.ownerId, ctx.actor.id))
    .orderBy(desc(booking.startsAt))
    .limit(300);
  const audit = await ctx.db
    .select({ entry: auditLog })
    .from(auditLog)
    .innerJoin(booking, eq(booking.id, auditLog.bookingId))
    .where(eq(booking.ownerId, ctx.actor.id))
    .orderBy(desc(auditLog.at))
    .limit(300);
  return { bookings: rows.map(toBookingDto), audit: audit.map((a) => toAuditDto(a.entry)) };
}

export function toAuditDto(a: typeof auditLog.$inferSelect) {
  return {
    id: a.id,
    at: a.at,
    actorId: a.actorId,
    action: a.action,
    bookingId: a.bookingId,
    before: a.beforeJson ? JSON.parse(a.beforeJson) : null,
    after: a.afterJson ? JSON.parse(a.afterJson) : null,
    source: a.source,
  };
}
