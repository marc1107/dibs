export const TIMEZONE = "Europe/Berlin";

/** Booking times snap to this grid (minutes). */
export const SLOT_MINUTES = 15;

/** Upper bounds that keep a single request cheap for D1. */
export const MAX_OCCURRENCES = 120;
export const MAX_SPAN_DAYS = 62;
export const MAX_NOTE_LENGTH = 200;
/** Keeps one /api/sync call well within D1's per-invocation query limit on the free plan. */
export const MAX_SYNC_ACTIONS = 20;

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
 * Person colours, assigned in this order to new users (first free colour wins).
 * The client derives tinted backgrounds and text tones from them (lib/people.ts), per theme.
 */
export const PALETTE = ["#2563EB", "#C2410C", "#0B7A6E", "#7C3AED", "#BE185D", "#4D7C0F"] as const;

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
