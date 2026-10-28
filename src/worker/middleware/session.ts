import { createMiddleware } from "hono/factory";
import { createAuth } from "../auth";
import type { AppEnv, SessionUser } from "../env";

/** Resolves the Better Auth session; 401 without one, 403 for removed people. */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const auth = createAuth(c.env, c.get("db"), c.get("notifier"));
  const result = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!result) return c.json({ ok: false, error: "unauthenticated", message: "Bitte anmelden" }, 401);
  const user = result.user as unknown as SessionUser;
  if (user.status === "removed") return c.json({ ok: false, error: "removed", message: "Zugang entfernt" }, 403);
  c.set("user", user);
  await next();
});

/** Every endpoint except /api/me and auth requires an approved (active) member. */
export const requireActive = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get("user").status !== "active") {
    return c.json({ ok: false, error: "pending", message: "Wartet auf Freigabe" }, 403);
  }
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get("user").role !== "admin") return c.json({ ok: false, error: "forbidden", message: "Nur für den Admin" }, 403);
  await next();
});
