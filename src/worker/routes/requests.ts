import { respondSchema } from "@shared/schemas";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { parseBody, serviceCtx } from "../lib/http";
import { getRequest, listRequests, respond, withdraw } from "../services/requests";

export const requestRoutes = new Hono<AppEnv>()
  .get("/requests", async (c) => c.json(await listRequests(serviceCtx(c))))
  .get("/requests/:id", async (c) => c.json(await getRequest(serviceCtx(c), c.req.param("id"))))
  .post("/requests/:id/respond", async (c) => {
    const input = await parseBody(c, respondSchema);
    return c.json(await respond(serviceCtx(c), c.req.param("id"), input));
  })
  .post("/requests/:id/withdraw", async (c) => c.json(await withdraw(serviceCtx(c), c.req.param("id"))));
