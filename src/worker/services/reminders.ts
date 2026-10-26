import { addDays, formatRange, localToUtc, utcToLocal } from "@shared/time";
import { and, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import type { Db } from "../db/client";
import { booking } from "../db/schema";
import { enabledRecipients, type Notifier } from "./notifier";

const LEAD_MINUTES = 60;
/** All-day bookings are announced at 19:00 the evening before. */
const ALL_DAY_REMINDER_TIME = "19:00";
const LOOKAHEAD_MS = 6 * 3600_000;

export function reminderAt(b: { startsAt: string; allDay: boolean }): string {
  if (b.allDay) return localToUtc(addDays(utcToLocal(b.startsAt).date, -1), ALL_DAY_REMINDER_TIME);
  return new Date(Date.parse(b.startsAt) - LEAD_MINUTES * 60_000).toISOString();
}

/** Called by the cron trigger every 15 minutes. Each booking is reminded at most once. */
export async function sendDueReminders(db: Db, notifier: Notifier, now: Date): Promise<number> {
  const nowIso = now.toISOString();
  const candidates = await db
    .select()
    .from(booking)
    .where(
      and(
        eq(booking.status, "active"),
        isNull(booking.reminderSentAt),
        gt(booking.startsAt, nowIso),
        lte(booking.startsAt, new Date(now.getTime() + LOOKAHEAD_MS).toISOString()),
      ),
    );
  const due = candidates.filter((b) => reminderAt(b) <= nowIso);
  if (due.length === 0) return 0;

  const wanting = new Set(await enabledRecipients(db, [...new Set(due.map((b) => b.ownerId))], "reminder"));
  for (const b of due) {
    if (!wanting.has(b.ownerId)) continue;
    notifier.add([b.ownerId], "reminder", {
      title: "Gleich hast du das Auto",
      body: `${formatRange(b, b.allDay)}${b.note ? ` · ${b.note}` : ""}`,
      url: `/bookings/${b.id}`,
      tag: `reminder-${b.id}`,
    });
  }
  await db
    .update(booking)
    .set({ reminderSentAt: nowIso })
    .where(inArray(booking.id, due.map((b) => b.id)));
  return due.length;
}
