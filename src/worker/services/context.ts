import type { AuditSource, Role } from "@shared/constants";
import type { Db } from "../db/client";
import { auditLog } from "../db/schema";
import { newId } from "../lib/ids";
import type { Notifier } from "./notifier";

export interface Actor {
  id: string;
  name: string;
  role: Role;
}

/** Everything a service call needs; `now` is injectable so time-dependent rules are testable. */
export interface ServiceCtx {
  db: Db;
  env: Env;
  actor: Actor;
  now: Date;
  /** True when the action was queued offline and is now delivered via /api/sync. */
  queuedOffline: boolean;
  notifier: Notifier;
}

export const isAdmin = (ctx: ServiceCtx) => ctx.actor.role === "admin";
export const nowIso = (ctx: ServiceCtx) => ctx.now.toISOString();

/** Audit source: admin acting on someone else's data, otherwise how the action reached the server. */
export function sourceFor(ctx: ServiceCtx, ownerId: string | null): AuditSource {
  if (isAdmin(ctx) && ownerId !== null && ownerId !== ctx.actor.id) return "admin";
  return ctx.queuedOffline ? "offline-sync" : "online";
}

export function auditInsert(
  ctx: ServiceCtx,
  entry: { action: string; bookingId?: string | null; before?: unknown; after?: unknown; source: AuditSource },
) {
  return ctx.db.insert(auditLog).values({
    id: newId(),
    at: nowIso(ctx),
    actorId: ctx.actor.id,
    action: entry.action,
    bookingId: entry.bookingId ?? null,
    beforeJson: entry.before === undefined ? null : JSON.stringify(entry.before),
    afterJson: entry.after === undefined ? null : JSON.stringify(entry.after),
    source: entry.source,
  });
}
