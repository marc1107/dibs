import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
};

// ---------------------------------------------------------------------------
// Better Auth tables (user is extended with app fields)
// ---------------------------------------------------------------------------

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
  status: text("status", { enum: ["pending", "active", "removed"] }).notNull().default("pending"),
  color: text("color").notNull().default("#2563EB"),
  startView: text("start_view", { enum: ["month", "week", "list"] }).notNull().default("month"),
  icalToken: text("ical_token").unique(),
  ...timestamps,
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    ...timestamps,
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

export const passkey = sqliteTable(
  "passkey",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: integer("backed_up", { mode: "boolean" }).notNull(),
    transports: text("transports"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
    aaguid: text("aaguid"),
  },
  (t) => [index("passkey_user_idx").on(t.userId), index("passkey_credential_idx").on(t.credentialID)],
);

// ---------------------------------------------------------------------------
// App tables. All instants are UTC ISO strings ("2026-10-28T16:00:00.000Z"),
// which compare correctly as text.
// ---------------------------------------------------------------------------

export const series = sqliteTable("series", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id),
  freq: text("freq", { enum: ["weekly", "biweekly"] }).notNull(),
  /** First occurrence in Berlin wall-clock time, "YYYY-MM-DDTHH:mm". */
  startLocal: text("start_local").notNull(),
  /** End of the first occurrence in Berlin wall-clock time ("…T24:00" for midnight). */
  endLocal: text("end_local").notNull(),
  untilDate: text("until_date").notNull(),
  allDay: integer("all_day", { mode: "boolean" }).notNull(),
  note: text("note"),
  createdAt: text("created_at").notNull(),
});

export const booking = sqliteTable(
  "booking",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    seriesId: text("series_id").references(() => series.id),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    originalStartsAt: text("original_starts_at").notNull(),
    originalEndsAt: text("original_ends_at").notNull(),
    timezone: text("timezone").notNull().default("Europe/Berlin"),
    allDay: integer("all_day", { mode: "boolean" }).notNull(),
    status: text("status", { enum: ["active", "requested", "cancelled", "ended_early", "rejected"] }).notNull(),
    note: text("note"),
    clientId: text("client_id").notNull().unique(),
    reminderSentAt: text("reminder_sent_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("booking_time_idx").on(t.startsAt, t.endsAt),
    index("booking_owner_idx").on(t.ownerId),
    index("booking_series_idx").on(t.seriesId),
  ],
);

export const request = sqliteTable(
  "request",
  {
    id: text("id").primaryKey(),
    /** The requesting (new) booking. */
    bookingId: text("booking_id")
      .notNull()
      .references(() => booking.id),
    /** The existing booking that was there first. */
    targetBookingId: text("target_booking_id")
      .notNull()
      .references(() => booking.id),
    status: text("status", { enum: ["open", "granted", "partial", "declined", "withdrawn"] }).notNull(),
    counterTime: text("counter_time"),
    decidedBy: text("decided_by").references(() => user.id),
    createdAt: text("created_at").notNull(),
    decidedAt: text("decided_at"),
  },
  (t) => [
    index("request_booking_idx").on(t.bookingId),
    index("request_target_idx").on(t.targetBookingId),
    uniqueIndex("request_open_pair_idx")
      .on(t.bookingId, t.targetBookingId)
      .where(sql`status = 'open'`),
  ],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    at: text("at").notNull(),
    actorId: text("actor_id").references(() => user.id),
    action: text("action").notNull(),
    bookingId: text("booking_id"),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    source: text("source", { enum: ["online", "offline-sync", "admin"] }).notNull(),
  },
  (t) => [index("audit_booking_idx").on(t.bookingId), index("audit_at_idx").on(t.at)],
);

export const pushSubscription = sqliteTable(
  "push_subscription",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("push_user_idx").on(t.userId)],
);

export const notificationPref = sqliteTable(
  "notification_pref",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.type] })],
);

/** Idempotency store: every mutation carries a client UUID; replays return the stored result. */
export const clientAction = sqliteTable("client_action", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  kind: text("kind").notNull(),
  resultJson: text("result_json").notNull(),
  createdAt: text("created_at").notNull(),
});
