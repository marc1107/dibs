import { buildPushHTTPRequest } from "@pushforge/builder";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { pushSubscription } from "../db/schema";

export interface PushPayload {
  title: string;
  body: string;
  /** In-app path opened when the notification is tapped. */
  url: string;
  tag?: string;
}

type Subscription = typeof pushSubscription.$inferSelect;

export function pushConfigured(env: Env): boolean {
  return Boolean(env.VAPID_PRIVATE_KEY && env.VAPID_PUBLIC_KEY && !env.VAPID_PRIVATE_KEY.startsWith("REPLACE_"));
}

/** Sends one Web Push message; removes subscriptions the push service reports as gone. */
export async function sendPush(db: Db, env: Env, sub: Subscription, payload: PushPayload): Promise<void> {
  const { endpoint, headers, body } = await buildPushHTTPRequest({
    privateJWK: env.VAPID_PRIVATE_KEY,
    subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    message: {
      payload: { ...payload },
      adminContact: env.VAPID_SUBJECT,
      options: { ttl: 24 * 3600, urgency: "high", ...(payload.tag ? { topic: payload.tag.slice(0, 32) } : {}) },
    },
  });
  const res = await fetch(endpoint, { method: "POST", headers, body });
  if (res.status === 404 || res.status === 410) {
    await db.delete(pushSubscription).where(eq(pushSubscription.id, sub.id));
  } else if (!res.ok) {
    console.warn("push failed", res.status, await res.text().catch(() => ""));
  }
}
