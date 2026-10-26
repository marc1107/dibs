export const TIMEZONE = "Europe/Berlin";

/** Booking times snap to this grid (minutes). */
export const SLOT_MINUTES = 15;

/** Upper bounds that keep a single request cheap for D1. */
export const MAX_OCCURRENCES = 120;
export const MAX_SPAN_DAYS = 62;
export const MAX_NOTE_LENGTH = 200;
export const MAX_SYNC_ACTIONS = 50;

export const ROLES = ["admin", "member"] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ["pending", "active", "removed"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const BOOKING_STATUSES = ["active", "requested", "cancelled", "ended_early", "rejected"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const REQUEST_STATUSES = ["open", "granted", "partial", "declined", "withdrawn"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REPEATS = ["none", "weekly", "biweekly"] as const;
export type Repeat = (typeof REPEATS)[number];

export const START_VIEWS = ["month", "week", "list"] as const;
export type StartView = (typeof START_VIEWS)[number];

export const AUDIT_SOURCES = ["online", "offline-sync", "admin"] as const;
export type AuditSource = (typeof AUDIT_SOURCES)[number];

/**
 * Person colours: `solid` for bars, text and avatars; `soft` for filled all-day cells.
 * Assigned in this order to new users (first free colour wins).
 */
export const PALETTE = [
  { solid: "#2563EB", soft: "#DCE7FD" },
  { solid: "#C2410C", soft: "#FDE4D6" },
  { solid: "#0B7A6E", soft: "#DDF3EF" },
  { solid: "#7C3AED", soft: "#EDE4FD" },
  { solid: "#BE185D", soft: "#FCE3EF" },
  { solid: "#4D7C0F", soft: "#E8F3D6" },
] as const;

export function softColor(solid: string): string {
  return PALETTE.find((p) => p.solid === solid)?.soft ?? "#EEF0F3";
}

export const NOTIFICATION_TYPES = [
  "approval_request",
  "request_to_me",
  "request_answer",
  "new_booking",
  "booking_changed",
  "reminder",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_DEFAULTS: Record<NotificationType, { enabled: boolean; locked: boolean; adminOnly?: boolean }> = {
  approval_request: { enabled: true, locked: true, adminOnly: true },
  request_to_me: { enabled: true, locked: true },
  request_answer: { enabled: true, locked: false },
  new_booking: { enabled: true, locked: false },
  booking_changed: { enabled: true, locked: false },
  reminder: { enabled: false, locked: false },
};

export const NOTIFICATION_LABELS: Record<NotificationType, string> = {
  approval_request: "Freigabe-Anfragen neuer Personen",
  request_to_me: "Anfragen an mich",
  request_answer: "Antworten auf meine Anfragen",
  new_booking: "Neue Buchungen",
  booking_changed: "Änderungen und Stornos",
  reminder: "Erinnerung vor meiner Fahrt",
};
