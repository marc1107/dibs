import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { z } from "zod";
import { createAuth } from "../auth";
import { user } from "../db/schema";
import { devLoginEnabled, type AppEnv } from "../env";
import { parseBody } from "../lib/http";

/**
 * Local-only sign-in for development and automated tests (no Google credentials needed).
 * Responds 404 unless DEV_LOGIN=true AND the request goes to localhost.
 */
export const devRoutes = new Hono<AppEnv>()
  .use(async (c, next) => {
    if (!devLoginEnabled(c.env, c.req.url)) return c.notFound();
    await next();
  })
  .post("/login", async (c) => {
    const { email, name } = await parseBody(c, z.object({ email: z.string().email(), name: z.string().min(1).max(30).optional() }));
    const auth = createAuth(c.env, c.get("db"), c.get("notifier"));
    const ctx = await auth.$context;
    const existing = await c.get("db").query.user.findFirst({ where: eq(user.email, email) });
    const u = existing ?? (await ctx.internalAdapter.createUser({ email, name: name ?? email.split("@")[0]!, emailVerified: true }, { method: "admin" }));
    const session = await ctx.internalAdapter.createSession(u.id).catch(() => null);
    if (!session) return c.json({ ok: false, error: "removed", message: "Zugang entfernt" }, 403);
    const cookie = ctx.authCookies.sessionToken;
    setCookie(c, cookie.name, `${session.token}.${await makeSignature(session.token, ctx.secret)}`, {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: false,
      maxAge: 60 * 60 * 24 * 30,
    });
    return c.json({ ok: true, userId: u.id });
  });
