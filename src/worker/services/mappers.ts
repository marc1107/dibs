import type { BookingDto, RequestDto } from "@shared/api";
import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { booking, request, user } from "../db/schema";

export type BookingRow = typeof booking.$inferSelect;
export type RequestRow = typeof request.$inferSelect;

export function toBookingDto(b: BookingRow): BookingDto {
  return {
    id: b.id,
    ownerId: b.ownerId,
    createdBy: b.createdBy,
    seriesId: b.seriesId,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    originalStartsAt: b.originalStartsAt,
    originalEndsAt: b.originalEndsAt,
    allDay: b.allDay,
    status: b.status,
    note: b.note,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

export function toRequestDto(r: RequestRow): RequestDto {
  return {
    id: r.id,
    bookingId: r.bookingId,
    targetBookingId: r.targetBookingId,
    status: r.status,
    counterTime: r.counterTime,
    decidedBy: r.decidedBy,
    createdAt: r.createdAt,
    decidedAt: r.decidedAt,
  };
}

/** The values the audit log keeps for a booking. */
export function bookingSnapshot(b: BookingRow) {
  return { startsAt: b.startsAt, endsAt: b.endsAt, status: b.status, note: b.note, ownerId: b.ownerId, allDay: b.allDay };
}

/** id → display name of all users (three people, so one cheap query). */
export async function userNames(db: Db): Promise<Map<string, string>> {
  const rows = await db.select({ id: user.id, name: user.name }).from(user).orderBy(asc(user.createdAt));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function loadBooking(db: Db, id: string): Promise<BookingRow | undefined> {
  return db.query.booking.findFirst({ where: eq(booking.id, id) });
}
