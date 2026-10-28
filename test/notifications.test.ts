import type { MeDto } from "@shared/api";
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/worker/db/client";
import { exportBackup } from "../src/worker/services/backup";
import { enabledRecipients } from "../src/worker/services/notifier";
import { household, login } from "./helpers";

describe("notification preferences", () => {
  it("uses the documented defaults", async () => {
    const { tim } = await household();
    const me = await tim.json<MeDto>("/api/me");
    expect(me.body.notifications).toEqual({
      approval_request: true,
      request_to_me: true,
      request_answer: true,
      new_booking: true,
      booking_changed: true,
      reminder: false,
    });
  });

  it("lets people switch off optional types but never requests that need an answer", async () => {
    const { tim } = await household();
    const res = await tim.json<MeDto>("/api/me/prefs", {
      method: "PUT",
      json: { notifications: { new_booking: false, request_to_me: false }, startView: "week", name: "Timo" },
    });
    expect(res.body.notifications.new_booking).toBe(false);
    expect(res.body.notifications.request_to_me).toBe(true);
    expect(res.body.user).toMatchObject({ startView: "week", name: "Timo" });
    const db = createDb(env.DB);
    expect(await enabledRecipients(db, [tim.id], "new_booking")).toEqual([]);
    expect(await enabledRecipients(db, [tim.id], "request_to_me")).toEqual([tim.id]);
  });

  it("stores push subscriptions per device", async () => {
    const { tim } = await household();
    const sub = { endpoint: "https://web.push.apple.com/abc", keys: { p256dh: "BKey", auth: "auth" } };
    expect((await tim.fetch("/api/push/subscribe", { method: "POST", json: sub })).status).toBe(200);
    expect((await tim.fetch("/api/push/subscribe", { method: "POST", json: { ...sub, endpoint: "http://insecure" } })).status).toBe(400);
  });

  it("does not notify pending people", async () => {
    await login("marc@example.com");
    const p = await login("p@example.com");
    expect(await enabledRecipients(createDb(env.DB), [p.id], "request_to_me")).toEqual([]);
  });
});

describe("backup", () => {
  it("exports business tables to R2 and leaves out session tokens", async () => {
    await household();
    const key = await exportBackup(createDb(env.DB), env.BACKUPS, new Date("2030-11-03T03:00:00Z"));
    expect(key).toBe("backups/2030-11-03.json");
    const obj = await env.BACKUPS.get(key);
    const data = (await obj!.json()) as { tables: Record<string, unknown[]> };
    expect(data.tables.user).toHaveLength(3);
    expect(Object.keys(data.tables)).not.toContain("session");
    expect(Object.keys(data.tables)).not.toContain("account");
  });
});
