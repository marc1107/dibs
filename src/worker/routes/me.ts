import { prefsSchema, pushSubscribeSchema } from "@shared/schemas";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { pushSubscription } from "../db/schema";
import type { AppEnv } from "../env";
import { parseBody, serviceCtx } from "../lib/http";
import { listUsers, regenerateIcalToken, savePushSubscription, updatePrefs } from "../services/users";

/** Endpoints for approved members only (mounted behind requireActive). */
export const memberRoutes = new Hono<AppEnv>()
  .get("/users", async (c) => c.json({ users: await listUsers(c.get("db")) }))
  .put("/me/prefs", async (c) => c.json(await updatePrefs(serviceCtx(c), await parseBody(c, prefsSchema))))
  .post("/me/ical-token", async (c) => c.json(await regenerateIcalToken(serviceCtx(c))))
  .post("/push/subscribe", async (c) => {
    await savePushSubscription(serviceCtx(c), await parseBody(c, pushSubscribeSchema));
    return c.json({ ok: true });
  })
  .post("/push/unsubscribe", async (c) => {
    const { endpoint } = await parseBody(c, z.object({ endpoint: z.string().url() }));
    await c
      .get("db")
      .delete(pushSubscription)
      .where(and(eq(pushSubscription.endpoint, endpoint), eq(pushSubscription.userId, c.get("user").id)));
    return c.json({ ok: true });
  });
