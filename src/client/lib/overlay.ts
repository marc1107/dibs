import type { SyncActionInput } from "@shared/schemas";
import { expandOccurrences } from "@shared/series";
import { floorToSlot, toInterval } from "@shared/time";
import { findConflicts, type ViewBooking } from "./calendar";

export interface OutboxEntry {
  clientId: string;
  /** Insertion order; the outbox is replayed strictly in this order. */
  seq: number;
  action: SyncActionInput;
  /** Created while offline or a send attempt failed → audit source "offline-sync". */
  queuedOffline: boolean;
  createdAt: string;
  /** Human-readable summary for "1 Buchung noch nicht gesendet". */
  label: string;
}

export const pendingId = (clientId: string, index: number) => `pending:${clientId}:${index}`;

/**
 * Shows queued actions immediately: new bookings appear (marked pending), edits and
 * cancellations are applied on top of the last known server state.
 */
export function applyOutbox(bookings: ViewBooking[], entries: OutboxEntry[], me: string, now = new Date()): ViewBooking[] {
  let list = [...bookings];
  for (const e of entries) {
    const a = e.action;
    if (a.type === "create") {
      const p = a.payload;
      const ownerId = p.ownerId ?? me;
      const occurrences = expandOccurrences({ ...p, startTime: p.startTime ?? null, endTime: p.endTime ?? null });
      const created = occurrences.map((o, i): ViewBooking => ({
        id: pendingId(p.clientId, i),
        ownerId,
        createdBy: me,
        seriesId: occurrences.length > 1 ? `pending:${p.clientId}` : null,
        startsAt: o.startsAt,
        endsAt: o.endsAt,
        originalStartsAt: o.startsAt,
        originalEndsAt: o.endsAt,
        allDay: p.allDay,
        status: findConflicts(list, ownerId, [o]).length > 0 ? "requested" : "active",
        note: p.note ?? null,
        createdAt: e.createdAt,
        updatedAt: e.createdAt,
        pending: true,
      }));
      list = [...list, ...created];
    } else {
      list = list.map((b) => {
        if (b.id !== a.bookingId) return b;
        if (a.type === "cancel") return { ...b, status: "cancelled", pending: true };
        if (a.type === "endNow") return { ...b, status: "ended_early", endsAt: floorToSlot(now), pending: true };
        const iv = toInterval({ ...a.payload, startTime: a.payload.startTime ?? null, endTime: a.payload.endTime ?? null });
        return { ...b, ...iv, allDay: a.payload.allDay, note: a.payload.note ?? null, pending: true };
      });
    }
  }
  return list;
}
