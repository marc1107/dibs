import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { createAuth } from "./auth";
import { createDb } from "./db/client";
import type { AppEnv } from "./env";
import { AppError } from "./lib/errors";
import { authRateLimit } from "./middleware/rate-limit";
import { requireActive, requireAdmin, requireSession } from "./middleware/session";
import { adminRoutes } from "./routes/admin";
import { bookingRoutes } from "./routes/bookings";
import { devRoutes } from "./routes/dev";
import { memberRoutes } from "./routes/me";
import { requestRoutes } from "./routes/requests";
import { exportBackup } from "./services/backup";
import { buildFeed } from "./services/ical";
import { Notifier } from "./services/notifier";
import { sendDueReminders } from "./services/reminders";
import { getMe } from "./services/users";

const BACKUP_CRON = "0 3 * * 7";

export const app = new Hono<AppEnv>();

// Static assets get their headers from public/_headers; these cover Worker responses.
app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    strictTransportSecurity: "max-age=31536000; includeSubDomains",
    referrerPolicy: "strict-origin-when-cross-origin",
    xFrameOptions: "DENY",
  }),
);

// Per-request DB handle and notifier; notifications go out after the response.
app.use("*", async (c, next) => {
  const notifier = new Notifier();
  const db = createDb(c.env.DB);
  c.set("db", db);
  c.set("notifier", notifier);
  await next();
  if (notifier.size > 0) c.executionCtx.waitUntil(notifier.flush(db, c.env));
});

app.onError((err, c) => {
  if (err instanceof AppError) return c.json(err.toResult(), err.status);
  console.error(err);
  return c.json({ ok: false, error: "server_error", message: "Interner Fehler" }, 500);
});

app.get("/api/health", (c) => c.json({ ok: true }));
app.get("/api/config", (c) => c.json({ turnstileSiteKey: c.env.TURNSTILE_SITE_KEY }));

app.use("/api/auth/*", authRateLimit);
app.on(["GET", "POST"], "/api/auth/*", (c) => createAuth(c.env, c.get("db"), c.get("notifier")).handler(c.req.raw));

app.route("/api/dev", devRoutes);

app.use("/api/*", requireSession);
app.get("/api/me", async (c) => c.json(await getMe(c.get("db"), c.env, c.get("user").id)));

app.use("/api/*", requireActive);
app.use("/api/admin/*", requireAdmin);
app.route("/api", bookingRoutes);
app.route("/api", requestRoutes);
app.route("/api", memberRoutes);
app.route("/api/admin", adminRoutes);
app.all("/api/*", (c) => c.json({ ok: false, error: "not_found", message: "Unbekannter Endpunkt" }, 404));

app.get("/ical/:file{[A-Za-z0-9_-]{20,}\\.ics}", async (c) => {
  const token = c.req.param("file").replace(/\.ics$/, "");
  const feed = await buildFeed(c.get("db"), token, c.req.query("scope") === "mine", new Date());
  if (!feed) return c.text("Not found", 404);
  return c.body(feed, 200, {
    "content-type": "text/calendar; charset=utf-8",
    "cache-control": "private, max-age=300",
  });
});

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    const db = createDb(env.DB);
    const now = new Date(controller.scheduledTime);
    if (controller.cron === BACKUP_CRON) {
      ctx.waitUntil(exportBackup(db, env.BACKUPS, now).then((key) => console.log(`backup written: ${key}`)));
      return;
    }
    const notifier = new Notifier();
    const count = await sendDueReminders(db, notifier, now);
    if (count > 0) ctx.waitUntil(notifier.flush(db, env));
  },
} satisfies ExportedHandler<Env>;
