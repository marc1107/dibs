import type { AdminUserDto, MeDto, MemberDto, UserListEntry } from "@shared/api";
import { NOTIFICATION_DEFAULTS, NOTIFICATION_TYPES, PALETTE, type NotificationType } from "@shared/constants";
import type { PrefsInput } from "@shared/schemas";
import { and, asc, desc, eq, gt, inArray, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { auditLog, booking, notificationPref, passkey, pushSubscription, session, user } from "../db/schema";
import { AppError, forbidden, notFound } from "../lib/errors";
import { newSecretToken } from "../lib/ids";
import { cancelBooking, toAuditDto } from "./bookings";
import { auditInsert, type ServiceCtx } from "./context";
import { pushConfigured } from "./push";
import { runBatch } from "../lib/batch";

type UserRow = typeof user.$inferSelect;

export const toMember = (u: UserRow): MemberDto => ({ id: u.id, name: u.name, color: u.color, role: u.role });

/** First palette colour not used by an active or pending user. */
export async function nextFreeColor(db: Db): Promise<string> {
  const used = await db.select({ color: user.color }).from(user).where(inArray(user.status, ["active", "pending"]));
  const taken = new Set(used.map((u) => u.color));
  return PALETTE.find((c) => !taken.has(c)) ?? PALETTE[used.length % PALETTE.length]!;
}

export async function notificationSettings(db: Db, userId: string): Promise<Record<NotificationType, boolean>> {
  const rows = await db.select().from(notificationPref).where(eq(notificationPref.userId, userId));
  const stored = new Map(rows.map((r) => [r.type, r.enabled]));
  return Object.fromEntries(
    NOTIFICATION_TYPES.map((t) => [t, NOTIFICATION_DEFAULTS[t].locked || (stored.get(t) ?? NOTIFICATION_DEFAULTS[t].enabled)]),
  ) as Record<NotificationType, boolean>;
}

export function icalUrl(env: Env, token: string | null): string | null {
  if (!token) return null;
  return `${env.APP_URL.replace(/^https?:/, "webcal:")}/ical/${token}.ics`;
}

export async function getMe(db: Db, env: Env, userId: string): Promise<MeDto> {
  const u = await db.query.user.findFirst({ where: eq(user.id, userId) });
  if (!u) throw notFound();
  return {
    user: { ...toMember(u), email: u.email, status: u.status, startView: u.startView },
    notifications: await notificationSettings(db, userId),
    vapidPublicKey: pushConfigured(env) ? env.VAPID_PUBLIC_KEY : null,
    icalUrl: u.status === "active" ? icalUrl(env, u.icalToken) : null,
  };
}

/** Active members plus removed people (whose past bookings stay visible). Pending people are hidden. */
export async function listUsers(db: Db): Promise<UserListEntry[]> {
  const rows = await db.select().from(user).where(inArray(user.status, ["active", "removed"])).orderBy(asc(user.createdAt));
  return rows.map((u) => ({ ...toMember(u), active: u.status === "active" }));
}

export async function updatePrefs(ctx: ServiceCtx, input: PrefsInput) {
  const changes: Partial<UserRow> = {};
  if (input.name) changes.name = input.name;
  if (input.startView) changes.startView = input.startView;
  if (Object.keys(changes).length > 0) {
    await ctx.db.update(user).set({ ...changes, updatedAt: ctx.now }).where(eq(user.id, ctx.actor.id));
  }
  for (const [type, enabled] of Object.entries(input.notifications ?? {}) as [NotificationType, boolean][]) {
    if (NOTIFICATION_DEFAULTS[type].locked) continue;
    await ctx.db
      .insert(notificationPref)
      .values({ userId: ctx.actor.id, type, enabled })
      .onConflictDoUpdate({ target: [notificationPref.userId, notificationPref.type], set: { enabled } });
  }
  return getMe(ctx.db, ctx.env, ctx.actor.id);
}

export async function regenerateIcalToken(ctx: ServiceCtx) {
  const token = newSecretToken();
  await ctx.db.update(user).set({ icalToken: token, updatedAt: ctx.now }).where(eq(user.id, ctx.actor.id));
  return { icalUrl: icalUrl(ctx.env, token) };
}

export async function savePushSubscription(ctx: ServiceCtx, sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
  await ctx.db
    .insert(pushSubscription)
    .values({
      id: crypto.randomUUID(),
      userId: ctx.actor.id,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      createdAt: ctx.now.toISOString(),
    })
    .onConflictDoUpdate({
      target: pushSubscription.endpoint,
      set: { userId: ctx.actor.id, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export async function adminListUsers(db: Db): Promise<AdminUserDto[]> {
  const rows = await db.select().from(user).orderBy(asc(user.createdAt));
  return rows.map((u) => ({ ...toMember(u), email: u.email, status: u.status, createdAt: u.createdAt.toISOString() }));
}

async function loadUser(ctx: ServiceCtx, id: string) {
  const u = await ctx.db.query.user.findFirst({ where: eq(user.id, id) });
  if (!u) throw notFound("Person nicht gefunden");
  if (u.id === ctx.actor.id) throw forbidden("Das eigene Konto kann so nicht geändert werden");
  return u;
}

function userAudit(ctx: ServiceCtx, u: UserRow, action: string, after: Partial<UserRow>) {
  return auditInsert(ctx, {
    action,
    before: { userId: u.id, name: u.name, status: u.status },
    after: { userId: u.id, name: u.name, ...after },
    source: "admin",
  });
}

export async function approveUser(ctx: ServiceCtx, id: string) {
  const u = await loadUser(ctx, id);
  if (u.status === "active") throw new AppError("conflict", "Bereits freigeschaltet");
  const color = u.status === "removed" ? await nextFreeColor(ctx.db) : u.color;
  await runBatch(ctx.env.DB, [
    ctx.db
      .update(user)
      .set({ status: "active", color, icalToken: u.icalToken ?? newSecretToken(), updatedAt: ctx.now })
      .where(eq(user.id, id)),
    userAudit(ctx, u, "user.approved", { status: "active" }),
  ]);
}

/** Signs a user out everywhere and drops device bindings. */
function revokeAccess(ctx: ServiceCtx, id: string) {
  return [
    ctx.db.delete(session).where(eq(session.userId, id)),
    ctx.db.delete(passkey).where(eq(passkey.userId, id)),
    ctx.db.delete(pushSubscription).where(eq(pushSubscription.userId, id)),
  ] as const;
}

export async function rejectUser(ctx: ServiceCtx, id: string) {
  const u = await loadUser(ctx, id);
  if (u.status !== "pending") throw new AppError("conflict", "Nur wartende Anfragen können abgelehnt werden");
  await runBatch(ctx.env.DB, [
    ctx.db.update(user).set({ status: "removed", icalToken: null, updatedAt: ctx.now }).where(eq(user.id, id)),
    ...revokeAccess(ctx, id),
    userAudit(ctx, u, "user.rejected", { status: "removed" }),
  ]);
}

/**
 * Removes a member: sessions, passkeys, push subscriptions and the iCal feed stop working
 * immediately. Past bookings stay in the history; future ones are cancelled so the car is free.
 */
export async function removeUser(ctx: ServiceCtx, id: string) {
  const u = await loadUser(ctx, id);
  if (u.role === "admin") throw forbidden("Admins können nicht entfernt werden");
  if (u.status === "removed") throw new AppError("conflict", "Bereits entfernt");
  const now = ctx.now.toISOString();
  const future = await ctx.db
    .select()
    .from(booking)
    .where(and(eq(booking.ownerId, id), inArray(booking.status, ["active", "requested"]), gt(booking.endsAt, now)));
  for (const b of future) {
    await cancelBooking(ctx, b.id, { clientId: crypto.randomUUID(), scope: "this" });
  }
  await runBatch(ctx.env.DB, [
    ctx.db.update(user).set({ status: "removed", icalToken: null, updatedAt: ctx.now }).where(eq(user.id, id)),
    ...revokeAccess(ctx, id),
    userAudit(ctx, u, "user.removed", { status: "removed" }),
  ]);
}

export async function adminAudit(db: Db, before?: string) {
  const rows = await db
    .select()
    .from(auditLog)
    .where(before ? lt(auditLog.at, before) : undefined)
    .orderBy(desc(auditLog.at))
    .limit(100);
  return rows.map(toAuditDto);
}
