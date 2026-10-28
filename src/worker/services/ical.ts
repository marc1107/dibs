import { addDays, utcToLocal, utcToLocalEnd } from "@shared/time";
import { and, eq, gt, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { booking, user } from "../db/schema";

const PAST_DAYS = 30;

/** RFC 5545 text escaping. */
function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Folds content lines at 75 octets (continuation lines start with a space). */
export function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const len = new TextEncoder().encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (size + len > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += len;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const dateValue = (d: string) => d.replace(/-/g, "");

/**
 * Calendar feed for one person: active (and early-ended, with their real end) bookings from
 * 30 days ago onwards. Names, times and notes only, never e-mail addresses.
 */
export async function buildFeed(db: Db, token: string, ownOnly: boolean, now: Date): Promise<string | null> {
  const owner = await db.query.user.findFirst({ where: eq(user.icalToken, token) });
  if (!owner || owner.status !== "active") return null;

  const from = new Date(now.getTime() - PAST_DAYS * 86_400_000).toISOString();
  const rows = await db
    .select({ b: booking, name: user.name })
    .from(booking)
    .innerJoin(user, eq(user.id, booking.ownerId))
    .where(
      and(
        inArray(booking.status, ["active", "ended_early"]),
        gt(booking.endsAt, from),
        ownOnly ? eq(booking.ownerId, owner.id) : undefined,
      ),
    )
    .orderBy(booking.startsAt);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//dibs//dibs//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${ownOnly ? "dibs (meine)" : "dibs"}`,
    "X-WR-TIMEZONE:Europe/Berlin",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const { b, name } of rows) {
    lines.push("BEGIN:VEVENT", `UID:${b.id}@dibs.bohner.cloud`, `DTSTAMP:${stamp(b.updatedAt)}`);
    if (b.allDay) {
      const start = utcToLocal(b.startsAt).date;
      const end = addDays(utcToLocalEnd(b.endsAt).date, 1);
      lines.push(`DTSTART;VALUE=DATE:${dateValue(start)}`, `DTEND;VALUE=DATE:${dateValue(end)}`);
    } else {
      lines.push(`DTSTART:${stamp(b.startsAt)}`, `DTEND:${stamp(b.endsAt)}`);
    }
    lines.push(`SUMMARY:${escapeText(`🚗 ${name}`)}`, "TRANSP:TRANSPARENT");
    if (b.note) lines.push(`DESCRIPTION:${escapeText(b.note)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
