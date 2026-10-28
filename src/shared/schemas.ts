import { z } from "zod";
import {
  MAX_NOTE_LENGTH,
  MAX_OCCURRENCES,
  MAX_SPAN_DAYS,
  NOTIFICATION_TYPES,
  REPEATS,
  START_VIEWS,
} from "./constants";
import { diffDays, toInterval } from "./time";
import { expandOccurrences } from "./series";

const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Datum im Format JJJJ-MM-TT")
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), "Ungültiges Datum");

const slotTime = z.string().regex(/^(([01]\d|2[0-3]):(00|15|30|45)|24:00)$/, "Uhrzeit im 15-Minuten-Raster");

const note = z
  .string()
  .trim()
  .max(MAX_NOTE_LENGTH)
  .optional()
  .transform((v) => (v ? v : null));

const clientId = z.string().uuid();

/** Date/time part shared by create and update. */
const timing = z.object({
  startDate: localDate,
  endDate: localDate,
  allDay: z.boolean(),
  startTime: slotTime.nullish(),
  endTime: slotTime.nullish(),
});

type Timing = z.infer<typeof timing>;

function checkTiming(t: Timing, ctx: z.RefinementCtx) {
  if (diffDays(t.startDate, t.endDate) < 0) {
    ctx.addIssue({ code: "custom", path: ["endDate"], message: "Ende liegt vor dem Beginn" });
    return;
  }
  if (diffDays(t.startDate, t.endDate) > MAX_SPAN_DAYS) {
    ctx.addIssue({ code: "custom", path: ["endDate"], message: `Höchstens ${MAX_SPAN_DAYS} Tage am Stück` });
  }
  if (!t.allDay) {
    if (!t.startTime || !t.endTime) {
      ctx.addIssue({ code: "custom", path: ["startTime"], message: "Von und Bis angeben" });
      return;
    }
    if (t.startTime === "24:00") ctx.addIssue({ code: "custom", path: ["startTime"], message: "Ungültige Startzeit" });
    const { startsAt, endsAt } = toInterval(t);
    if (startsAt >= endsAt) ctx.addIssue({ code: "custom", path: ["endTime"], message: "Ende muss nach dem Beginn liegen" });
  }
}

export const createBookingSchema = timing
  .extend({
    clientId,
    ownerId: z.string().min(1).optional(),
    repeat: z.enum(REPEATS).default("none"),
    until: localDate.nullish(),
    note,
  })
  .superRefine((v, ctx) => {
    checkTiming(v, ctx);
    if (v.repeat !== "none") {
      if (!v.until) {
        ctx.addIssue({ code: "custom", path: ["until"], message: "Enddatum für die Wiederholung angeben" });
        return;
      }
      if (diffDays(v.startDate, v.until) < 0) {
        ctx.addIssue({ code: "custom", path: ["until"], message: "Enddatum liegt vor dem Beginn" });
        return;
      }
      if (expandOccurrences(v).length > MAX_OCCURRENCES) {
        ctx.addIssue({ code: "custom", path: ["until"], message: `Höchstens ${MAX_OCCURRENCES} Termine` });
      }
    }
  });
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const SCOPES = ["this", "following"] as const;
export type Scope = (typeof SCOPES)[number];

export const updateBookingSchema = timing
  .extend({
    clientId,
    note,
    scope: z.enum(SCOPES).default("this"),
    /** updatedAt of the booking as the client last saw it; a mismatch means the server changed it meanwhile. */
    baseUpdatedAt: z.string().nullish(),
  })
  .superRefine(checkTiming);
export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;

export const cancelBookingSchema = z.object({
  clientId,
  scope: z.enum(SCOPES).default("this"),
  baseUpdatedAt: z.string().nullish(),
});
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;

export const endNowSchema = z.object({ clientId });
export type EndNowInput = z.infer<typeof endNowSchema>;

export const respondSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("grant") }),
  z.object({ action: z.literal("decline") }),
  z.object({ action: z.literal("counter"), counterTime: z.string().datetime() }),
]);
export type RespondInput = z.infer<typeof respondSchema>;

const queued = { queuedOffline: z.boolean().default(false) };

export const syncActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create"), payload: createBookingSchema, ...queued }),
  z.object({ type: z.literal("update"), bookingId: z.string().min(1), payload: updateBookingSchema, ...queued }),
  z.object({ type: z.literal("cancel"), bookingId: z.string().min(1), payload: cancelBookingSchema, ...queued }),
  z.object({ type: z.literal("endNow"), bookingId: z.string().min(1), payload: endNowSchema, ...queued }),
]);
export type SyncAction = z.infer<typeof syncActionSchema>;
export type SyncActionInput = z.input<typeof syncActionSchema>;


export const prefsSchema = z.object({
  name: z.string().trim().min(1).max(30).optional(),
  startView: z.enum(START_VIEWS).optional(),
  notifications: z.partialRecord(z.enum(NOTIFICATION_TYPES), z.boolean()).optional(),
});
export type PrefsInput = z.infer<typeof prefsSchema>;

export const pushSubscribeSchema = z.object({
  endpoint: z.string().url().startsWith("https://"),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

export const rangeQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});
