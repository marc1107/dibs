import { Hono } from "hono";
import type { AppEnv } from "../env";
import { serviceCtx } from "../lib/http";
import { adminAudit, adminListUsers, approveUser, rejectUser, removeUser } from "../services/users";

export const adminRoutes = new Hono<AppEnv>()
  .get("/users", async (c) => c.json({ users: await adminListUsers(c.get("db")) }))
  .post("/users/:id/approve", async (c) => {
    await approveUser(serviceCtx(c), c.req.param("id"));
    return c.json({ ok: true });
  })
  .post("/users/:id/reject", async (c) => {
    await rejectUser(serviceCtx(c), c.req.param("id"));
    return c.json({ ok: true });
  })
  .post("/users/:id/remove", async (c) => {
    await removeUser(serviceCtx(c), c.req.param("id"));
    return c.json({ ok: true });
  })
  .get("/audit", async (c) => c.json({ entries: await adminAudit(c.get("db"), c.req.query("before")) }));
