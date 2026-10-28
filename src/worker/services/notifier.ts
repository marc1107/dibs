import { NOTIFICATION_DEFAULTS, type NotificationType } from "@shared/constants";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { notificationPref, pushSubscription, user } from "../db/schema";
import { pushConfigured, sendPush, type PushPayload } from "./push";

interface Pending {
  userIds: string[];
  type: NotificationType;
  payload: PushPayload;
}

/**
 * Collects notifications during a request and delivers them afterwards (via waitUntil),
 * so push latency never delays the API response and nothing is sent for rolled-back work.
 */
export class Notifier {
  private pending: Pending[] = [];

  add(userIds: (string | null | undefined)[], type: NotificationType, payload: PushPayload) {
    const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
    if (ids.length > 0) this.pending.push({ userIds: ids, type, payload });
  }

  get size() {
    return this.pending.length;
  }

  /** For tests and logging. */
  peek(): readonly Pending[] {
    return this.pending;
  }

  async flush(db: Db, env: Env): Promise<void> {
    const batch = this.pending;
    this.pending = [];
    if (batch.length === 0) return;
    if (!pushConfigured(env)) {
      for (const n of batch) console.log(`[push disabled] ${n.type} → ${n.userIds.join(",")}: ${n.payload.title}`);
      return;
    }
    for (const n of batch) {
      const recipients = await enabledRecipients(db, n.userIds, n.type);
      if (recipients.length === 0) continue;
      const subs = await db.select().from(pushSubscription).where(inArray(pushSubscription.userId, recipients));
      await Promise.allSettled(subs.map((s) => sendPush(db, env, s, n.payload)));
    }
  }
}

/** Active users that have this notification type enabled (locked types are always on). */
export async function enabledRecipients(db: Db, userIds: string[], type: NotificationType): Promise<string[]> {
  const active = await db
    .select({ id: user.id })
    .from(user)
    .where(and(inArray(user.id, userIds), eq(user.status, "active")));
  const ids = active.map((u) => u.id);
  const def = NOTIFICATION_DEFAULTS[type];
  if (def.locked || ids.length === 0) return ids;
  const prefs = await db
    .select()
    .from(notificationPref)
    .where(and(inArray(notificationPref.userId, ids), eq(notificationPref.type, type)));
  const byUser = new Map(prefs.map((p) => [p.userId, p.enabled]));
  return ids.filter((id) => byUser.get(id) ?? def.enabled);
}
