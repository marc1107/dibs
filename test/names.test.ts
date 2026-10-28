import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { login } from "./helpers";

describe("first names only", () => {
  it("stores only the first name of a new account", async () => {
    const luca = await login("luca@example.com", "Luca Nuber");
    const me = await luca.json<{ user: { name: string } }>("/api/me");
    expect(me.body.user.name).toBe("Luca");
  });

  it("migration shortens existing full names, also with tabs or non-breaking spaces", async () => {
    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, email_verified, role, status, color, ical_token, created_at, updated_at)
       VALUES ('u1', 'Sophie Bohner', 's@example.com', 1, 'member', 'active', '#2563EB', 't1', 0, 0),
              ('u2', 'Marc', 'm@example.com', 1, 'admin', 'active', '#C2410C', 't2', 0, 0),
              ('u3', char(9) || 'Luca' || char(9) || 'Nuber', 'l@example.com', 1, 'member', 'active', '#0B7A6E', 't3', 0, 0),
              ('u4', 'Anna' || char(160) || 'Maria', 'a@example.com', 1, 'member', 'active', '#7C3AED', 't4', 0, 0)`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO "audit_log" (id, at, actor_id, action, before_json, after_json, source)
       VALUES ('a1', '2026-10-28T10:00:00.000Z', 'u2', 'user.approve',
               '{"userId":"u1","name":"Sophie Bohner","status":"pending"}',
               '{"userId":"u1","name":"Sophie Bohner","status":"active"}', 'admin')`,
    ).run();

    const migration = env.TEST_MIGRATIONS.find((m) => m.name.includes("first_names"));
    expect(migration).toBeDefined();
    await env.DB.batch(migration!.queries.map((q) => env.DB.prepare(q)));

    const rows = await env.DB.prepare(`SELECT id, name FROM "user" ORDER BY id`).all<{ id: string; name: string }>();
    expect(rows.results.map((r) => r.name)).toEqual(["Sophie", "Marc", "Luca", "Anna"]);
    const audit = await env.DB.prepare(`SELECT before_json, after_json FROM "audit_log"`).first<{ before_json: string; after_json: string }>();
    expect(JSON.parse(audit!.before_json)).toEqual({ userId: "u1", name: "Sophie", status: "pending" });
    expect(JSON.parse(audit!.after_json)).toEqual({ userId: "u1", name: "Sophie", status: "active" });
  });
});
