import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";

/** Workers Rate Limiting binding in front of the auth endpoints (per client IP). */
export const authRateLimit = createMiddleware<AppEnv>(async (c, next) => {
  const key = c.req.header("cf-connecting-ip") ?? "local";
  const { success } = await c.env.AUTH_LIMITER.limit({ key });
  if (!success) return c.json({ ok: false, error: "rate_limited", message: "Zu viele Versuche, bitte kurz warten" }, 429);
  await next();
});
