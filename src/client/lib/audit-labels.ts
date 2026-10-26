import type { AuditEntryDto } from "@shared/api";
import { formatRange } from "@shared/time";

const ACTIONS: Record<string, string> = {
  "booking.created": "Buchung angelegt",
  "booking.updated": "Buchung geändert",
  "booking.cancelled": "Storniert",
  "booking.cancelled_by_request": "Storniert für eine Anfrage",
  "booking.ended_early": "Vorzeitig beendet",
  "booking.activated": "Anfrage bestätigt, Buchung aktiv",
  "booking.shortened": "Gekürzt/verlängert durch Anfrage",
  "booking.split": "Geteilt durch Anfrage",
  "booking.split_part": "Zweiter Teil nach Teilung",
  "booking.counter_applied": "Start auf Gegenvorschlag verschoben",
  "booking.rejected": "Anfrage abgelehnt",
  "request.granted": "Anfrage: Klar, nimm's",
  "request.countered": "Anfrage: Brauch's bis …",
  "request.declined": "Anfrage: Nein",
  "request.withdrawn": "Anfrage zurückgezogen",
  "user.approved": "Person freigeschaltet",
  "user.rejected": "Person abgelehnt",
  "user.removed": "Person entfernt",
};

const SOURCES = { online: "online", "offline-sync": "offline gesendet", admin: "Admin" } as const;

export const actionLabel = (a: AuditEntryDto) => ACTIONS[a.action] ?? a.action;
export const sourceLabel = (a: AuditEntryDto) => SOURCES[a.source];

type Snapshot = { startsAt?: string; endsAt?: string; allDay?: boolean; status?: string; name?: string };

/** "Mi 28. Okt 17:00–22:00 → Mi 28. Okt 17:00–18:00" for booking changes. */
export function changeSummary(a: AuditEntryDto): string | null {
  const before = a.before as Snapshot | null;
  const after = a.after as Snapshot | null;
  const range = (s: Snapshot | null) => (s?.startsAt && s.endsAt ? formatRange({ startsAt: s.startsAt, endsAt: s.endsAt }, Boolean(s.allDay)) : null);
  const b = range(before);
  const n = range(after);
  if (b && n && b !== n) return `${b} → ${n}`;
  if (n) return n;
  if (after?.name) return after.name;
  return null;
}
