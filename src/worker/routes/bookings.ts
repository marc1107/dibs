import type { SyncResponse } from "@shared/api";
import {
  cancelBookingSchema,
  createBookingSchema,
  endNowSchema,
  rangeQuerySchema,
  syncSchema,
  updateBookingSchema,
  type SyncAction,
} from "@shared/schemas";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { parseBody, parseValue, sendResult, serviceCtx } from "../lib/http";
import { bookingDetail, bookingsInRange, cancelBooking, createBooking, endNow, history, updateBooking } from "../services/bookings";
import type { ServiceCtx } from "../services/context";
import { once } from "../services/idempotency";

export const bookingRoutes = new Hono<AppEnv>()
  .get("/bookings", async (c) => {
    const { from, to } = parseValue(rangeQuerySchema, c.req.query());
    return c.json(await bookingsInRange(serviceCtx(c), from, to));
  })
  .post("/bookings", async (c) => {
    const input = await parseBody(c, createBookingSchema);
    const ctx = serviceCtx(c);
    return sendResult(c, await once(ctx, input.clientId, "create", () => createBooking(ctx, input)));
  })
  .get("/bookings/:id", async (c) => c.json(await bookingDetail(serviceCtx(c), c.req.param("id"))))
  .patch("/bookings/:id", async (c) => {
    const input = await parseBody(c, updateBookingSchema);
    const ctx = serviceCtx(c);
    return sendResult(c, await once(ctx, input.clientId, "update", () => updateBooking(ctx, c.req.param("id"), input)));
  })
  .post("/bookings/:id/cancel", async (c) => {
    const input = await parseBody(c, cancelBookingSchema);
    const ctx = serviceCtx(c);
    return sendResult(c, await once(ctx, input.clientId, "cancel", () => cancelBooking(ctx, c.req.param("id"), input)));
  })
  .post("/bookings/:id/end-now", async (c) => {
    const input = await parseBody(c, endNowSchema);
    const ctx = serviceCtx(c);
    return sendResult(c, await once(ctx, input.clientId, "endNow", () => endNow(ctx, c.req.param("id"))));
  })
  .get("/history", async (c) => c.json(await history(serviceCtx(c))))
  /**
   * Offline outbox: actions are applied strictly in order, each idempotent by its client UUID.
   * The server's receive time counts, conflicts become regular requests (see createBooking).
   */
  .post("/sync", async (c) => {
    const { actions } = await parseBody(c, syncSchema);
    const results: SyncResponse["results"] = [];
    for (const action of actions) {
      const ctx = serviceCtx(c, action.queuedOffline);
      const result = await once(ctx, action.payload.clientId, action.type, () => applySyncAction(ctx, action));
      results.push({ ...result, clientId: action.payload.clientId });
    }
    return c.json({ results } satisfies SyncResponse);
  });

function applySyncAction(ctx: ServiceCtx, action: SyncAction) {
  switch (action.type) {
    case "create":
      return createBooking(ctx, action.payload);
    case "update":
      return updateBooking(ctx, action.bookingId, action.payload);
    case "cancel":
      return cancelBooking(ctx, action.bookingId, action.payload);
    case "endNow":
      return endNow(ctx, action.bookingId);
  }
}
