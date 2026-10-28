import type { SyncResponse } from "@shared/api";
import {
  cancelBookingSchema,
  createBookingSchema,
  endNowSchema,
  rangeQuerySchema,
  syncActionSchema,
  updateBookingSchema,
  type SyncAction,
} from "@shared/schemas";
import { MAX_SYNC_ACTIONS } from "@shared/constants";
import { Hono } from "hono";
import { z } from "zod";
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
    const { actions } = await parseBody(c, syncEnvelopeSchema);
    const results: SyncResponse["results"] = [];
    for (const raw of actions) {
      const clientId = rawClientId(raw);
      // Validated per action, so one malformed action does not discard the valid ones.
      const parsed = syncActionSchema.safeParse(raw);
      if (!parsed.success) {
        results.push({ ok: false, error: "invalid", message: parsed.error.issues[0]?.message ?? "Ungültige Aktion", clientId });
        continue;
      }
      const action = parsed.data;
      const ctx = serviceCtx(c, action.queuedOffline);
      try {
        const result = await once(ctx, action.payload.clientId, action.type, () => applySyncAction(ctx, action));
        results.push({ ...result, clientId });
      } catch (err) {
        // Unexpected failure: report it for exactly this action and stop, so the order of the
        // remaining actions is kept. Earlier actions are committed and reported as such.
        console.error("sync action failed", err);
        results.push({ ok: false, error: "server", message: "Konnte gerade nicht gespeichert werden", clientId });
        break;
      }
    }
    return c.json({ results } satisfies SyncResponse);
  });

const syncEnvelopeSchema = z.object({ actions: z.array(z.unknown()).min(1).max(MAX_SYNC_ACTIONS) });

function rawClientId(raw: unknown): string {
  const id = (raw as { payload?: { clientId?: unknown } } | null)?.payload?.clientId;
  return typeof id === "string" ? id.slice(0, 64) : "";
}

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
