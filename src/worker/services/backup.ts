import { sql } from "drizzle-orm";
import type { Db } from "../db/client";

/**
 * Business data exported weekly to the private R2 bucket. Session, verification and OAuth
 * account rows are left out on purpose: they hold tokens, and people can simply sign in again.
 */
const TABLES = ["user", "passkey", "series", "booking", "request", "audit_log", "notification_pref", "push_subscription"] as const;
const KEEP = 12;

export async function exportBackup(db: Db, bucket: R2Bucket, now: Date): Promise<string> {
  const data: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    data[table] = await db.all(sql.raw(`SELECT * FROM "${table}"`));
  }
  const key = `backups/${now.toISOString().slice(0, 10)}.json`;
  await bucket.put(key, JSON.stringify({ exportedAt: now.toISOString(), tables: data }), {
    httpMetadata: { contentType: "application/json" },
  });

  const listed = await bucket.list({ prefix: "backups/" });
  const old = listed.objects
    .map((o) => o.key)
    .sort()
    .slice(0, Math.max(0, listed.objects.length - KEEP));
  if (old.length > 0) await bucket.delete(old);
  return key;
}
